/**
 * recover.ts
 *
 * Recovery entrypoint — criterion 5.
 *
 * Given only:
 *   - A Bee endpoint
 *   - The public Feed owner address
 *   - The public Feed topic (or topic string)
 *
 * …this module:
 *   1. Reads the Feed from the network to get the latest manifest reference.
 *   2. Downloads the manifest from Swarm.
 *   3. Enumerates every file in the archive.
 *   4. Downloads each file and writes it to a local recovery directory.
 *
 * No local state, no database, no publisher private key, no archive index.
 *
 * Empty Feed handling — criterion 7:
 *   `FeedReader.downloadReference()` throws `BeeResponseError` (HTTP 404)
 *   when the feed has no updates yet.  We catch this and display
 *   "No archive has been published yet." instead of crashing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Bee } from '@ethersphere/bee-js';
import { BeeResponseError } from '@ethersphere/bee-js';
import { Topic, EthAddress } from '@ethersphere/core-sdk';
import { getBeeUrl, readArchiveConfig, ARCHIVE_TOPIC_STRING } from './config';
import { decodeManifest } from './manifest';
import { readPostageLifetime, printPostageLifetime } from './postage';

export interface RecoveryOptions {
  /** Bee node HTTP endpoint. */
  beeUrl?: string;
  /** Owner's Ethereum address (hex, with or without 0x prefix). */
  ownerAddress?: string;
  /** Topic in hex form (64 chars). Takes precedence over `topicString`. */
  topic?: string;
  /** Human-readable topic string; used to derive the topic hex via keccak256. */
  topicString?: string;
  /** Directory to write recovered files into. */
  outputDir?: string;
}

/**
 * Resolves recovery parameters from CLI options, falling back to the tracked
 * `published/archive.json` when flags are omitted.
 */
function resolveOptions(opts: RecoveryOptions): {
  beeUrl: string;
  ownerAddress: string;
  topic: Topic;
  outputDir: string;
} {
  const config = readArchiveConfig();

  const beeUrl = opts.beeUrl ?? getBeeUrl();

  const ownerAddress = opts.ownerAddress ?? config?.ownerAddress;
  if (!ownerAddress) {
    throw new Error(
      'Owner address is required.\n' +
      'Pass --owner <address> or ensure published/archive.json exists.',
    );
  }

  let topic: Topic;
  if (opts.topic) {
    topic = new Topic(opts.topic.startsWith('0x') ? opts.topic.slice(2) : opts.topic);
  } else if (opts.topicString) {
    topic = Topic.fromString(opts.topicString);
  } else if (config?.topic) {
    topic = new Topic(config.topic);
  } else {
    // Fall back to the well-known archive topic
    topic = Topic.fromString(ARCHIVE_TOPIC_STRING);
  }

  const outputDir =
    opts.outputDir ?? path.resolve(__dirname, '..', 'recovered');

  return { beeUrl, ownerAddress, topic, outputDir };
}

/**
 * Secures the extraction path by preventing directory traversal attacks.
 * Resolves the destination safely against the output directory.
 */
export function resolveAndValidatePath(outputDir: string, relativePath: string): string {
  const resolvedOutput = path.resolve(outputDir);
  const destPath = path.resolve(resolvedOutput, relativePath);

  // By appending path.sep, we prevent matching prefixes like /data and /data-leak
  // This effectively sandboxes file creation to explicitly inside outputDir
  if (!destPath.startsWith(resolvedOutput + path.sep)) {
    throw new Error(`Security Violation: Path traversal attempt blocked for '${relativePath}'`);
  }

  return destPath;
}

/**
 * Recovery pipeline.  Downloads and reconstructs the archive from Swarm.
 */
export async function recover(opts: RecoveryOptions = {}): Promise<void> {
  console.log('🐝 swarm-archive — recovery');
  console.log('════════════════════════════');

  const { beeUrl, ownerAddress, topic, outputDir } = resolveOptions(opts);
  const bee = new Bee(beeUrl);

  console.log(`   Bee URL      : ${beeUrl}`);
  console.log(`   Owner        : ${ownerAddress}`);
  console.log(`   Topic hex    : ${topic.toHex()}`);
  console.log(`   Output dir   : ${outputDir}`);

  // ── Step 1: read the latest Feed update ───────────────────────────────────
  //
  // `downloadReference()` fetches `GET /feeds/{owner}/{topic}` and returns
  // the 32-byte reference stored in the latest SOC payload.
  //
  // Criterion 7: if the Feed has never been updated the Bee node returns
  // HTTP 404, which bee-js surfaces as a `BeeResponseError`.  We catch it
  // and print a friendly message.

  console.log('\n📡 Reading latest Feed update…');
  const reader = bee.feed.makeReader(topic, ownerAddress);

  let manifestReference: string;
  try {
    const result = await reader.downloadReference();
    manifestReference = result.reference.toHex();
    console.log(`   Feed index     : ${result.feedIndex.toBigInt()}`);
    console.log(`   Manifest ref   : ${manifestReference}`);
  } catch (err: unknown) {
    if (err instanceof BeeResponseError && err.status === 404) {
      // Criterion 7: empty Feed — defined, friendly result.
      console.log('\nℹ️  No archive has been published yet.');
      console.log(
        '   The Feed exists but has received no updates.\n' +
        '   Run the publisher to create the first archive entry.',
      );
      return;
    }
    throw err;
  }

  // ── Step 2: download the manifest ─────────────────────────────────────────
  console.log('\n📋 Downloading collection manifest…');
  const manifestBytes = await bee.data.download(manifestReference);
  const manifest = decodeManifest(manifestBytes.toUint8Array());

  console.log(`   Version      : ${manifest.version}`);
  console.log(`   Published at : ${manifest.publishedAt}`);
  console.log(`   Files        : ${manifest.entries.length}`);

  // ── Step 3: enumerate and download every file ──────────────────────────────
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\n📂 Recovering ${manifest.entries.length} file(s) to "${outputDir}"…`);

  for (const entry of manifest.entries) {
    const destPath = resolveAndValidatePath(outputDir, entry.path);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    process.stdout.write(`   Downloading "${entry.path}" (${entry.size} B)… `);

    const fileData = await bee.file.download(entry.reference);
    const dataUint8 = 'toUint8Array' in fileData.data ? fileData.data.toUint8Array() : (fileData.data as Uint8Array);
    fs.writeFileSync(destPath, dataUint8);

    console.log('✓');
  }

  // ── Postage lifetime (informational) ─────────────────────────────────────
  // We can only show lifetime if we know the batch ID — for a stranger who
  // only knows the Feed identifiers this is not required, so we skip it.
  const config = readArchiveConfig();
  // Attempt to show lifetime if SWARM_BATCH_ID is in the environment
  if (process.env.SWARM_BATCH_ID) {
    try {
      const lifetime = await readPostageLifetime(bee, process.env.SWARM_BATCH_ID);
      printPostageLifetime(lifetime);
    } catch {
      // Non-fatal for recovery
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Archive recovered successfully!');
  console.log(`   ${manifest.entries.length} file(s) written to: ${outputDir}`);
  console.log('\n   Recovered files:');
  for (const entry of manifest.entries) {
    console.log(`   - ${entry.path} (${entry.size} B)`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

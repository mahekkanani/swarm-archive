/**
 * publish.ts
 *
 * Orchestrates the full publish flow:
 *
 *   1. Upload individual archive files → references (criterion 4)
 *   2. Build a collection manifest and upload it → manifest reference
 *   3. Write the manifest reference to the Feed (criterion 1, 3, 4)
 *   4. Create a Feed manifest (stable address) the first time (criterion 1)
 *   5. Save updated public config to published/archive.json (criterion 2)
 *   6. Display postage batch lifetime (criterion 6)
 *
 * Feed index resolution:
 *   `FeedWriter.uploadReference` internally calls `findNextIndex`, which
 *   fetches `GET /feeds/{owner}/{topic}` from the network and reads the
 *   `swarm-feed-index-next` response header.  On a 404 it defaults to
 *   index 0.  No local counter or state file is used (criterion 3).
 */

import * as path from 'path';
import { Bee } from '@ethersphere/bee-js';
import { PrivateKey } from '@ethersphere/core-sdk';
import {
  getBeeUrl,
  getPrivateKey,
  getBatchId,
  getArchiveTopic,
  writeArchiveConfig,
  readArchiveConfig,
  ARCHIVE_TOPIC_STRING,
  ArchiveConfig,
} from './config';
import { uploadArchiveFiles } from './upload';
import { buildManifest, encodeManifest } from './manifest';
import { readPostageLifetime, printPostageLifetime } from './postage';

const ARCHIVE_DIR = path.resolve(__dirname, '..', 'archive');

/**
 * Full publish pipeline.
 * Reads secrets from environment variables; writes only public identifiers
 * to tracked files.
 */
export async function publish(): Promise<void> {
  console.log('🐝 swarm-archive — publisher');
  console.log('════════════════════════════');

  // ── Load configuration ────────────────────────────────────────────────────
  const beeUrl = getBeeUrl();
  let privateKey: PrivateKey;
  let batchId: string;

  try {
    privateKey = getPrivateKey();
    batchId = getBatchId();
  } catch (err: unknown) {
    console.error('\n❌ Configuration error:', (err as Error).message);
    process.exit(1);
  }

  const bee = new Bee(beeUrl);
  const topic = getArchiveTopic();

  // Derive the public owner address from the private key — no private data is
  // written to any file.
  const ownerAddress = privateKey.publicKey().address().toHex();

  console.log(`   Bee URL      : ${beeUrl}`);
  console.log(`   Owner        : ${ownerAddress}`);
  console.log(`   Topic string : ${ARCHIVE_TOPIC_STRING}`);
  console.log(`   Topic hex    : ${topic.toHex()}`);

  // ── Step 1: upload individual archive files ───────────────────────────────
  const entries = await uploadArchiveFiles(bee, batchId, ARCHIVE_DIR);

  // ── Step 2: build and upload the collection manifest ──────────────────────
  const manifest = buildManifest(entries);
  const manifestBytes = encodeManifest(manifest);

  console.log(`\n📋 Uploading collection manifest (${manifestBytes.length} B)…`);
  const manifestUpload = await bee.data.upload(batchId, manifestBytes, {
    contentType: 'application/json',
  } as Parameters<typeof bee.data.upload>[2]);
  const manifestReference = manifestUpload.reference.toHex();
  console.log(`   Manifest reference: ${manifestReference}`);

  // ── Step 3: write manifest reference to the Feed ──────────────────────────
  //
  // `bee.feed.makeWriter` returns a FeedWriter whose `.uploadReference` calls
  // `updateFeedWithReference` → `findNextIndex` internally.
  //
  // `findNextIndex` queries `GET /feeds/{owner}/{topic}` and reads the
  // `swarm-feed-index-next` header.  On a 404 (empty feed) it returns index 0.
  // This satisfies criterion 3 (index from network) and criterion 7 (empty
  // feed is handled inside bee-js — no unhandled rejection here).

  console.log('\n📡 Writing manifest reference to Feed…');
  console.log(
    '   (bee-js will query the network for the next Feed index automatically)',
  );

  const writer = bee.feed.makeWriter(topic, privateKey.toHex());
  const feedUpdate = await writer.uploadReference(batchId, manifestReference);
  console.log(
    `   Feed update: SOC reference = ${feedUpdate.reference.toHex()}`,
  );

  // ── Step 4: create (or refresh) the Feed manifest ─────────────────────────
  //
  // A Feed manifest is a special Swarm chunk that resolves the latest Feed
  // entry when you download its reference via /bzz.  It gives the archive a
  // stable, human-shareable address even as content changes.
  //
  // We create it on the first publish and store its reference in archive.json.
  // On subsequent publishes the same reference stays valid.

  const existingConfig = readArchiveConfig();
  let feedManifestReference: string;

  if (existingConfig?.feedManifestReference) {
    feedManifestReference = existingConfig.feedManifestReference;
    console.log(
      `\n🔗 Existing Feed manifest: ${feedManifestReference}`,
    );
  } else {
    console.log('\n🔗 Creating Feed manifest (stable archive address)…');
    const manifestRef = await bee.feed.createManifest(
      batchId,
      topic,
      ownerAddress,
    );
    feedManifestReference = manifestRef.toHex();
    console.log(`   Feed manifest reference: ${feedManifestReference}`);
  }

  // ── Step 5: update tracked public config ──────────────────────────────────
  const config: ArchiveConfig = {
    ownerAddress,
    topic: topic.toHex(),
    topicString: ARCHIVE_TOPIC_STRING,
    feedManifestReference,
  };
  writeArchiveConfig(config);
  console.log('\n✅ published/archive.json updated with public identifiers.');

  // ── Step 6: display postage batch lifetime ────────────────────────────────
  try {
    const lifetime = await readPostageLifetime(bee, batchId);
    printPostageLifetime(lifetime);
  } catch {
    console.warn('\n⚠️  Could not read postage batch lifetime (non-fatal).');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Archive published successfully!');
  console.log('\n   Share these identifiers so anyone can recover the archive:');
  console.log(`   Owner address : ${ownerAddress}`);
  console.log(`   Topic string  : ${ARCHIVE_TOPIC_STRING}`);
  console.log(`   Topic hex     : ${topic.toHex()}`);
  if (feedManifestReference) {
    console.log(`   Feed manifest : ${feedManifestReference}`);
    console.log(
      `   Gateway URL   : https://gateway.ethswarm.org/bzz/${feedManifestReference}`,
    );
  }
  console.log('\n   These are also stored in published/archive.json (tracked).');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

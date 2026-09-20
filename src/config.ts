/**
 * config.ts
 *
 * Reads runtime configuration from environment variables.
 * Secrets (private key, batch ID) are consumed here and never written to
 * tracked files.  Public identifiers (owner address, topic) are read from
 * `published/archive.json`, which IS tracked.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrivateKey, Topic } from '@ethersphere/core-sdk';

// Load .env from project root if it exists (silently skipped in production)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// ── Bee node ──────────────────────────────────────────────────────────────────

export function getBeeUrl(): string {
  return process.env.BEE_URL ?? 'http://localhost:1633';
}

// ── Private credentials (only available to the publisher) ────────────────────

/**
 * Loads the secp256k1 private key from BEE_PRIVATE_KEY or SWARM_PRIVATE_KEY.
 * Throws a descriptive error if neither is set.
 */
export function getPrivateKey(): PrivateKey {
  const raw = process.env.BEE_PRIVATE_KEY ?? process.env.SWARM_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      'Private key not found.\n' +
      'Set BEE_PRIVATE_KEY (or SWARM_PRIVATE_KEY) in .env or your shell.\n' +
      'See .env.example for guidance.',
    );
  }
  return new PrivateKey(raw.startsWith('0x') ? raw.slice(2) : raw);
}

/**
 * Loads the postage batch ID from SWARM_BATCH_ID.
 * Throws a descriptive error if not set.
 */
export function getBatchId(): string {
  const id = process.env.SWARM_BATCH_ID;
  if (!id) {
    throw new Error(
      'Postage batch ID not found.\n' +
      'Set SWARM_BATCH_ID in .env or your shell.\n' +
      'See .env.example for guidance.',
    );
  }
  return id;
}

// ── Public archive identifiers (tracked in published/archive.json) ────────────

/** Shape of the tracked public configuration file. */
export interface ArchiveConfig {
  /** Ethereum address derived from the publisher's public key (hex, no 0x prefix). */
  ownerAddress: string;
  /** 32-byte keccak of the human-readable topic string (hex). */
  topic: string;
  /** Human-readable topic string used to derive the topic bytes. */
  topicString: string;
  /** Feed manifest reference: a stable Swarm address pointing to the feed. */
  feedManifestReference?: string;
}

const ARCHIVE_CONFIG_PATH = path.resolve(__dirname, '..', 'published', 'archive.json');

/** The canonical topic label for this archive. */
export const ARCHIVE_TOPIC_STRING = 'eight-hundred-winters-archive-v1';

/**
 * Returns the Topic bytes for this archive.
 * `Topic.fromString` hashes the label with keccak256.
 */
export function getArchiveTopic(): Topic {
  return Topic.fromString(ARCHIVE_TOPIC_STRING);
}

/**
 * Reads the tracked public configuration file.
 * Returns null if the file does not exist yet.
 */
export function readArchiveConfig(): ArchiveConfig | null {
  if (!fs.existsSync(ARCHIVE_CONFIG_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(ARCHIVE_CONFIG_PATH, 'utf8');
  return JSON.parse(raw) as ArchiveConfig;
}

/**
 * Writes (or updates) the tracked public configuration file.
 * This file is committed to the repository so strangers can recover the archive.
 */
export function writeArchiveConfig(config: ArchiveConfig): void {
  const dir = path.dirname(ARCHIVE_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ARCHIVE_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

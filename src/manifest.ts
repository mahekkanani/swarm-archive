/**
 * manifest.ts
 *
 * Defines the shape of the collection manifest stored on Swarm, and helpers
 * for building and parsing it.
 *
 * The manifest is a JSON document that lists every file in the archive with
 * its name, Swarm reference, content-type, and size.  It is uploaded
 * separately from the files themselves, so the Feed only needs to carry the
 * 32-byte manifest reference.
 *
 * Acceptance criterion 4: large content is written to the Feed *by reference*.
 */

import { Reference } from '@ethersphere/core-sdk';

export interface ManifestEntry {
  /** Archive-relative path, e.g. "docs/chapter-01.txt". */
  path: string;
  /** Swarm reference (64 hex chars) of the individual file. */
  reference: string;
  /** MIME type, e.g. "text/plain". */
  contentType: string;
  /** File size in bytes. */
  size: number;
}

export interface ArchiveManifest {
  /** Manifest schema version — increment if the shape changes. */
  version: 1;
  /** ISO-8601 timestamp of when this version was published. */
  publishedAt: string;
  /** Human-readable archive title. */
  title: string;
  /** All files in the archive. */
  entries: ManifestEntry[];
}

/**
 * Creates a new `ArchiveManifest` from a list of entries.
 */
export function buildManifest(entries: ManifestEntry[]): ArchiveManifest {
  return {
    version: 1,
    publishedAt: new Date().toISOString(),
    title: 'Eight Hundred Winters — Archive',
    entries,
  };
}

/**
 * Serialises a manifest to UTF-8 JSON bytes for uploading.
 */
export function encodeManifest(manifest: ArchiveManifest): Uint8Array {
  return Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Parses a manifest from raw bytes returned by `bee.data.download`.
 * Strict validation ensures payload parameters are well-formed before processing.
 * Throws if the bytes are not valid JSON matching the expected shape.
 */
export function decodeManifest(bytes: Uint8Array): ArchiveManifest {
  const text = Buffer.from(bytes).toString('utf8');
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new Error('Manifest is not valid JSON.');
  }

  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Invalid manifest format: not an object.');
  }
  if (obj.version !== 1) {
    throw new Error('Invalid manifest format: unsupported version.');
  }
  if (!Array.isArray(obj.entries)) {
    throw new Error('Invalid manifest format: entries is not an array.');
  }

  for (const entry of obj.entries) {
    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      throw new Error('Invalid entry: path must be a non-empty string.');
    }
    if (typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid entry: size must be a positive safe integer for ${entry.path}.`);
    }
    if (typeof entry.contentType !== 'string') {
      throw new Error(`Invalid entry: content type must be a string for ${entry.path}.`);
    }
    if (typeof entry.reference !== 'string' || !Reference.isValid(entry.reference)) {
      throw new Error(`Invalid entry: reference is completely malformed for ${entry.path}.`);
    }
  }

  return obj as ArchiveManifest;
}

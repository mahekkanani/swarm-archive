/**
 * upload.ts
 *
 * Uploads individual archive files to Swarm and returns their references.
 * Each file is uploaded separately so that the manifest can reference each
 * one individually, and so the Feed payload remains a compact 32-byte
 * manifest reference (not the full content).
 *
 * Acceptance criterion 4: large content written to Feed by reference.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Bee } from '@ethersphere/bee-js';
import { ManifestEntry } from './manifest';

/**
 * Walks a directory recursively and returns all file paths relative to `dir`.
 */
export function listArchiveFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string, prefix: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }

  walk(dir, '');
  return files.sort();
}

/**
 * Guesses a MIME content-type from a file extension.
 * Falls back to `application/octet-stream`.
 */
function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Uploads every file in `archiveDir` to Swarm individually.
 *
 * Returns an array of `ManifestEntry` objects — one per file — each
 * containing the file's archive-relative path, its Swarm reference, its
 * MIME type, and its byte size.
 *
 * @param bee        - Initialised Bee client.
 * @param batchId    - Usable postage batch ID.
 * @param archiveDir - Local directory whose contents form the archive.
 */
export async function uploadArchiveFiles(
  bee: Bee,
  batchId: string,
  archiveDir: string,
): Promise<ManifestEntry[]> {
  const relPaths = listArchiveFiles(archiveDir);

  if (relPaths.length === 0) {
    throw new Error(
      `Archive directory "${archiveDir}" is empty or does not exist.\n` +
      'Add files to the archive/ directory before publishing.',
    );
  }

  console.log(`\n📂 Uploading ${relPaths.length} file(s) from "${archiveDir}"…`);

  const entries: ManifestEntry[] = [];

  for (const relPath of relPaths) {
    const fullPath = path.join(archiveDir, relPath);
    const data = fs.readFileSync(fullPath);
    const contentType = guessContentType(relPath);

    process.stdout.write(`   Uploading "${relPath}" (${data.length} B)… `);

    const result = await bee.file.upload(batchId, data, relPath, {
      contentType,
    });

    const reference = result.reference.toHex();
    console.log(`✓ ${reference.slice(0, 12)}…`);

    entries.push({
      path: relPath,
      reference,
      contentType,
      size: data.length,
    });
  }

  return entries;
}

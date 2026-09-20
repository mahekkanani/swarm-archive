/**
 * run.ts
 *
 * Runs a basic test suite ensuring the manifest encodings match what's expected,
 * and that path traversal protections securely contain arbitrary payload values.
 * E2E tests against a real Bee node are tricky to mock perfectly without credentials,
 * so we focus on asserting deterministic application behavior and safety.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';
import { buildManifest, encodeManifest, decodeManifest, ManifestEntry } from '../src/manifest';
import { resolveAndValidatePath } from '../src/recover';

function assertThrows(fn: () => void, errorRegex: RegExp, description: string) {
  try {
    fn();
    throw new Error(`Expected test to throw, but it succeeded: ${description}`);
  } catch (err: unknown) {
    if (err instanceof Error && errorRegex.test(err.message)) {
      // Expected success
      return;
    }
    throw new Error(`Unexpected error thrown in test '${description}': ${(err as Error).message}`);
  }
}

function testManifestRoundTrip() {
  console.log('Running manifest round-trip test...');
  const entries: ManifestEntry[] = [
    {
      path: 'test.html',
      reference: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      contentType: 'text/html',
      size: 1024,
    },
  ];

  const manifest = buildManifest(entries);
  const bytes = encodeManifest(manifest);
  const decoded = decodeManifest(bytes);

  if (decoded.entries[0].path !== 'test.html') {
    throw new Error('Manifest round-trip failed path check!');
  }
  if (decoded.entries[0].reference !== entries[0].reference) {
    throw new Error('Manifest round-trip failed reference check!');
  }
  if (decoded.version !== 1) {
    throw new Error('Manifest version is wrong!');
  }

  console.log('✓ Manifest round-trip passing!');
}

function testManifestValidations() {
  console.log('Running manifest validation test...');

  const baseJson = {
    version: 1,
    publishedAt: "2026-09-20T00:00:00Z",
    title: "Test",
    entries: [] as any[]
  };

  // Missing version
  assertThrows(
    () => decodeManifest(Buffer.from(JSON.stringify({ ...baseJson, version: 2 }))),
    /unsupported version/,
    'Rejects bad version'
  );

  // Bad reference
  assertThrows(
    () => decodeManifest(Buffer.from(JSON.stringify({
      ...baseJson,
      entries: [{ path: 'fine.txt', reference: 'not-hex', contentType: 'text/plain', size: 100 }]
    }))),
    /reference is completely malformed/,
    'Rejects bad reference'
  );

  // Bad size
  assertThrows(
    () => decodeManifest(Buffer.from(JSON.stringify({
      ...baseJson,
      entries: [{ path: 'fine.txt', reference: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', contentType: 'text/plain', size: -50 }]
    }))),
    /size must be a positive safe integer/,
    'Rejects negative size'
  );

  console.log('✓ Manifest validations passing!');
}

function testPathTraversalProtection() {
  console.log('Running path traversal protection tests...');
  const outputDir = path.resolve(__dirname, '..', 'recovered');
  const normalizedOutputDir = outputDir + path.sep;

  // 1. Normal filename
  const normal = resolveAndValidatePath(outputDir, 'file.txt');
  if (normal !== path.join(outputDir, 'file.txt')) throw new Error('Normal file failed');

  // 2. Nested valid filename
  const nested = resolveAndValidatePath(outputDir, 'chapters/file.txt');
  if (nested !== path.join(outputDir, 'chapters', 'file.txt')) throw new Error('Nested file failed');

  // 3. ../outside.txt
  assertThrows(
    () => resolveAndValidatePath(outputDir, '../outside.txt'),
    /Security Violation/,
    'Traversing up one level'
  );

  // 4. ../../outside.txt
  assertThrows(
    () => resolveAndValidatePath(outputDir, '../../outside.txt'),
    /Security Violation/,
    'Traversing up multiple levels'
  );

  // 5. Absolute path attempting overwrite (e.g. /etc/passwd or C:\\Windows)
  // path.join(outputDir, '/etc/passwd') would just append, but path.resolve(outputDir, '/etc/passwd') resolves to the root.
  assertThrows(
    () => resolveAndValidatePath(outputDir, '/etc/passwd'),
    /Security Violation/,
    'Absolute root path'
  );

  // 6. Same prefix but different directory (e.g. outputDir is /data, trying to write to /data-leak/x)
  // This is simulated by using a string that starts with the same text
  // Since we resolve against outputDir, if someone provides '../recovered-leak/x', it resolves to sibling
  assertThrows(
    () => resolveAndValidatePath(outputDir, '../recovered-leak/file.txt'),
    /Security Violation/,
    'Sibling directory prefix bypass'
  );

  // 7. Exactly the output directory
  assertThrows(
    () => resolveAndValidatePath(outputDir, '.'),
    /Security Violation/,
    'Exact output directory (no filename)'
  );

  console.log('✓ Path traversal protections passing!');
}

function testMultiChunkFileExists() {
  console.log('Verifying multi-chunk test file...');
  const filePath = path.resolve(__dirname, '..', 'archive', 'large-data.bin');
  if (!fs.existsSync(filePath)) {
    throw new Error('large-data.bin was not found in archive/.');
  }

  const stats = fs.statSync(filePath);
  if (stats.size <= 4096) {
    throw new Error(`large-data.bin is too small (${stats.size} B). It must be > 4096 B to trigger chunk splitting.`);
  }

  console.log(`✓ Multi-chunk file is ready (${stats.size} B).`);
}

function runTests() {
  console.log('🧪 Running Swarm Archive tests...\n');

  testManifestRoundTrip();
  testManifestValidations();
  testPathTraversalProtection();
  testMultiChunkFileExists();

  console.log('\n✅ All tests passed successfully.');
}

runTests();

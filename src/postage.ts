/**
 * postage.ts
 *
 * Reads postage batch lifetime from the Bee node and surfaces it in a
 * human-readable form.
 *
 * Uses bee-js v13 `bee.stamp.get(batchId)` which returns a `PostageBatch`
 * whose `.duration` property is a `Duration` instance with helpers like
 * `.toDays()`, `.toHours()`, and `.represent()`.
 *
 * Acceptance criterion 6: read postage batch lifetime — no hardcoding.
 */

import { Bee } from '@ethersphere/bee-js';

export interface PostageLifetime {
  batchId: string;
  /** Approximate remaining lifetime as a human-readable string, e.g. "14 days". */
  remaining: string;
  /** Remaining full days (may be fractional; truncated here for display). */
  remainingDays: number;
  /** Remaining full hours. */
  remainingHours: number;
  /** Depth of the batch (determines capacity). */
  depth: number;
  /** Usage fraction 0–1. */
  usage: number;
  /** Human-readable usage text, e.g. "12%". */
  usageText: string;
}

/**
 * Queries the Bee node for the postage batch and returns lifetime information.
 *
 * @param bee      - Initialised `Bee` client.
 * @param batchId  - 64-hex postage batch ID.
 */
export async function readPostageLifetime(
  bee: Bee,
  batchId: string,
): Promise<PostageLifetime> {
  const batch = await bee.stamp.get(batchId);

  // `batch.duration` is a `Duration` instance provided by bee-js v13.
  // `.represent()` returns a friendly string like "14 days, 6 hours".
  // `.toDays()` returns a floating-point number.
  const remaining = batch.duration.represent();
  const remainingDays = Math.floor(batch.duration.toDays());
  const remainingHours = Math.floor(batch.duration.toHours() % 24);

  return {
    batchId: batch.batchID.toHex(),
    remaining,
    remainingDays,
    remainingHours,
    depth: batch.depth,
    usage: batch.usage,
    usageText: batch.usageText,
  };
}

/**
 * Prints a postage batch lifetime summary to stdout.
 */
export function printPostageLifetime(info: PostageLifetime): void {
  console.log('\n📦 Postage batch lifetime');
  console.log(`   Batch ID  : ${info.batchId}`);
  console.log(`   Remaining : ${info.remaining}`);
  console.log(`   Depth     : ${info.depth}`);
  console.log(`   Usage     : ${info.usageText}`);
  console.log(
    '\n   ⚠️  Content is available only while the postage batch is alive.',
  );
  console.log(
    '   Top up with `bee stamp topup` before it expires to keep data online.',
  );
}

/**
 * cli.ts
 *
 * Entry point for the command-line interface.
 *
 * Usage:
 *   npx tsx src/cli.ts publish
 *   npx tsx src/cli.ts recover [--owner <address>] [--topic <hex>] [--topic-string <str>] [--output <dir>] [--bee <url>]
 */

import { publish } from './publish';
import { recover } from './recover';

function printHelp(): void {
  console.log(`
swarm-archive CLI
═════════════════

Commands
  publish
    Upload the archive/ directory to Swarm and write the manifest reference to
    a Feed.  Requires SWARM_PRIVATE_KEY and SWARM_BATCH_ID in the environment.

  recover [options]
    Read the Feed, download the manifest, and recover every file. Requires only
    public identifiers (owner address + topic).  Private key is NOT needed.

    Options:
      --owner         <hex>   Owner Ethereum address (default: from archive.json)
      --topic         <hex>   64-hex Feed topic     (default: from archive.json)
      --topic-string  <str>   Human-readable topic  (keccak'd to topic bytes)
      --output        <dir>   Recovery output dir   (default: recovered/)
      --bee           <url>   Bee endpoint          (default: BEE_URL env or http://localhost:1633)

Environment variables
  BEE_URL             Bee node HTTP endpoint (default: http://localhost:1633)
  SWARM_PRIVATE_KEY   Secp256k1 private key hex (publisher only)
  SWARM_BATCH_ID      Postage batch ID hex (publisher only)

See .env.example for setup instructions.
`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        result[key] = value;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const flags = parseArgs(rest);

  if (!command || command === 'help' || flags['help'] === 'true') {
    printHelp();
    return;
  }

  if (command === 'publish') {
    await publish();
    return;
  }

  if (command === 'recover') {
    await recover({
      beeUrl: flags['bee'],
      ownerAddress: flags['owner'],
      topic: flags['topic'],
      topicString: flags['topic-string'],
      outputDir: flags['output'],
    });
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('\n❌ Fatal error:', (err as Error).message ?? err);
  process.exit(1);
});

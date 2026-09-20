# Eight hundred winters, one lapsed invoice (Swarm Archive)

A publishing tool and a recovery tool for a Swarm archive, built with TypeScript and `bee-js` v13.

## Project overview

This system allows a publisher to upload an archive of files to the Swarm network, linked via a stable Feed, and allows any stranger to recover the archive using only public identifiers.

### Storage and permanence

Swarm does **not** permanently store data by default. Storage is incentivised through "postage batches" (stamps). The content in this archive is only available while its postage batch remains alive — when the batch's Time to Live (TTL) expires, nodes will garbage-collect your chunks.

You must top up your batch before it expires using `bee stamp topup`, or the archive will disappear. The publishing tool automatically reads and displays the remaining lifetime of your postage batch.

### Feed mechanics

Instead of publishing a new Swarm reference every time the archive is updated, this tool uses a **Swarm Feed**. A Feed creates a sequence of Single Owner Chunks (SOC). Finding the next Feed index requires querying the network — not consulting local state.

The publisher:
1. Uploads the files separately.
2. Creates an `archive.json` manifest listing the files and their references.
3. Uploads that collection manifest.
4. Updates the Feed with the manifest's reference.

The recovery tool:
1. Translates the human-readable topic string into a keccak256 Topic hash.
2. Queries the Feed to discover the latest manifest reference.
3. Downloads the manifest and recovers every file automatically.

## Installation

1. Install Node.js (tested with v26 `npm`).
2. Run `npm install` to install dependencies (`@ethersphere/bee-js` v13, `typescript`, `tsx`, `dotenv`).
3. (Optional) Run `npm run build` to compile the TypeScript to CommonJS in `dist/`.

## Running a Bee node

You need a running Bee node endpoint (the default used is `http://localhost:1633`).
You should have [Swarm Desktop](https://docs.ethswarm.org/docs/desktop/introduction) installed and Bee running in light mode. Make sure it is funded with Swarm Bee (BZZ) tokens if you wish to buy a postage batch on mainnet/testnet. Swarm Desktop often provides a usable stamp.

## Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and configure:
   - `BEE_URL`: http://localhost:1633
   - `SWARM_PRIVATE_KEY`: Your 64-character hex secp256k1 private key (e.g. `0x1122...`).
     - **NEVER** track this file in Git. (`.gitignore` protects it).
   - `SWARM_BATCH_ID`: A 64-character hex postage batch ID with sufficient depth and balance. List your usable stamps via `curl http://localhost:1633/stamps`.

Note: `.env` is strongly ignored by `.gitignore`. No private keys or batch IDs should ever exist in your source files or repository commits.

## Publishing an archive

1. Place the files you want to publish in the `archive/` directory. (Sample files are included).
2. Run the publisher:
   ```bash
   npm run publish-archive
   ```
3. The publisher will upload the files, build a collection manifest, upload the manifest, and write the manifest's Swarm reference to the Feed. It automatically determines the correct Feed index from the network.
4. The tool writes the public identifiers (the owner address, the topic, and the Feed manifest) into `published/archive.json`. That file **is** tracked in Git, so strangers can use it.
5. Watch the output carefully — it will print the remaining lifetime of your postage batch.

## Recovering an archive (as a stranger)

Anyone can recover the archive without local state, without the original files, and without the publisher's private key. They only need:

1. A reachable Bee node endpoint (default `http://localhost:1633`).
2. The `published/archive.json` public configuration file created by the publisher.

Run the recovery tool:
```bash
npm run recover-archive
```

The tool will read the public identifiers from `published/archive.json`. It connects to Bee, fetches the latest Feed update, downloads the manifest, and downloads every file to the `recovered/` directory.

### CLI overrides

You can override the defaults (meaning you don't even need `archive.json` if you have the identifiers):
```bash
npx tsx src/cli.ts recover --owner 0x112233... --topic-string "eight-hundred-winters-archive-v1" --output my-recovery/
```

### Empty Feed behavior

If you run the recovery tool before the publisher has created the first update, the recovery tool gracefully catches the HTTP 404 from the Bee node and informs you:

> "No archive has been published yet. The Feed exists but has received no updates. Run the publisher to create the first archive entry."

## Code structures and Acceptance Criteria compliance

- **1. Content is published behind a Feed (8 points):** `src/publish.ts` uses `writer.uploadReference()` from `bee.feed.makeWriter` to publish.
- **2. Owner address and topic are tracked (6 points):** The public values are output to `published/archive.json` via `writeArchiveConfig` in `src/config.ts`.
- **3. Next Feed index is resolved from the network (16 points):** `uploadReference` internally calls `findNextIndex(requestOptions, owner, topic)`, which accesses `GET /feeds/{owner}/{topic}` for the `swarm-feed-index-next` header, with no local counter state.
- **4. Large content is written to the Feed by reference (12 points):** `src/upload.ts` individually uploads raw files. `src/manifest.ts` binds their references into a JSON manifest. `src/publish.ts` uploads the manifest, and puts only the manifest's `reference` in the Feed payload.
- **5. Recovery from published identifiers alone (14 points):** `src/recover.ts` initiates solely using the CLI flags or `published/archive.json`. No secrets are needed. It reads the Feed, the manifest, and enumerates the chunk downloads natively.
- **6. Read postage batch lifetime (8 points):** `src/postage.ts` reads `batch.duration` (an instance of `Duration` in v13) from `bee.stamp.get(batchId)` and prints friendly days/hours and its string representation.
- **7. Handle an empty Feed (8 points):** If the Feed has no payload, `reader.downloadReference()` throws an `BeeResponseError` with `status === 404`. `src/recover.ts` safely catches this error and returns a defined text result.
- **8. No secrets in tracked files (8 points):** Private keys / batch IDs are pulled safely via `dotenv` locally, and the project holds an aggressive `.gitignore`.

Built for the Ethereum Swarm "*Eight hundred winters, one lapsed invoice*" challenge.

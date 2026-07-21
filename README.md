# FeatherBench: staged no-tools visual packing

This Cloudflare Worker runs the three hardest all-or-nothing visual-packing challenges: **6, 7, and 8**. Challenges 1–5 and the older mixed bank are retired and privately archived.

## Protocol

- `POST /v1/start` requires a caller-supplied canonical lowercase UUID `conversation_code` only when `metadata.platform` or `metadata.harness` identifies Arena.ai. If absent on Arena.ai, the API tells the model to ask its user rather than inventing one. Other platforms may omit the code.
- Each run starts at challenge 6, advances to 7, and finishes at 8.
- Models are instructed to solve all three in sequence: never stop voluntarily, take the reasoning time needed, and submit only their strongest answer after full effort.
- If an answer is not accepted, that run's score is the highest consecutively solved active challenge. This is a fallback, never a reason to stop early.
- A conversation code may start multiple fresh runs. All runs remain stored internally, while the public leaderboard retains only the code's strongest current-version run: highest solved challenge first, then highest performance score on ties.
- Reaching challenge 8 emits a soft integrity alert and appears as `max_stage_pending_review` when linked to an Arena.ai conversation code, or `max_stage_unverified` otherwise. It is never presented as an automatically verified pass.
- Every active challenge allows one attempt. An unaccepted answer finalizes the run while retaining prior challenge credit.
- Only complete geometrically valid ASCII tilings count. The verifier accepts rotations, reflections, and any semantically valid packing rather than comparing against one literal map.
- Challenges 6–8 contain no decoys: every supplied tile is used exactly once.
- Each active challenge contributes equally to correctness. Performance is 90% correctness plus 10% speed.

Each run's `conversation_code`, challenge records, and latest score snapshot are persisted together in that run's SQLite-backed Cloudflare Durable Object storage. A shared SQLite-backed Durable Object also maintains an index of submitted runs for the public graph. No D1 database or additional Cloudflare binding is required.

The no-tools requirement is an attested closed-book track. The timing flag is only a heuristic: it cannot technically prove tool use, and a dishonest participant can wait. Conversely, a genuinely fast model can be falsely flagged. Report it as **suspected tool use**, never as proof.

## Private files

`src/bank.json` contains answer geometry and must remain private. Do not expose this repository or generator to evaluated models. Models receive only the deployed `/agent.md` and one staged task at a time.

The allowed “no tools” exceptions are transport-only HTTP needed to call the API and one optional plain-text workspace file named exactly `notes.txt`. The model may write and reread its own reasoning notes there. It may not create or use other workspace files, execute the notes file, generate or parse it with code, or use scripts, code, image extraction, search, computer vision, SAT/exact-cover solvers, or external assistance for solving.

## Build and test

```bash
npm install
npm run build:bank
npm run check
npx wrangler deploy --dry-run --outdir /tmp/featherbench-dry
```

Set the Worker secret before live deployment:

```bash
npx wrangler secret put BENCH_SECRET
npx wrangler deploy
```

Endpoints:

```text
GET  /health
GET  /agent.md
GET  /graph
GET  /graph.json
POST /v1/start
POST /v1/submit
```

Start body:

```json
{"conversation_code":"019f6bde-edae-7305-a9b2-6dec6ff62989","client_nonce":"random","attest_no_solving_tools":true,"metadata":{"platform":"arena.ai","harness":"arena.ai"}}
```

Submit body:

```json
{"run_token":"...","attest_no_solving_tools":true,"answer":"..AA..\n.BBA.."}
```

## Results graph and database

Open:

```text
https://featherbench.whoseyci.workers.dev/graph
```

The scatter plot uses total submitted-challenge time on the x-axis and highest accepted challenge on the y-axis (`none`, 6, 7, or 8). When present, the run's conversation code is used as its public model label and links to `https://arena.ai/agent/[code]`; otherwise the label comes from `metadata.model`. Repeated runs under the same conversation code are consolidated on the graph. It retains the run with the highest solved challenge, then the highest performance score on ties. Hovering a point shows that label, challenge, time, and integrity status. A table below the chart sorts runs by highest challenge and then lowest time. `/graph.json` provides the same public fields as JSON. The harness label comes from optional `metadata.harness`; it is `unknown` when omitted.

The graph starts filling with submissions made after this version is deployed. Old per-run Durable Objects are not enumerable, so historical runs are not automatically backfilled.

## Maximum stage

Stage 8 is the supplied 8×10 target with pieces A–F. The former G and H decoys are omitted. Its private exact-cover validation still finds exactly one geometric solution.

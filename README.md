# FeatherBench: staged no-tools visual packing

This private Cloudflare Worker runs an eight-stage, all-or-nothing visual-packing benchmark. It replaces the former mixed 480-item active bank; that bank was archived before this project was changed.

## Protocol

- `POST /v1/start` returns stage 1 only.
- Stages 1–3 have no minimum-time rule; a correct answer advances immediately.
- Starting with stage 4, a correct submission after at least 20 seconds advances and releases the next stage.
- Every stage allows one attempt. An incorrect answer permanently ends the run.
- Starting with stage 4, a completely correct answer received in under 20 seconds permanently blocks the run, sets `tool_use_flagged:true`, and instructs the participant to stop and self-report.
- Only complete geometrically valid ASCII tilings count. The verifier accepts rotations, reflections, decoy omission, and any semantically valid packing rather than comparing against one literal map.
- Stage N is worth N correctness points. Performance is 90% weighted correctness plus 10% speed.

The no-tools requirement is an attested closed-book track. The timing flag is only a heuristic: it cannot technically prove tool use, and a dishonest participant can wait. Conversely, a genuinely fast model can be falsely flagged. Report it as **suspected tool use**, never as proof.

## Private files

`src/bank.json` contains answer geometry and must remain private. Do not expose this repository or generator to evaluated models. Models receive only the deployed `/agent.md` and one staged task at a time.

The allowed “no tools” exception is transport-only HTTP needed to call the API. Scripts, code, image extraction, search, computer vision, SAT/exact-cover solvers, and external assistance for solving are prohibited.

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
POST /v1/start
POST /v1/submit
```

Start body:

```json
{"client_nonce":"random","attest_no_solving_tools":true,"metadata":{"model":"...","harness":"..."}}
```

Submit body:

```json
{"run_token":"...","attest_no_solving_tools":true,"answer":"..AA..\n.BBA.."}
```

## Maximum stage

Stage 8 is the supplied 8×10 target with pieces A–H. Color labels are all one word; H is `forest`. Its private exact-cover validation finds one geometric solution, using six pieces and two decoys.

# FeatherBench Cloudflare API

A prebuilt, Git-connected Cloudflare Worker deployment of FeatherBench. Link a **private GitHub repository** in the Cloudflare dashboard, deploy, set one secret, and give models `/agent.md`.

The bundled private bank contains 480 hard questions across fifteen categories. Seven saturated categories were removed; four verifier-asymmetric search tasks were added: max-flow with a min-cut certificate, Game-of-Life preimage, BFS-optimal sliding puzzle, and planted Boolean-circuit inversion. Existing hard tracks cover temporal replay, constrained routing, compound instruction following, transformed occupancy, all-piece packing, cube-net folding, and legal 3×3 Rubik's Cube solving. Each run receives a random subset and signed four-hour token; keys remain inside the private Worker bundle.

## Critical privacy rule

`src/bank.json` contains prompts **and private answer keys**. Keep this GitHub repository private and never mount it into the evaluated agent's sandbox. The evaluated model should receive only your deployed Worker URL.

## Cloudflare Dashboard deployment from GitHub

### 1. Create a private GitHub repository

Extract this archive, then:

```bash
git init
git add .
git commit -m "Deploy FeatherBench"
git branch -M main
git remote add origin git@github.com:YOUR_ACCOUNT/YOUR_PRIVATE_REPO.git
git push -u origin main
```

### 2. Connect it in Cloudflare

In the Cloudflare dashboard:

1. Open **Workers & Pages**.
2. Choose **Create application**.
3. Choose **Import a repository** / **Connect to Git**.
4. Authorize GitHub and select the private repository.
5. Select the `main` branch.
6. The project has no framework preset.
7. Use the repository root as the root directory.
8. If Cloudflare requests commands:
   - Build command: `npm run check`
   - Deploy command: `npx wrangler deploy`
9. Deploy.

Cloudflare reads `wrangler.jsonc`, bundles `src/index.js` and the private `src/bank.json`, and uploads `public/assets` using Workers Static Assets.

### 3. Add the runtime secret

After the Worker exists:

1. Open the Worker.
2. Go to **Settings → Variables and Secrets**.
3. Add an encrypted secret named:

```text
BENCH_SECRET
```

Generate a value locally:

```bash
python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Redeploy if Cloudflare requests it.

### 4. Verify

```bash
curl https://YOUR-WORKER.workers.dev/health
```

Then open:

```text
https://YOUR-WORKER.workers.dev/agent.md
```

Give that URL or its contents to the model you want to evaluate.

## Model workflow

The agent does everything itself:

1. `POST /v1/start` with `profile` and a random client nonce.
2. Receive a signed token and the selected tasks inline.
3. Download listed PNG/text assets.
4. Solve tasks.
5. Optionally submit one `mode:"check"` answer array for aggregate/category feedback only.
6. Submit one `mode:"final"` answer array and receive the locked detailed report.

No local FeatherBench installation, Docker, database, seed handling or manual release creation is required.

## API

```text
GET  /health
GET  /agent.md
POST /v1/start
POST /v1/submit
GET  /assets/...
```

Start example:

```bash
curl -sS -X POST https://YOUR-WORKER.workers.dev/v1/start \
  -H 'content-type: application/json' \
  -d '{
    "profile":"standard",
    "client_nonce":"model-generated-random-value",
    "metadata":{"agent":"arena","model":"unknown"}
  }' > start.json
```

Profiles select a random number of bank items per category:

| Profile | Per category | Total |
|---|---:|---:|
| smoke | 2 | 30 |
| quick | 4 | 60 |
| standard | 16 | 240 |
| full | 32 | 480 |

## One check, one final submission

A SQLite-backed Durable Object is created automatically for each run. The signed token still binds selected item IDs, profile, expiry and run ID, while the Durable Object enforces:

- at most one `mode:"check"` submission;
- at most one `mode:"final"` submission;
- check feedback contains aggregate/category scores only—no item diagnostics;
- final feedback may contain item results because the run is permanently locked;
- runs expire after four hours.

No manual D1 or KV setup is required; `wrangler.jsonc` declares the Durable Object binding and migration. This removes the repeated-submit oracle used to reverse-engineer earlier scoring.

## Correctness, speed and move efficiency

The report returns three headline metrics:

- `global_macro_score`: objective correctness, equally weighted by category;
- `speed_score`: start-to-submit wall-clock score normalized by profile;
- `performance_score`: 90% correctness plus 10% speed.

Rubik items execute the submitted Singmaster moves against the scrambled cube. An unsolved cube receives zero. A solved cube scores `min(1, hidden_reference_length / submitted_length)`. Difficulty and reference length are not sent to the model. The current reference is a valid inverse scramble rather than a proof of global optimality; sliding-puzzle items use certified BFS-optimal lengths.

## Visual and cube premises

- `visual_fit`: choose one alternative piece and transform it to cover the target. The scorer applies the transform and compares occupancy, avoiding 90°/270° naming-key bugs.
- `visual_packing`: choose the unique subset from required pieces plus decoys, then tile the irregular target with no gaps, overlap, or out-of-bounds cells. A private exact-cover search rejects non-unique instances.
- `cube_net`: fold the labeled 2D net and return the three opposite-face pairs.
- `rubiks_cube`: solve a legal scrambled 5×5 state supplied as six U,R,F,D,L,B matrices; outer and two-layer wide moves are supported, with 14–30 move scrambles.
- `max_flow`: submit a feasible per-edge flow plus a min-cut certificate; full credit requires matching primal and dual values.
- `life_preimage`: find any grid that evolves to the published state after the specified Life steps; grading is exact simulation.
- `sliding_puzzle`: submit a valid solution, scored against a certified BFS optimum.
- `circuit_inversion`: find any input satisfying a planted layered Boolean circuit output; grading is one circuit evaluation.
- `chess`: rank three quiet candidate moves and predict a three-ply principal variation from a pinned Stockfish 17.1/80k-node private reference. This is explicitly a closed-book track; engine-assisted results must be reported separately.
- `maker_breaker`: recover any perfect pairing whose pairs hit every winning hyperedge, certifying a Breaker strategy.
- `tiling_invariant`: produce a periodic integer weighting whose translated tile weights vanish while the enormous board has nonzero weight.
- `sequence_induction`: predict 128 exact terms from private mixed DFAO, interleaved-recurrence, and morphism families.
- `coloring_certificate`: submit both a proper k-coloring and a k-clique, giving valid upper/lower certificates. This deliberately uses a clique subgraph—not the invalid clique-minor argument.

Public task payloads no longer expose difficulty labels.

## Automatic deployments

After Git integration is active, pushes to `main` trigger new builds/deployments through Cloudflare. Keep pull requests and build logs private because the bank is secret.

## Optional bank rotation

You do not need to rotate the bundled bank for normal use: `/v1/start` samples fresh subsets and orderings each run.

To replace all questions, install FeatherBench 2.2+ on a trusted maintainer machine and run:

```bash
python scripts/rebuild_bank.py \
  --seed "new-private-secret-seed" \
  --profile full

git add src/bank.json public/assets
git commit -m "Rotate private benchmark bank"
git push
```

Do this privately. Publish old seeds/keys only after their evaluation window closes.

## Local development

```bash
npm install
npm run check
npm run dev
```

Set a local secret with Wrangler:

```bash
npx wrangler secret put BENCH_SECRET
```

## Limits

- The prebuilt bank and scorer live in the private Worker source; a model with access to that GitHub repository can cheat.
- Rubik reference lengths are not yet certified global optima; use the separate move-count metric cautiously.
- Cube-net generation should expand to all 11 topology families.
- Bank rotation requires the private Python FeatherBench maintainer package, but ordinary model runs require only the deployed URL.

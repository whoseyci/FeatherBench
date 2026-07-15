# FeatherBench Cloudflare API

A prebuilt, Git-connected Cloudflare Worker deployment of FeatherBench. Link a **private GitHub repository** in the Cloudflare dashboard, deploy, set one secret, and give models `/agent.md`.

The bundled private bank contains 224 hard questions across seven calibrated categories: temporal replay, constrained routing, compound instruction following, transformed-occupancy visual fit, all-piece visual packing, cube-net folding, and legal 3×3 Rubik's Cube solving. Seven categories that scored 100% across every calibration run were removed. Each run receives a cryptographically random subset and a signed four-hour token; keys remain inside the private Worker bundle.

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
5. Submit one answer array to `/v1/submit`.
6. Receive overall, category, item, difficulty and coverage scores immediately.

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
| smoke | 2 | 14 |
| quick | 4 | 28 |
| standard | 16 | 112 |
| full | 32 | 224 |

## Stateless design

The Worker stores no run database. The signed token contains the selected item IDs, profile, expiry and run ID. Consequently:

- no D1/KV setup is required;
- horizontal scaling works automatically;
- runs expire after four hours;
- tokens cannot be modified without invalidating the signature.

A token can technically be submitted more than once because there is no state store. For strict one-attempt tournaments, add a Durable Object or KV-backed replay registry. Ordinary model comparisons can simply retain the first returned report.

## Correctness, speed and move efficiency

The report returns three headline metrics:

- `global_macro_score`: objective correctness, equally weighted by category;
- `speed_score`: start-to-submit wall-clock score normalized by profile;
- `performance_score`: 90% correctness plus 10% speed.

Rubik items additionally execute the submitted Singmaster moves against the scrambled cube. A solved cube earns at least 85%; the final 15% rewards move count relative to the known inverse scramble. Any shorter valid solution receives full efficiency credit.

## Visual and cube premises

- `visual_fit`: choose one alternative piece and transform it to cover the target. The scorer applies the transform and compares occupancy, avoiding 90°/270° naming-key bugs.
- `visual_packing`: use every piece exactly once to tile the target with no gaps, overlap, or out-of-bounds cells.
- `cube_net`: fold the labeled 2D net and return the three opposite-face pairs.
- `rubiks_cube`: solve a legal scrambled 3×3 state supplied as six U,R,F,D,L,B matrices.

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
- The Worker is stateless and does not enforce one submission per token.
- Bank rotation requires the Python FeatherBench maintainer package, but ordinary model runs require only the deployed URL.

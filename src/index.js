import bank from './bank.json' with { type: 'json' };

const VERSION = 'featherbench-packing-staged-cf-1.5.0';
const TOKEN_TTL_SECONDS = 4 * 60 * 60;
const MIN_SOLVE_SECONDS = 20;
const TIMER_EXEMPT_STAGES = 3;
const MAX_BODY = 256 * 1024;
const enc = new TextEncoder();

function headers(type = 'application/json; charset=utf-8') {
  return {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: headers() }); }
function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const x = atob(s); return Uint8Array.from(x, c => c.charCodeAt(0)); }
async function sign(secret, body) { const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body))); }
function equal(a, b) { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
async function tokenFor(env, payload) { const body = b64(enc.encode(JSON.stringify(payload))); return body + '.' + b64(await sign(env.BENCH_SECRET, body)); }
async function verify(env, token) {
  if (!env.BENCH_SECRET) throw new Error('BENCH_SECRET is not configured');
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !equal(unb64(sig), await sign(env.BENCH_SECRET, body))) throw new Error('invalid token');
  const payload = JSON.parse(new TextDecoder().decode(unb64(body)));
  if (payload.exp < Date.now() / 1000) throw new Error('expired token');
  return payload;
}
async function readJson(req) {
  const n = Number(req.headers.get('content-length') || 0);
  if (n > MAX_BODY) throw new Error('body too large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error('body too large');
  return JSON.parse(text);
}

function cellsFromRows(rows, marker = '#') {
  const cells = [];
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === marker) cells.push([x, y]);
  return cells;
}
function norm(cells) {
  const minx = Math.min(...cells.map(p => p[0]));
  const miny = Math.min(...cells.map(p => p[1]));
  return cells.map(([x, y]) => [x - minx, y - miny]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
function transformed(cells, turns, reflect) {
  let pts = cells.map(([x, y]) => [reflect ? -x : x, y]);
  for (let i = 0; i < turns; i++) pts = pts.map(([x, y]) => [-y, x]);
  return norm(pts);
}
function signature(cells) { return JSON.stringify(norm(cells)); }
function shapeMatches(got, expectedRows) {
  const expected = cellsFromRows(expectedRows);
  const target = signature(got);
  for (const reflect of [false, true]) for (let turns = 0; turns < 4; turns++) {
    if (JSON.stringify(transformed(expected, turns, reflect)) === target) return true;
  }
  return false;
}
export function validConversationCode(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
export function isArenaRun(metadata) {
  const platform = String(metadata?.platform || '').trim().toLowerCase();
  const harness = String(metadata?.harness || '').trim().toLowerCase();
  return platform === 'arena.ai' || platform === 'arena' || harness === 'arena.ai' || harness === 'arena';
}
function answerText(answer) {
  if (typeof answer === 'string') return answer;
  if (answer && typeof answer.ascii_map === 'string') return answer.ascii_map;
  if (answer && Array.isArray(answer.rows) && answer.rows.every(x => typeof x === 'string')) return answer.rows.join('\n');
  return null;
}

/** Semantic, all-or-nothing packing verification. */
export function verifyPacking(stage, answer) {
  const text = answerText(answer);
  if (text === null || text.includes('```')) return false;
  const rows = text.replace(/\r/g, '').replace(/^\n+|\n+$/g, '').split('\n');
  const target = stage.key.target;
  if (rows.length !== target.length || rows.some((r, y) => r.length !== target[y].length)) return false;
  const used = new Map();
  for (let y = 0; y < target.length; y++) {
    for (let x = 0; x < target[y].length; x++) {
      const got = rows[y][x];
      if (target[y][x] === '.') {
        if (got !== '.') return false;
      } else {
        if (!/^[A-Z]$/.test(got) || !stage.key.pieces[got]) return false;
        if (!used.has(got)) used.set(got, []);
        used.get(got).push([x, y]);
      }
    }
  }
  if (!used.size) return false;
  for (const [label, cells] of used) if (!shapeMatches(cells, stage.key.pieces[label])) return false;
  return true;
}

function publicStage(stage) {
  return { stage: stage.stage, challenge: stage.stage, active_challenges: bank.stages.map(x => x.stage), total_challenges: bank.stages.length, prompt: stage.prompt, ...stage.public };
}
function round(n) { return Math.round(n * 1000) / 1000; }
function report(state) {
  const accepted = state.records.filter(r => r.accepted);
  const possible = bank.stages.length;
  const earned = accepted.length;
  const correctness = 100 * earned / possible;
  const speed = accepted.length ? accepted.reduce((n, r) => n + Math.min(100, 100 * MIN_SOLVE_SECONDS / Math.max(0.001, r.elapsed_seconds)), 0) / accepted.length : 0;
  const totalTime = state.records.reduce((n, r) => n + r.elapsed_seconds, 0);
  const highest = accepted.reduce((n, r) => Math.max(n, r.stage), 0);
  return {
    benchmark_version: VERSION,
    bank_commitment: bank.manifest.public_commitment,
    active_challenges: bank.stages.map(x => x.stage),
    conversation_code: state.conversation_code,
    model: String(state.conversation_code || state.metadata?.model || 'unknown').slice(0, 100),
    harness: String(state.metadata?.harness || 'unknown').slice(0, 100),
    status: state.status,
    score_finalized: ['stopped', 'max_stage_reached', 'flagged_tool_use'].includes(state.status),
    integrity_review_required: state.status === 'max_stage_reached',
    tool_use_flagged: state.status === 'flagged_tool_use',
    completed_challenges: accepted.length,
    completed_stages: accepted.length,
    highest_solved_challenge: highest,
    highest_solved_stage: highest,
    total_time_seconds: round(totalTime),
    raw_correct_challenges: state.records.filter(r => r.correct).length,
    raw_correct_stages: state.records.filter(r => r.correct).length,
    total_challenges: bank.stages.length,
    total_stages: bank.stages.length,
    weighted_correctness_score: round(correctness),
    speed_score: round(speed),
    performance_score: round(0.9 * correctness + 0.1 * speed),
    stage_results: state.records.map(r => ({ stage: r.stage, correct: r.correct, accepted: r.accepted, elapsed_seconds: r.elapsed_seconds, disposition: r.disposition })),
  };
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function publicResult(record) {
  const rawStatus = record.status;
  const arenaLinked = validConversationCode(record.conversation_code) && ['arena', 'arena.ai'].includes(String(record.harness || '').trim().toLowerCase());
  let status = rawStatus;
  if (rawStatus === 'failed') status = 'stopped'; // normalize historical records
  if (rawStatus === 'completed' || rawStatus === 'max_stage_reached') status = arenaLinked ? 'max_stage_pending_review' : 'max_stage_unverified';
  const modelUrl = validConversationCode(record.model) ? `https://arena.ai/agent/${record.model}` : null;
  return {
    run_id: record.run_id,
    model: record.model,
    model_url: modelUrl,
    harness: record.harness,
    status,
    identity_linked: arenaLinked,
    integrity_review_required: rawStatus === 'completed' || rawStatus === 'max_stage_reached',
    highest_solved_challenge: record.highest_solved_challenge ?? record.highest_solved_stage,
    highest_solved_stage: record.highest_solved_challenge ?? record.highest_solved_stage,
    total_time_seconds: record.total_time_seconds,
    weighted_correctness_score: record.weighted_correctness_score,
    speed_score: record.speed_score,
    performance_score: record.performance_score,
    updated_at: record.updated_at,
  };
}
function betterResult(candidate, incumbent) {
  if (!incumbent) return candidate;
  const a = Number(candidate.highest_solved_challenge ?? candidate.highest_solved_stage) || 0, b = Number(incumbent.highest_solved_challenge ?? incumbent.highest_solved_stage) || 0;
  if (a !== b) return a > b ? candidate : incumbent;
  const ap = Number(candidate.performance_score) || 0, bp = Number(incumbent.performance_score) || 0;
  if (ap !== bp) return ap > bp ? candidate : incumbent;
  return String(candidate.updated_at) > String(incumbent.updated_at) ? candidate : incumbent;
}
function graphHtml(records) {
  records = records.map(publicResult);
  const W = 1040, H = 620, left = 90, right = 990, top = 45, bottom = 535;
  const maxTime = Math.max(60, ...records.map(r => Number(r.total_time_seconds) || 0));
  const x = t => left + (Math.max(0, Number(t) || 0) / maxTime) * (right - left);
  const levels = [0, ...bank.stages.map(s => s.stage)];
  const y = s => { const i = Math.max(0, levels.indexOf(Number(s))); return bottom - (i / (levels.length - 1)) * (bottom - top); };
  const colors = { max_stage_pending_review: '#ffd43b', max_stage_unverified: '#f59f00', active: '#5b8def', stopped: '#adb5bd', flagged_tool_use: '#e8590c' };
  let grid = '';
  for (const s of levels) grid += `<line x1="${left}" y1="${y(s)}" x2="${right}" y2="${y(s)}" stroke="#253047"/><text x="${left - 16}" y="${y(s) + 5}" text-anchor="end">${s || 'none'}</text>`;
  for (let i = 0; i <= 5; i++) { const t = maxTime * i / 5; grid += `<line x1="${x(t)}" y1="${top}" x2="${x(t)}" y2="${bottom}" stroke="#253047"/><text x="${x(t)}" y="${bottom + 28}" text-anchor="middle">${Math.round(t)}s</text>`; }
  const points = records.map((r, i) => {
    const label = htmlEscape(r.model || 'unknown');
    const color = colors[r.status] || '#adb5bd';
    const point = `<circle cx="${x(r.total_time_seconds)}" cy="${y(r.highest_solved_stage)}" r="8" fill="${color}" stroke="#f8f9fa" stroke-width="2"><title>${label} — challenge ${r.highest_solved_stage}, ${r.total_time_seconds}s, ${htmlEscape(r.status)}</title></circle><text x="${x(r.total_time_seconds) + 11}" y="${y(r.highest_solved_stage) - 10 + (i % 3) * 10}" class="point-label">${label}</text>`;
    return r.model_url ? `<a href="${htmlEscape(r.model_url)}" target="_blank" rel="noopener noreferrer"><g>${point}</g></a>` : `<g>${point}</g>`;
  }).join('');
  const rows = [...records].sort((a, b) => (b.highest_solved_stage - a.highest_solved_stage) || (a.total_time_seconds - b.total_time_seconds)).map(r => { const label = htmlEscape(r.model); const shown = r.model_url ? `<a href="${htmlEscape(r.model_url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label; return `<tr><td>${shown}</td><td>${htmlEscape(r.harness)}</td><td>${r.highest_solved_stage}</td><td>${r.total_time_seconds}</td><td>${r.performance_score}</td><td><span class="status ${htmlEscape(r.status)}">${htmlEscape(r.status)}</span></td></tr>`; }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FeatherBench model graph</title><style>body{margin:0;background:#0b1020;color:#e9ecef;font:15px system-ui,sans-serif}.wrap{max-width:1120px;margin:auto;padding:32px 20px}h1{margin:0 0 8px;font-size:30px}p{color:#adb5bd}.card{background:#131a2c;border:1px solid #2b3753;border-radius:16px;padding:16px;margin-top:22px;overflow:auto}svg{width:100%;min-width:760px;height:auto}svg text{fill:#adb5bd;font-size:13px}.point-label{fill:#f1f3f5;font-size:12px;font-weight:600}.axis-label{fill:#f8f9fa;font-size:15px;font-weight:700}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #2b3753}th{color:#8fa8d8}a{color:#91b7ff}.status{padding:3px 8px;border-radius:999px;background:#343a40}.max_stage_pending_review{background:#a07900}.max_stage_unverified{background:#d9480f}.stopped{background:#495057}.flagged_tool_use{background:#e67700}.empty{padding:70px;text-align:center;color:#adb5bd}</style></head><body><main class="wrap"><h1>FeatherBench model progress</h1><p>Each point is the best retained run for one conversation code (or one uncoded run). Lower total time is farther left; a higher solved challenge is farther up. The active sequence is challenges 6, 7, and 8. Reaching challenge 8 is shown as pending review or unverified.</p><section class="card">${records.length ? `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Model performance scatter plot">${grid}<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#e9ecef"/><line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#e9ecef"/>${points}<text x="${(left + right) / 2}" y="590" text-anchor="middle" class="axis-label">Total time</text><text x="24" y="${(top + bottom) / 2}" text-anchor="middle" transform="rotate(-90 24 ${(top + bottom) / 2})" class="axis-label">Highest solved challenge</text></svg>` : '<div class="empty">No submitted runs yet.</div>'}</section><section class="card"><table><thead><tr><th>Model</th><th>Harness</th><th>Highest challenge</th><th>Total time (s)</th><th>Performance</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section></main></body></html>`;
}

function agentMd(origin) {
  return `# FeatherBench challenges 6–8 — closed-book/no-solving-tools track

This track measures unaided visual-spatial deduction. **Solving tools are strictly prohibited.** Do not use scripts, code, image extraction, search, SAT/exact-cover solvers, computer vision, or external assistance. HTTP calls used only to transport the task and answer are allowed.

The sole workspace exception is one optional plain-text file named exactly \`notes.txt\`. You may write and reread your own reasoning notes there. Do not create or use any other workspace file, and do not execute, programmatically generate, or parse \`notes.txt\` with code.

Only **challenges 6, 7, and 8** are active. The goal is to solve all three in sequence and reach challenge 8 within the current run. Do not stop voluntarily. For every released challenge, try your hardest, take as much reasoning time as you need, and submit only your strongest answer after full effort. A completely correct answer advances to the next challenge. Each challenge has one attempt and only exact valid tilings count. If an answer is not accepted, that run ends and its score is the highest consecutively solved challenge. You may start another fresh run with the same conversation code; the leaderboard retains only that code's strongest run. Score retention and resubmission are fallbacks—not invitations to stop early or submit weak guesses.

## Conversation code for Arena.ai runs

If you are currently running inside **Arena.ai**, set \`metadata.platform\` to \`arena.ai\` and provide the user's conversation code in canonical lowercase UUID form, for example \`019f6bde-edae-7305-a9b2-6dec6ff62989\`. If the Arena.ai user has not provided a code, **stop before starting, turn back to the user, and post a question asking for their conversation code.** Do not invent one. The same conversation code may be reused for fresh runs; only its strongest result is shown on the leaderboard. Outside Arena.ai, the conversation code is optional.

## Start

Arena.ai example:

\`\`\`bash
curl -sS -X POST ${origin}/v1/start \\
  -H 'content-type: application/json' \\
  -d '{"conversation_code":"019f6bde-edae-7305-a9b2-6dec6ff62989","client_nonce":"random-text","attest_no_solving_tools":true,"metadata":{"platform":"arena.ai","harness":"arena.ai"}}'
\`\`\`

Other platforms may omit \`conversation_code\` and should supply \`metadata.model\` and \`metadata.harness\` for graph labels.

## Answer the current challenge

Return the ASCII map in \`answer\` (JSON newlines must be escaped):

\`\`\`json
{"run_token":"...","attest_no_solving_tools":true,"answer":"..AA..\\n.BBA.."}
\`\`\`

Submit it once to \`POST /v1/submit\`. A successful non-final response contains the next challenge. Do not submit after any response with \`stop:true\`.

Each of the three active challenges contributes equally to correctness, and each challenge is all-or-nothing. The final report includes correctness, speed, and combined performance scores. When a conversation code is present it becomes the model label on ${origin}/graph; otherwise the graph uses \`metadata.model\`. The harness comes from optional \`metadata.harness\` and is \`unknown\` when omitted.
`;
}

export class RunGate {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(req) {
    const body = await req.json();
    if (body.action === 'record_result') {
      const r = body.record;
      if (!r || typeof r.run_id !== 'string' || r.run_id.length > 100) return json({ ok: false, error: 'bad result record' }, 400);
      await this.ctx.storage.put(`result:${r.run_id}`, r);
      return json({ ok: true });
    }
    if (body.action === 'list_results') {
      const found = await this.ctx.storage.list({ prefix: 'result:', limit: 1000 });
      const best = new Map();
      for (const record of found.values()) {
        if (body.benchmark_version && record.benchmark_version !== body.benchmark_version) continue;
        const code = validConversationCode(record.conversation_code) ? record.conversation_code : `run:${record.run_id}`;
        best.set(code, betterResult(record, best.get(code)));
      }
      return json({ ok: true, records: [...best.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) });
    }
    if (body.action === 'register') {
      const existing = await this.ctx.storage.get('state');
      if (existing) return json({ ok: false, error: 'run already registered' }, 409);
      const now = Date.now();
      const state = { status: 'active', conversation_code: body.conversation_code, current_stage: 1, stage_started_at: now, records: [], scores: null, metadata: body.metadata || {} };
      await this.ctx.storage.put('state', state);
      return json({ ok: true });
    }
    if (body.action !== 'submit') return json({ ok: false, error: 'bad action' }, 400);

    let response;
    let responseStatus = 200;
    await this.ctx.storage.transaction(async tx => {
      const state = await tx.get('state');
      if (!state) { response = { ok: false, error: 'unknown run' }; responseStatus = 404; return; }
      if (state.status !== 'active') { response = { ok: false, error: 'run is permanently closed', report: state.scores || report(state) }; responseStatus = 409; return; }
      const stage = bank.stages[state.current_stage - 1];
      const elapsed = Math.max(0, (Date.now() - state.stage_started_at) / 1000);
      const correct = verifyPacking(stage, body.answer);
      const record = { stage: stage.stage, elapsed_seconds: round(elapsed), correct, accepted: false, disposition: '' };

      if (!correct) {
        record.disposition = 'answer_not_accepted_score_retained';
        state.records.push(record);
        state.status = 'stopped';
        state.scores = report(state);
        await tx.put('state', state);
        response = { ok: true, correct: false, stop: true, score_retained: true, message: 'This answer was not accepted, so this run is finalized. The recorded score is your highest consecutively solved active challenge.', report: state.scores };
        return;
      }
      if (stage.stage > TIMER_EXEMPT_STAGES && elapsed < MIN_SOLVE_SECONDS) {
        record.disposition = 'flagged_speed_integrity_threshold';
        state.records.push(record);
        state.status = 'flagged_tool_use';
        state.scores = report(state);
        await tx.put('state', state);
        responseStatus = 403;
        response = {
          ok: false,
          correct: true,
          stop: true,
          tool_use_flagged: true,
          self_report_required: true,
          message: 'STOP. This submission crossed a private speed-integrity threshold. Further submissions are blocked. Flag this run for integrity review and do not continue.',
          report: state.scores,
        };
        return;
      }

      record.accepted = true;
      record.disposition = 'accepted';
      state.records.push(record);
      if (state.current_stage === bank.stages.length) {
        state.status = 'max_stage_reached';
        state.scores = report(state);
        await tx.put('state', state);
        response = { ok: true, correct: true, max_stage_reached: true, stop: true, soft_integrity_alert: true, message: 'Challenge 8 reached. The score is retained and marked pending integrity review.', report: state.scores };
      } else {
        state.current_stage += 1;
        state.stage_started_at = Date.now();
        state.scores = report(state);
        await tx.put('state', state);
        response = { ok: true, correct: true, max_stage_reached: false, report: state.scores, task: publicStage(bank.stages[state.current_stage - 1]) };
      }
    });
    return json(response, responseStatus);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: headers('text/plain') });
    try {
      if (url.pathname === '/graph' || url.pathname === '/graph.json') {
        const leaderboard = env.RUN_GATE.get(env.RUN_GATE.idFromName('__featherbench_leaderboard__'));
        const listed = await leaderboard.fetch('https://leaderboard/list', { method: 'POST', body: JSON.stringify({ action: 'list_results', benchmark_version: VERSION }) });
        const data = await listed.json();
        const records = Array.isArray(data.records) ? data.records : [];
        if (url.pathname === '/graph.json') return json({ ok: true, records: records.map(publicResult) });
        return new Response(graphHtml(records), { headers: headers('text/html; charset=utf-8') });
      }
      if (url.pathname === '/health') return json({ ok: true, version: VERSION, active_challenges: bank.stages.map(x => x.stage), challenges: bank.stages.length, track: 'no-solving-tools', graph: `${url.origin}/graph`, bank_commitment: bank.manifest.public_commitment });
      if (url.pathname === '/' || url.pathname === '/agent.md') return new Response(agentMd(url.origin), { headers: headers('text/markdown; charset=utf-8') });
      if (url.pathname === '/v1/start' && req.method === 'POST') {
        const body = await readJson(req);
        const arenaRun = isArenaRun(body.metadata);
        if (arenaRun && !body.conversation_code) return json({ ok: false, needs_conversation_code: true, error: 'conversation_code is required for Arena.ai runs', action_for_model: 'Turn back to the Arena.ai user and post a question asking for their conversation code. Do not invent one.' }, 400);
        if (body.conversation_code && !validConversationCode(body.conversation_code)) return json({ ok: false, needs_conversation_code: arenaRun, error: 'conversation_code must use canonical lowercase UUID form, for example 019f6bde-edae-7305-a9b2-6dec6ff62989', action_for_model: arenaRun ? 'Ask the Arena.ai user to provide or correct their conversation code.' : 'Correct the optional conversation code or omit it.' }, 400);
        if (!env.BENCH_SECRET) throw new Error('BENCH_SECRET missing');
        if (body.attest_no_solving_tools !== true) throw new Error('attest_no_solving_tools:true is required');
        const now = Math.floor(Date.now() / 1000);
        const conversationCode = body.conversation_code || null;
        const payload = { run_id: crypto.randomUUID(), conversation_code: conversationCode, iat: now, exp: now + TOKEN_TTL_SECONDS, nonce: String(body.client_nonce || '').slice(0, 200) };
        const runToken = await tokenFor(env, payload);
        const gate = env.RUN_GATE.get(env.RUN_GATE.idFromName(payload.run_id));
        const registration = await gate.fetch('https://gate/register', { method: 'POST', body: JSON.stringify({ action: 'register', conversation_code: conversationCode, metadata: body.metadata || {} }) });
        if (!registration.ok) throw new Error('could not register run');
        return json({
          ok: true,
          version: VERSION,
          run_id: payload.run_id,
          conversation_code: conversationCode,
          run_token: runToken,
          submit_url: `${url.origin}/v1/submit`,
          expires_at: payload.exp,
          policy: { active_challenges: [6, 7, 8], one_attempt_per_challenge: true, all_or_nothing: true, solving_tools_prohibited: true, private_integrity_checks: true },
          task: publicStage(bank.stages[0]),
        });
      }
      if (url.pathname === '/v1/submit' && req.method === 'POST') {
        const body = await readJson(req);
        if (body.attest_no_solving_tools !== true) throw new Error('attest_no_solving_tools:true is required');
        const payload = await verify(env, body.run_token);
        const gate = env.RUN_GATE.get(env.RUN_GATE.idFromName(payload.run_id));
        const gateResponse = await gate.fetch('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: body.answer }) });
        const result = await gateResponse.json();
        if (result.report) {
          try {
            const leaderboard = env.RUN_GATE.get(env.RUN_GATE.idFromName('__featherbench_leaderboard__'));
            await leaderboard.fetch('https://leaderboard/record', { method: 'POST', body: JSON.stringify({ action: 'record_result', record: { run_id: payload.run_id, ...result.report, updated_at: new Date().toISOString() } }) });
          } catch (_) { /* Per-run SQLite state remains authoritative if the index write fails. */ }
        }
        return json(result, gateResponse.status);
      }
      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 400);
    }
  },
};

import assert from 'node:assert/strict';
import bank from '../src/bank.json' with { type: 'json' };
import worker, { RunGate, isArenaRun, validConversationCode, verifyPacking } from '../src/index.js';

class Storage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k); }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async list({ prefix = '', limit = 1000 } = {}) { return new Map([...this.m].filter(([k]) => k.startsWith(prefix)).slice(0, limit)); }
  async transaction(fn) { return await fn(this); }
}

// Public pre-task surfaces must not disclose the private clock or threshold.
for (const path of ['/agent.md', '/health']) {
  const publicResponse = await worker.fetch(new Request('https://bench.test' + path), {});
  const publicText = await publicResponse.text();
  assert.equal(/20\s*seconds?|timer|minimum[_ -]?stage|speed.integrity.threshold|2000\s*\//i.test(publicText), false, `private clock leaked at ${path}`);
}

const CODE = '019f6bde-edae-7305-a9b2-6dec6ff62989';
assert.equal(validConversationCode(CODE), true);
assert.equal(validConversationCode('019F6BDE-EDAE-7305-A9B2-6DEC6FF62989'), false);
assert.equal(validConversationCode('not-a-code'), false);
assert.equal(isArenaRun({ platform: 'arena.ai' }), true);
assert.equal(isArenaRun({ harness: 'Arena' }), true);
assert.equal(isArenaRun({ platform: 'other' }), false);

// Missing codes are required only for Arena.ai and instruct that model to ask its user.
let missingCodeResponse = await worker.fetch(new Request('https://bench.test/v1/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attest_no_solving_tools: true, metadata: { platform: 'arena.ai' } }) }), {});
let missingCodeBody = await missingCodeResponse.json();
assert.equal(missingCodeResponse.status, 400);
assert.equal(missingCodeBody.needs_conversation_code, true);
assert.match(missingCodeBody.action_for_model, /(ask.*user|user.*ask)/i);
const externalNoCodeResponse = await worker.fetch(new Request('https://bench.test/v1/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attest_no_solving_tools: true, metadata: { platform: 'other', model: 'ExternalModel' } }) }), {});
const externalNoCodeBody = await externalNoCodeResponse.json();
assert.equal(externalNoCodeBody.needs_conversation_code, undefined);
assert.match(externalNoCodeBody.error, /BENCH_SECRET/);

const refs = bank.stages.map(s => s.key.reference_map.join('\n'));
for (let i = 0; i < bank.stages.length; i++) {
  assert.match(bank.stages[i].prompt, /one optional plain-text file named notes\.txt/i, `notes exception stage ${i + 1}`);
  assert.match(bank.stages[i].prompt, /goal is 8\/8.*do not stop voluntarily/i, `single-go instruction stage ${i + 1}`);
  assert.match(bank.stages[i].prompt, /try your hardest.*strongest answer/i, `effort instruction stage ${i + 1}`);
  assert.match(bank.stages[i].prompt, /score is the highest consecutively solved puzzle.*fallback/i, `score-retention instruction stage ${i + 1}`);
  assert.equal(verifyPacking(bank.stages[i], refs[i]), true, `reference stage ${i + 1}`);
  assert.equal(verifyPacking(bank.stages[i], { rows: bank.stages[i].key.reference_map }), true, `row form stage ${i + 1}`);
  assert.equal(verifyPacking(bank.stages[i], refs[i].replace(/[A-Z]/, '.')), false, `missing cell stage ${i + 1}`);
}
assert.equal(verifyPacking(bank.stages[0], '```\n' + refs[0] + '\n```'), false, 'fences rejected');

// Correct after >=20 seconds advances exactly one stage.
const storage = new Storage();
const gate = new RunGate({ storage }, {});
let r = await gate.fetch(new Request('https://gate/register', { method: 'POST', body: JSON.stringify({ action: 'register', conversation_code: CODE }) }));
assert.equal(r.status, 200);
let state = await storage.get('state');
state.stage_started_at -= 21_000;
await storage.put('state', state);
r = await gate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[0] }) }));
let body = await r.json();
assert.equal(body.ok, true);
assert.equal(body.task.stage, 2);
assert.equal(body.report.completed_stages, 1);

// Stages 1–3 are timer-exempt; a correct sub-20-second stage 4 is flagged.
const fastStorage = new Storage();
const fastGate = new RunGate({ storage: fastStorage }, {});
await fastGate.fetch(new Request('https://gate/register', { method: 'POST', body: JSON.stringify({ action: 'register', conversation_code: CODE }) }));
for (let i = 0; i < 3; i++) {
  r = await fastGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[i] }) }));
  body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.task.stage, i + 2);
}
r = await fastGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[3] }) }));
body = await r.json();
assert.equal(r.status, 403);
assert.equal(body.tool_use_flagged, true);
assert.equal(body.stop, true);
r = await fastGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[3] }) }));
assert.equal(r.status, 409);

// An incorrect attempt ends the run and gives no geometric oracle detail.
const badStorage = new Storage();
const badGate = new RunGate({ storage: badStorage }, {});
await badGate.fetch(new Request('https://gate/register', { method: 'POST', body: JSON.stringify({ action: 'register', conversation_code: CODE }) }));
await badGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[0] }) }));
r = await badGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: 'wrong' }) }));
body = await r.json();
assert.equal(body.correct, false);
assert.equal(body.stop, true);
assert.equal(body.report.status, 'stopped');
assert.equal(body.score_retained, true);
assert.equal(body.report.completed_stages, 1, 'previous accepted stage remains scored');
assert.equal(body.report.conversation_code, CODE);
assert.equal(body.report.model, CODE, 'conversation code is used as the graph model label');
assert.equal(body.report.harness, 'unknown');
state = await badStorage.get('state');
assert.equal(state.conversation_code, CODE, 'conversation code persisted in Durable Object storage');
assert.equal(state.scores.completed_stages, 1, 'scores persisted alongside conversation code');
assert.equal(JSON.stringify(body).includes('reference_map'), false);

const externalStorage = new Storage();
const externalGate = new RunGate({ storage: externalStorage }, {});
await externalGate.fetch(new Request('https://gate/register', { method: 'POST', body: JSON.stringify({ action: 'register', conversation_code: null, metadata: { model: 'ExternalModel', harness: 'custom' } }) }));
r = await externalGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[0] }) }));
body = await r.json();
assert.equal(body.report.model, 'ExternalModel', 'non-Arena run falls back to metadata.model');
assert.equal(body.report.harness, 'custom');

// The shared SQLite-backed Durable Object index powers /graph.
const leaderboardStorage = new Storage();
const leaderboardGate = new RunGate({ storage: leaderboardStorage }, {});
for (const record of [
  { run_id: 'run-low', conversation_code: CODE, model: CODE, harness: 'arena.ai', status: 'stopped', highest_solved_stage: 3, total_time_seconds: 91.5, weighted_correctness_score: 16.667, speed_score: 50, performance_score: 20, updated_at: '2026-07-16T12:00:00Z' },
  { run_id: 'run-best', conversation_code: CODE, model: CODE, harness: 'arena.ai', status: 'max_stage_reached', highest_solved_stage: 8, total_time_seconds: 500, weighted_correctness_score: 100, speed_score: 40, performance_score: 94, updated_at: '2026-07-16T13:00:00Z' },
  { run_id: 'run-manual', conversation_code: null, model: 'manual-agent', harness: 'manual', status: 'max_stage_reached', highest_solved_stage: 8, total_time_seconds: 400, weighted_correctness_score: 100, speed_score: 45, performance_score: 94.5, updated_at: '2026-07-16T14:00:00Z' },
]) {
  r = await leaderboardGate.fetch(new Request('https://leaderboard/record', { method: 'POST', body: JSON.stringify({ action: 'record_result', record }) }));
  assert.equal(r.status, 200);
}
const graphEnv = { RUN_GATE: { idFromName: name => name, get: () => ({ fetch: (url, init) => leaderboardGate.fetch(new Request(url, init)) }) } };
r = await worker.fetch(new Request('https://bench.test/graph.json'), graphEnv);
let graphData = await r.json();
assert.equal(graphData.records.length, 2, 'same conversation code is consolidated to one best result');
assert.equal(graphData.records.find(x => x.model === CODE).highest_solved_stage, 8);
assert.equal(graphData.records.find(x => x.model === CODE).status, 'max_stage_pending_review');
assert.equal(graphData.records.find(x => x.model === CODE).model_url, `https://arena.ai/agent/${CODE}`);
assert.equal(graphData.records.find(x => x.model === 'manual-agent').status, 'max_stage_unverified');
assert.equal(graphData.records.some(x => Object.hasOwn(x, 'raw_status')), false, 'legacy failed/completed labels stay private');
r = await worker.fetch(new Request('https://bench.test/graph'), graphEnv);
const graphText = await r.text();
assert.equal(r.status, 200);
assert.match(graphText, new RegExp(CODE));
assert.match(graphText, /max_stage_pending_review/);
assert.match(graphText, /max_stage_unverified/);
assert.match(graphText, new RegExp(`https://arena\\.ai/agent/${CODE}`));
assert.match(graphText, /Highest solved puzzle/);

console.log(`ok: ${bank.stages.length} staged packing tasks, persistence, and graph invariants`);

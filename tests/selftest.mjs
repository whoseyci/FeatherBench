import assert from 'node:assert/strict';
import bank from '../src/bank.json' with { type: 'json' };
import worker, { RunGate, validConversationCode, verifyPacking } from '../src/index.js';

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

// Missing codes are rejected before a run is created and instruct the model to ask its user.
let missingCodeResponse = await worker.fetch(new Request('https://bench.test/v1/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attest_no_solving_tools: true }) }), {});
let missingCodeBody = await missingCodeResponse.json();
assert.equal(missingCodeResponse.status, 400);
assert.equal(missingCodeBody.needs_conversation_code, true);
assert.match(missingCodeBody.action_for_model, /(ask.*user|user.*ask)/i);

const refs = bank.stages.map(s => s.key.reference_map.join('\n'));
for (let i = 0; i < bank.stages.length; i++) {
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
assert.equal(body.report.status, 'failed');
assert.equal(body.report.completed_stages, 1, 'previous accepted stage remains scored');
assert.equal(body.report.conversation_code, CODE);
state = await badStorage.get('state');
assert.equal(state.conversation_code, CODE, 'conversation code persisted in Durable Object storage');
assert.equal(state.scores.completed_stages, 1, 'scores persisted alongside conversation code');
assert.equal(JSON.stringify(body).includes('reference_map'), false);

// The shared SQLite-backed Durable Object index powers /graph without exposing conversation codes.
const leaderboardStorage = new Storage();
const leaderboardGate = new RunGate({ storage: leaderboardStorage }, {});
r = await leaderboardGate.fetch(new Request('https://leaderboard/record', { method: 'POST', body: JSON.stringify({ action: 'record_result', record: { run_id: 'run-1', conversation_code: CODE, model: 'GraphModel', harness: 'manual', status: 'failed', highest_solved_stage: 3, total_time_seconds: 91.5, weighted_correctness_score: 16.667, speed_score: 50, performance_score: 20, updated_at: '2026-07-16T12:00:00Z' } }) }));
assert.equal(r.status, 200);
const graphEnv = { RUN_GATE: { idFromName: name => name, get: () => ({ fetch: (url, init) => leaderboardGate.fetch(new Request(url, init)) }) } };
r = await worker.fetch(new Request('https://bench.test/graph'), graphEnv);
const graphText = await r.text();
assert.equal(r.status, 200);
assert.match(graphText, /GraphModel/);
assert.match(graphText, /Highest solved puzzle/);
assert.equal(graphText.includes(CODE), false, 'public graph must not expose conversation code');

console.log(`ok: ${bank.stages.length} staged packing tasks, persistence, and graph invariants`);

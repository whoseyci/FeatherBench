import assert from 'node:assert/strict';
import bank from '../src/bank.json' with { type: 'json' };
import { RunGate, verifyPacking } from '../src/index.js';

class Storage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k); }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async transaction(fn) { return await fn(this); }
}

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
let r = await gate.fetch(new Request('https://gate/register', { method: 'POST', body: JSON.stringify({ action: 'register' }) }));
assert.equal(r.status, 200);
let state = await storage.get('state');
state.stage_started_at -= 21_000;
await storage.put('state', state);
r = await gate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[0] }) }));
let body = await r.json();
assert.equal(body.ok, true);
assert.equal(body.task.stage, 2);
assert.equal(body.report.completed_stages, 1);

// A correct sub-20-second solution is flagged and permanently closed.
const fastStorage = new Storage();
const fastGate = new RunGate({ storage: fastStorage }, {});
await fastGate.fetch(new Request('https://gate/register', { method: 'POST', body: JSON.stringify({ action: 'register' }) }));
r = await fastGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[0] }) }));
body = await r.json();
assert.equal(r.status, 403);
assert.equal(body.tool_use_flagged, true);
assert.equal(body.stop, true);
r = await fastGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: refs[0] }) }));
assert.equal(r.status, 409);

// An incorrect attempt ends the run and gives no geometric oracle detail.
const badStorage = new Storage();
const badGate = new RunGate({ storage: badStorage }, {});
await badGate.fetch(new Request('https://gate/register', { method: 'POST', body: JSON.stringify({ action: 'register' }) }));
state = await badStorage.get('state');
state.stage_started_at -= 21_000;
await badStorage.put('state', state);
r = await badGate.fetch(new Request('https://gate/submit', { method: 'POST', body: JSON.stringify({ action: 'submit', answer: 'wrong' }) }));
body = await r.json();
assert.equal(body.correct, false);
assert.equal(body.stop, true);
assert.equal(body.report.status, 'failed');
assert.equal(JSON.stringify(body).includes('reference_map'), false);

console.log(`ok: ${bank.stages.length} staged packing tasks and protocol invariants`);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PAGE_LIMIT = 700;
const INTERRUPTION_PAGE = 636;
const SLOTS_PER_PAGE = 3;

const json = value => JSON.stringify(value, null, 2);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const atomicWrite = (file, value) => {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, json(value));
  fs.renameSync(temporary, file);
};

function fakePage(provider, flowId, page, changes = {}) {
  const change = changes[page] || {};
  const slots = Array.from({ length: change.count ?? SLOTS_PER_PAGE }, (_, i) => ({
    slot_id: change.ids?.[i] ?? `${provider}-${flowId}-${page}-${i}`,
    provider, flow_id: flowId, page,
  }));
  return { page, flow_id: flowId, rows: slots,
    continuation: page < PAGE_LIMIT ? { next_page: page + 1 } : { stop: true } };
}

class Store {
  constructor(root) { this.root = root; fs.mkdirSync(root, { recursive: true }); }
  publish(sequence, source, { interruptAt } = {}) {
    const destination = path.join(this.root, `checkpoint-${String(sequence).padStart(6, '0')}`);
    fs.cpSync(source, destination, { recursive: true });
    if (interruptAt === 'before-complete') return;
    fs.writeFileSync(path.join(destination, 'CHECKPOINT.COMPLETE'), 'ok\n');
    if (interruptAt === 'before-latest') return;
    atomicWrite(path.join(this.root, 'latest.json'), { sequence, directory: path.basename(destination) });
  }
  restoreLatest(destination) {
    const latest = fs.existsSync(path.join(this.root, 'latest.json'))
      ? read(path.join(this.root, 'latest.json')) : null;
    assert.ok(latest, 'a published checkpoint is required');
    const source = path.join(this.root, latest.directory);
    assert.ok(fs.existsSync(path.join(source, 'CHECKPOINT.COMPLETE')));
    fs.cpSync(source, destination, { recursive: true });
  }
}

class Checkpoint {
  constructor(root, provider = 'AH', flowId = 'flow-1') {
    this.root = root; this.provider = provider; this.flowId = flowId;
    this.parts = path.join(root, 'parts'); fs.mkdirSync(this.parts, { recursive: true });
    this.manifestFile = path.join(root, 'manifest.json');
    this.stateFile = path.join(root, 'state.json');
    this.auditFile = path.join(root, 'audit.json');
    if (!fs.existsSync(this.manifestFile)) {
      atomicWrite(this.manifestFile, { schema: 1, provider, flow_id: flowId,
        status: 'partial', last_committed_page: 0, row_count: 0, pages: [] });
      atomicWrite(this.stateFile, { provider, flow_id: flowId, status: 'in_progress',
        last_committed_page: 0, next_continuation: { next_page: 1 } });
      atomicWrite(this.auditFile, { provider, flow_id: flowId, status: 'in_progress',
        loads_completed: 0, slot_count: 0 });
    }
  }
  get manifest() { return read(this.manifestFile); }
  get state() { return read(this.stateFile); }
  get audit() { return read(this.auditFile); }
  commit(page, failurePoint) {
    const m = this.manifest;
    const state = this.state;
    const audit = this.audit;
    assert.equal(page.page, m.last_committed_page + 1);
    const body = page.rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    const part = `parts/page-${String(page.page).padStart(4, '0')}.jsonl`;
    fs.writeFileSync(path.join(this.root, part), body);
    m.pages.push({ page: page.page, path: part, rows: page.rows.length,
      sha256: crypto.createHash('sha256').update(body).digest('hex'), page_digest: digest(page) });
    m.last_committed_page = page.page; m.row_count += page.rows.length;
    state.last_committed_page = page.page; state.next_continuation = page.continuation;
    audit.loads_completed = page.page; audit.slot_count = m.row_count;
    // These are deliberately separate writes: recovery must reject a torn commit.
    if (failurePoint === 'before-state') { atomicWrite(this.manifestFile, m); return; }
    atomicWrite(this.manifestFile, m);
    if (failurePoint === 'before-audit') { atomicWrite(this.stateFile, state); return; }
    atomicWrite(this.stateFile, state);
    atomicWrite(this.auditFile, audit);
  }
  rows() {
    const m = this.manifest; const result = [];
    for (const item of m.pages) {
      const file = path.join(this.root, item.path); const body = fs.readFileSync(file);
      assert.equal(crypto.createHash('sha256').update(body).digest('hex'), item.sha256);
      result.push(...body.toString().trim().split('\n').map(line => JSON.parse(line)));
    }
    assert.equal(result.length, m.row_count); return result;
  }
  consistent() {
    const m = this.manifest, s = this.state, a = this.audit;
    return m.last_committed_page === s.last_committed_page &&
      s.last_committed_page === a.loads_completed && m.row_count === a.slot_count &&
      m.pages.length === m.last_committed_page;
  }
  finish(status = 'slots_captured') {
    assert.ok(this.consistent()); assert.equal(this.state.last_committed_page, PAGE_LIMIT);
    atomicWrite(this.manifestFile, { ...this.manifest, status: 'complete' });
    atomicWrite(this.stateFile, { ...this.state, status: 'complete' });
    atomicWrite(this.auditFile, { ...this.audit, status });
    atomicWrite(path.join(this.root, 'complete.json'), { provider: this.provider,
      flow_id: this.flowId, status: 'complete', slot_count: this.manifest.row_count });
  }
  persistMismatch(mismatches) {
    atomicWrite(this.stateFile, { ...this.state, status: 'page_mismatch', mismatches });
    atomicWrite(this.auditFile, { ...this.audit, status: 'page_mismatch', mismatches });
  }
}

function restoreConsistent(source, destination) {
  const c = new Checkpoint(source);
  if (!c.consistent()) throw new Error('inconsistent checkpoint');
  fs.cpSync(source, destination, { recursive: true });
  return new Checkpoint(destination);
}

function replayCheck(c, changes) {
  const mismatches = [];
  for (const item of c.manifest.pages) {
    const replay = fakePage(c.provider, c.flowId, item.page, changes);
    if (digest(replay) !== item.page_digest) mismatches.push(item.page);
  }
  if (mismatches.length) c.persistMismatch(mismatches);
  return mismatches;
}

function publicationGate(ah, oh, runId) {
  if (!ah.complete || !oh.complete) return false;
  if (ah.runId !== runId || oh.runId !== runId) return false;
  if (ah.status !== 'accepted' || oh.status !== 'accepted') return false;
  if (ah.incompleteFlows || oh.incompleteFlows) return false;
  return ah.slotCount + oh.slotCount > 0;
}

function runUntilShutdown(root, store) {
  const c = new Checkpoint(root);
  assert.throws(() => {
    for (let page = 1; page <= PAGE_LIMIT; page++) {
      c.commit(fakePage('AH', 'flow-1', page));
      if (page === INTERRUPTION_PAGE) {
        const snapshot = tmp('gastro-snapshot-');
        fs.cpSync(root, snapshot, { recursive: true });
        store.publish(1, snapshot);
        throw new Error('runner shutdown');
      }
    }
  }, /runner shutdown/);
}

test('shutdown at AH page 636 restores in a fresh workspace without duplicate or missing rows', () => {
  const remote = tmp('gastro-remote-'); const first = tmp('gastro-first-'); const fresh = tmp('gastro-fresh-');
  runUntilShutdown(first, new Store(remote));
  const source = new Checkpoint(first);
  assert.equal(source.consistent(), true); assert.equal(source.state.last_committed_page, 636);
  assert.equal(source.audit.status, 'in_progress'); assert.equal(fs.existsSync(path.join(first, 'complete.json')), false);
  new Store(remote).restoreLatest(fresh);
  const restored = new Checkpoint(fresh);
  assert.equal(restored.rows().length, 636 * SLOTS_PER_PAGE);
  for (let page = 637; page <= PAGE_LIMIT; page++) restored.commit(fakePage('AH', 'flow-1', page));
  restored.finish();
  const rows = restored.rows(); assert.equal(rows.length, PAGE_LIMIT * SLOTS_PER_PAGE);
  assert.equal(new Set(rows.map(row => row.slot_id)).size, rows.length);
});

test('changed availability is persisted as page_mismatch and blocks publication', () => {
  const root = tmp('gastro-mismatch-'); const c = new Checkpoint(root);
  for (let page = 1; page <= 636; page++) c.commit(fakePage('AH', 'flow-1', page));
  const mismatches = replayCheck(c, { 200: { ids: ['same-1', 'same-2', 'new-slot'] } });
  assert.deepEqual(mismatches, [200]); assert.equal(c.state.status, 'page_mismatch');
  assert.equal(c.audit.status, 'page_mismatch'); assert.equal(c.rows().length, 636 * SLOTS_PER_PAGE);
  assert.equal(publicationGate({ complete: false, status: 'incomplete', runId: 'r', slotCount: 1, incompleteFlows: true },
    { complete: true, status: 'accepted', runId: 'r', slotCount: 1 }, 'r'), false);
});

test('corrupted parts are rejected during restore', () => {
  const root = tmp('gastro-corrupt-'); const c = new Checkpoint(root);
  c.commit(fakePage('AH', 'flow-1', 1));
  fs.appendFileSync(path.join(root, c.manifest.pages[0].path), '{"slot_id":"corrupt"}\n');
  assert.throws(() => c.rows(), /ERR_ASSERTION/);
});

test('interrupted checkpoint publication keeps the previous checkpoint restorable', () => {
  const remote = tmp('gastro-publish-'); const source = tmp('gastro-source-');
  const c = new Checkpoint(source); c.commit(fakePage('AH', 'flow-1', 1));
  const store = new Store(remote); store.publish(1, source);
  c.commit(fakePage('AH', 'flow-1', 2));
  store.publish(2, source, { interruptAt: 'before-latest' });
  const restored = tmp('gastro-published-'); store.restoreLatest(restored);
  assert.equal(new Checkpoint(restored).manifest.last_committed_page, 1);
});

test('partial, mismatched, and incomplete site publication are rejected', () => {
  const accepted = { complete: true, status: 'accepted', runId: 'run-1', slotCount: 10, incompleteFlows: false };
  assert.equal(publicationGate({ ...accepted, complete: false }, accepted, 'run-1'), false);
  assert.equal(publicationGate(accepted, { ...accepted, runId: 'run-2' }, 'run-1'), false);
  assert.equal(publicationGate({ ...accepted, status: 'page_mismatch', incompleteFlows: true }, accepted, 'run-1'), false);
  assert.equal(publicationGate(accepted, accepted, 'run-1'), true);
});

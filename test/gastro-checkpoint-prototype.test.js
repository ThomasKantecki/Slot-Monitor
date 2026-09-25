import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PAGES = 700;
const INTERRUPT = 636;
const WIDTH = 3;
const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
function atomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function page(provider, flow, number, changes = {}) {
  const change = changes[number] || {};
  return {
    page: number,
    flow_id: flow,
    rows: Array.from({ length: change.count ?? WIDTH }, (_, i) => ({
      slot_id: change.ids?.[i] ?? `${provider}-${flow}-${number}-${i}`,
      provider, flow_id: flow, page: number,
    })),
    continuation: number < PAGES ? { next_page: number + 1 } : { stop: true },
  };
}

class Checkpoint {
  constructor(root) {
    this.root = root;
    this.manifestFile = path.join(root, 'manifest.json');
    this.stateFile = path.join(root, 'state.json');
    this.auditFile = path.join(root, 'audit.json');
    fs.mkdirSync(path.join(root, 'parts'), { recursive: true });
    if (!fs.existsSync(this.manifestFile)) {
      atomic(this.manifestFile, { pages: [], last: 0, rows: 0, status: 'partial' });
      atomic(this.stateFile, { last: 0, next: 1, status: 'in_progress' });
      atomic(this.auditFile, { loads: 0, rows: 0, status: 'in_progress' });
    }
  }
  get manifest() { return read(this.manifestFile); }
  get state() { return read(this.stateFile); }
  get audit() { return read(this.auditFile); }
  commit(input, stop = '') {
    const m = this.manifest;
    const s = this.state;
    const a = this.audit;
    assert.equal(input.page, m.last + 1);
    const body = `${input.rows.map(JSON.stringify).join('\n')}\n`;
    const relative = `parts/page-${String(input.page).padStart(4, '0')}.jsonl`;
    fs.writeFileSync(path.join(this.root, relative), body);
    m.pages.push({ page: input.page, path: relative, rows: input.rows.length,
      sha: hash(body), digest: digest(input) });
    m.last = input.page; m.rows += input.rows.length;
    s.last = input.page; s.next = input.continuation.next_page;
    a.loads = input.page; a.rows = m.rows;
    atomic(this.manifestFile, m);
    if (stop === 'after-manifest') throw new Error('interrupted after manifest');
    atomic(this.stateFile, s);
    if (stop === 'after-state') throw new Error('interrupted after state');
    atomic(this.auditFile, a);
    if (stop === 'after-audit') throw new Error('interrupted after audit');
  }
  consistent() {
    try {
      const m = this.manifest; const s = this.state; const a = this.audit;
      if (m.last !== s.last || s.last !== a.loads || m.rows !== a.rows || m.pages.length !== m.last) return false;
      for (const part of m.pages) {
        const body = fs.readFileSync(path.join(this.root, part.path));
        if (hash(body) !== part.sha) return false;
      }
      return m.pages.reduce((n, p) => n + p.rows, 0) === m.rows;
    } catch { return false; }
  }
  rows() {
    assert.equal(this.consistent(), true);
    return this.manifest.pages.flatMap(part => fs.readFileSync(path.join(this.root, part.path), 'utf8')
      .trim().split('\n').map(JSON.parse));
  }
  mismatch(pages) {
    atomic(this.stateFile, { ...this.state, status: 'page_mismatch', mismatches: pages });
    atomic(this.auditFile, { ...this.audit, status: 'page_mismatch', mismatches: pages });
  }
  finish() {
    assert.equal(this.consistent(), true);
    assert.equal(this.state.last, PAGES);
    atomic(this.manifestFile, { ...this.manifest, status: 'complete' });
    atomic(this.stateFile, { ...this.state, status: 'complete' });
    atomic(this.auditFile, { ...this.audit, status: 'slots_captured' });
    atomic(path.join(this.root, 'complete.json'), { status: 'complete' });
  }
}

function copy(source, target) { fs.cpSync(source, target, { recursive: true }); }
function markComplete(root) { fs.writeFileSync(path.join(root, 'CHECKPOINT.COMPLETE'), 'ok\n'); }
function restorePrior(parent, target) {
  const candidates = fs.readdirSync(parent).filter(x => /^checkpoint-/.test(x)).sort().reverse();
  for (const name of candidates) {
    const source = path.join(parent, name);
    if (!fs.existsSync(path.join(source, 'CHECKPOINT.COMPLETE'))) continue;
    const checkpoint = new Checkpoint(source);
    if (!checkpoint.consistent()) continue;
    copy(source, target);
    return new Checkpoint(target);
  }
  throw new Error('no consistent checkpoint');
}
function publish(parent, sequence, source, { interrupted = false } = {}) {
  const target = path.join(parent, `checkpoint-${String(sequence).padStart(6, '0')}`);
  copy(source, target);
  assert.equal(new Checkpoint(target).consistent(), true);
  if (interrupted) return target;
  markComplete(target);
  atomic(path.join(parent, 'latest.json'), { directory: path.basename(target) });
  return target;
}
function gate(ah, oh, id) {
  return ah.complete && oh.complete && ah.runId === id && oh.runId === id &&
    ah.status === 'accepted' && oh.status === 'accepted' &&
    !ah.incomplete && !oh.incomplete && ah.slots + oh.slots > 0;
}

test('interrupts AH at page 636 and restores all rows exactly once', () => {
  const live = temp('ah-live-'); const remote = temp('remote-'); const fresh = temp('fresh-');
  const checkpoint = new Checkpoint(live);
  assert.throws(() => {
    for (let n = 1; n <= PAGES; n++) {
      checkpoint.commit(page('AH', 'flow', n));
      if (n === INTERRUPT) { publish(remote, 1, live); throw new Error('runner shutdown'); }
    }
  }, /runner shutdown/);
  assert.equal(checkpoint.manifest.last, INTERRUPT);
  assert.equal(checkpoint.state.status, 'in_progress');
  assert.equal(checkpoint.audit.loads, INTERRUPT);
  assert.equal(fs.existsSync(path.join(live, 'complete.json')), false);
  copy(path.join(remote, 'checkpoint-000001'), fresh);
  const restored = new Checkpoint(fresh);
  assert.equal(restored.rows().length, INTERRUPT * WIDTH);
  for (let n = INTERRUPT + 1; n <= PAGES; n++) restored.commit(page('AH', 'flow', n));
  restored.finish();
  const rows = restored.rows();
  assert.equal(rows.length, PAGES * WIDTH);
  assert.equal(new Set(rows.map(r => r.slot_id)).size, rows.length);
});

test('calls each torn-write point and restores the prior consistent checkpoint', () => {
  for (const point of ['after-manifest', 'after-state']) {
    const parent = temp(`torn-${point}-`); const live = path.join(parent, 'live');
    const prior = path.join(parent, 'checkpoint-000001'); const target = path.join(parent, 'restored');
    const checkpoint = new Checkpoint(live); checkpoint.commit(page('AH', 'flow', 1));
    copy(live, prior); markComplete(prior);
    assert.throws(() => checkpoint.commit(page('AH', 'flow', 2), point), new RegExp(`interrupted ${point.replace('-', ' ')}`));
    copy(live, path.join(parent, 'checkpoint-000002')); // no completion marker: interrupted publication
    const restored = restorePrior(parent, target);
    assert.equal(restored.manifest.last, 1);
    assert.equal(restored.rows().length, WIDTH);
  }
});

test('after-audit is consistent locally but interrupted upload is ignored', () => {
  const parent = temp('upload-'); const live = temp('live-'); const target = temp('restored-');
  const checkpoint = new Checkpoint(live); checkpoint.commit(page('AH', 'flow', 1));
  publish(parent, 1, live); checkpoint.commit(page('AH', 'flow', 2), 'after-audit');
  assert.equal(checkpoint.consistent(), true);
  const incomplete = publish(parent, 2, live, { interrupted: true });
  assert.equal(fs.existsSync(path.join(incomplete, 'CHECKPOINT.COMPLETE')), false);
  const restored = restorePrior(parent, target);
  assert.equal(restored.manifest.last, 1);
});

test('availability changes persist page_mismatch without duplicates', () => {
  const root = temp('mismatch-'); const checkpoint = new Checkpoint(root);
  for (let n = 1; n <= INTERRUPT; n++) checkpoint.commit(page('AH', 'flow', n));
  const mismatches = checkpoint.manifest.pages.filter(p => digest(page('AH', 'flow', p.page, {
    200: { ids: ['same', 'same-2', 'new'] },
  })) !== p.digest).map(p => p.page);
  checkpoint.mismatch(mismatches);
  assert.deepEqual(mismatches, [200]);
  assert.equal(checkpoint.state.status, 'page_mismatch');
  assert.equal(new Set(checkpoint.rows().map(r => r.slot_id)).size, checkpoint.rows().length);
  assert.equal(fs.existsSync(path.join(root, 'complete.json')), false);
});

test('corrupt parts are rejected', () => {
  const root = temp('corrupt-'); const checkpoint = new Checkpoint(root);
  checkpoint.commit(page('AH', 'flow', 1));
  fs.appendFileSync(path.join(root, checkpoint.manifest.pages[0].path), '{"corrupt":true}\n');
  assert.equal(checkpoint.consistent(), false);
  assert.throws(() => checkpoint.rows(), /true|ERR_ASSERTION/);
});

test('partial, mismatched, and incomplete site publication is rejected', () => {
  const accepted = { complete: true, status: 'accepted', runId: 'r', slots: 10, incomplete: false };
  assert.equal(gate({ ...accepted, complete: false }, accepted, 'r'), false);
  assert.equal(gate(accepted, { ...accepted, runId: 'other' }, 'r'), false);
  assert.equal(gate({ ...accepted, status: 'page_mismatch', incomplete: true }, accepted, 'r'), false);
  assert.equal(gate(accepted, accepted, 'r'), true);
});

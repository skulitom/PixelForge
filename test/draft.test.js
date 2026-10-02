import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, DRAFT_KEY } from '../studio/draft.js';

// The parts of the browser's Storage that the studio uses.
function fakeStorage({ quota = Infinity } = {}) {
  const items = new Map();
  return {
    items,
    getItem: key => items.has(key) ? items.get(key) : null,
    setItem(key, value) { if (value.length > quota) throw new Error('QuotaExceededError'); items.set(key, String(value)); },
    removeItem: key => { items.delete(key); }
  };
}
test('the studio keeps one draft with its name and time, and forgets it on request', () => {
  const storage = fakeStorage(), drafts = createDraftStore(storage, { now: () => 1790000000000 });
  assert.equal(drafts.load(), null);
  assert.equal(drafts.save('{ "name": "broken', 'hero.json'), true);
  // The text is kept as typed, valid JSON or not: an unfinished edit is exactly what recovery is for.
  assert.deepEqual(drafts.load(), { text: '{ "name": "broken', name: 'hero.json', savedAt: 1790000000000 });
  assert.deepEqual([...storage.items.keys()], [DRAFT_KEY]);
  assert.equal(drafts.save('{}', 'hero.json'), true); assert.equal(drafts.load().text, '{}');
  drafts.clear(); assert.equal(drafts.load(), null); assert.equal(storage.items.size, 0);
});
test('a draft that cannot be stored or read never breaks the studio', () => {
  const storage = fakeStorage({ quota: 120 }), drafts = createDraftStore(storage);
  assert.equal(drafts.save('small', 'a.json'), true);
  // A refused write reports false and leaves the earlier draft in place.
  assert.equal(drafts.save('x'.repeat(500), 'a.json'), false); assert.equal(drafts.load().text, 'small');
  for (const stored of ['not json', 'null', '[]', '{"text":1,"name":"a","savedAt":2}', '{"text":"a","name":"a"}', '{"text":"a","name":"a","savedAt":"soon"}']) { storage.items.set(DRAFT_KEY, stored); assert.equal(drafts.load(), null, stored); }
  // Browsers with storage switched off hand out nothing, or throw on every call.
  for (const broken of [null, undefined, { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } }]) {
    const none = createDraftStore(broken);
    assert.equal(none.load(), null); assert.equal(none.save('a', 'b'), false); assert.doesNotThrow(() => none.clear());
  }
});

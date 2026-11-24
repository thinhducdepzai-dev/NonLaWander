import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleDraft } from '../public/data.js';
import { applyEdit, createPlan, inspectPlan, prepareRequest } from '../public/planner.js';
import { createTripStore, hasDraftChanges, legacyStorageKey, tripStoragePrefix } from '../public/trips.js';

function memoryStorage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, value); },
  };
}

function sampleDraft() {
  const form = exampleDraft();
  return {
    form,
    plan: createPlan(prepareRequest(form).request),
    appliedDraft: JSON.stringify(form),
    undo: null,
  };
}

function removeFirstStop(draft) {
  const { id: slotId, stops } = draft.plan.slots[0];
  const stopId = stops[0].id;
  return {
    ...draft,
    plan: applyEdit(draft.plan, { type: 'remove', slotId, stopId }),
    undo: { slotId, stopId, plan: draft.plan },
  };
}

test('a fresh browser starts empty and a new trip can be named before setting dates', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  assert.equal(store.migrateLegacy(), null);
  assert.deepEqual(store.list(), []);

  const trip = store.create();
  assert.equal(trip.name, 'Chuyến đi mới');
  assert.equal(trip.draft.form.startDate, '');
  assert.equal(trip.draft.form.endDate, '');
  assert.deepEqual(trip.draft.form.days, {});
  assert.equal(trip.draft.plan, null);
  assert.equal(trip.confirmed, null);

  store.rename(trip.id, '  Một vòng phố cổ  ');
  const reopened = createTripStore(storage).list();
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].id, trip.id);
  assert.equal(reopened[0].name, 'Một vòng phố cổ');
});

test('migrating twice restores one draft, including unapplied form changes and saved itinerary edits', () => {
  const storage = memoryStorage();
  const draft = removeFirstStop(sampleDraft());
  draft.form.notes.vibes = 'Đi chậm và ghé chụp ảnh';
  draft.form.budget = '';
  const legacy = { draft: draft.form, plan: draft.plan, appliedDraft: draft.appliedDraft };
  const original = JSON.stringify(legacy);
  storage.setItem(legacyStorageKey, original);

  const first = createTripStore(storage).migrateLegacy();
  const reopened = createTripStore(storage);
  const second = reopened.migrateLegacy();

  assert.deepEqual(second, first);
  assert.deepEqual(reopened.list(), [first]);
  assert.deepEqual(first.draft, { form: legacy.draft, plan: legacy.plan, appliedDraft: legacy.appliedDraft, undo: null });
  assert.equal(first.confirmed, null);
  assert.equal(inspectPlan(first.draft.plan).stopCount, 5);
  assert.equal(storage.getItem(legacyStorageKey), original);

  reopened.rename(first.id, 'Chuyến đã nhập');
  assert.equal(createTripStore(storage).migrateLegacy().name, 'Chuyến đã nhập');
});

test('failed migration writes leave legacy data available and a reload can retry', () => {
  const storage = memoryStorage();
  const { form, plan, appliedDraft } = sampleDraft();
  const old = JSON.stringify({ draft: form, plan, appliedDraft });
  storage.setItem(legacyStorageKey, old);
  const blocked = createTripStore({
    get length() { return storage.length; },
    key: storage.key,
    getItem: storage.getItem,
    setItem() { throw new Error('Storage quota exceeded'); },
  });

  const pending = blocked.migrateLegacy();
  assert.equal(blocked.storageProblem, true);
  assert.deepEqual(blocked.list(), [pending]);
  assert.equal(storage.getItem(tripStoragePrefix + pending.id), null);
  assert.equal(storage.getItem(legacyStorageKey), old);

  const reopened = createTripStore(storage);
  assert.equal(reopened.migrateLegacy().id, pending.id);
  assert.equal(reopened.storageProblem, false);
  assert.equal(reopened.list().length, 1);
});

test('malformed legacy storage does not create a trip', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  storage.setItem(legacyStorageKey, '{broken');
  assert.equal(store.migrateLegacy(), null);
  const { form, plan } = sampleDraft();
  plan.slots[0].stops[0].placeId = 'missing';
  storage.setItem(legacyStorageKey, JSON.stringify({ draft: form, plan }));
  assert.equal(store.migrateLegacy(), null);
  assert.deepEqual(store.list(), []);
});

test('two trips keep independent names, forms, schedules, and undo across reopen', () => {
  const storage = memoryStorage();
  const firstStore = createTripStore(storage);
  const first = firstStore.create();
  const second = firstStore.create();
  assert.notEqual(first.id, second.id);

  firstStore.saveDraft(first.id, sampleDraft());
  firstStore.saveDraft(second.id, sampleDraft());
  const before = firstStore.get(second.id);
  const edited = removeFirstStop(firstStore.get(first.id).draft);
  edited.form.notes.areas = 'Ưu tiên Hồ Gươm';
  firstStore.saveDraft(first.id, edited);
  firstStore.rename(first.id, 'Chuyến A');

  const reopened = createTripStore(storage);
  assert.equal(reopened.get(first.id).name, 'Chuyến A');
  assert.deepEqual(reopened.get(first.id).draft, edited);
  assert.deepEqual(reopened.get(second.id), before);

  const saved = reopened.get(first.id).draft;
  reopened.saveDraft(first.id, { ...saved, plan: saved.undo.plan, undo: null });
  assert.equal(inspectPlan(reopened.get(first.id).draft.plan).stopCount, 6);
  assert.deepEqual(reopened.get(second.id), before);
});

test('editing a draft after confirmation preserves the snapshot until explicit update', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  assert.equal(store.confirm(id), null);
  store.saveDraft(id, sampleDraft());
  const firstConfirmation = store.confirm(id);
  assert.equal(hasDraftChanges(firstConfirmation), false);
  assert.equal(hasDraftChanges(store.rename(id, 'Tên mới')), false);

  const edited = removeFirstStop(store.get(id).draft);
  edited.form.budget = '160000';
  store.saveDraft(id, edited);
  const reopened = createTripStore(storage);
  const beforeUpdate = reopened.get(id);

  assert.equal(hasDraftChanges(beforeUpdate), true);
  assert.deepEqual(beforeUpdate.confirmed, firstConfirmation.confirmed);
  assert.equal(beforeUpdate.confirmed.form.budget, '350000');
  assert.equal(inspectPlan(beforeUpdate.confirmed.plan).stopCount, 6);
  assert.equal(inspectPlan(beforeUpdate.draft.plan).stopCount, 5);

  reopened.confirm(id);
  const updated = createTripStore(storage).get(id);
  assert.equal(hasDraftChanges(updated), false);
  assert.equal(updated.confirmed.form.budget, '160000');
  assert.equal(inspectPlan(updated.confirmed.plan).stopCount, 5);
  assert.deepEqual(updated.draft.undo, edited.undo);
});

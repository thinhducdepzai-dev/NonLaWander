import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleDraft } from '../public/data.js';
import { applyEdit, clock, createPlan, inspectPlan, prepareRequest, walkMinutes } from '../public/planner.js';
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

test('adding the first visit starts an empty itinerary and treats opening hours as a warning', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const trip = store.create();
  const command = { slotId: '2026-11-27-morning', placeId: 'cho-dem' };
  assert.ok(store.addVisit(trip.id, command).errors.arrival);

  const form = exampleDraft();
  store.saveDraft(trip.id, { ...trip.draft, form });
  const { trip: saved } = store.addVisit(trip.id, command);
  const [morning, afternoon] = saved.draft.plan.slots;
  const [stop] = morning.stops;
  const review = inspectPlan(saved.draft.plan);

  assert.match(stop.id, /^visit-[a-f0-9]{32}$/);
  assert.equal(stop.placeId, 'cho-dem');
  assert.equal(review.stopCount, 1);
  assert.equal(review.total, 50_000);
  assert.deepEqual(afternoon.stops, []);
  assert.deepEqual(review.slots[0].stops[0].issues, [{ code: 'opening' }]);
  assert.equal(clock(review.slots[0].stops[0].arrival), '08:00');
  assert.equal(saved.draft.appliedDraft, JSON.stringify(form));
  assert.deepEqual(createTripStore(storage).get(trip.id), saved);
});

test('adding to a legacy itinerary appends a distinct visit and recalculates only the selected route', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  const draft = sampleDraft();
  const [morning, afternoon] = draft.plan.slots;
  draft.form.days[morning.date].morning.end = '12:00';
  store.saveDraft(id, draft);

  const { trip } = store.addVisit(id, { slotId: morning.id, placeId: 'ngoc-son' });
  const updated = trip.draft.plan;
  const review = inspectPlan(updated);
  const [first, , previous, appended] = review.slots[0].stops;

  assert.deepEqual(updated.slots[0].stops.slice(0, -1), morning.stops);
  assert.deepEqual(updated.slots[1], afternoon);
  assert.deepEqual(review.slots[1], inspectPlan(draft.plan).slots[1]);
  assert.equal(first.id, 'visit-ngoc-son');
  assert.equal(appended.placeId, first.placeId);
  assert.notEqual(appended.id, first.id);
  assert.equal(previous.walkToNext, walkMinutes(previous.place, appended.place));
  assert.equal(appended.arrival, previous.departure + previous.walkToNext);
  assert.equal(appended.departure - appended.arrival, appended.place.duration);
  assert.equal(review.total, 230_000);
  assert.equal(trip.draft.appliedDraft, JSON.stringify(draft.form));
  assert.deepEqual(createTripStore(storage).get(id).draft.plan, updated);
});

test('a newly enabled draft slot can take a visit without replacing the existing slots', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  const draft = sampleDraft();
  const [morning, afternoon] = draft.plan.slots;
  const slotId = '2026-11-27-afternoon';
  draft.form.days[morning.date].afternoon = { enabled: true, start: '14:00', end: '17:00' };
  store.saveDraft(id, draft);

  const { trip } = store.addVisit(id, { slotId, placeId: 'ma-may' });
  const [first, inserted, last] = trip.draft.plan.slots;

  assert.deepEqual(first, morning);
  assert.deepEqual(last, afternoon);
  assert.equal(inserted.id, slotId);
  assert.deepEqual(inserted.stops.map(({ placeId }) => placeId), ['ma-may']);
  assert.equal(inspectPlan(trip.draft.plan).total, 220_000);
});

test('a window and budget conflict reports both limits without writing the draft', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  const draft = sampleDraft();
  const [slot] = draft.plan.slots;
  draft.form.budget = '200000';
  store.saveDraft(id, draft);
  const before = storage.getItem(tripStoragePrefix + id);

  const result = store.addVisit(id, { slotId: slot.id, placeId: 'pho-gia-truyen' });

  assert.equal(result.trip, undefined);
  assert.ok(result.conflicts.some(({ code, end }) => code === 'window' && end === 11 * 60));
  assert.deepEqual(result.conflicts.find(({ code }) => code === 'budget'), {
    code: 'budget', total: 275_000, budget: 200_000, overBudget: 75_000,
  });
  assert.equal(storage.getItem(tripStoragePrefix + id), before);
  assert.deepEqual(store.get(id).draft, draft);
});

test('a fixed visit stays anchored and blocks a conflicting change to the selected window', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  const draft = sampleDraft();
  const [slot] = draft.plan.slots;
  slot.stops[0].fixedStart = 8 * 60;
  draft.form.days[slot.date].morning = { enabled: true, start: '08:30', end: '13:00' };
  store.saveDraft(id, draft);

  const result = store.addVisit(id, { slotId: slot.id, placeId: 'ho-guom' });

  assert.ok(result.conflicts.some(({ code, start, ready }) => code === 'fixed' && start === 480 && ready === 510));
  assert.deepEqual(createTripStore(storage).get(id).draft, draft);
});

test('adding to a confirmed trip only writes its draft and survives a new store instance', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  const other = store.create();
  const before = sampleDraft();
  const [slot] = before.plan.slots;
  store.saveDraft(id, before);
  const { confirmed } = store.confirm(id);
  store.saveDraft(id, { ...before, form: { ...before.form, days: {
    ...before.form.days, [slot.date]: { morning: { enabled: true, start: '08:00', end: '12:00' } },
  } } });

  const { trip: updated } = store.addVisit(id, { slotId: slot.id, placeId: 'ho-guom' });
  const reopened = createTripStore(storage);

  assert.equal(hasDraftChanges(updated), true);
  assert.equal(inspectPlan(updated.draft.plan).stopCount, 7);
  assert.equal(inspectPlan(updated.confirmed.plan).stopCount, 6);
  assert.deepEqual(reopened.get(id).confirmed, confirmed);
  assert.deepEqual(reopened.get(other.id), other);
  assert.deepEqual(reopened.get(id), updated);
});

function savedTransferDraft(sourcePlaces, targetPlaces) {
  const form = exampleDraft();
  form.days['2026-11-29'] = { morning: { enabled: true, start: '08:00', end: '11:00' } };
  const { request } = prepareRequest(form);
  const visits = [sourcePlaces, targetPlaces, ['trang-tien']];
  const slots = request.slots.map((slot, index) => ({
    ...slot, stops: visits[index].map((placeId) => ({ id: `visit-${placeId}`, placeId })),
  }));
  return { form, plan: { version: 1, request, slots }, appliedDraft: JSON.stringify(form), undo: null };
}

test('moving a legacy visit to an empty session on another day leaves the source session empty', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  const draft = savedTransferDraft(['ngoc-son'], []);
  const [source, target, third] = draft.plan.slots;
  const [visit] = source.stops;
  store.saveDraft(id, draft);

  const { trip } = store.moveVisit(id, { slotId: source.id, toSlotId: target.id, stopId: visit.id });
  const [empty, moved, untouched] = trip.draft.plan.slots;
  const review = inspectPlan(trip.draft.plan);

  assert.equal(empty.id, source.id);
  assert.deepEqual(empty.stops, []);
  assert.deepEqual(moved.stops, [visit]);
  assert.deepEqual(untouched, third);
  assert.equal(review.slots[0].freeMinutes, source.end - source.start);
  assert.equal(clock(review.slots[1].stops[0].arrival), '14:00');
  assert.equal(review.total, inspectPlan(draft.plan).total);
  assert.deepEqual(createTripStore(storage).get(id), trip);
});

test('moving a visit by ID distinguishes two visits at the same place', () => {
  const store = createTripStore(memoryStorage());
  const { id } = store.create();
  const draft = savedTransferDraft(['ngoc-son'], []);
  const [source, target] = draft.plan.slots;
  const [original] = source.stops;
  const second = { id: 'visit-a1234567890123456789012345678901', placeId: original.placeId, manual: true };
  source.stops.push(second);
  store.saveDraft(id, draft);

  const { trip } = store.moveVisit(id, { slotId: source.id, toSlotId: target.id, stopId: second.id });

  assert.deepEqual(trip.draft.plan.slots[0].stops, [original]);
  assert.deepEqual(trip.draft.plan.slots[1].stops, [second]);
  assert.equal(inspectPlan(trip.draft.plan).total, inspectPlan(draft.plan).total);
});

test('placing a dragged visit before a destination visit recalculates walking in both sessions', () => {
  const store = createTripStore(memoryStorage());
  const { id } = store.create();
  const other = store.create();
  const draft = savedTransferDraft(['ngoc-son', 'dinh-cafe', 'nha-tho'], ['ho-guom']);
  const [source, target] = draft.plan.slots;
  store.saveDraft(id, draft);
  const { confirmed } = store.confirm(id);
  const before = inspectPlan(draft.plan);
  const { trip } = store.moveVisit(id, {
    slotId: source.id, toSlotId: target.id, stopId: 'visit-dinh-cafe', beforeStopId: 'visit-ho-guom',
  });
  const after = inspectPlan(trip.draft.plan);

  const [ngoc, church] = after.slots[0].stops;
  const [coffee, lake] = after.slots[1].stops;
  assert.deepEqual([ngoc.id, church.id, coffee.id, lake.id], ['visit-ngoc-son', 'visit-nha-tho', 'visit-dinh-cafe', 'visit-ho-guom']);
  assert.equal(ngoc.walkToNext, walkMinutes(ngoc.place, church.place));
  assert.notEqual(ngoc.walkToNext, before.slots[0].stops[0].walkToNext);
  assert.equal(church.arrival, ngoc.departure + ngoc.walkToNext);
  assert.equal(coffee.walkToNext, walkMinutes(coffee.place, lake.place));
  assert.equal(lake.arrival, coffee.departure + coffee.walkToNext);
  assert.ok(after.slots[0].freeMinutes > before.slots[0].freeMinutes);
  assert.ok(after.slots[1].freeMinutes < before.slots[1].freeMinutes);
  assert.deepEqual(after.slots[2], before.slots[2]);
  assert.equal(after.total, before.total);
  assert.deepEqual(trip.confirmed, confirmed);
  assert.deepEqual(store.get(other.id), other);
});

test('rejected moves report the affected session and leave the stored plan byte for byte', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  const draft = savedTransferDraft(['ngoc-son'], ['ho-guom']);
  const [source, target] = draft.plan.slots;
  target.stops[0].fixedStart = 14 * 60 + 20;
  store.saveDraft(id, draft);
  const before = storage.getItem(tripStoragePrefix + id);

  const result = store.moveVisit(id, {
    slotId: source.id, toSlotId: target.id, stopId: 'visit-ngoc-son', beforeStopId: 'visit-ho-guom',
  });

  assert.ok(result.conflicts.some((issue) => issue.code === 'fixed' && issue.slot.id === target.id && issue.start === 860 && issue.ready > issue.start));
  assert.equal(storage.getItem(tripStoragePrefix + id), before);

  const fixedDate = store.moveVisit(id, { slotId: target.id, toSlotId: source.id, stopId: 'visit-ho-guom' });
  assert.ok(fixedDate.conflicts.some((issue) => issue.code === 'fixed-date' && issue.slot.id === source.id));
  assert.equal(storage.getItem(tripStoragePrefix + id), before);

  target.end = 14 * 60 + 30;
  target.stops = [];
  store.saveDraft(id, draft);
  const short = storage.getItem(tripStoragePrefix + id);
  const window = store.moveVisit(id, { slotId: source.id, toSlotId: target.id, stopId: 'visit-ngoc-son' });
  assert.ok(window.conflicts.some((issue) => issue.code === 'window' && issue.slot.id === target.id && issue.end === target.end));
  assert.equal(storage.getItem(tripStoragePrefix + id), short);
});

test('a selected slot added in the current form can receive a visit without regenerating the plan', () => {
  const store = createTripStore(memoryStorage());
  const { id } = store.create();
  const draft = savedTransferDraft(['ngoc-son'], ['ho-guom']);
  const [source, target, third] = draft.plan.slots;
  draft.form.days[source.date].afternoon = { enabled: true, start: '14:00', end: '17:00' };
  const toSlotId = `${source.date}-afternoon`;
  store.saveDraft(id, draft);

  const { trip } = store.moveVisit(id, { slotId: source.id, toSlotId, stopId: 'visit-ngoc-son' });

  assert.deepEqual(trip.draft.plan.slots.map(({ id }) => id), [source.id, toSlotId, target.id, third.id]);
  assert.deepEqual(trip.draft.plan.slots[1].stops, source.stops);
  assert.deepEqual(trip.draft.plan.slots.slice(2), [target, third]);
  assert.equal(trip.draft.appliedDraft, JSON.stringify(draft.form));
});

test('a deselected draft slot stays visible in the existing plan but is not a move destination', () => {
  const store = createTripStore(memoryStorage());
  const { id } = store.create();
  const draft = savedTransferDraft(['ngoc-son'], ['ho-guom']);
  const [source, target] = draft.plan.slots;
  draft.form.days[target.date].afternoon.enabled = false;
  store.saveDraft(id, draft);

  assert.deepEqual(store.moveVisit(id, { slotId: source.id, toSlotId: target.id, stopId: 'visit-ngoc-son' }), { error: 'target' });
  assert.deepEqual(store.get(id).draft.plan.slots[1], target);
});

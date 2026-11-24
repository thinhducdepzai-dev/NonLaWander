import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleDraft, places } from '../public/data.js';
import { applyEdit, clock, createPlan, dateIndex, inspectPlan, openingHours, prepareRequest } from '../public/planner.js';

test('three days with two outings produce exactly two slots and use one shared budget', () => {
  const { request } = prepareRequest(exampleDraft());
  const review = inspectPlan(createPlan(request));

  assert.equal(dateIndex(request.endDate) - dateIndex(request.startDate) + 1, 3);
  assert.deepEqual(review.slots.map(({ date, period }) => [date, period]), [
    ['2026-11-27', 'morning'],
    ['2026-11-28', 'afternoon'],
  ]);
  assert.equal(review.stopCount, 6);
  assert.equal(review.total, 200_000);
  assert.equal(review.overBudget, 0);
  assert.deepEqual(review.missing, []);
  assert.ok(review.slots.every((slot) => slot.stops.every((stop) => !stop.issues.length)));
});

test('moving a stop recomputes both times and walking legs without mutating the original', () => {
  const { request } = prepareRequest(exampleDraft());
  const plan = createPlan(request);
  const slotId = plan.slots[0].id;
  const edited = applyEdit(plan, { type: 'move', slotId, stopId: 'visit-ngoc-son', toIndex: 1 });
  const { stops } = inspectPlan(edited).slots[0];

  assert.deepEqual(stops.map(({ placeId, arrival, walkToNext }) => [placeId, clock(arrival), walkToNext]), [
    ['dinh-cafe', '08:00', 2],
    ['ngoc-son', '08:57', 7],
    ['nha-tho', '09:54', null],
  ]);
  assert.equal(plan.slots[0].stops[0].id, 'visit-ngoc-son');
});

test('reordering can make the same visit exceed its slot and demo opening hours', () => {
  const draft = exampleDraft();
  draft.endDate = draft.startDate;
  draft.days[draft.startDate].morning.end = '10:10';
  draft.mustVisit = ['pho-gia-truyen', 'ma-may'];

  const plan = createPlan(prepareRequest(draft).request);
  const slotId = plan.slots[0].id;
  assert.ok(inspectPlan(plan).slots[0].stops.every((stop) => !stop.issues.length));

  const edited = applyEdit(plan, { type: 'move', slotId, stopId: 'visit-pho-gia-truyen', toIndex: 1 });
  const { stops } = inspectPlan(edited).slots[0];
  assert.equal(clock(stops[0].arrival), '08:30');
  assert.deepEqual(stops[1].issues.map(({ code }) => code), ['window', 'opening']);
});

test('removing a required stop updates cost, budget warning, and missing stop', () => {
  const plan = createPlan(prepareRequest(exampleDraft()).request);
  const edited = applyEdit(plan, { type: 'remove', slotId: plan.slots[0].id, stopId: 'visit-ngoc-son' });
  const review = inspectPlan(edited, 100_000);

  assert.equal(review.stopCount, 5);
  assert.equal(review.total, 170_000);
  assert.equal(review.overBudget, 70_000);
  assert.deepEqual(review.missing.map(({ id }) => id), ['ngoc-son']);
});

test('a zero budget keeps only free visits and flags the required paid stop', () => {
  const draft = exampleDraft();
  draft.budget = '0';
  const review = inspectPlan(createPlan(prepareRequest(draft).request));
  assert.equal(review.total, 0);
  assert.deepEqual(review.missing.map(({ id }) => id), ['ngoc-son']);
  assert.ok(review.slots.every((slot) => slot.freeMinutes >= 45));
});

test('opening hours depend on local calendar day and include split hours', () => {
  const market = places.find(({ id }) => id === 'cho-dem');
  assert.equal(openingHours(market, '2026-11-26').length, 0);
  assert.equal(openingHours(market, '2026-11-27').length, 1);
  const house = places.find(({ id }) => id === 'ma-may');
  assert.deepEqual(openingHours(house, '2026-11-28'), [
    { start: '08:30', end: '11:30' },
    { start: '13:30', end: '17:00' },
  ]);
});

test('validates skipped trips, bad ranges, overlapping slots, and transport support', () => {
  const draft = exampleDraft();
  draft.days[draft.startDate].afternoon = { enabled: true, start: '10:00', end: '15:00' };
  draft.transport = 'car';
  assert.deepEqual(Object.keys(prepareRequest(draft).errors), ['start-2026-11-27-afternoon', 'transport']);
  draft.days = {};
  draft.transport = 'walk';
  assert.deepEqual(Object.keys(prepareRequest(draft).errors), ['sessions']);
  draft.endDate = '2026-11-26';
  assert.deepEqual(Object.keys(prepareRequest(draft).errors), ['departure']);
});

test('free-text notes are saved in the request snapshot without changing the order', () => {
  const draft = exampleDraft();
  const original = prepareRequest(draft).request;
  draft.notes.transport = 'Tìm đường ít ồn';
  const updated = prepareRequest(draft).request;
  assert.equal(original.notes.transport, '');
  assert.equal(updated.notes.transport, 'Tìm đường ít ồn');
  assert.deepEqual(createPlan(original).slots, createPlan(updated).slots);
});

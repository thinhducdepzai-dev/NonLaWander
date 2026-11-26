import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarCosts, calendarOf, sessionTiming, wallMinute } from '../public/calendar.js';
import { calendarDemoReply } from '../public/calendar-ai.js';
import { planCalendarDraft, planningForm } from '../public/calendar-planning.js';
import { eventSessionById } from '../public/data.js';
import { eventDateFilters, hanoiToday, libraryEventRange, sessionsInRange } from '../public/library-events.js';
import { createTripStore, hasDraftChanges } from '../public/trips.js';

const first = 'hoa-nhac-20261218-1730';
const second = 'hoa-nhac-20261218-1930';
const free = 'ky-uc-pho-20261219-1600';
const unknown = 'dem-nghe-thuat-20261219-2330';
const at = (date, time) => wallMinute(date, time);
const add = (sessionId) => ({ type: 'add-session', sessionId });
const range = { start: at('2026-12-18', '16:00'), end: at('2026-12-20', '02:00') };

function fixture() {
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const store = createTripStore(storage);
  return { storage, store };
}

function trip(store, end = range.end) {
  const { id } = store.create();
  store.setCalendarRange(id, range.start, end);
  return store.setCalendarMode(id, 'manual');
}

test('Hanoi day filters include cross-midnight sessions and exclude exact non-overlapping bounds', () => {
  assert.equal(hanoiToday(new Date('2026-12-18T16:59:59Z')), '2026-12-18');
  assert.equal(hanoiToday(new Date('2026-12-18T17:00:00Z')), '2026-12-19');
  const get = (date) => sessionsInRange(libraryEventRange(date, date)).map(({ id }) => id);
  assert.deepEqual(get('2026-12-18'), [first, second]);
  assert.deepEqual(get('2026-12-19'), [free, unknown]);
  assert.deepEqual(get('2026-12-20'), [unknown]);
  const midnight = sessionTiming(eventSessionById[unknown]);
  assert.deepEqual(sessionsInRange({ start: midnight.end, end: midnight.end + 60 }), []);
  assert.deepEqual(sessionsInRange({ start: midnight.start - 60, end: midnight.start }), []);
  assert.deepEqual(eventDateFilters({ ...range, end: at('2026-12-20', '00:00') }), { from: '2026-12-18', to: '2026-12-19' });
});

test('same-name sessions are distinct, repeated adds preserve the previous undo, and tickets snapshot independently', () => {
  const { store, storage } = fixture();
  const { id } = trip(store);
  const other = trip(store);
  store.setCalendarPreferences(id, { participants: 3 });
  const original = store.confirm(id).confirmed;
  const one = store.changeCalendar(id, add(first));
  const duplicate = store.changeCalendar(id, add(first));
  assert.match(duplicate.error, /đã có/);
  assert.equal(store.get(id).draft.calendarUndoId, one.undoId);
  const two = store.changeCalendar(id, add(second));
  assert.notEqual(one.event.id, two.event.id);
  assert.notEqual(one.event.id, first);
  assert.equal(one.event.title, two.event.title);
  assert.deepEqual([two.event.start, two.event.end], [at('2026-12-18', '19:30'), at('2026-12-18', '21:00')]);
  assert.deepEqual(store.undoCalendar(id, two.undoId).draft.calendar.events.map(({ sessionId }) => sessionId), [first]);
  store.changeCalendar(id, add(second));
  store.changeCalendar(id, add(free));
  store.changeCalendar(id, add(unknown));
  const reopened = createTripStore(storage).get(id);
  assert.deepEqual(reopened.draft.calendar.events.map(({ sessionId }) => sessionId), [first, second, free, unknown]);
  assert.deepEqual(reopened.confirmed, original);
  assert.deepEqual(store.get(other.id), other);
  assert.deepEqual(calendarCosts(reopened.draft.calendar.events), { total: 300_000, missingCostCount: 1 });
  const locked = store.confirm(id).confirmed;
  assert.equal(locked.participants, 3);
  assert.equal(locked.prices['session:' + first], 120_000);
  assert.equal(locked.prices['session:' + second], 180_000);
  assert.equal(locked.prices['session:' + free], 0);
  assert.equal(locked.prices['session:' + unknown], null);
  assert.equal(hasDraftChanges(createTripStore(storage).get(id)), false);
});

test('fixed sessions check trip bounds, overlaps, budget, walking, and reject time changes', () => {
  const { store } = fixture();
  const short = trip(store, at('2026-12-18', '20:00'));
  const tooLate = store.changeCalendar(short.id, add(second));
  assert.match(tooLate.issues[0].message, /21:00.*20:00/);
  assert.deepEqual(store.get(short.id), short);
  const { id } = trip(store);
  const visit = store.changeCalendar(id, { type: 'create', event: {
    title: 'Cuộc hẹn', category: 'other', start: at('2026-12-18', '20:15'), end: at('2026-12-18', '20:45'),
  } }).event;
  const before = store.get(id);
  assert.equal(store.changeCalendar(id, add(second)).issues[0].code, 'overlap');
  assert.deepEqual(store.get(id), before);
  store.changeCalendar(id, { type: 'remove', id: visit.id });
  store.setCalendarPreferences(id, { budget: 150_000 });
  assert.equal(store.changeCalendar(id, add(second)).issues[0].code, 'budget');
  const nearby = store.changeCalendar(id, { type: 'create', event: {
    title: 'Cà phê Đinh', placeId: 'dinh-cafe', category: 'cafe', start: at('2026-12-18', '16:35'), end: at('2026-12-18', '17:30'),
  } }).event;
  store.setCalendarPreferences(id, { budget: null });
  assert.equal(store.changeCalendar(id, add(first)).issues[0].code, 'walk');
  store.changeCalendar(id, { type: 'remove', id: nearby.id });
  const { event } = store.changeCalendar(id, add(first));
  const saved = store.get(id);
  for (const command of [
    { type: 'move', id: event.id, start: event.start + 30 },
    { type: 'resize', id: event.id, end: event.end + 30 },
    { type: 'edit', id: event.id, event: { end: event.end + 30 } },
    { type: 'duplicate', id: event.id, start: event.start + 120 },
    { type: 'attach', id: event.id, placeId: 'ma-may' },
  ]) assert.match(store.changeCalendar(id, command).error, /cố định/);
  assert.deepEqual(store.get(id), saved);
});

test('event chat consults without a write, asks for the time when ambiguous, and commits a clear command', () => {
  const { store, storage } = fixture();
  const { id } = trip(store);
  const version = store.confirm(id).confirmed;
  const before = store.get(id);
  const calendar = calendarOf(before.draft);
  const question = calendarDemoReply('Trong chuyến này có sự kiện nào?', calendar);
  assert.deepEqual(question.sessions, [first, second, free, unknown]);
  assert.equal(question.command, undefined);
  assert.equal(calendarDemoReply('Trong chuyến này có buổi diễn nào?', calendar).command, undefined);
  store.saveConversation(id, { messages: [{ author: 'demo', text: question.reply, sessions: question.sessions }] });
  assert.deepEqual(createTripStore(storage).get(id).draft, before.draft);
  const vague = calendarDemoReply('Thêm buổi diễn đó', calendar);
  assert.match(vague.reply, /mấy giờ/);
  assert.equal(vague.command, undefined);
  assert.deepEqual(calendarDemoReply('Thêm Hòa nhạc cuối tuần lúc 19h30', calendar).command, add(second));
  const selected = calendarDemoReply('Thêm Hòa nhạc cuối tuần lúc 19:30', calendar);
  assert.deepEqual(selected.command, add(second));
  assert.equal(selected.direct, true);
  const added = store.changeCalendar(id, selected.command);
  assert.equal(added.event.sessionId, second);
  assert.deepEqual(store.undoCalendar(id, added.undoId).confirmed, version);
});

test('guided planning prefers a ward, and explains when matching sessions do not fit', () => {
  const { store } = fixture();
  const { id } = trip(store);
  const state = store.setTripWards(id, ['00070']);
  const answers = planningForm(state).answers;
  answers.idea = { ids: ['event-session'], custom: '' };
  const plan = planCalendarDraft(calendarOf(state.draft), answers);
  assert.equal(plan.calendar.events[0].sessionId, free);
  const short = trip(store, at('2026-12-18', '18:00'));
  const skipped = planCalendarDraft(calendarOf(short.draft), answers);
  assert.equal(skipped.calendar.events.length, 0);
  assert.match(skipped.notes.join(' '), /ngoài thời gian chuyến/);
  const absent = planCalendarDraft({ ...range, start: at('2026-12-21', '09:00'), end: at('2026-12-21', '19:00'), events: [] }, answers);
  assert.match(absent.notes.join(' '), /Chưa có suất demo/);
});

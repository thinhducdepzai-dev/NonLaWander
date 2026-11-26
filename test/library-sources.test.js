import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarCosts, sessionTimeLabel, wallMinute } from '../public/calendar.js';
import { calendarDemoReply } from '../public/calendar-ai.js';
import { planCalendarDraft, planningForm } from '../public/calendar-planning.js';
import { eventSessionById, libraryPlaces, placeById } from '../public/data.js';
import { libraryEventRange, sessionKind, sessionsInRange, sessionTicketLabel } from '../public/library-events.js';
import { applyLibraryUpdates, sourcedPlaces, sourcedSessions } from '../public/library-sources.js';
import { createTripStore, hasDraftChanges } from '../public/trips.js';
import { wardLibrary } from '../public/wards.js';

const placeId = 'nha-hat-lon';
const sessionId = 'luy-da-bat-tu-20250727-2000';
const day = '2025-07-27';

function fixture(date = day) {
  const records = new Map();
  const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const store = createTripStore(storage);
  const { id } = store.create({ savedPlaceId: placeId });
  store.setCalendarRange(id, wallMinute(date, '16:00'), wallMinute(date, '22:00'));
  store.setCalendarMode(id, 'manual');
  return { store, storage, id };
}

test('reapplying the source updates the same ID, while a separate branch has its own ID', () => {
  const original = [{ id: placeId, name: 'Nhà hát Lớn Hà Nội', duration: 35 }];
  const once = applyLibraryUpdates(original, sourcedPlaces);
  assert.deepEqual(applyLibraryUpdates(once, sourcedPlaces), once);
  assert.equal(once[0].id, original[0].id);
  assert.equal(once[0].duration, 35);
  assert.deepEqual(applyLibraryUpdates(applyLibraryUpdates([], sourcedSessions), sourcedSessions), [eventSessionById[sessionId]]);
  const branches = applyLibraryUpdates(once, { 'test-other-branch': { name: once[0].name, address: 'Địa chỉ khác (fixture)' } });
  assert.deepEqual(branches.map(({ id }) => id), [placeId, 'test-other-branch']);
  assert.equal(libraryPlaces.filter(({ id }) => id === placeId).length, 1);
  assert.match(placeById[placeId].address, /Số 1 Tràng Tiền.*Cửa Nam/);
  assert.equal(placeById[placeId].cost, undefined);
  assert.equal(placeById[placeId].hours, undefined);
  assert.equal(wardLibrary('00082').places[0].id, placeId);
  const { store, id } = fixture();
  const chat = calendarDemoReply('Gợi ý chụp ảnh', store.get(id).draft.calendar, undefined, { wardIds: ['00082'] });
  assert.equal(chat.choices[0], placeId);
});

test('a published start-only session appears on its Hanoi date and cannot change the draft', () => {
  const { store, storage, id } = fixture();
  const draft = store.get(id).draft;
  const session = eventSessionById[sessionId];
  assert.equal(session.placeId, placeId);
  assert.equal(sessionKind(session), 'Lịch công bố');
  assert.equal(sessionTicketLabel(session), 'Chưa biết giá vé');
  assert.match(sessionTimeLabel(session, true), /27\/07\/2025.*20:00.*Chưa có giờ kết thúc/);
  assert.deepEqual(sessionsInRange(libraryEventRange(day, day)), [session]);
  assert.deepEqual(sessionsInRange(libraryEventRange('2025-07-28', '2025-07-28')), []);
  const start = wallMinute(day, '20:00');
  assert.deepEqual(sessionsInRange({ start: start - 1, end: start }), []);
  assert.deepEqual(sessionsInRange({ start, end: start + 1 }), [session]);
  const chat = calendarDemoReply('Thêm Lũy đá bất tử lúc 20:00 ngày 27/07/2025', draft.calendar);
  assert.deepEqual(chat.command, { type: 'add-session', sessionId });
  assert.match(store.changeCalendar(id, chat.command).error, /Chưa có giờ kết thúc/);
  const answers = planningForm(store.get(id)).answers;
  answers.idea = { ids: ['event-session'], custom: '' };
  const plan = planCalendarDraft(draft.calendar, answers);
  assert.match(plan.notes.join(' '), /Chưa có giờ kết thúc/);
  assert.deepEqual(plan.calendar, draft.calendar);
  assert.deepEqual(createTripStore(storage).get(id).draft, draft);
});

test('a Library cost update leaves a saved place, visit ID and confirmed cost intact', (t) => {
  const { store, storage, id } = fixture();
  const place = placeById[placeId];
  t.after(() => { delete place.cost; });
  const { event } = store.changeCalendar(id, { type: 'create', event: {
    title: place.name, placeId, category: 'sight', start: wallMinute(day, '17:00'), end: wallMinute(day, '17:35'),
  } });
  assert.deepEqual(calendarCosts([event]), { total: 0, missingCostCount: 1 });
  place.cost = 40_000;
  assert.equal(store.confirm(id).confirmed.prices[placeId], 40_000);
  place.cost = 60_000;
  const reopened = createTripStore(storage).get(id);
  assert.deepEqual(reopened.savedPlaceIds, [placeId]);
  assert.deepEqual(reopened.draft.calendar.events, [event]);
  assert.deepEqual(reopened.confirmed.calendar.events, [event]);
  assert.equal(calendarCosts(reopened.draft.calendar.events).total, 60_000);
  assert.equal(calendarCosts(reopened.confirmed.calendar.events, reopened.confirmed.prices).total, 40_000);
  assert.equal(hasDraftChanges(reopened), true);
});

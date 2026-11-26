import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calendarCommand, calendarCosts, calendarLegs, calendarOf, dayCount, openingNote, travelEstimate, wallMinute } from '../public/calendar.js';
import { calendarDemoReply, parseCalendarMessage } from '../public/calendar-ai.js';
import { planCalendarDraft, planningForm } from '../public/calendar-planning.js';
import { placeWard, wardLibrary, wards } from '../public/wards.js';
import { exampleDraft, placeById } from '../public/data.js';
import { createPlan, inspectPlan, prepareRequest, walkMinutes } from '../public/planner.js';
import { createTripStore, hasDraftChanges, tripStoragePrefix } from '../public/trips.js';

const friday = '2026-11-27';
const saturday = '2026-11-28';
const sunday = '2026-11-29';
const at = (time, day = saturday) => wallMinute(day, time);
const start = at('16:00', friday);
const end = at('12:00', sunday);
const lunch = { title: 'Ăn trưa', category: 'food', start: at('12:00'), end: at('13:00') };
const blank = { start, end, mode: 'manual', events: [] };

function browserStorage() {
  const entries = new Map();
  return {
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, value); },
  };
}

function configuredTrip(store) {
  const trip = store.create();
  store.setCalendarRange(trip.id, start, end);
  return store.setCalendarMode(trip.id, 'manual');
}

test('a saved place survives without dates and both onboarding steps resume after reload', () => {
  const storage = browserStorage();
  let store = createTripStore(storage);
  const { id } = store.create({ savedPlaceId: 'dinh-cafe' });
  const setup = { startDate: friday, startTime: '16:00', endDate: sunday, endTime: '12:00', editingRange: true };
  store.setCalendarSetup(id, setup);
  store = createTripStore(storage);
  assert.deepEqual(store.get(id).calendarSetup, setup);
  assert.equal(calendarOf(store.get(id).draft), null);
  assert.equal(store.setCalendarRange(id, start, start), null);
  assert.equal(store.setCalendarRange(id, start, end).draft.calendar.mode, null);
  store = createTripStore(storage);
  assert.equal(store.get(id).calendarSetup.editingRange, false);
  assert.equal(dayCount(calendarOf(store.get(id).draft)), 3);
  assert.equal(dayCount({ start, end: at('18:00', friday) }), 1);
  assert.equal(dayCount({ start, end: at('12:00', '2026-12-06') }), 10);
  assert.deepEqual(store.get(id).savedPlaceIds, ['dinh-cafe']);
  assert.deepEqual(store.setCalendarMode(id, 'ai').draft.calendar.events, []);
  assert.equal(store.get(id).activeCalendarTool, 'planning');
});

test('create, move and attach keep one event ID and duration, while duplicate creates a new ID', () => {
  const storage = browserStorage();
  const store = createTripStore(storage);
  const { id } = configuredTrip(store);
  const { event } = store.changeCalendar(id, { type: 'create', event: lunch });
  const move = store.changeCalendar(id, { type: 'move', id: event.id, start: at('12:30') });
  assert.equal(move.event.end, at('13:30'));
  const command = { type: 'attach', id: event.id, placeId: 'dinh-cafe' };
  const preview = store.changeCalendar(id, command, { preview: true });
  assert.deepEqual(preview.costs, { total: 55_000, missingCostCount: 0 });
  assert.equal(store.get(id).draft.calendar.events[0].placeId, undefined);
  const attached = store.changeCalendar(id, command, { expected: preview.fingerprint });
  assert.deepEqual(attached.calendar.events, [{ ...move.event, placeId: 'dinh-cafe' }]);
  const reloaded = createTripStore(storage).get(id);
  assert.deepEqual(reloaded.draft.calendar, attached.calendar);
  const duplicate = store.changeCalendar(id, { type: 'duplicate', id: event.id, start: at('15:00') });
  assert.equal(duplicate.calendar.events.length, 2);
  assert.notEqual(duplicate.event.id, event.id);
  assert.equal(calendarCosts(duplicate.calendar.events).total, 110_000);
  assert.deepEqual(store.undoCalendar(id).draft.calendar, attached.calendar);
});

test('out-of-range, overlapping, costly, and too-short commands leave storage untouched', () => {
  const storage = browserStorage();
  const store = createTripStore(storage);
  const { id } = configuredTrip(store);
  const { event } = store.changeCalendar(id, { type: 'create', event: lunch });
  store.setCalendarPreferences(id, { budget: 40_000 });
  const key = tripStoragePrefix + id;
  const original = storage.getItem(key);
  const attempts = [
    [{ type: 'move', id: event.id, start: at('15:00', friday) }, ['range']],
    [{ type: 'create', event: { ...lunch, title: 'Trùng giờ' } }, ['overlap']],
    [{ type: 'attach', id: event.id, placeId: 'cho-dem' }, ['duration', 'budget']],
    [{ type: 'attach', id: event.id, placeId: 'dinh-cafe' }, ['budget']],
  ];
  for (const [command, expected] of attempts) {
    const result = store.changeCalendar(id, command);
    assert.deepEqual(result.issues.map(({ code }) => code), expected);
    assert.equal(result.trip, undefined);
    assert.equal(storage.getItem(key), original);
  }
  store.setCalendarPreferences(id, { budget: 100_000 });
  const extend = store.changeCalendar(id, { type: 'edit', id: event.id, event: { end: at('13:10'), placeId: 'cho-dem' } });
  assert.equal(extend.event.id, event.id);
  assert.match(openingNote(extend.event), /tham khảo/);
  assert.equal(extend.issues.length, 0);
});

test('explicit travel accounts for a gap once and unknown endpoints produce no walking estimate', () => {
  const coffee = { ...lunch, id: 'visit-coffee', placeId: 'dinh-cafe' };
  const temple = { ...lunch, id: 'visit-temple', placeId: 'ngoc-son', title: 'Đền', start: at('13:15'), end: at('14:05') };
  const travel = { id: 'trip-to-temple', title: 'Sang Đền Ngọc Sơn', category: 'travel', start: at('13:00'), end: at('13:15'), from: 'Cà phê Đinh', to: 'ngoc-son' };
  const initial = { ...blank, events: [coffee, temple] };
  const result = calendarCommand(initial, { type: 'create', event: travel });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(calendarLegs(result.calendar.events).map(({ explicit }) => explicit.id), [travel.id]);
  assert.equal(travelEstimate(travel), walkMinutes(placeById['dinh-cafe'], placeById['ngoc-son']));
  const unknown = { ...travel, to: '' };
  assert.equal(travelEstimate(unknown), null);
  assert.equal(calendarLegs([coffee, temple, unknown])[0].unknown.id, unknown.id);
});

test('legacy stop arrival times survive conversion and confirmed data and other trips stay independent', () => {
  const storage = browserStorage();
  const store = createTripStore(storage);
  const { id } = store.create();
  const form = exampleDraft();
  const plan = createPlan(prepareRequest(form).request);
  const slot = inspectPlan(plan).slots[0];
  const old = slot.stops[0];
  store.saveDraft(id, { form, plan, appliedDraft: null, undo: null });
  const confirmed = store.confirm(id).confirmed;
  const saved = calendarOf(confirmed).events.find(({ id: eventId }) => eventId === old.id);
  assert.equal(saved.start, at('00:00', slot.date) + old.arrival);
  const untouched = configuredTrip(store);
  const result = store.changeCalendar(id, { type: 'edit', id: saved.id, event: { title: 'Điểm mở đầu' } });
  assert.ok(result.trip);
  const reloaded = createTripStore(storage);
  assert.equal(reloaded.get(id).draft.plan, null);
  assert.equal(reloaded.get(id).draft.calendar.events.find(({ id: eventId }) => eventId === saved.id).title, 'Điểm mở đầu');
  assert.deepEqual(reloaded.get(id).confirmed, confirmed);
  assert.deepEqual(reloaded.get(untouched.id), untouched);
});

test('fixed anchors reject a move and input-only group changes preserve the confirmed snapshot', () => {
  const store = createTripStore(browserStorage());
  const { id } = configuredTrip(store);
  const { event } = store.changeCalendar(id, { type: 'create', event: { ...lunch, fixed: true, placeId: 'ho-guom' } });
  assert.match(store.changeCalendar(id, { type: 'move', id: event.id, start: at('13:00') }).error, /cố định/);
  const { confirmed } = store.confirm(id);
  const trip = store.setCalendarPreferences(id, { participants: 3, budget: null });
  assert.deepEqual(trip.draft.calendar, confirmed.calendar);
  assert.equal(confirmed.participants, 1);
  assert.ok(hasDraftChanges(trip));
  assert.equal(store.confirm(id).confirmed.participants, 3);
  assert.deepEqual(calendarCosts([event], { 'ho-guom': 0 }), { total: 0, missingCostCount: 0 });
  assert.deepEqual(calendarCosts([event], { 'ho-guom': null }), { total: 0, missingCostCount: 1 });
});

test('demo parses the original free text, asks about ambiguous edits, and offers an unassigned bún chả slot', () => {
  const message = 'Bọn mình 3 người, chiều thứ Bảy muốn ăn bún chả rồi đi cà phê, khoảng 250 nghìn mỗi người';
  assert.deepEqual(parseCalendarMessage(message), { participants: 3, budget: 250_000, period: 'chieu', weekday: 'thu bay' });
  const proposal = calendarDemoReply(message, blank);
  assert.equal(proposal.command.event.start, at('14:00'));
  assert.equal(proposal.command.event.placeId, undefined);
  assert.equal(calendarDemoReply('Muốn ăn bún chả thứ Bảy', blank).command.event.start, at('09:00'));
  assert.equal(proposal.direct, undefined);
  assert.deepEqual(calendarDemoReply('Gợi ý từ các câu trả lời', blank, undefined, { idea: 'phở' }).choices, ['pho-gia-truyen']);
  const target = { ...lunch, id: 'first' };
  const calendar = { ...blank, events: [target] };
  assert.equal(calendarDemoReply('Có quán nào hợp?', calendar, target.id).command, undefined);
  assert.equal(calendarDemoReply('Thử đổi quán này thì sao?', calendar, target.id).command.type, 'attach');
  assert.equal(calendarDemoReply('Đổi sang 13:30', calendar, target.id).command.start, at('13:30'));
  assert.equal(calendarDemoReply('Đổi cả buổi', calendar, target.id).command, undefined);
  assert.match(calendarDemoReply('Xóa Ăn trưa', { ...calendar, events: [target, { ...target, id: 'second' }] }).reply, /nhiều sự kiện/);
});

test('preview checks latest related events and ignores trip names and unrelated calendar changes', () => {
  const store = createTripStore(browserStorage());
  const { id } = configuredTrip(store);
  const command = { type: 'create', event: lunch };
  const expected = store.changeCalendar(id, command, { preview: true }).fingerprint;
  store.rename(id, 'Tên mới');
  store.changeCalendar(id, { type: 'create', event: { ...lunch, title: 'Tối thứ Sáu', start: at('18:00', friday), end: at('19:00', friday) } });
  assert.equal(store.changeCalendar(id, command, { preview: true }).fingerprint, expected);
  const blocker = store.changeCalendar(id, { type: 'create', event: { ...lunch, title: 'Lịch phát sinh' } }).event;
  const stale = store.changeCalendar(id, command, { expected });
  assert.equal(stale.stale, true);
  assert.equal(stale.issues[0].code, 'overlap');
  assert.equal(store.changeCalendar(id, command, { preview: true }).fingerprint, stale.fingerprint);
  assert.equal(store.get(id).draft.calendar.events.length, 2);
  store.changeCalendar(id, { type: 'remove', id: blocker.id });
  assert.equal(store.changeCalendar(id, command, { expected }).trip.name, 'Tên mới');
});

test('chat availability questions with an add verb never write the draft', () => {
  const store = createTripStore(browserStorage());
  const trip = configuredTrip(store);
  const before = store.get(trip.id).draft;
  const calendar = calendarOf(before);
  const question = calendarDemoReply('Nếu thêm Cà phê Đinh vào lịch thứ Bảy lúc 15h thì có kịp không?', calendar);
  assert.equal(question.command, undefined);
  assert.equal(question.consultation.event.placeId, 'dinh-cafe');
  const checked = store.changeCalendar(trip.id, question.consultation, { preview: true });
  assert.equal(checked.issues.length, 0);
  assert.deepEqual(store.get(trip.id).draft, before);
  const vague = calendarDemoReply('Thêm quán đó đi', calendar);
  assert.equal(vague.command, undefined);
  assert.match(vague.reply, /địa điểm nào/);
  const command = calendarDemoReply('Thêm Cà phê Đinh vào lịch thứ Bảy lúc 15h', calendar);
  assert.equal(command.direct, true);
  const saved = store.changeCalendar(trip.id, command.command);
  assert.equal(saved.event.start, at('15:00'));
  assert.equal(store.undoCalendar(trip.id, saved.undoId).draft.calendar.events.length, 0);
});

test('edited planning answers and progress reload independently of the conversation and draft', () => {
  const storage = browserStorage();
  let store = createTripStore(storage);
  const { id, draft } = configuredTrip(store);
  store.savePlanning(id, { key: 'people', value: '2', step: 1 });
  store.savePlanning(id, { key: 'vibe', value: { ids: ['culture', 'slow'], custom: 'Yên tĩnh' }, step: 2 });
  store.savePlanning(id, { key: 'idea', value: { ids: ['pho'], custom: '' }, step: 1 });
  store.savePlanning(id, { key: 'vibe', value: { ids: ['slow', 'food'], custom: 'Gần hồ' } });
  store.saveConversation(id, { messages: [{ author: 'you', text: 'Ăn gì quanh Hồ Gươm?' }] });
  store = createTripStore(storage);
  const trip = store.get(id);
  assert.equal(trip.planning.step, 1);
  assert.deepEqual(trip.planning.answers.vibe, { ids: ['slow', 'food'], custom: 'Gần hồ' });
  assert.deepEqual(trip.planning.answers.idea, { ids: ['pho'], custom: '' });
  assert.equal(trip.conversation.messages.length, 1);
  assert.deepEqual(trip.draft, draft);
});

test('final planning applies once to the latest draft, attaches in place, and can be undone without changing the confirmed trip', () => {
  const storage = browserStorage();
  let store = createTripStore(storage);
  const { id } = configuredTrip(store);
  const initial = store.changeCalendar(id, { type: 'create', event: lunch }).event;
  const { confirmed } = store.confirm(id);
  store.savePlanning(id, { key: 'people', value: '3', step: 1 });
  store.savePlanning(id, { key: 'vibe', value: { ids: ['food'], custom: '' }, step: 2 });
  store.savePlanning(id, { key: 'idea', value: { ids: ['pho'], custom: '' }, step: 3 });
  store.savePlanning(id, { key: 'area', value: { ids: ['quarter'], custom: '' }, step: 4 });
  store.savePlanning(id, { key: 'budget', value: '120000', step: 5 });
  store.savePlanning(id, { key: 'transport', value: { ids: ['walk'], custom: '' }, step: 6 });
  const other = store.changeCalendar(id, { type: 'create', event: { ...lunch, title: 'Gọi về nhà', category: 'rest', start: at('14:00'), end: at('15:00') } }).event;
  const before = store.get(id);
  const { trip, receipt } = store.applyPlanning(id);
  assert.equal(receipt.added.length, 0);
  assert.equal(receipt.attached.length, 1);
  assert.equal(trip.draft.participants, 3);
  assert.deepEqual(trip.draft.calendar.events, [{ ...initial, placeId: 'pho-gia-truyen' }, other]);
  assert.deepEqual(trip.confirmed, confirmed);
  store = createTripStore(storage);
  assert.deepEqual(store.applyPlanning(id).receipt, receipt);
  assert.deepEqual(store.get(id), trip);
  const undone = store.undoCalendar(id, receipt.undoId);
  assert.deepEqual(undone.draft.calendar, before.draft.calendar);
  assert.equal(undone.draft.form.budget, before.draft.form.budget);
  assert.equal(undone.draft.participants, before.draft.participants);
  assert.deepEqual(undone.confirmed, confirmed);
});

test('chat distinguishes an action from a prohibition before writing the saved draft', async (t) => {
  const moved = { start: at('13:00'), end: at('14:00') };
  const cases = [
    { message: 'Đổi giờ Ăn trưa sang 13h, đừng xóa nhé', text: /Đổi giờ “Ăn trưa”/, action: 'move', moved },
    { message: 'Đổi giờ Ăn trưa sang 13h và đừng xóa nhé', text: /Đổi giờ “Ăn trưa”/, action: 'move', moved },
    { message: 'Đừng xóa Ăn trưa', text: /giữ nguyên lịch nháp/ },
    { message: 'Xóa sự kiện Ăn trưa', text: /Xóa “Ăn trưa”/, action: 'remove' },
    { message: 'Xóa Ăn trưa, đừng xóa Ăn trưa', text: /xác nhận lại/ },
    { message: 'Đổi giờ Ăn trưa sang 13h rồi xóa Ăn trưa', text: /xác nhận lại/ },
  ];
  for (const { message, text, action, moved: times } of cases) {
    await t.test(message, () => {
      const storage = browserStorage();
      const store = createTripStore(storage);
      const { id } = configuredTrip(store);
      const { event } = store.changeCalendar(id, { type: 'create', event: lunch });
      const other = store.changeCalendar(id, { type: 'create', event: {
        title: 'Điểm ngày khác', category: 'sight', start: at('09:00', sunday), end: at('10:00', sunday),
      } }).event;
      const before = store.get(id).draft;
      const response = calendarDemoReply(message, calendarOf(before));
      assert.match(response.reply ?? response.label, text);
      assert.equal(response.command?.type, action);
      if (action) {
        assert.equal(response.direct, true);
        assert.equal(response.command.id, event.id);
        const { trip, undoId } = store.changeCalendar(id, response.command);
        assert.ok(trip);
        assert.deepEqual(createTripStore(storage).get(id).draft.calendar.events, [
          ...(times ? [{ ...event, ...times }] : []), other,
        ]);
        assert.deepEqual(store.undoCalendar(id, undoId).draft.calendar.events, before.calendar.events);
      } else {
        assert.deepEqual(createTripStore(storage).get(id).draft, before);
      }
    });
  }
});

test('ward preferences persist by trip and preserve the calendar and confirmed snapshot', () => {
  const storage = browserStorage();
  const store = createTripStore(storage);
  const { id } = configuredTrip(store);
  const other = configuredTrip(store);
  store.changeCalendar(id, { type: 'create', event: lunch });
  const before = store.confirm(id);
  store.setTripWards(other.id, ['00004']);
  store.setTripWards(id, ['00070', '00082', '00070', 'lake']);
  assert.deepEqual(store.get(id).wardIds, ['00070', '00082']);
  store.setTripWards(id, ['00082']);
  const reopened = createTripStore(storage);
  assert.deepEqual(reopened.get(id).wardIds, ['00082']);
  assert.deepEqual(reopened.get(other.id).wardIds, ['00004']);
  assert.deepEqual(reopened.get(id).draft, before.draft);
  assert.deepEqual(reopened.get(id).confirmed, before.confirmed);
  assert.equal(hasDraftChanges(reopened.get(id)), false);
});

test('legacy tourism areas remain readable and selecting no ward clears their ranking priority', () => {
  const storage = browserStorage();
  const store = createTripStore(storage);
  const { id, draft } = configuredTrip(store);
  store.saveDraft(id, { ...draft, form: { ...draft.form, areas: ['lake'] } });
  const legacy = store.get(id);
  assert.deepEqual(legacy.draft.form.areas, ['lake']);
  assert.equal(legacy.wardIds, undefined);
  assert.deepEqual(planningForm(legacy).answers.area.ids, ['lake']);
  store.setTripWards(id, []);
  const updated = createTripStore(storage).get(id);
  assert.deepEqual(updated.draft.form.areas, ['lake']);
  assert.deepEqual(planningForm(updated).answers.area, { ids: [], custom: '', wardIds: [] });
});

test('the same request ranks different Library entries by ward in chat and scheduling', () => {
  const store = createTripStore(browserStorage());
  const first = configuredTrip(store);
  const second = configuredTrip(store);
  store.setTripWards(first.id, ['00070']);
  store.setTripWards(second.id, ['00082']);
  for (const [tripId, wardId] of [[first.id, '00070'], [second.id, '00082']]) {
    const trip = store.get(tripId);
    const calendar = calendarOf(trip.draft);
    const response = calendarDemoReply('Gợi ý chụp ảnh', calendar, undefined, { wardIds: trip.wardIds });
    assert.equal(placeWard(response.choices[0]).id, wardId);
    const answers = planningForm(trip).answers;
    answers.idea = { ids: ['chup-anh'], custom: '' };
    const draft = planCalendarDraft(calendar, answers);
    assert.equal(placeWard(draft.calendar.events[0].placeId).id, wardId);
  }
  const response = calendarDemoReply('Gợi ý chụp ảnh', blank, undefined, { wardIds: ['00004'] });
  assert.ok(response.choices.length > 0);
  assert.match(response.reply, /ngoài các phường ưu tiên/);
  const answers = planningForm(store.setTripWards(first.id, ['00004'])).answers;
  answers.idea = { ids: ['chup-anh'], custom: '' };
  const outside = planCalendarDraft(blank, answers);
  assert.ok(outside.added.length);
  assert.match(outside.notes.join(' '), /ngoài các phường ưu tiên/);
});

test('the three ward boundaries contain every assigned Library point', () => {
  const data = JSON.parse(readFileSync(new URL('../public/assets/hanoi-wards.geojson', import.meta.url), 'utf8'));
  assert.deepEqual(data.features.map(({ id }) => id), wards.map(({ id }) => id));
  for (const feature of data.features) {
    const [ring] = feature.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring.at(-1));
    for (const { id, lon, lat } of wardLibrary(feature.id).places) {
      let inside = false;
      for (let i = 1; i < ring.length; i++) {
        const [[x1, y1], [x2, y2]] = ring.slice(i - 1, i + 1);
        if ((y1 > lat) !== (y2 > lat) && lon < x1 + (x2 - x1) * (lat - y1) / (y2 - y1)) inside = !inside;
      }
      assert.ok(inside, id);
    }
  }
  assert.equal(placeWard('trang-tien'), undefined);
});

import { eventSessionById, placeById } from './data.js';
import { clock, dateIndex, inspectPlan, newVisitId, openingHours, placeCost, walkMinutes } from './planner.js';

export const dayMinutes = 1440;
export const eventCategories = {
  sight: 'Tham quan', food: 'Ăn uống', cafe: 'Cà phê', fun: 'Giải trí',
  travel: 'Di chuyển', rest: 'Nghỉ ngơi', other: 'Khác', session: 'Suất sự kiện',
};

export function wallMinute(date, time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  const [hours, mins] = time.split(':').map(Number);
  return dateIndex(date) * dayMinutes + hours * 60 + mins;
}

export const dayOf = (minute) => Math.floor(minute / dayMinutes);
export const dateOf = (minute) => new Date(dayOf(minute) * 86_400_000).toISOString().slice(0, 10);
export const timeOf = (minute) => clock((minute % dayMinutes + dayMinutes) % dayMinutes);
export const minuteInDay = (minute) => minute - dayOf(minute) * dayMinutes;
export const dayStart = (minute) => dayOf(minute) * dayMinutes;
export const dayCount = (calendar) => dayOf(calendar.end - 1) - dayOf(calendar.start) + 1;

const longDate = new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
export function calendarDate(minute, weekday = false) {
  if (weekday) return longDate.format(minute * 60_000);
  const [, month, date] = dateOf(minute).split('-');
  return `${date}/${month}`;
}
export const momentLabel = (minute) => `${calendarDate(minute, true)} · ${timeOf(minute)}`;
export const orderedEvents = (events) => events.toSorted((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));

export function sessionTiming(session) {
  return { start: wallMinute(session.date, session.starts), end: wallMinute(session.endDate ?? session.date, session.ends) };
}

export function sessionTimeLabel(session) {
  const { start, end } = sessionTiming(session);
  return `${momentLabel(start)}–${dayOf(start) === dayOf(end) ? timeOf(end) : momentLabel(end)}`;
}

export const calendarCostKey = (event) => event.sessionId ? `session:${event.sessionId}` : event.placeId;

export function calendarEventCost(event, prices) {
  if (!event.sessionId) return event.placeId ? placeCost(event.placeId, prices) : null;
  const key = calendarCostKey(event);
  return prices && Object.hasOwn(prices, key) ? prices[key] : eventSessionById[event.sessionId]?.price ?? null;
}

export function placeCategory(place) {
  return ({ coffee: 'cafe', food: 'food', landmark: 'sight', leaf: 'sight' })[place?.icon] ?? 'other';
}

export function calendarOf(version) {
  if (!version || version.calendar) return version?.calendar ?? null;
  const from = version.plan?.request ?? version.form;
  if (!from) return null;
  const start = wallMinute(from.startDate, '00:00');
  const last = wallMinute(from.endDate, '00:00');
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(last) || last < start) return null;
  const used = new Set();
  const events = version.plan ? inspectPlan(version.plan).slots.flatMap((slot) => {
    const base = wallMinute(slot.date, '00:00');
    return slot.stops.map((stop, index) => {
      const id = used.has(stop.id) ? `${stop.id}-${slot.id}-${index}` : stop.id;
      used.add(id);
      return { id, title: stop.place.name, category: placeCategory(stop.place), placeId: stop.placeId,
        start: base + stop.arrival, end: base + stop.departure, ...(stop.fixedStart === undefined ? {} : { fixed: true }) };
    });
  }) : [];
  return { start, end: Math.max(last + dayMinutes, ...events.map(({ end }) => end)), mode: 'manual', events: orderedEvents(events) };
}

const isMoment = (minute) => Number.isSafeInteger(minute) && Math.abs(minute) <= 144_000_000_000;
export const validCalendarRange = (start, end) => isMoment(start) && isMoment(end) && start < end;
const knownPlace = (id) => !id || (typeof id === 'string' && Object.hasOwn(placeById, id));

function validEvent(event) {
  return event && typeof event.id === 'string' && /^[a-z0-9-]+$/.test(event.id) &&
    typeof event.title === 'string' && !!event.title.trim() && event.title.length <= 120 &&
    Object.hasOwn(eventCategories, event.category) && validCalendarRange(event.start, event.end) &&
    knownPlace(event.placeId) && (event.category === 'session'
      ? typeof event.sessionId === 'string' && /^[a-z0-9-]+$/.test(event.sessionId) && event.fixed === true
      : event.sessionId === undefined) && ['location', 'from', 'to'].every((key) => event[key] === undefined ||
      (typeof event[key] === 'string' && event[key].length <= 120));
}

export function isCalendar(calendar) {
  if (!calendar || !validCalendarRange(calendar.start, calendar.end) || ![null, 'manual', 'ai'].includes(calendar.mode) ||
      !Array.isArray(calendar.events) || !calendar.events.every(validEvent)) return false;
  const ids = calendar.events.map(({ id }) => id);
  const sessions = calendar.events.flatMap(({ sessionId }) => sessionId ? [sessionId] : []);
  return new Set(ids).size === ids.length && new Set(sessions).size === sessions.length;
}

function endpoint(value) {
  const name = value?.trim().toLowerCase();
  return Object.values(placeById).find((place) => place.id === value || place.name.toLowerCase() === name);
}

export function travelEstimate(event) {
  const from = endpoint(event.from);
  const to = endpoint(event.to);
  return from && to ? walkMinutes(from, to) : null;
}

function issue(code, ids, message) {
  return { code, ids, message };
}

export function calendarLegs(events) {
  const sorted = orderedEvents(events);
  const places = sorted.filter((event) => event.placeId);
  const trips = sorted.filter(({ category }) => category === 'travel');
  return places.slice(1).flatMap((to, index) => {
    const from = places[index];
    if (dayOf(from.end) !== dayOf(to.start)) return [];
    const withinGap = trips.filter((travel) => travel.start >= from.end && travel.end <= to.start);
    const explicit = withinGap.find((travel) => endpoint(travel.from)?.id === from.placeId && endpoint(travel.to)?.id === to.placeId);
    const unknown = withinGap.find((travel) => travelEstimate(travel) === null);
    const minutes = walkMinutes(placeById[from.placeId], placeById[to.placeId]);
    return [{ from, to, minutes, explicit, unknown }];
  });
}

export function calendarCosts(events, prices) {
  let total = 0;
  let missingCostCount = 0;
  for (const event of events) {
    if (!calendarCostKey(event)) continue;
    const cost = calendarEventCost(event, prices);
    if (cost === null) missingCostCount++;
    else total += cost;
  }
  return { total, missingCostCount };
}

export function openingNote(event) {
  if (!event.placeId || event.sessionId) return '';
  const place = placeById[event.placeId];
  if (!place.hours?.length) return 'Chưa có giờ mở cửa.';
  const day = dayStart(event.start);
  const fits = openingHours(place, dateOf(event.start)).some(({ start, end }) =>
    wallMinute(dateOf(day), start) <= event.start && event.end <= wallMinute(dateOf(day), end));
  return fits ? '' : 'Ngoài giờ mở cửa tham khảo.';
}

function conflicts(calendar, budget) {
  const events = orderedEvents(calendar.events);
  const issues = [];
  for (const [index, event] of events.entries()) {
    if (event.start < calendar.start || event.end > calendar.end) {
      const bounds = event.sessionId ? ` Suất từ ${momentLabel(event.start)} đến ${momentLabel(event.end)}. Chuyến từ ${momentLabel(calendar.start)} đến ${momentLabel(calendar.end)}.` : '';
      issues.push(issue('range', [event.id], `“${event.title}” nằm ngoài thời gian chuyến.${bounds}`));
    }
    if (event.placeId && !event.sessionId && event.end - event.start < placeById[event.placeId].duration) {
      issues.push(issue('duration', [event.id], `${placeById[event.placeId].name} cần khoảng ${placeById[event.placeId].duration} phút, khung này có ${event.end - event.start} phút.`));
    }
    const estimate = event.category === 'travel' && travelEstimate(event);
    if (typeof estimate === 'number' && event.end - event.start < estimate) {
      issues.push(issue('travel', [event.id], `Chặng “${event.title}” cần khoảng ${estimate} phút đi bộ.`));
    }
    for (const next of events.slice(index + 1)) {
      if (next.start >= event.end) break;
      const [first, second] = [event.title, next.title].sort((a, b) => a.localeCompare(b, 'vi'));
      issues.push(issue('overlap', [event.id, next.id].sort(), `“${first}” trùng giờ với “${second}”.`));
    }
  }
  for (const { from, to, minutes, explicit, unknown } of calendarLegs(events)) {
    if (explicit || unknown) continue;
    const busy = events.filter((event) => event.id !== from.id && event.id !== to.id && event.start < to.start && event.end > from.end);
    const open = busy.reduce((gap, event) => gap - Math.max(0, Math.min(to.start, event.end) - Math.max(from.end, event.start)), to.start - from.end);
    if (open < minutes) issues.push(issue('walk', [from.id, to.id, ...busy.map(({ id }) => id)],
      `Cần khoảng ${minutes} phút đi bộ từ “${from.title}” đến “${to.title}”.`));
  }
  const { total } = calendarCosts(events);
  if (Number.isFinite(budget) && total > budget) {
    issues.push(issue('budget', [], `Chi phí đã biết ${total.toLocaleString('vi-VN')} ₫/người vượt ngân sách ${budget.toLocaleString('vi-VN')} ₫/người.`));
  }
  return issues;
}

export function calendarBudget(version) {
  const raw = version.form?.budget;
  const value = raw?.trim() ? Number(raw) : undefined;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function calendarCommand(calendar, command, budget) {
  const target = calendar.events.find((event) => event.id === command.id);
  if (!['create', 'add-session'].includes(command.type) && !target) return { error: 'Sự kiện này đã thay đổi hoặc đã bị xóa.' };
  if (target?.sessionId && command.type !== 'remove') {
    return { error: 'Suất sự kiện có giờ và địa điểm cố định. Bạn có thể xóa lượt này rồi chọn suất khác trong Library.' };
  }
  let next;
  switch (command.type) {
    case 'create':
      if (command.event?.category === 'session' || command.event?.sessionId) return { error: 'Chọn suất sự kiện trong Library.' };
      next = { ...command.event, id: command.event?.id ?? newVisitId() };
      break;
    case 'add-session': {
      const session = Object.hasOwn(eventSessionById, command.sessionId) && eventSessionById[command.sessionId];
      if (!session) return { error: 'Không tìm thấy suất sự kiện trong Library.' };
      if (calendar.events.some((event) => event.sessionId === session.id)) return { error: 'Suất này đã có trong lịch nháp.' };
      next = { ...sessionTiming(session), id: newVisitId(), sessionId: session.id,
        title: session.name, category: 'session', placeId: session.placeId, fixed: true };
      break;
    }
    case 'edit': next = { ...target, ...command.event, id: target.id }; break;
    case 'move': next = { ...target, start: command.start, end: command.start + target.end - target.start }; break;
    case 'resize': next = { ...target, end: command.end }; break;
    case 'attach': next = { ...target, placeId: command.placeId }; break;
    case 'duplicate': next = { ...target, id: command.newId ?? newVisitId(), start: command.start, end: command.start + target.end - target.start, fixed: false }; break;
    case 'remove': break;
    default: return { error: 'Thao tác này chưa được hỗ trợ.' };
  }
  if (next && (!validEvent(next) || (next.sessionId && command.type !== 'add-session'))) return { error: 'Nhập tên và chọn thời điểm kết thúc sau bắt đầu.' };
  if (target?.fixed && next?.id === target.id && next.start !== target.start) {
    return { error: 'Giờ bắt đầu của sự kiện cố định phải được giữ nguyên.' };
  }
  const events = calendar.events.filter((event) => event.id !== target?.id || command.type === 'duplicate');
  if (next && events.some((event) => event.id === next.id)) return { error: 'ID sự kiện đã được sử dụng.' };
  if (next) events.push(next);
  const candidate = { ...calendar, events: orderedEvents(events) };
  const before = conflicts(calendar, budget);
  const after = conflicts(candidate, budget);
  const issues = after.filter((entry) => entry.ids.includes(next?.id) || !before.some((old) =>
    old.code === entry.code && old.message === entry.message && JSON.stringify(old.ids) === JSON.stringify(entry.ids)));
  const start = next?.start ?? target.start;
  const end = next?.end ?? target.end;
  const beforeLegs = calendarLegs(calendar.events).filter(({ from, to, explicit, unknown }) => target &&
    (from.id === target.id || to.id === target.id || (explicit ?? unknown)?.id === target.id ||
      (from.end <= target.end && target.start <= to.start)));
  const afterLegs = calendarLegs(candidate.events).filter(({ from, to, explicit, unknown }) =>
    from.id === next?.id || to.id === next?.id || (explicit ?? unknown)?.id === next?.id ||
    (from.end <= end && start <= to.start) || (target && from.end <= target.end && target.start <= to.start));
  const connected = new Set([...beforeLegs, ...afterLegs].flatMap(({ from, to, explicit, unknown }) => [
    from.id, to.id, (explicit ?? unknown)?.id,
  ]));
  const relevant = calendar.events.filter((event) => connected.has(event.id) ||
    (event.start < end && event.end > start) || (target && event.start < target.end && event.end > target.start));
  const beforeCosts = calendarCosts(calendar.events);
  const costs = calendarCosts(candidate.events);
  const opening = next ? openingNote(next) : '';
  const generatedId = next?.id !== target?.id ? next?.id : null;
  const issuesForReview = issues.map(({ code, ids, message }) =>
    JSON.stringify([code, ids.map((id) => id === generatedId ? '' : id).sort(), message])).sort();
  const fingerprint = JSON.stringify([calendar.start, calendar.end, target, relevant, next && { ...next, id: target?.id },
    issuesForReview, opening, Number.isFinite(budget) ? budget : null]);
  return { calendar: candidate, event: next, issues, fingerprint, opening, costs, beforeCosts, beforeLegs, afterLegs };
}

export function availableStart(calendar, duration = 60, after = calendar.start) {
  let time = Math.max(after, calendar.start);
  for (const event of orderedEvents(calendar.events)) {
    if (event.end <= time) continue;
    if (event.start >= time + duration) break;
    time = event.end;
  }
  return Math.min(time, Math.max(calendar.start, calendar.end - duration));
}

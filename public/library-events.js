import { dateOf, dayMinutes, sessionTiming, wallMinute } from './calendar.js';
import { eventSessions } from './data.js';

const hanoiDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short' });
export const hanoiToday = (now = new Date()) => hanoiDate.format(now);

export function libraryEventRange(from, to) {
  const start = wallMinute(from, '00:00');
  const last = wallMinute(to, '00:00');
  return Number.isFinite(start) && Number.isFinite(last) && last >= start ? { start, end: last + dayMinutes } : null;
}

export function sessionsInRange({ start, end }) {
  return eventSessions.filter((session) => {
    const timing = sessionTiming(session);
    return timing.start < end && timing.end > start;
  }).toSorted((a, b) => sessionTiming(a).start - sessionTiming(b).start);
}

export function eventDateFilters(calendar, now = new Date()) {
  if (calendar) return { from: dateOf(calendar.start), to: dateOf(calendar.end - 1) };
  const from = hanoiToday(now);
  return { from, to: dateOf(wallMinute(from, '00:00') + 30 * dayMinutes) };
}

export function eventLibraryHref({ sessionId, tripId, from, to, add } = {}) {
  const search = new URLSearchParams();
  if (tripId) search.set('fromTrip', tripId);
  if (from) search.set('from', from);
  if (to) search.set('to', to);
  if (add) search.set('add', '1');
  return `#library/events${sessionId ? `/${sessionId}` : ''}${search.size ? `?${search}` : ''}`;
}

import { periods, places, placeById } from './data.js';

const dayInMs = 86_400_000;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dayFormat = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', timeZone: 'UTC' });

export function dateIndex(value) {
  if (!datePattern.test(value)) return NaN;
  const index = Date.parse(value) / dayInMs;
  return Number.isInteger(index) && dateAt(index) === value ? index : NaN;
}

export function dateAt(index) {
  return new Date(index * dayInMs).toISOString().slice(0, 10);
}

export function weekday(date) {
  const label = dayFormat.format(dateIndex(date) * dayInMs);
  return label[0].toUpperCase() + label.slice(1);
}

export function minutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function clock(value) {
  return [Math.floor(value / 60), value % 60].map((part) => String(part).padStart(2, '0')).join(':');
}

function prepareSlots(draft) {
  const errors = {};
  const first = dateIndex(draft.startDate);
  const last = dateIndex(draft.endDate);
  if (!Number.isInteger(first)) errors.arrival = 'Chọn ngày đến Hà Nội.';
  if (!Number.isInteger(last)) errors.departure = 'Chọn ngày rời Hà Nội.';
  else if (last < first) errors.departure = 'Ngày rời phải cùng ngày hoặc sau ngày đến.';

  const slots = [];
  if (!errors.arrival && !errors.departure) {
    for (const [date, day] of Object.entries(draft.days).sort(([a], [b]) => a.localeCompare(b))) {
      const index = dateIndex(date);
      if (!(first <= index && index <= last)) continue;

      let previous;
      for (const period of periods) {
        const window = day[period.id];
        if (!window?.enabled) continue;

        const id = `${date}-${period.id}`;
        const start = minutes(window.start);
        const end = minutes(window.end);
        if (!timePattern.test(window.start)) errors[`start-${id}`] = 'Nhập giờ bắt đầu.';
        if (!timePattern.test(window.end) || end <= start) {
          errors[`end-${id}`] = 'Chọn giờ kết thúc sau giờ bắt đầu.';
        }
        if (!errors[`start-${id}`] && !errors[`end-${id}`]) {
          if (previous && start < previous.end) {
            errors[`start-${id}`] = `Chọn giờ sau buổi ${previous.label.toLowerCase()}.`;
          }
          if (!previous || end > previous.end) previous = { end, label: period.label };
        }
        slots.push({ id, date, period: period.id, start, end });
      }
    }
    if (!slots.length) errors.sessions = 'Chọn ít nhất một buổi để xếp lịch.';
  }
  return { slots, errors };
}

export function prepareRequest(draft) {
  const { slots, errors } = prepareSlots(draft);
  const budget = Number(draft.budget);
  if (String(draft.budget).trim() === '' || !Number.isSafeInteger(budget) || budget < 0) {
    errors.budget = 'Nhập tổng ngân sách từ 0 ₫ cho mỗi người.';
  }
  if (draft.transport !== 'walk') {
    errors.transport = 'Bản demo xếp lịch theo đường đi bộ. Chọn Đi bộ để tiếp tục.';
  }

  if (Object.keys(errors).length) return { errors };
  const { startDate, endDate, vibes, areas, mustVisit, transport, notes } = draft;
  return {
    request: { startDate, endDate, slots, vibes: [...vibes], areas: [...areas], mustVisit: [...mustVisit], budget, transport, notes: { ...notes } },
  };
}

export function openingHours(place, date) {
  const day = new Date(dateIndex(date) * dayInMs).getUTCDay();
  return (place.hours ?? []).filter((window) => !window.days || window.days.includes(day));
}

export function walkMinutes(from, to) {
  if (![from.lat, from.lon, to.lat, to.lon].every(Number.isFinite)) return null;
  if (from.id && from.id === to.id) return 0;
  const rad = Math.PI / 180;
  const x = (from.lon - to.lon) * rad * Math.cos((from.lat + to.lat) * rad / 2);
  const y = (from.lat - to.lat) * rad;
  const meters = Math.hypot(x, y) * 6_371_000;
  return Math.max(2, Math.ceil(meters * 1.25 / 75));
}

function schedule(slot) {
  let ready = slot.start;
  let idle = 0;
  const stops = slot.stops.map((stop, index) => {
    const place = placeById[stop.placeId];
    const hours = openingHours(place, slot.date);
    const next = slot.stops[index + 1];
    const walkToNext = next ? walkMinutes(place, placeById[next.placeId]) : null;
    const nextOpening = hours.find((window) =>
      Math.max(ready, minutes(window.start)) + place.duration <= minutes(window.end));
    const openingArrival = nextOpening ? Math.max(ready, minutes(nextOpening.start)) : ready;
    const suggestedArrival = openingArrival + place.duration <= slot.end ? openingArrival : ready;
    const arrival = stop.fixedStart ?? (stop.manual ? ready : suggestedArrival);
    const departure = arrival + place.duration;
    const issues = [];
    if (arrival < ready) issues.push({ code: 'fixed', start: arrival, ready });
    if (departure > slot.end) issues.push({ code: 'window', end: slot.end });
    if (place.hours?.length && !hours.some((window) => arrival >= minutes(window.start) && departure <= minutes(window.end))) {
      issues.push({ code: 'opening' });
    }

    const wait = Math.max(0, arrival - ready);
    idle += wait;
    ready = Math.max(ready, departure) + (walkToNext ?? 0);
    return { ...stop, place, arrival, departure, walkToNext, wait, issues };
  });

  const freeMinutes = idle + Math.max(0, slot.end - ready);
  return { ...slot, stops, freeMinutes, idleMinutes: idle };
}

const visit = (place) => ({ id: `visit-${place.id}`, placeId: place.id });

function tryInsert(slot, place, index = slot.stops.length) {
  const stops = slot.stops.toSpliced(index, 0, visit(place));
  const result = schedule({ ...slot, stops });
  if (result.stops.some((stop) => stop.issues.length > 0)) return null;
  return { stops, freeMinutes: result.freeMinutes, idleMinutes: result.idleMinutes };
}

function preference(place, slot, request) {
  const previous = placeById[slot.stops.at(-1)?.placeId];
  const vibeBonus = place.vibes.filter((vibe) => request.vibes.includes(vibe)).length * 14;
  const areaBonus = request.areas.includes(place.area) ? 7 : 0;
  const walking = previous ? walkMinutes(previous, place) : 0;
  const repeated = slot.stops.some((stop) => placeById[stop.placeId].icon === place.icon);
  return vibeBonus + areaBonus - walking * 0.8 - (repeated ? 12 : 0);
}

export function createPlan(request) {
  const plan = emptyPlan(request);
  const { slots } = plan;

  let balance = request.budget;
  const used = new Set();
  const chosen = request.mustVisit.map((id) => placeById[id]).filter(Boolean);
  const priority = chosen.map((place) => ({
    place,
    choices: slots.filter((slot) => tryInsert(slot, place)).length,
  })).sort((a, b) => a.choices - b.choices);

  for (const { place } of priority) {
    if (!hasKnownCost(place) || place.cost > balance || used.has(place.id)) continue;
    let best;
    for (const slot of slots) {
      for (let index = 0; index <= slot.stops.length; index++) {
        const candidate = tryInsert(slot, place, index);
        if (!candidate) continue;
        if (!best || slot.stops.length < best.slot.stops.length ||
            (slot.stops.length === best.slot.stops.length && candidate.freeMinutes < best.freeMinutes)) {
          best = { ...candidate, slot };
        }
      }
    }
    if (!best) continue;
    best.slot.stops = best.stops;
    used.add(place.id);
    balance -= place.cost;
  }

  // Ưu tiên mỗi buổi có một điểm trước khi thêm các điểm tiếp theo.
  for (let target = 1; target <= places.length && used.size < places.length; target++) {
    const openSlots = slots.filter((slot) => slot.stops.length < target);
    openSlots.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    for (const slot of openSlots) {
      const candidates = places
        .filter((place) => hasKnownCost(place) && place.cost <= balance && !used.has(place.id))
        .flatMap((place) => {
          const candidate = tryInsert(slot, place);
          if (!candidate) return [];
          const score = preference(place, slot, request) - candidate.idleMinutes * 0.45;
          return [{ place, candidate, score }];
        })
        .sort((a, b) => b.score - a.score || a.candidate.freeMinutes - b.candidate.freeMinutes || a.place.cost - b.place.cost);
      const best = candidates[0];
      if (!best) continue;

      slot.stops = best.candidate.stops;
      balance -= best.place.cost;
      used.add(best.place.id);
    }
  }

  return plan;
}

function emptyPlan(request) {
  return { version: 1, request, slots: request.slots.map((slot) => ({ ...slot, stops: [] })) };
}

export function hasKnownCost(place) {
  return Number.isFinite(place.cost) && place.cost >= 0;
}

export function placeCost(placeId, prices) {
  if (prices && Object.hasOwn(prices, placeId)) return prices[placeId];
  const place = placeById[placeId];
  return hasKnownCost(place) ? place.cost : null;
}

export function draftBudget(plan, form) {
  const current = Number(form.budget);
  return form.budget.trim() !== '' && Number.isSafeInteger(current) && current >= 0 ? current : plan.request.budget;
}

function planCosts(slots, budget, prices) {
  let total = 0;
  let missingCostCount = 0;
  for (const slot of slots) {
    for (const { placeId } of slot.stops) {
      const cost = placeCost(placeId, prices);
      if (cost !== null) total += cost;
      else missingCostCount++;
    }
  }
  return { total, missingCostCount, overBudget: Math.max(0, total - budget) };
}

function slotOverlap(first, second) {
  return first.date === second.date && first.start < second.end && second.start < first.end;
}

function sortedSlots(slots) {
  return slots.toSorted((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

function requestWithSlots(request, slots) {
  const startDate = slots[0].date < request.startDate ? slots[0].date : request.startDate;
  const lastDate = slots.at(-1).date;
  return {
    ...request, startDate,
    endDate: lastDate > request.endDate ? lastDate : request.endDate,
    slots: slots.map(({ id, date, period, start, end }) => ({ id, date, period, start, end })),
  };
}

function blockingIssues(slot) {
  return schedule(slot).stops.flatMap((stop) => stop.issues.filter(({ code }) => code !== 'opening').map((issue) => ({
    ...issue, slot, stopId: stop.id, placeName: stop.place.name, departure: stop.departure,
  })));
}

export function moveDestinations(plan, form) {
  const { slots, errors } = prepareSlots(form);
  const existing = new Map(plan.slots.map((slot) => [slot.id, slot]));
  const available = slots.filter(({ id }) => !errors[`start-${id}`] && !errors[`end-${id}`]);
  return sortedSlots(available.map((slot) => existing.get(slot.id) ?? { ...slot, stops: [] }));
}

function worsenedIssue(issue, previous) {
  const old = previous.find((item) => item.slot.id === issue.slot.id && item.stopId === issue.stopId && item.code === issue.code);
  if (!old) return true;
  return issue.code === 'fixed' ? issue.ready > old.ready : issue.departure > old.departure;
}

export function moveVisit(plan, command, form) {
  const { slotId, stopId, toSlotId = slotId, beforeStopId, toIndex } = command;
  const source = plan.slots.find((slot) => slot.id === slotId);
  const sourceIndex = source?.stops.findIndex((stop) => stop.id === stopId) ?? -1;
  if (sourceIndex < 0) return { error: 'source' };

  const existingTarget = plan.slots.find((slot) => slot.id === toSlotId);
  const target = form && toSlotId !== slotId
    ? moveDestinations(plan, form).find((slot) => slot.id === toSlotId)
    : existingTarget;
  if (!target) return { error: 'target' };

  const sameSlot = source === target;
  const stop = source.stops[sourceIndex];
  if (sameSlot && beforeStopId === stop.id) return { plan };
  const remaining = source.stops.toSpliced(sourceIndex, 1);
  const destinationStops = sameSlot ? remaining : target.stops;
  const index = beforeStopId ? destinationStops.findIndex((item) => item.id === beforeStopId) : toIndex ?? destinationStops.length;
  if (!Number.isInteger(index) || index < 0 || index > destinationStops.length) return { error: 'position' };
  if (sameSlot && index === sourceIndex) return { plan };

  const nextTarget = { ...target, stops: destinationStops.toSpliced(index, 0, stop) };
  const nextSource = { ...source, stops: remaining };
  const conflicts = [];
  if (stop.fixedStart !== undefined && source.date !== target.date) {
    conflicts.push({ code: 'fixed-date', slot: target, source, start: stop.fixedStart, placeName: placeById[stop.placeId].name });
  }
  if (!existingTarget) {
    for (const slot of plan.slots.filter((item) => slotOverlap(target, item))) {
      conflicts.push({ code: 'overlap', slot: target, other: slot });
    }
  }

  const before = (sameSlot ? [source] : [source, target]).flatMap(blockingIssues);
  const after = (sameSlot ? [nextTarget] : [nextSource, nextTarget]).flatMap(blockingIssues);
  // Reordering within a session keeps its existing end-time warning behavior.
  conflicts.push(...after.filter((issue) => (!sameSlot || issue.code !== 'window') && worsenedIssue(issue, before)));
  if (conflicts.length) return { conflicts };

  const slots = plan.slots.map((slot) => slot === target ? nextTarget : slot === source ? nextSource : slot);
  if (existingTarget) return { plan: { ...plan, slots } };
  const updated = sortedSlots([...slots, nextTarget]);
  return { plan: { ...plan, request: requestWithSlots(plan.request, updated), slots: updated } };
}

export function applyEdit(plan, command) {
  if (command.type === 'move') {
    if (!Number.isInteger(command.toIndex)) return plan;
    return moveVisit(plan, command).plan ?? plan;
  }
  if (command.type !== 'remove') return plan;
  const slot = plan.slots.find((item) => item.id === command.slotId);
  const sourceIndex = slot?.stops.findIndex((stop) => stop.id === command.stopId) ?? -1;
  if (sourceIndex < 0) return plan;

  const stops = slot.stops.toSpliced(sourceIndex, 1);
  return { ...plan, slots: plan.slots.map((item) => item.id === slot.id ? { ...slot, stops } : item) };
}

export function appendVisit(plan, request, { slotId, placeId }) {
  const target = request.slots.find((slot) => slot.id === slotId);
  if (!target) return { error: 'slot' };
  if (!Object.hasOwn(placeById, placeId)) return { error: 'place' };

  const current = plan ?? emptyPlan(request);
  const previous = current.slots.find((slot) => slot.id === slotId);
  const slot = { ...target, stops: [...(previous?.stops ?? []), { id: newVisitId(), placeId, manual: true }] };
  const others = current.slots.filter((item) => item.id !== slotId);
  const slots = sortedSlots([...others, slot]);

  const conflicts = [];
  for (const other of others) {
    if (slotOverlap(slot, other)) {
      conflicts.push({ code: 'overlap', slot: other });
    }
  }
  conflicts.push(...blockingIssues(slot));
  const { total, overBudget } = planCosts(slots, request.budget);
  if (overBudget) conflicts.push({ code: 'budget', total, budget: request.budget, overBudget });
  if (conflicts.length) return { conflicts };

  // Apply the selected window and the current whole-trip budget while keeping the other slots from the itinerary.
  const updatedRequest = requestWithSlots({ ...current.request, budget: request.budget }, slots);
  return { plan: { ...current, request: updatedRequest, slots } };
}

export function newVisitId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `visit-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function replacementSummary(route, index, costs) {
  const { placeId, arrival } = route.stops[index];
  const previous = route.stops[index - 1];
  const next = route.stops[index + 1];
  return {
    placeId, arrival, ...costs,
    incoming: previous && { placeId: previous.placeId, minutes: previous.walkToNext },
    outgoing: next && { placeId: next.placeId, minutes: route.stops[index].walkToNext },
  };
}

export function previewReplacement(plan, { slotId, stopId, placeId }, budget = plan.request.budget) {
  const slotIndex = plan.slots.findIndex((slot) => slot.id === slotId);
  const slot = plan.slots[slotIndex];
  const index = slot?.stops.findIndex((stop) => stop.id === stopId) ?? -1;
  if (index < 0) return { error: 'visit' };
  const previous = slot.stops[index];
  if (previous.placeId === placeId || !Object.hasOwn(placeById, placeId)) return { error: 'place' };

  const beforeRoute = schedule(slot);
  // The replacement is a new visit to the place, with no fixed time inherited from the original visit.
  const stops = slot.stops.with(index, { id: previous.id, placeId, manual: true });
  const nextSlot = { ...slot, stops };
  const afterRoute = schedule(nextSlot);
  const slots = plan.slots.with(slotIndex, nextSlot);
  const before = replacementSummary(beforeRoute, index, planCosts(plan.slots, budget));
  const after = replacementSummary(afterRoute, index, planCosts(slots, budget));
  const conflicts = [];
  const openingWarnings = [];
  for (const stop of afterRoute.stops) {
    for (const issue of stop.issues) {
      if (issue.code === 'opening') openingWarnings.push(stop.placeId);
      else conflicts.push({ ...issue, placeId: stop.placeId, departure: stop.departure });
    }
  }

  const { date, period, start, end } = slot;
  const preview = { slot: { date, period, start, end }, before, after, budget, conflicts, openingWarnings };
  // Include the affected route in the check, so changes to later visits also require review.
  const timing = ({ stops }) => stops.map(({ id, placeId, arrival, departure, walkToNext, fixedStart }) =>
    [id, placeId, arrival, departure, walkToNext, fixedStart]);
  const fingerprint = JSON.stringify([preview, timing(beforeRoute), timing(afterRoute)]);
  return { preview, fingerprint, candidate: { ...plan, slots }, slotIndex, index };
}

export function inspectPlan(plan, budget = plan.request.budget, prices) {
  const slots = plan.slots.map(schedule);
  const stops = slots.flatMap((slot) => slot.stops);
  const visited = new Set(stops.map((stop) => stop.placeId));
  return {
    slots,
    ...planCosts(plan.slots, budget, prices),
    stopCount: stops.length,
    missing: plan.request.mustVisit.filter((id) => placeById[id] && !visited.has(id)).map((id) => placeById[id]),
  };
}

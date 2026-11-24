import { areas, periodById, placeById, transports, vibes } from './data.js';
import { appendVisit, dateIndex, moveVisit, prepareRequest } from './planner.js';

export const legacyStorageKey = 'nonla-wander-v1';
export const tripStoragePrefix = 'nonla-wander-v2:';
const migratedTripId = 'legacy-v1';
const defaultName = 'Chuyến đi mới';
const noteFields = ['vibes', 'areas', 'mustVisit', 'budget', 'transport'];
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const tripIdPattern = /^[a-z0-9-]+$/;
const visitIdPattern = /^visit-[a-f0-9]{32}$/;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDate = (value) => typeof value === 'string' && Number.isInteger(dateIndex(value));
const isTimeInput = (value) => typeof value === 'string' && (value === '' || timePattern.test(value));
const isMoney = (value) => Number.isSafeInteger(value) && value >= 0;
const isPeriod = (id) => typeof id === 'string' && Object.hasOwn(periodById, id);
const isPlace = (id) => typeof id === 'string' && Object.hasOwn(placeById, id);
const isList = (value, check) => Array.isArray(value) && value.every(check);
const isKnown = (items, id) => items.some((item) => item.id === id);

function isPreferences(value) {
  return isList(value.vibes, (id) => isKnown(vibes, id)) &&
    isList(value.areas, (id) => isKnown(areas, id)) &&
    isList(value.mustVisit, isPlace) &&
    isKnown(transports, value.transport) &&
    isRecord(value.notes) && noteFields.every((field) => typeof value.notes[field] === 'string');
}

function isForm(value) {
  return isRecord(value) && typeof value.startDate === 'string' && typeof value.endDate === 'string' &&
    isPreferences(value) && typeof value.budget === 'string' &&
    isRecord(value.days) && Object.entries(value.days).every(([date, day]) =>
      isDate(date) && isRecord(day) && Object.entries(day).every(([period, window]) =>
        isPeriod(period) && isRecord(window) && typeof window.enabled === 'boolean' &&
        isTimeInput(window.start) && isTimeInput(window.end)));
}

function isSlot(slot, request) {
  return isRecord(slot) && isDate(slot.date) && slot.date >= request.startDate && slot.date <= request.endDate &&
    isPeriod(slot.period) && slot.id === `${slot.date}-${slot.period}` &&
    Number.isInteger(slot.start) && Number.isInteger(slot.end) && 0 <= slot.start &&
    slot.start < slot.end && slot.end < 24 * 60;
}

function isPlan(plan) {
  if (!isRecord(plan) || plan.version !== 1 || !isRecord(plan.request)) return false;
  const { request, slots } = plan;
  return isDate(request.startDate) && isDate(request.endDate) && request.startDate <= request.endDate &&
    isPreferences(request) && request.transport === 'walk' && isMoney(request.budget) &&
    isList(request.slots, (slot) => isSlot(slot, request)) &&
    isList(slots, (slot) => isSlot(slot, request) && isList(slot.stops, (stop) =>
      isRecord(stop) && isPlace(stop.placeId) && typeof stop.id === 'string' &&
      (stop.id === `visit-${stop.placeId}` || visitIdPattern.test(stop.id)) &&
      (stop.manual === undefined || typeof stop.manual === 'boolean') &&
      (stop.fixedStart === undefined || (Number.isInteger(stop.fixedStart) && stop.fixedStart >= 0 && stop.fixedStart < 24 * 60))));
}

function isUndo(undo) {
  return undo === null || (isRecord(undo) && isPlan(undo.plan) && undo.plan.slots.some((slot) =>
    slot.id === undo.slotId && slot.stops.some((stop) => stop.id === undo.stopId)));
}

function isDraft(draft) {
  return isRecord(draft) && isForm(draft.form) && (draft.plan === null || isPlan(draft.plan)) &&
    (draft.appliedDraft === null || typeof draft.appliedDraft === 'string') && isUndo(draft.undo);
}

function isTrip(trip, id) {
  return isRecord(trip) && trip.version === 2 && trip.id === id && Number.isFinite(trip.createdAt) &&
    typeof trip.name === 'string' && isDraft(trip.draft) &&
    (trip.confirmed === null || (isRecord(trip.confirmed) && isForm(trip.confirmed.form) && isPlan(trip.confirmed.plan)));
}

function blankDraft() {
  return {
    form: {
      startDate: '',
      endDate: '',
      days: {},
      vibes: [],
      areas: [],
      mustVisit: [],
      budget: '',
      transport: 'walk',
      notes: Object.fromEntries(noteFields.map((field) => [field, ''])),
    },
    plan: null,
    appliedDraft: null,
    undo: null,
  };
}

function newTrip(id, name = defaultName, draft = blankDraft()) {
  return { version: 2, id, name, createdAt: Date.now(), draft, confirmed: null };
}

function planSnapshot({ form, plan }) {
  return { form, plan };
}

export function hasDraftChanges(trip) {
  return trip.confirmed !== null && JSON.stringify(planSnapshot(trip.draft)) !== JSON.stringify(trip.confirmed);
}

export function createTripStore(storage) {
  // Each trip is one atomic write. A failed write can still be used in the current page.
  const unsaved = new Map();
  let readFailed = false;

  function read(key) {
    let value;
    try {
      value = storage.getItem(key);
    } catch {
      readFailed = true;
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function readTrip(id) {
    if (!tripIdPattern.test(id)) return null;
    const trip = read(tripStoragePrefix + id);
    return isTrip(trip, id) ? trip : null;
  }

  function get(id) {
    const pending = unsaved.get(id);
    return pending ? structuredClone(pending) : readTrip(id);
  }

  function write(trip) {
    try {
      storage.setItem(tripStoragePrefix + trip.id, JSON.stringify(trip));
      unsaved.delete(trip.id);
    } catch {
      unsaved.set(trip.id, structuredClone(trip));
    }
    return trip;
  }

  function list() {
    const ids = new Set(unsaved.keys());
    try {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(tripStoragePrefix)) ids.add(key.slice(tripStoragePrefix.length));
      }
      readFailed = false;
    } catch {
      readFailed = true;
    }
    return Array.from(ids, get).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }

  function migrateLegacy() {
    // The migrated trip itself is the marker. The old key stays available for another attempt if writing fails.
    const migrated = readTrip(migratedTripId);
    if (migrated) return migrated;

    const legacy = read(legacyStorageKey);
    if (!isRecord(legacy) || !isForm(legacy.draft) || !(legacy.plan === null || isPlan(legacy.plan))) return null;

    const pending = unsaved.get(migratedTripId);
    return write(pending ?? newTrip(migratedTripId, 'Chuyến đi đã lưu', {
      form: legacy.draft,
      plan: legacy.plan,
      appliedDraft: typeof legacy.appliedDraft === 'string' ? legacy.appliedDraft : null,
      undo: null,
    }));
  }

  function create() {
    // getRandomValues also works when this dev server is opened over local-network HTTP.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return write(newTrip(id));
  }

  function rename(id, name) {
    const trip = get(id);
    return trip && write({ ...trip, name: name.trim() || defaultName });
  }

  function saveDraft(id, draft) {
    const trip = get(id);
    return trip && write({ ...trip, draft });
  }

  function addVisit(id, command) {
    const trip = get(id);
    if (!trip) return { error: 'trip' };
    const { request, errors } = prepareRequest(trip.draft.form);
    if (errors) return { errors };
    const result = appendVisit(trip.draft.plan, request, command);
    if (!result.plan) return result;

    const fullyApplied = JSON.stringify(result.plan.request) === JSON.stringify(request);
    const draft = {
      ...trip.draft,
      plan: result.plan,
      appliedDraft: fullyApplied ? JSON.stringify(trip.draft.form) : trip.draft.appliedDraft,
      undo: null,
    };
    return { trip: write({ ...trip, draft }) };
  }

  function moveDraftVisit(id, command) {
    const trip = get(id);
    if (!trip?.draft.plan) return { error: 'trip' };
    const result = moveVisit(trip.draft.plan, command, trip.draft.form);
    if (!result.plan) return result;
    if (result.plan === trip.draft.plan) return { unchanged: true };

    const draft = { ...trip.draft, plan: result.plan, undo: null };
    if (result.plan.request !== trip.draft.plan.request &&
        JSON.stringify(result.plan.request) === JSON.stringify(prepareRequest(draft.form).request)) {
      draft.appliedDraft = JSON.stringify(draft.form);
    }
    return { trip: write({ ...trip, draft }) };
  }

  function confirm(id) {
    const trip = get(id);
    if (!trip?.draft.plan) return null;
    return write({ ...trip, confirmed: structuredClone(planSnapshot(trip.draft)) });
  }

  return {
    list, get, create, rename, saveDraft, addVisit, moveVisit: moveDraftVisit, confirm, migrateLegacy,
    get storageProblem() { return readFailed || unsaved.size > 0; },
  };
}

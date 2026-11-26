import { areas, experienceById, periodById, placeById, transports, vibes } from './data.js';
import { calendarBudget, calendarCommand, calendarOf, dateOf, isCalendar, validCalendarRange } from './calendar.js';
import { planCalendarDraft, planningForm, planningIssue, planningQuestions, updatePlanning } from './calendar-planning.js';
import { appendVisit, dateIndex, draftBudget, moveVisit, newVisitId, placeCost, prepareRequest, previewReplacement } from './planner.js';
import { normalizeWardIds } from './wards.js';

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
export const isParticipantCount = (value) => Number.isSafeInteger(value) && value > 0;
export const participantCount = (version) => version.participants ?? 1;
const hasValidParticipants = (version) => version.participants === undefined || isParticipantCount(version.participants);
const isPeriod = (id) => typeof id === 'string' && Object.hasOwn(periodById, id);
const isPlace = (id) => typeof id === 'string' && Object.hasOwn(placeById, id);
const isExperience = (id) => typeof id === 'string' && Object.hasOwn(experienceById, id);
const savedIds = (value, check) => Array.isArray(value) ? [...new Set(value.filter(check))] : [];
const isList = (value, check) => Array.isArray(value) && value.every(check);
const isKnown = (items, id) => items.some((item) => item.id === id);
const isPriceSnapshot = (prices) => isRecord(prices) && Object.entries(prices).every(([id, cost]) =>
  isPlace(id) && (cost === null || (Number.isFinite(cost) && cost >= 0)));

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
    (draft.calendar === undefined || (draft.plan === null && isCalendar(draft.calendar))) &&
    (draft.appliedDraft === null || typeof draft.appliedDraft === 'string') && isUndo(draft.undo) && hasValidParticipants(draft);
}

function isTrip(trip, id) {
  return isRecord(trip) && trip.version === 2 && trip.id === id && Number.isFinite(trip.createdAt) &&
    typeof trip.name === 'string' && isDraft(trip.draft) &&
    (trip.confirmed === null || (isRecord(trip.confirmed) && isForm(trip.confirmed.form) &&
      (trip.confirmed.calendar ? trip.confirmed.plan === null && isCalendar(trip.confirmed.calendar) : isPlan(trip.confirmed.plan)) &&
      hasValidParticipants(trip.confirmed) &&
      (trip.confirmed.prices === undefined || isPriceSnapshot(trip.confirmed.prices))));
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
  return { version: 2, id, name, createdAt: Date.now(), draft, confirmed: null, savedPlaceIds: [], savedExperienceIds: [] };
}

function planSnapshot(version) {
  return { form: version.form, plan: version.plan, participants: participantCount(version),
    ...(version.calendar ? { calendar: version.calendar } : {}) };
}

function tripPrices(plan) {
  return Object.fromEntries(plan.slots.flatMap(({ stops }) => stops.map(({ placeId }) => [placeId, placeCost(placeId)])));
}

export function hasDraftChanges(trip) {
  if (!trip.confirmed) return false;
  if (JSON.stringify(planSnapshot(trip.draft)) !== JSON.stringify(planSnapshot(trip.confirmed))) return true;
  return Boolean(trip.confirmed.prices && Object.entries(trip.confirmed.prices).some(([id, cost]) => placeCost(id) !== cost));
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
    if (!isTrip(trip, id)) return null;
    return {
      ...trip,
      savedPlaceIds: savedIds(trip.savedPlaceIds, isPlace),
      savedExperienceIds: savedIds(trip.savedExperienceIds, isExperience),
    };
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

  function create({ savedPlaceId, savedExperienceId } = {}) {
    if (savedPlaceId !== undefined && !isPlace(savedPlaceId)) return null;
    if (savedExperienceId !== undefined && !isExperience(savedExperienceId)) return null;
    // getRandomValues also works when this dev server is opened over local-network HTTP.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const trip = newTrip(id);
    if (savedPlaceId) trip.savedPlaceIds.push(savedPlaceId);
    if (savedExperienceId) trip.savedExperienceIds.push(savedExperienceId);
    return write(trip);
  }

  function setSavedPlace(id, placeId, saved) {
    return isPlace(placeId) ? setSavedItem(id, 'savedPlaceIds', placeId, saved) : null;
  }

  function setSavedExperience(id, experienceId, saved) {
    return isExperience(experienceId) ? setSavedItem(id, 'savedExperienceIds', experienceId, saved) : null;
  }

  function setSavedItem(id, field, itemId, saved) {
    const trip = get(id);
    if (!trip || trip[field].includes(itemId) === saved) return trip;
    const items = saved ? [...trip[field], itemId] : trip[field].filter((item) => item !== itemId);
    return write({ ...trip, [field]: items });
  }

  function rename(id, name) {
    const trip = get(id);
    return trip && write({ ...trip, name: name.trim() || defaultName });
  }

  function saveDraft(id, { form, plan, appliedDraft, undo }) {
    const trip = get(id);
    return trip && write({ ...trip, draft: { ...trip.draft, form, plan, appliedDraft, undo } });
  }

  function setParticipants(id, participants) {
    if (!isParticipantCount(participants)) return null;
    const trip = get(id);
    if (!trip || participantCount(trip.draft) === participants) return trip;
    return write({ ...trip, draft: { ...trip.draft, participants } });
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

  function calculateReplacement(trip, command) {
    const draft = trip?.draft;
    if (!draft?.plan) return { error: 'visit' };
    return previewReplacement(draft.plan, command, draftBudget(draft.plan, draft.form));
  }

  function previewDraftReplacement(id, command) {
    const { preview, fingerprint, error } = calculateReplacement(get(id), command);
    return { preview, fingerprint, error };
  }

  function replaceDraftVisit(id, command, expected) {
    const trip = get(id);
    const { preview, fingerprint, candidate, slotIndex, index, error } = calculateReplacement(trip, command);
    if (error) return { error };
    if (fingerprint !== expected) return { preview, fingerprint, changed: true };
    if (preview.conflicts.length || preview.after.overBudget) return { preview, fingerprint };

    const { stopId } = command;
    // Older IDs were tied to the place; save an independent ID only with the confirmed replacement.
    const idToSave = stopId === `visit-${preview.before.placeId}` ? newVisitId() : stopId;
    const slot = candidate.slots[slotIndex];
    const stops = slot.stops.with(index, { ...slot.stops[index], id: idToSave });
    const plan = { ...candidate, slots: candidate.slots.with(slotIndex, { ...slot, stops }) };
    const draft = { ...trip.draft, plan, undo: null };
    return { trip: write({ ...trip, draft }), stopId: idToSave };
  }

  function setCalendarSetup(id, input) {
    const trip = get(id);
    if (!trip) return null;
    const setup = Object.fromEntries(['startDate', 'startTime', 'endDate', 'endTime'].map((key) => [key, String(input[key] ?? '').slice(0, 10)]));
    return write({ ...trip, calendarSetup: { ...setup, editingRange: !!input.editingRange } });
  }

  function setCalendarRange(id, start, end) {
    const trip = get(id);
    if (!trip || !validCalendarRange(start, end)) return null;
    const current = calendarOf(trip.draft);
    if (current?.mode || current?.events.length) return null;
    const form = { ...trip.draft.form, startDate: dateOf(start), endDate: dateOf(end - 1) };
    const draft = { ...trip.draft, form, plan: null, calendar: { start, end, mode: null, events: [] } };
    const calendarSetup = { ...trip.calendarSetup, editingRange: false };
    return write({ ...trip, draft, calendarSetup });
  }

  function setCalendarMode(id, mode) {
    const trip = get(id);
    if (!trip?.draft.calendar || trip.draft.calendar.mode || !['manual', 'ai'].includes(mode)) return null;
    const draft = { ...trip.draft, calendar: { ...trip.draft.calendar, mode } };
    return write({ ...trip, draft, activeCalendarTool: mode === 'ai' ? 'planning' : null });
  }

  function calendarChange(draft, calendar, previous, undoPreferences = null) {
    return { ...draft, calendar, plan: null, appliedDraft: null, undo: null, calendarUndo: previous,
      calendarUndoId: newVisitId(), calendarUndoPreferences: undoPreferences };
  }

  function changeCalendar(id, command, { preview = false, expected } = {}) {
    const trip = get(id);
    const calendar = trip && calendarOf(trip.draft);
    if (!calendar?.mode) return { error: 'Thiết lập thời gian chuyến đi trước.' };
    const result = calendarCommand(calendar, command, calendarBudget(trip.draft));
    if (result.error || preview) return result;
    if (expected !== undefined && expected !== result.fingerprint) return { ...result, stale: true };
    if (result.issues.length) return result;
    const budget = calendarBudget(trip.draft);
    const form = budget === null ? trip.draft.form : { ...trip.draft.form, budget: String(budget) };
    const draft = calendarChange({ ...trip.draft, form }, result.calendar, calendar);
    return { ...result, undoId: draft.calendarUndoId, trip: write({ ...trip, draft }) };
  }

  function undoCalendar(id, expected) {
    const trip = get(id);
    if (!isCalendar(trip?.draft.calendarUndo)) return null;
    if (expected && trip.draft.calendarUndoId !== expected) return null;
    const { calendarUndo, calendarUndoId, calendarUndoPreferences, ...draft } = trip.draft;
    if (calendarUndoPreferences) {
      const { people, budget, previousPeople, previousBudget } = calendarUndoPreferences;
      if (draft.participants === people) {
        if (previousPeople === null) delete draft.participants;
        else draft.participants = previousPeople;
      }
      if (draft.form.budget === budget) draft.form = { ...draft.form, budget: previousBudget };
    }
    const planning = trip.planning?.result?.undoId === calendarUndoId && calendarUndoId
      ? { ...trip.planning, result: { undone: true } } : trip.planning;
    return write({ ...trip, planning, draft: { ...draft, calendar: calendarUndo } });
  }

  function withCalendarPreferences(draft, { participants, budget }) {
    return {
      ...draft,
      ...(isParticipantCount(participants) ? { participants } : {}),
      ...(budget === null || isMoney(budget) ? { form: { ...draft.form, budget: budget === null ? '' : String(budget) } } : {}),
    };
  }

  function setCalendarPreferences(id, preferences) {
    const trip = get(id);
    return trip && write({ ...trip, draft: withCalendarPreferences(trip.draft, preferences) });
  }

  function saveConversation(id, conversation, preferences = {}) {
    const trip = get(id);
    return trip && write({ ...trip, conversation: structuredClone(conversation),
      draft: withCalendarPreferences(trip.draft, preferences) });
  }

  function setCalendarTool(id, tool) {
    const trip = get(id);
    return trip && write({ ...trip, activeCalendarTool: tool });
  }

  function savePlanning(id, change) {
    const trip = get(id);
    const planning = trip && updatePlanning(trip, change);
    if (!planning) return null;
    const { wardIds } = change.key === 'area' ? planning.answers.area : {};
    return write({ ...trip, planning, ...(wardIds === undefined ? {} : { wardIds: normalizeWardIds(wardIds) }) });
  }

  function setTripWards(id, ids) {
    const trip = get(id);
    if (!trip) return null;
    const wardIds = normalizeWardIds(ids);
    const planning = trip.planning && { ...trip.planning, result: null };
    return write({ ...trip, wardIds, ...(planning ? { planning } : {}) });
  }

  function applyPlanning(id) {
    const trip = get(id);
    const calendar = calendarOf(trip?.draft);
    if (!calendar?.mode) return { error: 'Thiết lập thời gian chuyến đi trước.' };
    const planning = planningForm(trip);
    if (planning.result && !planning.result.undone) return { trip, receipt: planning.result };
    if (planning.step !== planningQuestions.length - 1) return { error: 'Xác nhận các câu hỏi trước khi lập lịch.' };
    const invalid = planningQuestions.find((question) => planningIssue(question, planning.answers[question.key]));
    if (invalid) return { error: planningIssue(invalid, planning.answers[invalid.key]) };
    const result = planCalendarDraft(calendar, planning.answers);
    const participants = Number(planning.answers.people);
    const budget = planning.answers.budget === '' ? null : Number(planning.answers.budget);
    let draft = withCalendarPreferences(trip.draft, { participants, budget });
    const changed = result.calendar !== calendar || participantCount(draft) !== participantCount(trip.draft) ||
      draft.form.budget !== trip.draft.form.budget;
    if (changed) {
      draft = calendarChange(draft, result.calendar, calendar, {
        people: participants, budget: draft.form.budget,
        previousPeople: trip.draft.participants ?? null, previousBudget: trip.draft.form.budget,
      });
    } else draft = trip.draft;
    const receipt = { added: result.added, attached: result.attached, notes: result.notes,
      preferencesChanged: changed && (participantCount(draft) !== participantCount(trip.draft) ||
        draft.form.budget !== trip.draft.form.budget),
      undoId: changed ? draft.calendarUndoId : null };
    return { receipt, trip: write({ ...trip, draft, planning: { ...planning, result: receipt } }) };
  }

  function confirm(id) {
    const trip = get(id);
    if (!trip?.draft.plan && !trip?.draft.calendar?.mode) return null;
    const confirmed = structuredClone(planSnapshot(trip.draft));
    confirmed.prices = confirmed.calendar ? Object.fromEntries(confirmed.calendar.events.filter(({ placeId }) => placeId)
      .map(({ placeId }) => [placeId, placeCost(placeId)])) : tripPrices(confirmed.plan);
    return write({ ...trip, confirmed });
  }

  return {
    list, get, create, rename, saveDraft, setParticipants, setSavedPlace, setSavedExperience, addVisit, moveVisit: moveDraftVisit,
    previewReplacement: previewDraftReplacement, replaceVisit: replaceDraftVisit, confirm, migrateLegacy,
    setCalendarSetup, setCalendarRange, setCalendarMode, changeCalendar, undoCalendar, setCalendarPreferences, saveConversation,
    setCalendarTool, savePlanning, applyPlanning, setTripWards,
    get storageProblem() { return readFailed || unsaved.size > 0; },
  };
}

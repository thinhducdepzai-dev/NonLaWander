import { areas, eventSessions, experienceById, experiences, placeById, libraryPlaces as places, transports, vibes } from './data.js';
import { calendarBudget, calendarCommand, calendarCosts, dayMinutes, dayStart, momentLabel, openingNote, placeCategory } from './calendar.js';
import { sessionsInRange } from './library-events.js';
import { normalizeWardIds, wardPreference } from './wards.js';

export const planningQuestions = [
  { key: 'people', title: 'Chuyến đi có bao nhiêu người?', label: 'Số người tham gia', type: 'number', required: true },
  { key: 'vibe', title: 'Bạn thích chuyến đi có vibe nào?', type: 'multiple', options: vibes, custom: 'Vibe khác' },
  { key: 'idea', title: 'Bạn muốn thử món ăn hay hoạt động nào?', type: 'multiple',
    options: [...experiences.map(({ id, name }) => ({ id, label: name })), { id: 'event-session', label: 'Xem sự kiện' }],
    custom: 'Món, hoạt động hoặc tên sự kiện' },
  { key: 'area', title: 'Bạn muốn ưu tiên phường nào?', type: 'wards', options: areas },
  { key: 'budget', title: 'Ngân sách mỗi người là bao nhiêu?', label: 'Ngân sách (₫/người)', type: 'number' },
  { key: 'transport', title: 'Bạn muốn di chuyển bằng gì?', type: 'single', options: transports, custom: 'Phương tiện khác' },
  { key: 'places', title: 'Có nơi nào bạn nhất định muốn ghé?', type: 'multiple', options: places.map(({ id, name }) => ({ id, label: name })), custom: 'Địa điểm khác' },
];

const fold = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd').trim();

function importedChoice(question, legacy) {
  const text = fold(legacy);
  const ids = question.options.filter(({ label }) => text.includes(fold(label))).map(({ id }) => id);
  return { ids: question.type === 'single' ? ids.slice(0, 1) : ids, custom: ids.length ? '' : legacy };
}

export function planningForm(trip) {
  const { draft, conversation, planning } = trip;
  const legacy = conversation?.answers ?? {};
  const original = draft.form;
  const answers = {
    people: String(draft.participants ?? trip.confirmed?.participants ?? legacy.people ?? 1),
    budget: String(calendarBudget(draft) ?? legacy.budget ?? ''),
    vibe: { ids: original.vibes, custom: original.notes?.vibes ?? '' },
    idea: { ids: trip.savedExperienceIds ?? [], custom: '' },
    area: { ids: original.areas, custom: original.notes?.areas ?? '' },
    transport: { ids: [original.transport], custom: original.notes?.transport ?? '' },
    places: { ids: original.mustVisit, custom: original.notes?.mustVisit ?? '' },
  };
  for (const question of planningQuestions) {
    if (question.options && typeof legacy[question.key] === 'string' && legacy[question.key]) {
      answers[question.key] = importedChoice(question, legacy[question.key]);
    }
  }
  const oldStep = conversation?.tab === 'guided' ? planningQuestions.findIndex(({ key }) => !Object.hasOwn(legacy, key)) : 0;
  return {
    ...planning,
    step: Math.min(planningQuestions.length - 1, Math.max(0, planning?.step ?? oldStep)),
    answers: { ...answers, ...planning?.answers,
      area: trip.wardIds === undefined ? { ...answers.area, ...planning?.answers?.area }
        : { ids: [], custom: '', wardIds: normalizeWardIds(trip.wardIds) } },
  };
}

export function updatePlanning(trip, { key, value, step }) {
  const progress = planningForm(trip);
  const question = planningQuestions[progress.step];
  if (question.key !== key) return null;
  const answers = { ...progress.answers, [key]: value };
  return { ...progress, answers, step: Math.max(0, Math.min(planningQuestions.length - 1, step ?? progress.step)), result: null };
}

export function planningIssue(question, value) {
  if (question.type !== 'number' || (!question.required && value === '')) return '';
  if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= (question.required ? 1 : 0)) return '';
  return question.required ? 'Nhập số người là số nguyên từ 1 trở lên.' : 'Nhập ngân sách bằng số đồng nguyên từ 0 trở lên.';
}

function choice(answers, key) {
  const value = answers[key];
  const options = planningQuestions.find((question) => question.key === key).options;
  const ids = options.filter(({ id }) => value.ids.includes(id)).map(({ id }) => id);
  const custom = value.custom?.trim();
  return { ids: ids.length || !custom ? ids : options.filter(({ label }) => fold(label) === fold(custom)).map(({ id }) => id), custom };
}

function plansFor(answers, calendar, notes, geography) {
  const selectedVibes = choice(answers, 'vibe');
  const selectedAreas = choice(answers, 'area');
  const desiredPlaces = choice(answers, 'places');
  const desiredIdeas = choice(answers, 'idea');
  const hasPreference = (place) => selectedVibes.ids.some((id) => place.vibes.includes(id));
  const areaMatches = (place) => selectedAreas.ids.includes(place.area);
  const rank = (place) => geography.score(place) + 2 * Number(areaMatches(place)) + Number(hasPreference(place));
  const priorities = desiredPlaces.ids.map((id) => ({ label: placeById[id].name, candidates: [placeById[id]] }));
  const exactPlace = places.find(({ name }) => fold(name) === fold(desiredPlaces.custom));
  if (desiredPlaces.custom && !exactPlace) notes.push(`Library demo chưa có “${desiredPlaces.custom}”.`);
  if (exactPlace && !desiredPlaces.ids.includes(exactPlace.id)) priorities.push({ label: exactPlace.name, candidates: [exactPlace] });
  const exactIdea = experiences.find(({ name }) => fold(name) === fold(desiredIdeas.custom));
  if (exactIdea && !desiredIdeas.ids.includes(exactIdea.id)) desiredIdeas.ids.push(exactIdea.id);
  else if (desiredIdeas.custom && !exactIdea) notes.push(`Library demo chưa có dữ liệu cho “${desiredIdeas.custom}”.`);
  for (const id of desiredIdeas.ids) {
    if (id === 'event-session') continue;
    const idea = experienceById[id];
    priorities.push({ label: idea.name, candidates: idea.placeIds.map((placeId) => placeById[placeId]).filter(Boolean) });
  }
  if (selectedAreas.custom && !areas.some(({ label }) => fold(label) === fold(selectedAreas.custom))) {
    notes.push(`Library demo chưa nhận diện khu vực “${selectedAreas.custom}”.`);
  }
  if (selectedVibes.custom && !vibes.some(({ label }) => fold(label) === fold(selectedVibes.custom))) {
    notes.push(`Đã lưu vibe “${selectedVibes.custom}”. Bộ demo chỉ xếp theo các vibe có trong Library.`);
  }

  const ranked = places.toSorted((left, right) => rank(right) - rank(left));
  if (priorities.length) return priorities.map((item) => ({ ...item, candidates: item.candidates.toSorted((a, b) => rank(b) - rank(a)) }));
  return [...new Set(calendar.events.filter((event) => !event.placeId && !event.location).map(({ category }) => category)), 'general']
    .filter((category) => category === 'general' || ranked.some((place) => placeCategory(place) === category))
    .map((category) => ({
      label: { food: 'Ăn uống', cafe: 'Cà phê', sight: 'Tham quan', general: 'Điểm phù hợp với chuyến' }[category] ?? 'Địa điểm cho sự kiện',
      candidates: ranked.filter((place) => category === 'general' || placeCategory(place) === category),
      attachOnly: category !== 'general',
    }));
}

function attachAtExistingTime(calendar, candidates, budget) {
  for (const event of calendar.events) {
    if (event.placeId || event.location) continue;
    for (const place of candidates) {
      if (placeCategory(place) !== event.category) continue;
      if (event.category === 'food' && /\ban (?:trua|toi|sang)\b/.test(fold(event.title)) && place.category !== 'Ăn uống') continue;
      const result = calendarCommand(calendar, { type: 'attach', id: event.id, placeId: place.id }, budget);
      if (result.issues?.length === 0) return result;
    }
  }
  return null;
}

function fitNewVisit(calendar, candidates, budget, geography) {
  const total = calendarCosts(calendar.events).total;
  const gaps = [];
  let cursor = calendar.start;
  for (const event of calendar.events) {
    if (cursor < event.start) gaps.push({ start: cursor, end: event.start });
    cursor = Math.max(cursor, event.end);
  }
  if (cursor < calendar.end) gaps.push({ start: cursor, end: calendar.end });
  let fallback;
  for (const place of candidates) {
    if (fallback && geography.score(place) < geography.score(placeById[fallback.event.placeId])) return fallback;
    if (budget !== null && total + (place.cost ?? 0) > budget) continue;
    for (const gap of gaps) {
      // Demo opening hours repeat weekly. Include the next full week after a partial first day.
      const last = Math.min(gap.end, dayStart(gap.start) + 8 * dayMinutes);
      for (let start = Math.ceil(gap.start / 15) * 15; start + place.duration <= last; start += 15) {
        const end = start + place.duration;
        const event = { title: place.name, category: placeCategory(place), placeId: place.id, start, end };
        const warning = openingNote(event);
        if (warning && fallback) continue;
        const result = calendarCommand(calendar, { type: 'create', event }, budget);
        if (result.issues?.length !== 0) continue;
        if (!warning) return result;
        fallback = result;
      }
    }
  }
  return fallback;
}

export function planCalendarDraft(calendar, answers) {
  const budget = answers.budget === '' ? null : Number(answers.budget);
  const notes = [];
  const added = [];
  const attached = [];
  const transport = choice(answers, 'transport');
  if (transport.ids.some((id) => id !== 'walk') || transport.custom && fold(transport.custom) !== 'di bo') {
    notes.push('Chưa xếp địa điểm tự động cho phương tiện này. Dữ liệu demo hiện chỉ tính được đường đi bộ.');
    return { calendar, added, attached, notes };
  }
  const geography = wardPreference(answers.area.wardIds);
  let next = calendar;
  const requestedIdea = choice(answers, 'idea');
  const custom = fold(requestedIdea.custom);
  const named = custom && eventSessions.find(({ name }) => custom.includes(fold(name)));
  const wantsSession = requestedIdea.ids.includes('event-session') || named ||
    /\b(su kien|suat dien|buoi dien|hoa nhac)\b/.test(custom);
  if (wantsSession) {
    const candidates = sessionsInRange(calendar).filter((session) => named ? session.name === named.name
      : !/\bhoa nhac\b/.test(custom) || fold(session.name).includes('hoa nhac'))
      .toSorted((a, b) => geography.score({ id: b.placeId }) - geography.score({ id: a.placeId }));
    const wasAdded = candidates.some(({ id }) => calendar.events.some(({ sessionId }) => sessionId === id));
    if (!wasAdded) {
      const attempts = candidates.map(({ id }) => calendarCommand(calendar, { type: 'add-session', sessionId: id }, budget));
      const accepted = attempts.find((result) => result.issues?.length === 0);
      if (accepted) {
        next = accepted.calendar;
        const { event } = accepted;
        added.push(`${event.title} · ${momentLabel(event.start)}`);
        const outside = geography.outsideNote([{ id: event.placeId, name: event.title }], 'Chưa có suất phù hợp hơn trong phường ưu tiên.');
        if (outside) notes.push(outside);
      } else {
        const conflict = attempts[0]?.issues?.[0]?.message;
        notes.push(conflict ? `Chưa xếp được suất demo. ${conflict}` : 'Chưa có suất demo khớp yêu cầu trong thời gian chuyến.');
      }
    }
  }
  const remainingIdeas = { ...answers, idea: { ...requestedIdea, custom: wantsSession ? '' : requestedIdea.custom } };
  if (wantsSession && !requestedIdea.ids.some((id) => id !== 'event-session') &&
      !answers.places.ids.length && !answers.places.custom) return { calendar: next, added, attached, notes };
  const priorities = plansFor(remainingIdeas, next, notes, geography);
  for (const { label, candidates, attachOnly } of priorities) {
    if (label === 'Điểm phù hợp với chuyến' && (attached.length || next.events.some(({ placeId }) => placeId))) continue;
    if (candidates.some(({ id }) => next.events.some(({ placeId }) => placeId === id)) && !attachOnly) continue;
    const eligible = candidates.filter(({ id }) => !next.events.some(({ placeId }) => placeId === id));
    const attachment = attachAtExistingTime(next, eligible, budget);
    const result = attachment ?? (!attachOnly && fitNewVisit(next, eligible, budget, geography));
    if (!result) {
      notes.push(eligible.length ? `Chưa xếp được ${label} trong khung giờ và ngân sách còn lại.` : `Chưa tìm được địa điểm mới cho ${label} trong Library demo.`);
      continue;
    }
    next = result.calendar;
    const { event } = result;
    const outside = geography.outsideNote([placeById[event.placeId]],
      'Library demo chưa có điểm phù hợp hơn trong phường đã chọn cho yêu cầu hoặc khung giờ này.');
    if (outside) notes.push(outside);
    const when = momentLabel(event.start);
    if (attachment) attached.push(`${placeById[event.placeId].name} vào “${event.title}” · ${when}`);
    else added.push(`${event.title} · ${when}`);
    if (result.opening) notes.push(`${placeById[event.placeId].name}: ${result.opening}`);
  }
  return { calendar: next, added, attached, notes };
}

import { eventSessionById, placeById, libraryPlaces as places } from './data.js';
import { eventLibraryHref } from './library-events.js';
import { icon } from './icons.js';
import { filterLibraryPlaces, libraryGroups } from './library.js';
import { placeCost } from './planner.js';
import { calendarBudget, calendarCosts, calendarDate, calendarEventCost, calendarLegs, calendarOf, availableStart, dateOf, dayCount,
  dayMinutes, dayOf, dayStart, eventCategories, minuteInDay, momentLabel, openingNote, placeCategory, sessionTimeLabel,
  timeOf, travelEstimate, validCalendarRange, wallMinute } from './calendar.js';
import { setupCalendarChat } from './calendar-ai.js';
import { setupCalendarPlanning } from './calendar-planning-view.js';
import { setupWardPicker } from './ward-picker.js';
import { normalizeWardIds, wardById } from './wards.js';
import { hasDraftChanges, isParticipantCount, participantCount } from './trips.js';

const $ = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat('vi-VN');
const money = (amount) => `${currency.format(amount)} ₫`;
const percent = (minute) => `${100 * minute / dayMinutes}%`;
const compact = window.matchMedia('(max-width: 740px)');
const widePanel = window.matchMedia('(min-width: 1050px)');
const panels = {
  ai: { element: 'calendar-ai', button: 'calendar-open-ai', focus: 'calendar-ai-title' },
  planning: { element: 'calendar-planning', button: 'calendar-open-planning', focus: 'calendar-planning-title' },
  library: { element: 'calendar-library', button: 'calendar-open-library', focus: 'calendar-library-query' },
};
const step = 15;
const rangeFields = ['startDate', 'startTime', 'endDate', 'endTime'];
const rangeInput = ({ start, end }) => ({ startDate: dateOf(start), startTime: timeOf(start), endDate: dateOf(end), endTime: timeOf(end) });
const slotExtent = (node, start, end) => {
  node.style.top = percent(start);
  node.style.height = percent(end - start);
};
const timeRange = (start, end) => dayOf(start) === dayOf(end)
  ? `${momentLabel(start)}–${timeOf(end)}` : `${momentLabel(start)} → ${momentLabel(end)}`;

export function setupCalendarView({ trips, updated, tripHash, savedHref, announce }) {
  const rangeForm = $('calendar-range-form');
  const workspace = $('calendar-layout');
  const scroller = $('calendar-scroll');
  const grid = $('calendar-grid');
  const dialog = $('calendar-event-dialog');
  const eventForm = $('calendar-event-form');
  const categoryControl = eventForm.elements.category;
  const costForm = $('calendar-cost-form');
  const costSettings = $('calendar-cost-settings');
  const wardDialog = $('calendar-ward-dialog');
  let pendingWards;
  const manualWards = setupWardPicker($('calendar-manual-wards'), (ids) => { pendingWards = ids; }, (link) => {
    if (!link.target) wardDialog.close();
  });
  let trip;
  let confirmed;
  let calendar;
  let pendingPlace;
  let pendingSession;
  let lastResume;
  let visibleDay = 0;
  let panel;
  let panelEvent;
  let calendarScroll;
  let formContext;
  let attachment;
  let restoreFocus;
  let drag;
  let skipClick = false;

  for (const [value, label] of Object.entries(eventCategories)) if (value !== 'session') categoryControl.add(new Option(label, value));
  const libraryGroup = $('calendar-library-group');
  for (const label of libraryGroups) libraryGroup.add(new Option(label, label));
  $('calendar-known-places').replaceChildren(...places.map((place) => new Option(place.name)));

  function handleUpdate(value) {
    if (!value) return;
    trip = value;
    calendar = calendarOf(confirmed ? trip.confirmed : trip.draft);
    updated(trip);
  }

  function fieldError(start, end) {
    $('calendar-start-error').textContent = start;
    $('calendar-end-error').textContent = end;
    for (const key of rangeFields) {
      const invalid = key.startsWith('start') ? start : end;
      if (invalid) rangeForm.elements[key].setAttribute('aria-invalid', 'true');
      else rangeForm.elements[key].removeAttribute('aria-invalid');
    }
  }

  function setupInput() {
    const session = pendingSession?.session;
    return { startDate: session?.date ?? '', startTime: '09:00',
      endDate: session?.endDate ?? session?.date ?? '', endTime: session?.ends ?? '18:00',
      ...(calendar ? rangeInput(calendar) : {}), ...trip.calendarSetup };
  }

  function mountStage(focus) {
    const setup = !calendar || (!calendar.mode && trip.calendarSetup?.editingRange);
    const mode = !setup && !calendar.mode;
    $('calendar-setup').hidden = !setup;
    $('calendar-mode').hidden = !mode;
    workspace.hidden = setup || mode;
    const pending = $('calendar-pending-session');
    pending.hidden = !pendingSession;
    if (pendingSession) pending.textContent = `Suất đang thêm: ${pendingSession.session.name} · ${sessionTimeLabel(pendingSession.session)}.`;
    if (setup) {
      const values = setupInput();
      for (const key of rangeFields) rangeForm.elements[key].value = values[key] ?? '';
      fieldError('', '');
      if (focus) $('calendar-setup-title').focus();
      return;
    }
    if (mode) {
      if (focus) $('calendar-mode-title').focus();
      return;
    }
    renderLayout(true);
    if (focus) $(panels[panel]?.focus ?? 'calendar-title').focus({ preventScroll: true });
    if (!confirmed && pendingSession) {
      const { session, href } = pendingSession;
      pendingSession = null;
      const params = new URLSearchParams(href.split('?')[1]);
      params.delete('add');
      const returnHref = `${href.split('?')[0]}?${params}`;
      const result = apply({ type: 'add-session', sessionId: session.id });
      $('trip-library-return').href = returnHref;
      history.replaceState(history.state, '', tripHash(trip.id, false, returnHref));
      if (result.trip) {
        const status = $('calendar-session-status');
        status.textContent = `Đã thêm “${session.name}” · ${timeRange(result.event.start, result.event.end)}. Có thể hoàn tác.`;
        status.hidden = false;
        status.focus();
      } else feedback(`Chưa thêm “${session.name}” · ${sessionTimeLabel(session)}. ${errorText(result)}`);
    }
    if (!confirmed && pendingPlace && lastResume !== `${trip.id}/${pendingPlace.id}`) {
      lastResume = `${trip.id}/${pendingPlace.id}`;
      offerPlace(pendingPlace.id);
    }
  }

  rangeForm.addEventListener('input', () => {
    const input = Object.fromEntries(new FormData(rangeForm));
    handleUpdate(trips.setCalendarSetup(trip.id, { ...input, editingRange: true }));
    fieldError('', '');
  });
  rangeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(rangeForm));
    const start = wallMinute(input.startDate, input.startTime);
    const end = wallMinute(input.endDate, input.endTime);
    if (!validCalendarRange(start, end)) {
      const startError = !Number.isFinite(start) ? 'Chọn ngày và giờ bắt đầu.' : '';
      const endError = !Number.isFinite(end) ? 'Chọn ngày và giờ kết thúc.' : end <= start ? 'Kết thúc phải sau thời điểm bắt đầu.' : '';
      fieldError(startError, endError);
      rangeForm.elements[startError ? 'startDate' : 'endDate'].focus();
      return;
    }
    handleUpdate(trips.setCalendarRange(trip.id, start, end));
    mountStage(true);
  });
  $('calendar-back-to-time').addEventListener('click', () => {
    handleUpdate(trips.setCalendarSetup(trip.id, { ...rangeInput(calendar), editingRange: true }));
    mountStage(true);
  });
  $('calendar-mode').addEventListener('click', (event) => {
    const mode = event.target.closest('[data-calendar-mode]')?.dataset.calendarMode;
    if (!mode) return;
    handleUpdate(trips.setCalendarMode(trip.id, mode));
    panel = mode === 'ai' && !pendingSession ? 'planning' : undefined;
    mountStage(true);
  });

  function errorText(result) {
    return result.error ?? result.issues?.map(({ message }) => message).join(' ') ?? '';
  }

  function feedback(text, inDialog = false) {
    const node = $(inDialog ? 'calendar-event-error' : 'calendar-feedback');
    node.textContent = text;
    node.hidden = !text;
    if (text) node.focus();
  }

  function preview(command) {
    return trips.changeCalendar(trip.id, command, { preview: true });
  }

  function apply(command, options) {
    const result = trips.changeCalendar(trip.id, command, options);
    if (result.trip) {
      handleUpdate(result.trip);
      if (result.event) {
        const index = dayOf(result.event.start) - dayOf(calendar.start);
        if (!daysVisible().some((day) => dayOf(day) === dayOf(result.event.start))) visibleDay = index;
      }
      renderLayout(false);
      if (result.event && !workspace.classList.contains('panel-only')) bringEventIntoView(result.event);
    }
    return result;
  }

  function bringEventIntoView(event) {
    const node = grid.querySelector(`[data-event-open="${event.id}"]`);
    if (!node) return;
    const card = node.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    const header = grid.firstElementChild.offsetHeight;
    if (card.top < frame.top + header || card.bottom > frame.bottom) {
      scroller.scrollTop += card.top - frame.top - header - 28;
    }
  }

  function selectedSpan() {
    const pages = dayCount(calendar);
    const start = compact.matches ? visibleDay : Math.floor(visibleDay / 7) * 7;
    return { start, size: compact.matches ? 1 : Math.min(pages - start, 7), pages };
  }

  function daysVisible() {
    const { start, size } = selectedSpan();
    return Array.from({ length: size }, (_, index) => dayStart(calendar.start) + (start + index) * dayMinutes);
  }

  function renderCosts(version) {
    const { total, missingCostCount } = calendarCosts(calendar.events, version.prices);
    const people = participantCount(version);
    const group = Number.isSafeInteger(total) ? BigInt(total) * BigInt(people) : total * people;
    const budget = calendarBudget(version);
    $('calendar-costs').textContent = [
      `${missingCostCount ? 'Đã biết' : 'Ước tính'} ${money(total)}/người`,
      `${money(group)} cả nhóm (${people} người)`,
      missingCostCount && `${missingCostCount} lượt chưa có giá`,
      budget !== null && `Ngân sách ${money(budget)}/người`,
    ].filter(Boolean).join(' · ');
  }

  function renderWardSummary() {
    const names = normalizeWardIds(trip.wardIds).map((id) => wardById[id].name);
    $('calendar-ward-summary').textContent = names.join(', ');
    $('calendar-ward-settings').hidden = confirmed;
  }

  $('calendar-open-wards').addEventListener('click', () => {
    pendingWards = normalizeWardIds(trip.wardIds);
    manualWards.render(pendingWards, trip.id);
    wardDialog.showModal();
    $('calendar-ward-title').focus();
  });
  $('calendar-close-wards').addEventListener('click', () => wardDialog.close());
  $('calendar-save-wards').addEventListener('click', () => {
    handleUpdate(trips.setTripWards(trip.id, pendingWards));
    renderWardSummary();
    if (panel === 'planning') planning.render();
    wardDialog.close();
    announce('Đã lưu phường ưu tiên cho chuyến này.');
  });

  function updateCostFields() {
    costForm.elements.participants.value = participantCount(trip.draft);
    costForm.elements.budget.value = calendarBudget(trip.draft) ?? '';
    $('calendar-cost-error').textContent = '';
    costForm.querySelectorAll('[aria-invalid]').forEach((control) => control.removeAttribute('aria-invalid'));
  }

  costSettings.querySelector('summary').addEventListener('click', () => {
    if (!costSettings.open && trip) updateCostFields();
  });
  costForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = costForm.elements;
    const participants = fields.participants.valueAsNumber;
    const budget = fields.budget.value === '' && !fields.budget.validity.badInput ? null : fields.budget.valueAsNumber;
    const badPeople = !isParticipantCount(participants);
    const badBudget = budget !== null && (!Number.isSafeInteger(budget) || budget < 0);
    const badField = badPeople ? fields.participants : badBudget ? fields.budget : null;
    fields.participants.removeAttribute('aria-invalid');
    fields.budget.removeAttribute('aria-invalid');
    $('calendar-cost-error').textContent = badPeople ? 'Nhập số người là số nguyên từ 1 trở lên.'
      : badBudget ? 'Nhập ngân sách là số nguyên từ 0 trở lên, hoặc để trống.' : '';
    if (badField) {
      badField.setAttribute('aria-invalid', 'true');
      badField.focus();
      return;
    }
    handleUpdate(trips.setCalendarPreferences(trip.id, { participants, budget }));
    renderCosts(trip.draft);
    $('calendar-confirm').disabled = !!trip.confirmed && !hasDraftChanges(trip);
    costSettings.open = false;
    costSettings.querySelector('summary').focus();
    announce('Đã cập nhật số người và ngân sách của bản nháp.');
  });

  function drawEvent(event, day) {
    const place = placeById[event.placeId];
    const card = document.createElement('article');
    const open = document.createElement('button');
    const timing = document.createElement('small');
    const title = document.createElement('strong');
    const detail = document.createElement('small');
    card.className = 'calendar-event';
    card.dataset.category = event.category;
    card.dataset.eventId = event.id;
    card.title = `${event.title} · ${timeRange(event.start, event.end)}`;
    const startOnDay = Math.max(0, event.start - day);
    const endOnDay = Math.min(dayMinutes, event.end - day);
    slotExtent(card, startOnDay, endOnDay);
    card.classList.toggle('is-short', endOnDay - startOnDay < 35);
    open.type = 'button';
    open.dataset.eventOpen = event.id;
    open.className = 'calendar-event-open';
    open.setAttribute('aria-label', `${event.title}, ${timeRange(event.start, event.end)}`);
    timing.textContent = `${timeOf(event.start)}–${timeOf(event.end)}`;
    title.textContent = event.title;
    detail.textContent = place && place.name !== event.title ? place.name
      : event.location || (event.category === 'travel' ? [event.from, event.to].filter(Boolean).join(' → ') : '');
    open.append(title, timing);
    if (detail.textContent) open.append(detail);
    card.append(open);
    if (!confirmed && !event.sessionId && event.end <= day + dayMinutes) {
      const resize = document.createElement('span');
      resize.className = 'calendar-resize-handle';
      resize.dataset.resize = 'true';
      resize.setAttribute('aria-hidden', 'true');
      card.append(resize);
    }
    return card;
  }

  function renderLegs() {
    const notes = calendarLegs(calendar.events).map(({ from, to, minutes, explicit, unknown }) =>
      `${from.title} → ${to.title} · ${explicit ? `Đã dành ${explicit.end - explicit.start} phút trong “${explicit.title}”`
        : unknown ? 'Chưa xác định chặng đi bộ' : `Khoảng ${minutes} phút đi bộ`}`);
    for (const event of calendar.events) {
      if (event.category === 'travel') {
        const travel = travelEstimate(event);
        notes.push(`${event.title} · ${event.end - event.start} phút đã đặt · ${travel === null ? 'Chưa xác định thời gian đi bộ' : `Ước tính đi bộ ${travel} phút`}`);
      }
      const opening = openingNote(event);
      if (opening) notes.push(`${event.title} · ${opening}`);
    }
    $('calendar-legs').hidden = !notes.length;
    $('calendar-leg-list').replaceChildren(...notes.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
  }

  function renderGrid(resetScroll) {
    visibleDay = Math.max(0, Math.min(visibleDay, dayCount(calendar) - 1));
    const days = daysVisible();
    const { start, size, pages } = selectedSpan();
    $('calendar-prev').parentElement.hidden = pages <= 7;
    $('calendar-prev').disabled = !start;
    $('calendar-next').disabled = start + size >= pages;
    $('calendar-visible-range').textContent = size === 1 ? calendarDate(days[0], true) : `${calendarDate(days[0])} – ${calendarDate(days.at(-1))}`;

    const block = Math.floor(visibleDay / 7) * 7;
    $('calendar-day-picker').replaceChildren(...Array.from({ length: Math.min(7, pages - block) }, (_, index) => {
      const button = document.createElement('button');
      button.className = 'text-button';
      button.type = 'button';
      button.dataset.focusDay = block + index;
      button.textContent = calendarDate(dayStart(calendar.start) + (block + index) * dayMinutes, true);
      button.setAttribute('aria-pressed', visibleDay === block + index);
      return button;
    }));

    const scrollTop = scroller.scrollTop;
    grid.style.setProperty('--calendar-columns', days.length);
    grid.innerHTML = `<div class="calendar-grid-header"><span>UTC+7</span>${days.map((day) => `<strong>${calendarDate(day, true)}</strong>`).join('')}</div>
      <div class="calendar-grid-body">
        <div class="calendar-hours" aria-hidden="true">${Array.from({ length: 24 }, (_, hour) => `<span>${timeOf(hour * 60)}</span>`).join('')}</div>
        ${days.map((day) => `<div class="calendar-day" data-day="${day}" role="group" aria-label="${calendarDate(day, true)}"></div>`).join('')}
      </div>`;
    for (const [index, node] of [...grid.querySelectorAll('.calendar-day')].entries()) {
      const day = days[index];
      for (const [begin, end] of [[day, Math.max(day, calendar.start)], [Math.min(day + dayMinutes, calendar.end), day + dayMinutes]]) {
        if (end <= begin) continue;
        const inactive = document.createElement('div');
        inactive.className = 'calendar-inactive';
        inactive.setAttribute('aria-hidden', 'true');
        slotExtent(inactive, begin - day, end - day);
        node.append(inactive);
      }
      for (const event of calendar.events) if (event.start < day + dayMinutes && event.end > day) node.append(drawEvent(event, day));
    }

    if (resetScroll) {
      const first = calendar.events.find((event) => event.end > days[0] && event.start < days.at(-1) + dayMinutes);
      const initial = first ? Math.max(days[0], first.start)
        : dayOf(calendar.start) === dayOf(days[0]) ? Math.max(days[0] + 8 * 60, calendar.start) : days[0] + 8 * 60;
      const pixels = grid.querySelector('.calendar-day').offsetHeight / dayMinutes;
      scroller.scrollTop = Math.max(0, (minuteInDay(initial) - 60) * pixels);
    } else scroller.scrollTop = scrollTop;
  }

  function renderLayout(resetScroll) {
    const version = confirmed ? trip.confirmed : trip.draft;
    $('calendar-tools').hidden = confirmed;
    costSettings.hidden = confirmed;
    renderWardSummary();
    $('calendar-title').textContent = confirmed ? 'Lịch đã chốt' : 'Lịch nháp';
    $('calendar-range-label').textContent = timeRange(calendar.start, calendar.end);
    $('calendar-confirm').hidden = confirmed;
    $('calendar-confirm').textContent = trip.confirmed ? 'Cập nhật lịch đã chốt' : 'Chốt lịch';
    $('calendar-confirm').disabled = !!trip.confirmed && !hasDraftChanges(trip);
    $('calendar-undo').hidden = confirmed;
    $('calendar-undo').disabled = !trip.draft.calendarUndo;
    $('calendar-saved-link').href = savedHref(trip.id);
    renderCosts(version);
    renderLegs();
    renderPanels();
    renderGrid(resetScroll);
  }

  function changePage(direction) {
    const span = selectedSpan();
    visibleDay = span.start + direction * (compact.matches ? 1 : 7);
    renderGrid(true);
    const button = $(direction < 0 ? 'calendar-prev' : 'calendar-next');
    (button.disabled ? $('calendar-title') : button).focus();
  }
  $('calendar-prev').addEventListener('click', () => changePage(-1));
  $('calendar-next').addEventListener('click', () => changePage(1));
  $('calendar-day-picker').addEventListener('click', (event) => {
    const button = event.target.closest('[data-focus-day]');
    if (!button) return;
    visibleDay = Number(button.dataset.focusDay);
    renderGrid(true);
    $('calendar-day-picker').querySelector('[aria-pressed="true"]')?.focus();
  });
  compact.addEventListener('change', () => { if (!workspace.hidden) renderGrid(true); });
  widePanel.addEventListener('change', () => {
    if (!workspace.hidden) renderPanels();
  });

  function currentEvent(id) {
    return calendar?.events.find((event) => event.id === id);
  }

  function openDialog(heading, view) {
    if (!dialog.open) {
      restoreFocus = document.activeElement;
      dialog.showModal();
    }
    $('calendar-event-heading').textContent = heading;
    $('calendar-event-info').hidden = view !== 'info';
    eventForm.hidden = view !== 'form';
    $('calendar-attachment').hidden = view !== 'attach';
    feedback('', true);
    $('calendar-event-heading').focus();
  }

  function openInfo(id) {
    const event = currentEvent(id);
    if (!event) return;
    formContext = { id };
    $('calendar-event-when').textContent = timeRange(event.start, event.end);
    const place = placeById[event.placeId];
    const cost = calendarEventCost(event, confirmed ? trip.confirmed.prices : undefined);
    const location = event.sessionId
      ? [place?.name ?? 'Chưa có nơi tổ chức', cost === null ? 'Chưa biết giá vé' : cost === 0 ? 'Miễn phí' : `${money(cost)}/người`]
      : place ? [place.name, cost === null ? 'Chưa có giá' : cost === 0 ? 'Miễn phí' : money(cost), openingNote(event)]
      : [event.location, event.category === 'travel' ? [event.from, event.to].filter(Boolean).join(' → ') : 'Chưa gắn địa điểm'];
    $('calendar-event-place').textContent = [eventCategories[event.category], ...location].filter(Boolean).join(' · ');
    const source = $('calendar-event-session');
    source.hidden = !eventSessionById[event.sessionId];
    if (!source.hidden) source.href = eventLibraryHref({ sessionId: event.sessionId, tripId: trip.id });
    $('calendar-event-actions').hidden = confirmed;
    for (const button of $('calendar-event-actions').querySelectorAll('[data-event-action]')) {
      const action = button.dataset.eventAction;
      button.hidden = event.sessionId ? action !== 'remove' : event.category === 'travel' && ['library', 'ai'].includes(action);
    }
    openDialog(event.title, 'info');
  }
  $('calendar-event-session').addEventListener('click', () => dialog.close());

  function eventFields() {
    const travel = categoryControl.value === 'travel';
    const moveOnly = ['move', 'duplicate'].includes(formContext.type);
    $('calendar-event-name-fields').hidden = moveOnly;
    $('calendar-event-end').hidden = moveOnly;
    $('calendar-event-location').hidden = travel || moveOnly;
    $('calendar-event-travel').hidden = !travel || moveOnly;
    $('calendar-event-linked-place').textContent = formContext.placeId ? `Địa điểm: ${placeById[formContext.placeId].name}` : '';
  }

  function editor(type, entry = {}, placeId = entry.placeId) {
    const day = dayStart(calendar.start) + visibleDay * dayMinutes;
    const place = placeById[placeId];
    const duration = Math.min(calendar.end - calendar.start, place?.duration ?? ((entry.end ?? 60) - (entry.start ?? 0)));
    const baseTime = type === 'duplicate' ? entry.end : Math.max(calendar.start, day + 9 * 60);
    const start = type === 'duplicate' || entry.start === undefined ? availableStart(calendar, duration, baseTime) : entry.start;
    const end = type === 'duplicate' ? start + duration : entry.end ?? Math.min(calendar.end, start + duration);
    formContext = { type, id: entry.id, placeId, attachment: entry.attachment, fixed: entry.fixed };
    const values = { ...rangeInput({ start, end }), title: entry.title ?? place?.name ?? '',
      category: entry.category ?? placeCategory(place), location: entry.location ?? '', from: entry.from ?? '', to: entry.to ?? '' };
    for (const [field, value] of Object.entries(values)) eventForm.elements[field].value = value;
    eventFields();
    const heading = ({ create: 'Tạo sự kiện', edit: 'Sửa sự kiện', move: 'Đổi ngày/giờ', duplicate: 'Nhân bản sự kiện' })[type];
    openDialog(heading, 'form');
    (['move', 'duplicate'].includes(type) ? eventForm.elements.startDate : eventForm.elements.title).focus();
  }
  categoryControl.addEventListener('change', eventFields);
  $('calendar-create-event').addEventListener('click', () => editor('create'));
  $('calendar-event-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    else if (!workspace.hidden) $('calendar-title').focus({ preventScroll: true });
    restoreFocus = null;
  });
  $('calendar-event-actions').addEventListener('click', (event) => {
    const action = event.target.closest('[data-event-action]')?.dataset.eventAction;
    const entry = currentEvent(formContext.id);
    if (!action || !entry || confirmed) return;
    if (action === 'library' || action === 'ai') {
      dialog.close();
      setPanel(action, entry.id);
      restoreFocus = $(action === 'ai' ? 'calendar-ai-title' : 'calendar-library-query');
      return;
    }
    if (action === 'remove') {
      const result = apply({ type: 'remove', id: entry.id });
      if (result.trip) { dialog.close(); announce('Đã xóa sự kiện. Có thể hoàn tác.'); }
      else feedback(errorText(result), true);
      return;
    }
    editor(action, entry);
  });

  eventForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(eventForm));
    const start = wallMinute(input.startDate, input.startTime);
    const end = wallMinute(input.endDate, input.endTime);
    const { type, id, placeId, attachment: selectedPlace } = formContext;
    const record = { title: input.title.trim(), category: input.category, start, end,
      location: input.location.trim(), from: input.from.trim(), to: input.to.trim(),
      placeId: input.category === 'travel' ? null : placeId };
    const command = ['move', 'duplicate'].includes(type) ? { type, id, start } : { type, id, event: record };
    if (selectedPlace) {
      if (!validCalendarRange(start, end)) return feedback('Chọn thời điểm kết thúc sau bắt đầu.', true);
      const current = currentEvent(id);
      showAttachment(selectedPlace, { ...current, start, end }, true);
      return;
    }
    const result = apply(command);
    if (!result.trip) return feedback(errorText(result), true);
    finishEditing(result.event);
  });

  function finishEditing(event) {
    if (!workspace.classList.contains('panel-only')) {
      restoreFocus = grid.querySelector(`[data-event-open="${event.id}"]`) ?? restoreFocus;
    }
    dialog.close();
    feedback('');
    if (pendingPlace) {
      const href = new URLSearchParams(location.hash.split('?')[1]).get('library');
      const libraryBack = href && `#library${href.includes('?') ? `?${href.split('?')[1]}` : ''}`;
      history.replaceState(history.state, '', tripHash(trip.id, false, libraryBack));
      pendingPlace = null;
      lastResume = undefined;
    }
    announce(`Đã lưu “${event.title}”. Có thể hoàn tác.`);
  }

  function showAttachment(placeId, entry, adjust = false) {
    const place = placeById[placeId];
    if (!place || !entry) return;
    const command = adjust ? { type: 'edit', id: entry.id, event: { start: entry.start, end: entry.end, placeId } }
      : { type: 'attach', id: entry.id, placeId };
    const result = preview(command);
    const candidateEnd = Math.max(entry.end, entry.start + place.duration);
    const alternative = candidateEnd > entry.end ? { type: 'edit', id: entry.id, event: { start: entry.start, end: candidateEnd, placeId } } : null;
    formContext = { id: entry.id };
    attachment = { command, options: { expected: result.fingerprint }, alternative,
      alternativeResult: alternative ? preview(alternative) : null, placeId, entry };
    openDialog(entry.placeId ? 'Thay địa điểm' : 'Gắn địa điểm', 'attach');
    $('calendar-attachment-summary').textContent = `${place.name} → ${entry.title} · ${timeRange(entry.start, entry.end)}`;
    const cost = placeCost(place.id);
    const route = (result.afterLegs ?? []).filter(({ from, to }) => from.id === entry.id || to.id === entry.id)
      .map(({ from, to, explicit, unknown, minutes }) =>
        `${from.title} → ${to.title} (${explicit ? `${explicit.end - explicit.start} phút đã dành` : unknown ? 'chưa xác định' : `đi bộ khoảng ${minutes} phút`})`);
    const changedCost = result.costs ? `Cả chuyến ${money(result.beforeCosts.total)} → ${money(result.costs.total)}/người` : '';
    $('calendar-attachment-warning').textContent = [
      `Ghé khoảng ${place.duration} phút`, cost === null ? 'Chưa có giá' : cost === 0 ? 'Miễn phí' : `${money(cost)}/người`,
      changedCost, ...route, result.opening, errorText(result),
    ].filter(Boolean).join(' · ');
    $('calendar-attach-apply').disabled = !!errorText(result);
    const extra = $('calendar-attach-alternative');
    extra.hidden = !alternative;
    extra.disabled = !alternative || !!errorText(attachment.alternativeResult);
    extra.textContent = alternative ? `Gắn và kéo dài tới ${timeOf(candidateEnd)}` : '';
  }

  function attach(alternative) {
    const pending = attachment;
    const command = alternative ? pending.alternative : pending.command;
    if (!command) return;
    const expected = alternative ? pending.alternativeResult.fingerprint : pending.options.expected;
    const result = apply(command, { expected });
    if (result.trip) return finishEditing(result.event);
    if (result.stale) {
      const latest = trips.get(trip.id);
      if (latest) handleUpdate(latest);
      const current = currentEvent(pending.entry.id);
      if (current) showAttachment(pending.placeId, pending.command.type === 'edit' ? pending.entry : current, pending.command.type === 'edit');
      feedback('Lịch liên quan vừa đổi. Hãy xem lại trước khi gắn địa điểm.', true);
    } else feedback(errorText(result), true);
  }
  $('calendar-attach-apply').addEventListener('click', () => attach(false));
  $('calendar-attach-alternative').addEventListener('click', () => attach(true));
  $('calendar-attach-edit').addEventListener('click', () => editor('edit', {
    ...attachment.entry, end: Math.min(calendar.end, Math.max(attachment.entry.end, attachment.entry.start + placeById[attachment.placeId].duration)),
    attachment: attachment.placeId,
  }));

  function offerPlace(placeId, contextId = panelEvent) {
    const entry = contextId && currentEvent(contextId);
    if (entry) return showAttachment(placeId, entry);
    if (contextId) return feedback('Sự kiện này không còn trong lịch.');
    editor('create', {}, placeId);
  }

  function renderLibraryPanel() {
    $('calendar-library-events').href = eventLibraryHref({ tripId: trip.id });
    const query = $('calendar-library-query').value;
    const results = filterLibraryPlaces(query, libraryGroup.value);
    const event = currentEvent(panelEvent);
    $('calendar-library-context').textContent = event ? `Chọn địa điểm cho “${event.title}”` : 'Chọn một địa điểm để đặt vào lịch nháp.';
    $('calendar-library-empty').hidden = !!results.length;
    $('calendar-library-results').replaceChildren(...results.map((place) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'text-button';
      button.type = 'button';
      button.dataset.calendarPlace = place.id;
      button.textContent = place.name;
      row.append(button);
      return row;
    }));
  }

  function saveChat(chatState) {
    handleUpdate(trips.saveConversation(trip.id, chatState));
    chat.render();
  }

  function undoCalendar(expected) {
    const value = trips.undoCalendar(trip.id, expected);
    if (!value) return false;
    handleUpdate(value);
    $('calendar-session-status').hidden = true;
    feedback('');
    renderLayout(false);
    announce('Đã hoàn tác thao tác trên lịch của chuyến này.');
    return true;
  }

  const chat = setupCalendarChat({ getTrip: () => trip, getCalendar: () => calendar, save: saveChat,
    preview, apply, choosePlace: offerPlace, undo: undoCalendar });
  const planning = setupCalendarPlanning({ getTrip: () => trip, getCalendar: () => calendar, undo: undoCalendar,
    save(change) {
      const value = trips.savePlanning(trip.id, change);
      if (value) {
        handleUpdate(value);
        renderWardSummary();
        planning.render();
      }
    },
    apply() {
      const result = trips.applyPlanning(trip.id);
      if (result.trip) {
        handleUpdate(result.trip);
        renderLayout(false);
        const firstChange = calendar.events.find((event) =>
          !trip.draft.calendarUndo?.events.some((previous) => previous.id === event.id && previous.placeId === event.placeId));
        if (firstChange && widePanel.matches) bringEventIntoView(firstChange);
      }
      return result;
    },
  });

  function setOverlay(active) {
    document.body.classList.toggle('has-calendar-ai-overlay', active);
    for (const node of document.querySelectorAll('.skip-link, .site-header, #trip-header, #site-footer')) node.inert = active;
    if (active) sizeOverlay();
  }

  function sizeOverlay() {
    if (!document.body.classList.contains('has-calendar-ai-overlay')) return;
    const height = window.visualViewport?.height ?? window.innerHeight;
    document.body.style.setProperty('--ai-viewport-height', `${height}px`);
  }
  window.visualViewport?.addEventListener('resize', sizeOverlay);

  function sizeDesktopPanel() {
    if (!panel || !widePanel.matches || workspace.hidden) return;
    const top = workspace.getBoundingClientRect().top + window.scrollY;
    workspace.style.setProperty('--ai-panel-top', `${top}px`);
  }
  new ResizeObserver(sizeDesktopPanel).observe($('trip-header'));

  function renderPanels() {
    const panelOnly = !!panel && !widePanel.matches;
    workspace.classList.toggle('with-panel', !!panel);
    workspace.classList.toggle('panel-only', panelOnly);
    setOverlay(panelOnly && panel !== 'library');
    sizeDesktopPanel();
    for (const [name, config] of Object.entries(panels)) {
      $(config.element).hidden = name !== panel;
      $(config.button).setAttribute('aria-expanded', name === panel);
    }
    if (panel === 'ai') chat.render();
    if (panel === 'planning') planning.render();
    if (panel === 'library') renderLibraryPanel();
  }

  function setPanel(next, contextId = null) {
    const previous = panel;
    if (!previous) calendarScroll = scroller.scrollTop;
    const previousContext = panelEvent;
    panel = next;
    panelEvent = contextId;
    handleUpdate(trips.setCalendarTool(trip.id, next === 'ai' || next === 'planning' ? next : null));
    if (next === 'ai' && contextId) handleUpdate(trips.saveConversation(trip.id, { ...trip.conversation, contextId }));
    if (next === 'library' && contextId !== previousContext) {
      $('calendar-library-query').value = '';
      libraryGroup.value = '';
    }
    renderPanels();
    if (!next && previous && !widePanel.matches) {
      renderGrid(calendarScroll === undefined);
      if (calendarScroll !== undefined) scroller.scrollTop = calendarScroll;
    }
    if (next) $(panels[next].focus).focus({ preventScroll: true });
    else if (previous) $(panels[previous].button).focus({ preventScroll: true });
  }

  for (const [name, config] of Object.entries(panels)) {
    $(config.button).addEventListener('click', () => setPanel(panel === name ? undefined : name));
  }
  for (const button of workspace.querySelectorAll('[data-calendar-close-panel]')) button.addEventListener('click', () => setPanel());
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing || !trip || !panel || workspace.hidden || dialog.open || wardDialog.open) return;
    if (!$(panels[panel].element).contains(event.target) && !$(panels[panel].button).contains(event.target)) return;
    event.preventDefault();
    setPanel();
  });

  $('calendar-library-query').addEventListener('input', renderLibraryPanel);
  libraryGroup.addEventListener('change', renderLibraryPanel);
  $('calendar-library-results').addEventListener('click', (event) => {
    const id = event.target.closest('[data-calendar-place]')?.dataset.calendarPlace;
    if (id) offerPlace(id);
  });

  $('calendar-undo').addEventListener('click', () => {
    undoCalendar();
    if ($('calendar-undo').disabled) $('calendar-title').focus();
  });
  $('calendar-confirm').addEventListener('click', () => {
    const saved = trips.confirm(trip.id);
    if (saved) {
      handleUpdate(saved);
      location.hash = tripHash(trip.id, true);
      announce('Đã lưu phiên bản chốt.');
    }
  });

  function pointerTime(event) {
    const node = [...grid.querySelectorAll('.calendar-day')].find((column) => {
      const bounds = column.getBoundingClientRect();
      return event.clientX >= bounds.left && event.clientX <= bounds.right;
    });
    if (!node) return null;
    const bounds = node.getBoundingClientRect();
    const elapsed = (event.clientY - bounds.top) / bounds.height * dayMinutes;
    const minute = Math.max(0, Math.min(dayMinutes - step, Math.floor(elapsed / step) * step));
    return { node, time: Number(node.dataset.day) + minute };
  }

  grid.addEventListener('pointerdown', (event) => {
    if (confirmed || event.pointerType !== 'mouse' || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const point = pointerTime(event);
    if (!point || !event.target.closest('.calendar-day')) return;
    const id = event.target.closest('[data-event-id]')?.dataset.eventId;
    const type = !id ? 'create' : event.target.closest('[data-resize]') ? 'resize' : 'move';
    const entry = currentEvent(id);
    drag = { pointer: event.pointerId, start: point.time, x: event.clientX, y: event.clientY, entry, type, active: false };
  });

  function dragTarget(point) {
    if (drag.type === 'create') {
      const start = Math.min(drag.start, point);
      return { start, end: Math.max(point, drag.start) + step };
    }
    if (drag.type === 'resize') return { start: drag.entry.start, end: Math.max(drag.entry.start + step, point + step) };
    const start = drag.entry.start + point - drag.start;
    return { start, end: start + drag.entry.end - drag.entry.start };
  }

  window.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const point = pointerTime(event);
    if (!point) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    if (!drag.active) {
      drag.active = true;
      grid.setPointerCapture(event.pointerId);
      grid.classList.add('calendar-dragging');
    }
    const { start, end } = dragTarget(point.time);
    const hint = $('calendar-drag-preview');
    hint.hidden = false;
    hint.textContent = timeRange(start, end);
    grid.querySelector('.calendar-ghost')?.remove();
    const ghost = document.createElement('div');
    ghost.className = 'calendar-ghost';
    const day = Number(point.node.dataset.day);
    slotExtent(ghost, Math.max(0, start - day), Math.min(dayMinutes, end - day));
    point.node.append(ghost);
  });

  function clearDrag() {
    drag = undefined;
    grid.classList.remove('calendar-dragging');
    grid.querySelector('.calendar-ghost')?.remove();
    $('calendar-drag-preview').hidden = true;
  }
  window.addEventListener('pointercancel', clearDrag);
  window.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const active = drag.active;
    const point = pointerTime(event);
    const target = point && dragTarget(point.time);
    const action = drag;
    clearDrag();
    if (!active || !target) return;
    skipClick = true;
    window.setTimeout(() => { skipClick = false; }, 180);
    if (action.type === 'create') {
      if (target.start < calendar.start || target.end > calendar.end) return feedback('Khung giờ chọn nằm ngoài thời gian chuyến.');
      editor('create', target);
      return;
    }
    const result = apply({ type: action.type, id: action.entry.id, ...target });
    if (!result.trip) feedback(errorText(result));
    else {
      feedback('');
      announce(`Đã đổi thời gian “${result.event.title}”. Có thể hoàn tác.`);
    }
  });

  grid.addEventListener('click', (event) => {
    if (skipClick) return;
    const id = event.target.closest('[data-event-open]')?.dataset.eventOpen;
    if (id) return openInfo(id);
    if (confirmed || !event.target.closest('.calendar-day')) return;
    const point = pointerTime(event);
    if (!point) return;
    if (point.time < calendar.start || point.time >= calendar.end) return feedback('Giờ này nằm ngoài thời gian chuyến.');
    editor('create', { start: point.time, end: Math.min(calendar.end, point.time + 60) });
  });

  return {
    render(value, readOnly, resume, focus = false) {
      if (!value) {
        if (dialog.open) dialog.close();
        if (wardDialog.open) wardDialog.close();
        setOverlay(false);
        trip = undefined;
        lastResume = undefined;
        return;
      }
      const changed = trip?.id !== value.id || confirmed !== readOnly;
      if (changed && dialog.open) dialog.close();
      if (changed && wardDialog.open) wardDialog.close();
      trip = value;
      confirmed = readOnly;
      calendar = calendarOf(readOnly ? value.confirmed : value.draft);
      pendingPlace = readOnly ? null : resume?.place;
      pendingSession = !readOnly && resume?.session ? resume : null;
      $('calendar-session-status').hidden = true;
      if (!pendingPlace) lastResume = undefined;
      if (changed) {
        visibleDay = 0;
        costSettings.open = false;
        $('calendar-library-query').value = '';
        libraryGroup.value = '';
        const savedPanel = value.activeCalendarTool === undefined && value.conversation?.open
          ? value.conversation.tab === 'free' ? 'ai' : 'planning' : value.activeCalendarTool;
        panel = !confirmed && !pendingSession && (savedPanel === 'ai' || savedPanel === 'planning') ? savedPanel : undefined;
        calendarScroll = undefined;
        panelEvent = null;
        feedback('');
      }
      mountStage(focus);
    },
  };
}

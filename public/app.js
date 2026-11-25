import { areas, exampleDraft, periodById, periods, placeById, places, transports, vibes } from './data.js';
import { setupHomeMotion } from './home.js';
import { icon } from './icons.js';
import { getLibraryReturn, renderLibrary, setupLibraryActions, slotLabel, tripLibraryHref } from './library.js';
import { applyEdit, clock, createPlan, dateAt, dateIndex, draftBudget, inspectPlan, moveDestinations, openingHours, placeCost, prepareRequest, weekday } from './planner.js';
import { setupReplacement } from './replace-visit.js';
import { setupTripLibrary } from './trip-library.js';
import { createTripStore, hasDraftChanges, isParticipantCount, participantCount } from './trips.js';

const $ = (id) => document.getElementById(id);
const form = $('trip-form');
const participants = $('participants');
const days = $('day-list');
const timeline = $('timeline');
const updateHomePhoto = setupHomeMotion($('home-view'));
const dayPageSize = 7;
const currency = new Intl.NumberFormat('vi-VN');
const money = (amount) => `${currency.format(amount)} ₫`;
const shortDate = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const year = (date) => date.slice(0, 4);

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const trips = createTripStore(browserStorage());
let activeTrip = null;
let viewingConfirmed = false;
let draft;
let plan;
let appliedDraft;
let dayPage = 0;
let editing = false;
let undo = null;
let errors = {};
let libraryReturn = null;
let addedVisitNotice = null;
let moveSelection = null;
let moveFeedback = null;
let draggedVisit = null;

function save() {
  if (!activeTrip || viewingConfirmed) return;
  const saved = trips.saveDraft(activeTrip.id, { form: draft, plan, appliedDraft, undo });
  if (saved) activeTrip = saved;
  updateTripControls();
  showStorageStatus();
}

function announce(message) {
  $('status').textContent = message;
}

function showStorageStatus() {
  $('storage-notice').hidden = !trips.storageProblem;
}

document.querySelectorAll('[data-icon]').forEach((node) => {
  node.innerHTML = icon(node.dataset.icon);
});

function options(group, items, type = 'checkbox') {
  return items.map((item) => `
    <label class="choice">
      <input type="${type}" name="${group}" value="${item.id}" ${group === 'transport' ? 'aria-describedby="transport-hint error-transport"' : ''}>
      <span>${item.icon ? icon(item.icon) : ''}${item.label}<span class="choice-check">${icon('check')}</span></span>
    </label>`).join('');
}

$('vibes-options').innerHTML = options('vibes', vibes);
$('areas-options').innerHTML = options('areas', areas);
$('places-options').innerHTML = options('mustVisit', places.map((place) => ({ ...place, label: place.name })));
$('transport-options').innerHTML = options('transport', transports, 'radio');

for (const container of form.querySelectorAll('[data-note]')) {
  const { note, label } = container.dataset;
  container.innerHTML = `<details class="note">
    <summary>${icon('plus')} Thêm yêu cầu riêng <span class="sr-only">về ${label}</span><span class="note-saved" hidden>· Đã nhập</span></summary>
    <label for="note-${note}">Yêu cầu riêng về ${label}</label>
    <textarea id="note-${note}" name="${note}" rows="2"></textarea>
  </details>`;
}

function renderPreferences() {
  for (const input of form.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
    if (input.dataset.period) continue;
    const value = draft[input.name];
    input.checked = Array.isArray(value) ? value.includes(input.value) : value === input.value;
  }
  $('budget').value = draft.budget;
  for (const input of form.querySelectorAll('textarea')) {
    input.value = draft.notes[input.name];
    updateNote(input);
  }
  updatePlaceCount();
}

function updateNote(input) {
  input.closest('details').querySelector('.note-saved').hidden = !input.value.trim();
}

function updatePlaceCount() {
  const names = places.filter((place) => draft.mustVisit.includes(place.id)).map((place) => place.name);
  $('places-summary').textContent = names.length ? names.join(', ') : 'Chọn địa điểm mẫu';
}

function slotWindow(date, period) {
  return draft.days[date]?.[period.id] ?? { enabled: false, start: period.start, end: period.end };
}

function timeField(date, period, bound, label, value) {
  const id = `${bound}-${date}-${period.id}`;
  return `<div class="field time-field">
    <label for="${id}">${label}<span class="sr-only"> buổi ${period.label.toLowerCase()} ngày ${shortDate(date)}</span></label>
    <input type="time" id="${id}" data-date="${date}" data-period="${period.id}" data-bound="${bound}" value="${value}" aria-describedby="error-${id}">
    <p class="field-error" id="error-${id}" hidden></p>
  </div>`;
}

function dayMarkup(date) {
  const dateLabel = `${weekday(date)} · ${shortDate(date)}`;
  const chosen = periods.filter((period) => slotWindow(date, period).enabled);
  return `<div class="day-card" id="day-${date}">
    <fieldset class="day-top">
      <legend class="sr-only">${dateLabel}</legend>
      <div class="day-name" aria-hidden="true"><strong>${weekday(date)}</strong><time datetime="${date}">${shortDate(date)}</time></div>
      <div class="day-options">
        ${periods.map((period) => `<label class="choice slot-choice">
          <input type="checkbox" id="pick-${date}-${period.id}" data-date="${date}" data-period="${period.id}" ${slotWindow(date, period).enabled ? 'checked' : ''}>
          <span>${icon(period.icon)}${period.label}</span>
        </label>`).join('')}
      </div>
    </fieldset>
    ${chosen.map((period) => {
      const window = slotWindow(date, period);
      return `<div class="time-band">
        <span class="time-band-name">${icon(period.icon)}${period.label}</span>
        ${timeField(date, period, 'start', 'Từ', window.start)}
        ${timeField(date, period, 'end', 'Đến', window.end)}
      </div>`;
    }).join('')}
    ${chosen.length
      ? `<button type="button" class="day-clear" data-day-clear="${date}" aria-label="Bỏ các buổi ngày ${shortDate(date)}">Nghỉ cả ngày</button>`
      : '<p class="day-off">Nghỉ cả ngày</p>'}
  </div>`;
}

function activeSlotCount() {
  const first = dateIndex(draft.startDate);
  const last = dateIndex(draft.endDate);
  return Object.entries(draft.days)
    .filter(([date]) => first <= dateIndex(date) && dateIndex(date) <= last)
    .reduce((count, [, day]) => count + Object.values(day).filter((slot) => slot.enabled).length, 0);
}

function updateSlotCount() {
  $('slot-count').textContent = `${activeSlotCount()} buổi đã chọn`;
}

function renderDays() {
  updateSlotCount();
  const first = dateIndex(draft.startDate);
  const last = dateIndex(draft.endDate);
  if (!(first <= last)) {
    days.innerHTML = '<p class="empty-inline">Chọn khoảng ngày để thấy các buổi có thể lên lịch.</p>';
    return;
  }

  const count = last - first + 1;
  const lastPage = Math.floor((count - 1) / dayPageSize);
  dayPage = Math.max(0, Math.min(dayPage, lastPage));
  const offset = dayPage * dayPageSize;
  const visible = Math.min(dayPageSize, count - offset);
  days.innerHTML = Array.from({ length: visible }, (_, index) => dayMarkup(dateAt(first + offset + index))).join('');
  if (lastPage) {
    days.insertAdjacentHTML('beforeend', `<div class="day-pagination">
      <button type="button" class="text-button" data-page="-1" ${dayPage === 0 ? 'disabled' : ''}>Ngày trước</button>
      <span>Ngày ${currency.format(offset + 1)}–${currency.format(offset + visible)} / ${currency.format(count)}</span>
      <button type="button" class="text-button" data-page="1" ${dayPage === lastPage ? 'disabled' : ''}>Ngày sau</button>
    </div>`);
  }
  renderErrors();
}

function syncDraft() {
  $('arrival').value = draft.startDate;
  $('departure').value = draft.endDate;
  renderDays();
  renderPreferences();
}

function renderErrors() {
  const banner = $('form-errors');
  const entries = Object.entries(errors);
  banner.hidden = !entries.length;
  banner.innerHTML = entries.length ? `<p><strong>Kiểm tra lại thông tin chuyến đi</strong></p>
    <ul>${entries.map(([field, message]) => `<li><a href="#${field}" data-error-link="${field}">${message}</a></li>`).join('')}</ul>` : '';

  for (const message of form.querySelectorAll('.field-error')) {
    const field = message.id.slice(6);
    const text = errors[field];
    const input = $(field);
    message.textContent = text ?? '';
    message.hidden = !text;
    const controls = field === 'transport' ? form.querySelectorAll('input[name="transport"]') : [input];
    for (const control of controls) {
      if (text) control?.setAttribute('aria-invalid', 'true');
      else control?.removeAttribute('aria-invalid');
    }
  }
}

function checkExistingErrors() {
  if (!Object.keys(errors).length) return;
  const countError = errors.participants;
  errors = prepareRequest(draft).errors ?? {};
  if (countError) errors.participants = countError;
  renderErrors();
}

function enteredParticipantCount() {
  return /^\d+$/.test(participants.value) ? Number(participants.value) : NaN;
}

function validateParticipants() {
  if (isParticipantCount(enteredParticipantCount())) {
    delete errors.participants;
    return true;
  }
  errors.participants = 'Nhập số người là số nguyên từ 1 trở lên.';
  return false;
}

participants.addEventListener('input', () => {
  const count = enteredParticipantCount();
  if (!isParticipantCount(count)) return;
  if (errors.participants) {
    delete errors.participants;
    renderErrors();
  }
  if (count === participantCount(activeTrip.draft)) return;
  activeTrip = trips.setParticipants(activeTrip.id, count) ?? activeTrip;
  updateTripControls();
  showStorageStatus();
  if (plan) $('trip-summary').innerHTML = summaryMarkup(reviewPlan());
});

function renderStale() {
  $('stale-notice').hidden = !plan || viewingConfirmed || JSON.stringify(draft) === appliedDraft;
}

function onDraftChange() {
  renderStale();
  save();
  if (tripLibrary.open) renderPlan();
}

form.addEventListener('input', ({ target }) => {
  if (target instanceof HTMLTextAreaElement) {
    draft.notes[target.name] = target.value;
    updateNote(target);
    onDraftChange();
  } else if (target.id === 'budget') {
    draft.budget = target.value;
    onDraftChange();
    if (plan) $('trip-summary').innerHTML = summaryMarkup(reviewPlan());
  }
});

form.addEventListener('change', ({ target }) => {
  if (!(target instanceof HTMLInputElement)) return;
  const { name, value, checked, dataset } = target;
  if (name === 'startDate' || name === 'endDate') {
    draft[name] = value;
    if (name === 'startDate') dayPage = 0;
    renderDays();
  } else if (dataset.period) {
    const { date, period, bound } = dataset;
    const previous = slotWindow(date, periodById[period]);
    draft.days[date] ??= {};
    draft.days[date][period] = bound ? { ...previous, [bound]: value } : { ...previous, enabled: checked };
    if (!bound) {
      $(`day-${date}`).outerHTML = dayMarkup(date);
      $(target.id).focus({ preventScroll: true });
      updateSlotCount();
      announce(`Đã chọn ${activeSlotCount()} buổi trong chuyến đi.`);
    }
  } else if (name === 'transport') {
    draft.transport = value;
  } else if (Array.isArray(draft[name])) {
    draft[name] = checked ? [...draft[name], value] : draft[name].filter((item) => item !== value);
    if (name === 'mustVisit') updatePlaceCount();
  } else if (name === 'budget') {
    if (plan) {
      const { overBudget } = reviewPlan();
      if (overBudget) announce(`Lịch đang vượt ngân sách ${money(overBudget)} mỗi người.`);
    }
  } else {
    return;
  }
  checkExistingErrors();
  onDraftChange();
  if (editing && !tripLibrary.open && (name === 'startDate' || name === 'endDate' || dataset.period)) renderPlan();
});

days.addEventListener('click', (event) => {
  const clear = event.target.closest('[data-day-clear]');
  if (clear) {
    const date = clear.dataset.dayClear;
    for (const window of Object.values(draft.days[date])) window.enabled = false;
    $(`day-${date}`).outerHTML = dayMarkup(date);
    $(`pick-${date}-morning`).focus({ preventScroll: true });
    updateSlotCount();
    checkExistingErrors();
    onDraftChange();
    announce(`Đã bỏ các buổi ngày ${shortDate(date)}. Còn ${activeSlotCount()} buổi đã chọn.`);
    return;
  }
  const button = event.target.closest('[data-page]');
  if (!button) return;
  dayPage += Number(button.dataset.page);
  renderDays();
  const corresponding = days.querySelector(`[data-page="${button.dataset.page}"]:enabled`);
  (corresponding ?? days.querySelector('[data-page]:enabled')).focus({ preventScroll: true });
});

function focusTripField(id) {
  if (!$(id) && /^(start|end)-\d{4}-\d{2}-\d{2}-/.test(id)) {
    const date = id.match(/\d{4}-\d{2}-\d{2}/)[0];
    dayPage = Math.floor((dateIndex(date) - dateIndex(draft.startDate)) / dayPageSize);
    renderDays();
  }
  if (id === 'transport') form.querySelector('input[name="transport"]:checked')?.focus();
  else ($(id) ?? $('sessions')).focus();
}

$('form-errors').addEventListener('click', (event) => {
  const link = event.target.closest('[data-error-link]');
  if (!link) return;
  event.preventDefault();
  focusTripField(link.dataset.errorLink);
});

$('load-example').addEventListener('click', () => {
  draft = exampleDraft();
  dayPage = 0;
  errors = {};
  renderErrors();
  syncDraft();
  renderPlan();
  onDraftChange();
  announce('Đã nạp form lịch mẫu ba ngày với hai buổi đã chọn.');
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = prepareRequest(draft);
  errors = result.errors ?? {};
  validateParticipants();
  renderErrors();
  if (Object.keys(errors).length) {
    $('form-errors').focus();
    return;
  }

  plan = createPlan(result.request);
  appliedDraft = JSON.stringify(draft);
  editing = false;
  undo = null;
  clearMove();
  onDraftChange();
  renderPlan();
  const review = reviewPlan();
  announce(`Đã xếp lịch ${review.slots.length} buổi với ${review.stopCount} điểm dừng.`);
  $('itinerary-title').focus();
});

function reviewPlan() {
  const budget = draftBudget(plan, draft);
  const prices = viewingConfirmed ? activeTrip.confirmed.prices : undefined;
  return { ...inspectPlan(plan, budget, prices), budget };
}

function warning(text) {
  return `<p class="warning">${icon('alert')}<span>${text}</span></p>`;
}

function summaryMarkup(review) {
  const count = participantCount(viewingConfirmed ? activeTrip.confirmed : activeTrip.draft);
  const groupTotal = Number.isSafeInteger(review.total) ? BigInt(review.total) * BigInt(count) : review.total * count;
  const costLabel = review.missingCostCount ? 'Chi phí đã biết' : 'Chi phí ước tính';
  const { startDate, endDate } = plan.request;
  const tripDuration = dateIndex(endDate) - dateIndex(startDate) + 1;
  const startLabel = year(startDate) === year(endDate) && startDate !== endDate
    ? shortDate(startDate)
    : `${shortDate(startDate)}/${year(startDate)}`;
  const endLabel = startDate === endDate ? '' : ` – ${shortDate(endDate)}/${year(endDate)}`;
  return `<div class="summary-card">
    <div class="summary-top">
      <span class="summary-date">${icon('calendar')}${startLabel}${endLabel}</span>
      <span class="summary-mode">${icon('walk')}Đi bộ</span>
    </div>
    <p class="summary-duration">${currency.format(tripDuration)} ngày · ${review.slots.length} buổi</p>
    <p class="summary-cost-label">${costLabel}</p>
    <div class="summary-metrics">
      <div><span>Mỗi người</span><strong class="total">${money(review.total)}</strong></div>
      <div><span>Cả nhóm · ${currency.format(count)} người</span><strong class="group-total">${money(groupTotal)}</strong></div>
    </div>
    <div class="budget-line"><span>${icon('wallet')} Ngân sách cả lịch</span><strong>${money(review.budget)} / người</strong></div>
  </div>
  ${review.missingCostCount ? warning(`Còn ${review.missingCostCount} lượt ghé chưa có giá.`) : ''}
  ${review.overBudget ? warning(`Vượt ngân sách ${money(review.overBudget)} / người. Bỏ điểm hoặc điều chỉnh ngân sách.`) : ''}
  ${review.missing.length ? warning(`Điểm muốn ghé chưa có trong lịch: ${review.missing.map((place) => place.name).join(', ')}. Thử đổi khung giờ hoặc ngân sách, hay hoàn tác nếu vừa bỏ điểm.`) : ''}`;
}

function slotName(slot) {
  return `${periodById[slot.period].label} ${shortDate(slot.date)}/${year(slot.date)}`;
}

function placementText(slot) {
  const last = slot.stops.at(-1);
  return last ? `Đặt ở cuối buổi, sau ${placeById[last.placeId].name}.` : 'Buổi đang trống. Lượt ghé sẽ ở vị trí đầu tiên.';
}

function moveForm(slot, stop, destinations) {
  if (moveSelection?.stopId !== stop.id || moveSelection.slotId !== slot.id) return '';
  const options = destinations.filter(({ id }) => id !== slot.id);
  const selected = options.find(({ id }) => id === moveSelection.toSlotId) ?? options[0];
  if (!selected) return '';

  return `<form id="timeline-move-form" class="timeline-move-form" aria-labelledby="timeline-move-title">
    <div>
      <strong id="timeline-move-title">Chuyển ${stop.place.name}</strong>
      <p id="timeline-move-source">Lượt ${clock(stop.arrival)} · ${slotName(slot)}</p>
    </div>
    <label for="timeline-move-slot">Chuyển đến buổi</label>
    <select id="timeline-move-slot" aria-describedby="timeline-move-title timeline-move-source timeline-move-position">${options.map((item) =>
      `<option value="${item.id}" ${item.id === selected.id ? 'selected' : ''}>${slotName(item)} · ${clock(item.start)}–${clock(item.end)}</option>`).join('')}</select>
    <p id="timeline-move-position" role="status">${placementText(selected)}</p>
    <div class="timeline-move-actions">
      <button type="submit" class="primary-button">Chuyển lượt ghé</button>
      <button type="button" id="timeline-move-cancel" class="text-button">Hủy</button>
    </div>
  </form>`;
}

function moveErrorMarkup() {
  return `<div id="timeline-move-error" class="error-box" role="alert" tabindex="-1">
    <strong>Chưa chuyển lượt ghé. Bản nháp vẫn giữ nguyên.</strong>
    <ul>${moveFeedback.messages.map((message) => `<li>${message}</li>`).join('')}</ul>
  </div>`;
}

function dropMarkup(slot, eligible, stop) {
  const label = stop ? `Thả trước ${stop.place.name}` : slot.stops.length ? 'Thả ở cuối buổi' : 'Thả vào buổi trống';
  return `<li class="timeline-drop${eligible ? ' timeline-drop-target' : ''}" data-drop-slot="${slot.id}" data-before-stop="${stop?.id ?? ''}" aria-hidden="true">${label}</li>`;
}

function stopMarkup(slot, stop, index, opened, destinations) {
  const { place, arrival, departure, walkToNext, wait, issues } = stop;
  const cost = placeCost(place.id, viewingConfirmed ? activeTrip.confirmed.prices : undefined);
  const hours = openingHours(place, slot.date)
    .map((window) => `${window.start}–${window.end}`).join(', ') || (place.hours?.length ? 'Đóng cửa hôm đó' : 'Chưa có giờ mở cửa');
  const area = areas.find((item) => item.id === place.area).label;
  const showMove = moveSelection?.stopId === stop.id && moveSelection.slotId === slot.id;
  return `<li class="stop" data-visit="${stop.id}">
    <div class="stop-row">
      <time class="stop-time" aria-label="Đến lúc ${clock(arrival)}">${clock(arrival)}</time>
      <span class="stop-icon tone-${place.icon}">${icon(place.icon)}</span>
      <details class="stop-place" data-detail="${stop.id}" ${opened.has(stop.id) ? 'open' : ''}>
        <summary>
          <span class="stop-description"><strong>${place.name}</strong><span>${place.category} · ${area}</span></span>
          <span class="stop-chevron">${icon('chevron')}</span>
        </summary>
        <dl>
          <div><dt>Giờ mở cửa mẫu</dt><dd>${hours}</dd></div>
          <div><dt>Giờ rời điểm</dt><dd>${clock(departure)}</dd></div>
          <div><dt>Thời lượng ghé</dt><dd>${place.duration} phút</dd></div>
          ${place.crowd ? `<div><dt>Độ đông mẫu</dt><dd>${place.crowd}</dd></div>` : ''}
        </dl>
      </details>
      <span class="stop-price">${cost === null ? 'Chưa có giá' : cost ? money(cost) : 'Miễn phí'}</span>
    </div>
    ${issues.map((issue) => warning(stopIssue(issue))).join('')}
    ${wait ? `<p class="stop-wait">${icon('clock')} ${stop.fixedStart === undefined ? 'Chờ mở cửa' : 'Chờ đến giờ cố định'} ${wait} phút</p>` : ''}
    ${editing ? `<div class="stop-actions" role="group" aria-label="Sửa ${place.name}">
      <span class="timeline-grip" draggable="true" data-drag-slot="${slot.id}" data-drag-stop="${stop.id}" aria-hidden="true" title="Kéo ${place.name}">${icon('grip')} Kéo</span>
      ${editButton('up', 'Lên', slot, stop, index === 0)}
      ${editButton('down', 'Xuống', slot, stop, index === slot.stops.length - 1)}
      ${editButton('remove', 'Bỏ', slot, stop)}
      ${destinations.some(({ id }) => id !== slot.id) ? `<button type="button" data-action="transfer" data-slot="${slot.id}" data-stop="${stop.id}" aria-label="Chuyển ${place.name} sang buổi khác" aria-expanded="${showMove}" ${showMove ? 'aria-controls="timeline-move-form"' : ''}>${icon('route')}Chuyển sang buổi…</button>` : ''}
      <button type="button" data-action="replace" data-slot="${slot.id}" data-stop="${stop.id}" aria-haspopup="dialog" aria-label="Thay địa điểm ${place.name}">${icon('edit')}Thay địa điểm</button>
    </div>` : ''}
    ${moveFeedback?.stopId === stop.id && moveFeedback.slotId === slot.id ? moveErrorMarkup() : ''}
    ${editing ? moveForm(slot, stop, destinations) : ''}
    ${walkToNext ? `<p class="walk-leg">${icon('walk')} ${walkToNext} phút đi bộ đến điểm kế</p>` : ''}
  </li>`;
}

function stopIssue(issue) {
  if (issue.code === 'opening') return 'Lượt ghé nằm ngoài giờ mở cửa mẫu.';
  if (issue.code === 'fixed') return `Không thể đến đúng giờ cố định ${clock(issue.start)}. Sớm nhất là ${clock(issue.ready)}.`;
  return `Vượt giờ kết thúc buổi (${clock(issue.end)}).`;
}

function editButton(action, label, slot, stop, disabled = false) {
  return `<button type="button" data-action="${action}" data-slot="${slot.id}" data-stop="${stop.id}" aria-label="${label === 'Bỏ' ? 'Bỏ' : 'Chuyển ' + label.toLowerCase()} ${stop.place.name}" ${disabled ? 'disabled' : ''}>
    ${icon(action === 'remove' ? 'trash' : action)}${label}
  </button>`;
}

function slotMarkup(slot, opened, destinations, librarySlot) {
  const period = periodById[slot.period];
  let shortage = '';
  if (!slot.stops.length) shortage = 'Buổi này chưa có điểm ghé.';
  else if (slot.freeMinutes >= 45) shortage = `Dữ liệu demo còn để trống ${slot.freeMinutes} phút trong buổi này.`;

  const eligible = destinations.some(({ id }) => id === slot.id);
  const stops = slot.stops.map((stop, index) =>
    `${editing ? dropMarkup(slot, eligible, stop) : ''}${stopMarkup(slot, stop, index, opened, destinations)}`).join('');
  return `<section class="timeline-slot" aria-labelledby="label-${slot.id}">
    <div class="timeline-slot-heading">
      <h4 id="label-${slot.id}">${icon(period.icon)}${period.label}</h4>
      <span>${clock(slot.start)}–${clock(slot.end)}</span>
    </div>
    ${stops || editing ? `<ol class="stops" ${!stops ? 'aria-hidden="true"' : ''}>${stops}${editing ? dropMarkup(slot, eligible) : ''}</ol>` : ''}
    ${librarySlot ? `<div class="trip-library-drop" data-library-slot="${slot.id}" aria-hidden="true">
      <strong>Thả ở cuối buổi</strong><span>${slotLabel(librarySlot)}</span>
    </div>` : ''}
    ${shortage ? warning(shortage) : ''}
    ${slot.freeMinutes > 0 && (!shortage || !slot.stops.length) ? `<p class="slot-slack">Còn ${slot.freeMinutes} phút linh động</p>` : ''}
    ${undo?.slotId === slot.id ? `<div class="undo-area">
      <span>Đã bỏ điểm khỏi lịch.</span>
      <button class="text-button" type="button" id="undo-edit">Hoàn tác</button>
    </div>` : ''}
  </section>`;
}

function renderPlan() {
  const librarySlots = tripLibrary.sync(activeTrip, draft, plan, viewingConfirmed);
  const empty = $('empty-plan');
  empty.hidden = !!plan || !!librarySlots.length;
  empty.textContent = tripLibrary.open ? 'Thiết lập ngày và buổi để thêm địa điểm vào lịch.'
    : 'Chọn ngày và buổi, rồi bấm Xếp lịch đi bộ để tạo lịch cho chuyến này.';
  $('edit-plan').hidden = !plan || viewingConfirmed;
  $('timeline-edit-hint').hidden = !editing;
  if (!plan && !librarySlots.length) {
    $('trip-summary').replaceChildren();
    timeline.replaceChildren();
    renderStale();
    return;
  }

  const review = plan ? reviewPlan() : null;
  const scheduled = review?.slots ?? [];
  const opened = new Set(Array.from(timeline.querySelectorAll('details[open]'), (detail) => detail.dataset.detail));
  const destinations = editing && plan ? moveDestinations(plan, draft) : [];
  const libraryById = new Map(librarySlots.map((slot) => [slot.id, slot]));
  const existing = new Set(scheduled.map(({ id }) => id));
  const unscheduled = new Map([...librarySlots, ...destinations].filter(({ id }) => !existing.has(id)).map((slot) => [slot.id, slot]));
  const added = Array.from(unscheduled.values(), (slot) => ({ ...slot, stops: [], freeMinutes: slot.end - slot.start }));
  const visibleSlots = [...scheduled, ...added].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const grouped = Object.groupBy(visibleSlots, (slot) => slot.date);
  $('edit-plan').setAttribute('aria-pressed', editing);
  $('edit-plan').disabled = !review?.stopCount && !editing;
  $('edit-label').textContent = editing ? 'Xong' : 'Chỉnh sửa';
  $('trip-summary').innerHTML = review ? summaryMarkup(review) : '';
  timeline.innerHTML = Object.entries(grouped).map(([date, slots]) => `
    <article class="timeline-day" aria-labelledby="title-${date}">
      <div class="timeline-day-heading">
        <span class="day-number" aria-hidden="true">${date.slice(8, 10)}</span>
        <div>
          <h3 id="title-${date}">${weekday(date)} <time datetime="${date}" class="sr-only">ngày ${shortDate(date)}</time></h3>
          <p>Tháng ${Number(date.slice(5, 7))} · ${slots.length} buổi</p>
        </div>
      </div>
      ${slots.map((slot) => slotMarkup(slot, opened, destinations, libraryById.get(slot.id))).join('')}
    </article>`).join('');
  if (moveFeedback && !$('timeline-move-error')) timeline.insertAdjacentHTML('afterbegin', moveErrorMarkup());
  renderStale();
}

$('edit-plan').addEventListener('click', () => {
  editing = !editing;
  clearMove();
  renderPlan();
  announce(editing ? 'Đang chỉnh sửa. Có thể đổi thứ tự, chuyển sang buổi khác hoặc bỏ lượt ghé.' : 'Đã đóng chế độ chỉnh sửa.');
});

function finishDrag() {
  draggedVisit = null;
  timeline.classList.remove('is-dragging');
  timeline.querySelector('.timeline-drop-active')?.classList.remove('timeline-drop-active');
  timeline.querySelector('.timeline-drag-source')?.classList.remove('timeline-drag-source');
  timeline.querySelector('.timeline-drag-origin')?.classList.remove('timeline-drag-origin');
}

function clearMove() {
  moveSelection = null;
  moveFeedback = null;
  finishDrag();
}

function moveConflictText(issue) {
  const slot = slotName(issue.slot);
  switch (issue.code) {
    case 'fixed-date': return `${slot} không cùng ngày với giờ cố định ${clock(issue.start)} của ${issue.placeName} ở buổi ${slotName(issue.source)}.`;
    case 'overlap': return `Khung giờ buổi ${slot} trùng với buổi ${slotName(issue.other)} đã có trong nháp.`;
    case 'fixed': return `Ở buổi ${slot}, sớm nhất có thể đến ${issue.placeName} lúc ${clock(issue.ready)}, sau giờ cố định ${clock(issue.start)}.`;
    case 'window': return `Ở buổi ${slot}, ${issue.placeName} dự kiến kết thúc lúc ${clock(issue.departure)}, sau giờ kết thúc buổi ${clock(issue.end)}.`;
  }
}

function renderEditedTrip(trip) {
  const formChanged = JSON.stringify(draft) !== JSON.stringify(trip.draft.form);
  activeTrip = trip;
  ({ form: draft, plan, appliedDraft, undo } = activeTrip.draft);
  clearMove();
  if (formChanged) syncDraft();
  updateTripControls();
  showStorageStatus();
  renderSavedPlaces();
  renderPlan();
}

function performMove(command, action) {
  if (!editing || viewingConfirmed) return;
  const result = trips.moveVisit(activeTrip.id, command);
  if (result.unchanged) return;
  if (!result.trip) {
    moveFeedback = {
      ...command,
      messages: result.conflicts?.map(moveConflictText) ?? ['Vị trí hoặc lượt ghé đã thay đổi. Hãy tải lại bản nháp rồi thử lại.'],
    };
    renderPlan();
    $('timeline-move-error').focus();
    return;
  }

  renderEditedTrip(result.trip);

  const slot = plan.slots.find((item) => item.id === (command.toSlotId ?? command.slotId));
  const place = placeById[slot.stops.find((stop) => stop.id === command.stopId).placeId];
  if (action) {
    const controls = [...timeline.querySelectorAll(`[data-stop="${command.stopId}"]:enabled`)];
    (controls.find((button) => button.dataset.action === action) ?? controls[0])?.focus({ preventScroll: true });
  } else timeline.querySelector(`[data-detail="${command.stopId}"] summary`)?.focus();
  const review = reviewPlan();
  const warnings = review.slots.flatMap((item) => item.stops.flatMap((stop) => stop.issues)).length + Number(review.overBudget > 0);
  const message = slot.id === command.slotId ? 'Đã đổi thứ tự.' : `Đã chuyển ${place.name} sang buổi ${slotName(slot)}.`;
  announce(`${message} Lịch hiện có ${review.stopCount} điểm.${warnings ? ` Có ${warnings} cảnh báo về giờ hoặc ngân sách.` : ''}`);
}

function toggleMoveForm(control) {
  const { slot, stop } = control.dataset;
  const opened = moveSelection?.slotId === slot && moveSelection.stopId === stop;
  clearMove();
  if (!opened) moveSelection = { slotId: slot, stopId: stop };
  renderPlan();
  ($('timeline-move-slot') ?? timeline.querySelector(`[data-action="transfer"][data-stop="${stop}"]`))?.focus();
}

timeline.addEventListener('click', (event) => {
  if (event.target.closest('#timeline-move-cancel')) {
    const trigger = timeline.querySelector('[data-action="transfer"][aria-expanded="true"]');
    if (trigger) toggleMoveForm(trigger);
    return;
  }
  if (event.target.closest('#undo-edit')) {
    const { plan: previous, stopId } = undo;
    plan = previous;
    undo = null;
    clearMove();
    save();
    renderPlan();
    const restored = timeline.querySelector(`[data-stop="${stopId}"][data-action="remove"]`);
    (restored ?? timeline.querySelector(`[data-detail="${stopId}"] summary`))?.focus();
    announce('Đã khôi phục điểm vừa bỏ.');
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control || !editing) return;
  const { action, slot: slotId, stop: stopId } = control.dataset;
  if (action === 'transfer') {
    toggleMoveForm(control);
    return;
  }
  if (action === 'replace') {
    clearMove();
    renderPlan();
    if (!replacement.open(activeTrip.id, slotId, stopId)) {
      const latest = trips.get(activeTrip.id);
      if (latest) renderEditedTrip(latest);
      $('edit-plan').focus();
      announce('Lượt ghé đã thay đổi. Hãy chọn lại trên timeline.');
    }
    return;
  }
  const slot = plan.slots.find((item) => item.id === slotId);
  const oldIndex = slot.stops.findIndex((stop) => stop.id === stopId);
  if (action !== 'remove') {
    performMove({ slotId, stopId, toIndex: oldIndex + (action === 'up' ? -1 : 1) }, action);
    return;
  }
  clearMove();
  undo = { slotId, stopId, plan };
  plan = applyEdit(plan, { type: 'remove', slotId, stopId });
  save();
  renderPlan();
  $('undo-edit').focus();
  const review = reviewPlan();
  const issues = review.slots.flatMap((item) => item.stops.flatMap((stop) => stop.issues)).length;
  const flags = issues + Number(review.overBudget > 0);
  announce(`Đã bỏ điểm. Lịch hiện có ${review.stopCount} điểm.${flags ? ` Có ${flags} cảnh báo về giờ hoặc ngân sách.` : ''}`);
});

timeline.addEventListener('change', ({ target }) => {
  if (target.id !== 'timeline-move-slot' || !moveSelection) return;
  moveSelection.toSlotId = target.value;
  moveFeedback = null;
  $('timeline-move-error')?.remove();
  const slot = moveDestinations(plan, draft).find((item) => item.id === target.value);
  if (slot) $('timeline-move-position').textContent = placementText(slot);
});

timeline.addEventListener('submit', (event) => {
  if (event.target.id !== 'timeline-move-form' || !moveSelection) return;
  event.preventDefault();
  moveSelection.toSlotId = $('timeline-move-slot').value;
  performMove(moveSelection);
});

timeline.addEventListener('dragstart', (event) => {
  const handle = event.target.closest('[data-drag-stop]');
  if (!handle || !editing || viewingConfirmed) return;
  draggedVisit = { slotId: handle.dataset.dragSlot, stopId: handle.dataset.dragStop };
  const row = handle.closest('.stop');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-nonla-visit', draggedVisit.stopId);
  event.dataTransfer.setDragImage(row.querySelector('.stop-row'), 16, 22);
  row.classList.add('timeline-drag-source');
  handle.closest('.timeline-slot').classList.add('timeline-drag-origin');
  timeline.classList.add('is-dragging');
});

timeline.addEventListener('dragover', (event) => {
  if (!draggedVisit) return;
  const zone = event.target.closest('[data-drop-slot]');
  timeline.querySelector('.timeline-drop-active')?.classList.remove('timeline-drop-active');
  if (!zone) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  zone.classList.add('timeline-drop-active');
});

timeline.addEventListener('dragleave', (event) => {
  event.target.closest('.timeline-drop-active')?.classList.remove('timeline-drop-active');
});

timeline.addEventListener('drop', (event) => {
  const zone = event.target.closest('[data-drop-slot]');
  if (!zone || !draggedVisit) return;
  event.preventDefault();
  const command = { ...draggedVisit, toSlotId: zone.dataset.dropSlot, beforeStopId: zone.dataset.beforeStop };
  finishDrag();
  performMove(command);
});
timeline.addEventListener('dragend', finishDrag);

function tripHash(id, confirmed = false, returnHref) {
  const path = `#trip/${id}${confirmed ? '/confirmed' : ''}`;
  return returnHref ? `${path}?${new URLSearchParams({ library: returnHref })}` : path;
}

function savedPlacesHash(id) {
  return `${tripHash(id)}?saved=1`;
}

function renderSavedPlaces() {
  const { id, savedPlaceIds } = activeTrip;
  $('trip-saved-library').href = tripLibraryHref(id);
  $('trip-saved-empty').hidden = !!savedPlaceIds.length;
  $('trip-saved-list').replaceChildren(...savedPlaceIds.map((placeId) => {
    const place = placeById[placeId];
    const item = $('trip-saved-item').content.firstElementChild.cloneNode(true);
    const details = item.querySelector('.trip-saved-place');
    details.href = tripLibraryHref(id, placeId);
    details.querySelector('.trip-saved-icon').innerHTML = icon(place.icon);
    details.querySelector('strong').textContent = place.name;
    const area = areas.find((entry) => entry.id === place.area)?.label;
    details.querySelector('small').textContent = [place.category, area].filter(Boolean).join(' · ');
    const add = item.querySelector('.trip-saved-add');
    add.href = tripLibraryHref(id, placeId, true);
    add.textContent = viewingConfirmed ? 'Thêm vào nháp' : 'Thêm vào lịch';
    add.setAttribute('aria-label', `Thêm ${place.name} ${viewingConfirmed ? 'vào nháp' : 'vào lịch'}`);
    const remove = item.querySelector('.trip-saved-remove');
    remove.dataset.placeId = placeId;
    remove.setAttribute('aria-label', `Bỏ lưu ${place.name}`);
    return item;
  }));
}

$('trip-saved-list').addEventListener('click', (event) => {
  const button = event.target.closest('.trip-saved-remove');
  if (!button || !activeTrip) return;
  const { placeId } = button.dataset;
  const index = activeTrip.savedPlaceIds.indexOf(placeId);
  const trip = trips.setSavedPlace(activeTrip.id, placeId, false);
  if (!trip) return;
  activeTrip = trip;
  renderSavedPlaces();
  showStorageStatus();
  const remaining = $('trip-saved-list').querySelectorAll('.trip-saved-remove');
  (remaining[Math.min(index, remaining.length - 1)] ?? $('trip-saved-title')).focus();
  announce(`Đã bỏ lưu ${placeById[placeId].name}.`);
});

function tripDates(trip) {
  const { startDate, endDate } = trip.draft.form;
  const first = Number.isInteger(dateIndex(startDate)) ? `${shortDate(startDate)}/${year(startDate)}` : '';
  const last = Number.isInteger(dateIndex(endDate)) ? `${shortDate(endDate)}/${year(endDate)}` : '';
  if (first && last) return first === last ? first : `${first} – ${last}`;
  if (first) return `Đến ${first}`;
  if (last) return `Rời ${last}`;
  return 'Chưa chọn ngày';
}

function tripStatus(trip) {
  if (hasDraftChanges(trip)) return 'Đã chốt · Có nháp';
  return trip.confirmed ? 'Đã chốt' : 'Nháp';
}

function renderHome() {
  const [recent] = trips.list();
  $('home-recent').hidden = !recent;
  if (!recent) return;

  const slots = recent.draft.plan?.slots;
  const details = slots
    ? `${slots.length} buổi · ${slots.reduce((count, slot) => count + slot.stops.length, 0)} điểm đã xếp`
    : tripDates(recent);
  const href = tripHash(recent.id);
  $('recent-trip-link').href = href;
  $('recent-trip-name').textContent = recent.name;
  $('recent-trip-details').textContent = `${tripStatus(recent)} · ${details}`;
}

function renderTripList() {
  const allTrips = trips.list();
  $('empty-trips').hidden = allTrips.length > 0;
  $('trip-list').hidden = allTrips.length === 0;
  $('trip-list').replaceChildren(...allTrips.map((trip) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'trip-card';
    link.href = tripHash(trip.id);
    link.dataset.tripId = trip.id;
    link.innerHTML = `<span class="section-icon">${icon('calendar')}</span>
      <span class="trip-card-info"><strong></strong><span></span></span>
      <span class="trip-card-status"></span>`;
    link.querySelector('strong').textContent = trip.name;
    link.querySelector('.trip-card-info > span').textContent = tripDates(trip);
    const status = link.querySelector('.trip-card-status');
    status.textContent = tripStatus(trip);
    if (trip.confirmed) status.classList.add('is-confirmed');
    item.append(link);
    return item;
  }));
}

function updateTripControls() {
  const { id, name, confirmed } = activeTrip;
  const changed = hasDraftChanges(activeTrip);
  $('trip-title').textContent = name;
  $('version-links').hidden = !confirmed;
  $('draft-link').href = tripHash(id, false, libraryReturn?.href);
  $('confirmed-link').href = tripHash(id, true, libraryReturn?.href);
  $('draft-link').setAttribute('aria-current', viewingConfirmed ? 'false' : 'page');
  $('confirmed-link').setAttribute('aria-current', viewingConfirmed ? 'page' : 'false');
  $('draft-changed').hidden = !changed;
  $('confirm-plan').hidden = viewingConfirmed || !plan;
  $('confirm-plan').disabled = Boolean(confirmed) && !changed;
  $('confirm-label').textContent = confirmed ? 'Cập nhật lịch đã chốt' : 'Chốt lịch';
  document.title = `${name} — NonLa Wander`;
}

function toggleRename(show) {
  $('rename-form').hidden = !show;
  $('rename-trip').setAttribute('aria-expanded', show);
  if (show) {
    $('trip-name').value = activeTrip.name;
    $('trip-name').select();
    $('trip-name').focus();
  }
}

function renderRoute(focus = false, previousHash = '') {
  replacement.close();
  tripLibrary.close();
  const previousId = activeTrip?.id;
  const { hash } = location;
  const [path, search] = hash.split('?', 2);
  const params = new URLSearchParams(search);
  const route = path.match(/^#trip\/([a-z0-9-]+)(\/confirmed)?$/);
  activeTrip = route ? trips.get(route[1]) : null;
  libraryReturn = activeTrip ? getLibraryReturn(params.get('library')) : null;
  const showProjects = !activeTrip && (hash === '#trips' || hash.startsWith('#trip/'));
  const showLibrary = /^#library(?:[/?]|$)/.test(hash);
  const showHome = !activeTrip && !showProjects && !showLibrary;
  viewingConfirmed = Boolean(route?.[2] && activeTrip?.confirmed);
  document.body.classList.toggle('is-home', showHome);
  document.body.classList.toggle('is-library', showLibrary);
  $('home-view').hidden = !showHome;
  $('trip-list-view').hidden = !showProjects;
  $('trip-header').hidden = !activeTrip;
  $('trip-saved').hidden = !activeTrip;
  $('trip-workspace').hidden = !activeTrip;
  $('site-footer').hidden = showHome || showLibrary;
  $('home-link').setAttribute('aria-current', showHome ? 'page' : 'false');
  $('trips-link').setAttribute('aria-current', showProjects ? 'page' : activeTrip ? 'location' : 'false');
  $('library-link').setAttribute('aria-current', showLibrary ? (hash.startsWith('#library/') ? 'location' : 'page') : 'false');
  if (!showLibrary) {
    $('library-view').hidden = true;
    $('library-detail').hidden = true;
  }

  if (activeTrip) {
    if (route[2] && !viewingConfirmed) history.replaceState(null, '', tripHash(activeTrip.id, false, libraryReturn?.href));
    const state = viewingConfirmed ? activeTrip.confirmed : activeTrip.draft;
    ({ form: draft, plan, appliedDraft, undo } = structuredClone(state));
    editing = false;
    clearMove();
    dayPage = 0;
    errors = !viewingConfirmed && libraryReturn?.place ? prepareRequest(draft).errors ?? {} : {};
    toggleRename(false);
    $('planner').hidden = viewingConfirmed;
    $('trip-workspace').classList.toggle('confirmed-workspace', viewingConfirmed);
    $('itinerary-title').textContent = viewingConfirmed ? 'Lịch đã chốt' : 'Lịch nháp';
    $('trip-version-guidance').textContent = viewingConfirmed ? 'Mở Nháp để chỉnh tiếp lịch.' : 'Nháp tự lưu trên trình duyệt này.';
    if (!viewingConfirmed) {
      participants.value = participantCount(state);
      for (const detail of form.querySelectorAll('details[open]')) detail.open = false;
      syncDraft();
      renderErrors();
    }
    timeline.replaceChildren();
    updateTripControls();
    renderTripLibraryContext();
    renderSavedPlaces();
    renderPlan();
    if (focus) {
      if (!viewingConfirmed && libraryReturn?.place) {
        const firstError = Object.keys(errors)[0];
        const field = firstError ?? libraryReturn.field ?? 'sessions';
        focusTripField(field);
      } else $(params.get('saved') === '1' ? 'trip-saved-title' : 'trip-title').focus();
    }
  } else if (showProjects) {
    if (hash !== '#trips') history.replaceState(null, '', '#trips');
    document.title = 'My Projects · NonLa Wander';
    renderTripList();
    if (focus) {
      const previous = previousId && $('trip-list').querySelector(`[data-trip-id="${previousId}"]`);
      (previous || $('trip-list-title')).focus();
    }
  } else if (showLibrary) {
    renderLibrary(hash, focus, previousHash, renderLibraryActions, savedPlacesHash);
  } else {
    document.title = 'Home · NonLa Wander';
    renderHome();
    if (focus) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      $('home-title').focus({ preventScroll: true });
    }
    updateHomePhoto();
  }
  showStorageStatus();
}

function renderTripLibraryContext() {
  const added = addedVisitNotice?.tripId === activeTrip.id ? addedVisitNotice.placeName : '';
  addedVisitNotice = null;
  $('trip-library-context').hidden = !libraryReturn && !added;
  $('trip-library-message').hidden = !added;
  $('trip-library-message').textContent = added ? `Đã thêm ${added} vào bản nháp.` : '';
  $('trip-library-return').hidden = !libraryReturn;
  if (!libraryReturn) return;
  const link = $('trip-library-return');
  link.href = libraryReturn.href;
  link.textContent = libraryReturn.place ? `Tiếp tục thêm ${libraryReturn.place.name}` : 'Quay về danh sách Library';
}

function createTrip(resume) {
  const trip = trips.create();
  location.hash = tripHash(trip.id, false, resume?.(trip.id));
  announce('Đã tạo chuyến đi mới.');
}

for (const button of document.querySelectorAll('[data-create-trip]')) {
  button.addEventListener('click', () => createTrip());
}

const renderLibraryActions = setupLibraryActions({
  trips, createTrip, tripHash, savedPlacesHash, showStorageStatus,
  showAdded(tripId, placeName, returnHref) {
    addedVisitNotice = { tripId, placeName };
    location.hash = tripHash(tripId, false, returnHref);
  },
});

const replacement = setupReplacement({
  trips,
  onSaved(trip, placeName) {
    renderEditedTrip(trip);
    announce(`Đã thay địa điểm trong bản nháp bằng ${placeName}.`);
  },
  focusVisit({ tripId, slotId, stopId }) {
    if (activeTrip?.id !== tripId || !editing || viewingConfirmed) return;
    const latest = trips.get(tripId);
    if (latest && JSON.stringify(latest) !== JSON.stringify(activeTrip)) renderEditedTrip(latest);
    (timeline.querySelector(`[data-action="replace"][data-slot="${slotId}"][data-stop="${stopId}"]`) ?? $('edit-plan')).focus();
  },
});

const tripLibrary = setupTripLibrary({
  trips,
  refresh: renderPlan,
  changeLayout(open) {
    const workspace = $('trip-workspace');
    const planner = $('planner');
    workspace.classList.toggle('trip-library-workspace', open);
    if (open) workspace.append(planner);
    else workspace.prepend(planner);
  },
  focusSetup(validation) {
    errors = validation;
    renderErrors();
    focusTripField(Object.keys(validation)[0] ?? 'sessions');
  },
  onAdded: renderEditedTrip,
});

$('rename-trip').addEventListener('click', () => toggleRename($('rename-form').hidden));
$('trip-name').addEventListener('input', (event) => {
  activeTrip = trips.rename(activeTrip.id, event.target.value) ?? activeTrip;
  updateTripControls();
  showStorageStatus();
});
$('rename-form').addEventListener('submit', (event) => {
  event.preventDefault();
  toggleRename(false);
  $('rename-trip').focus();
});

$('confirm-plan').addEventListener('click', () => {
  if (!validateParticipants()) {
    renderErrors();
    participants.focus();
    return;
  }
  const wasConfirmed = Boolean(activeTrip.confirmed);
  const saved = trips.confirm(activeTrip.id);
  if (!saved) return;
  activeTrip = saved;
  location.hash = tripHash(activeTrip.id, true, libraryReturn?.href);
  announce(wasConfirmed ? 'Đã cập nhật lịch đã chốt.' : 'Đã chốt lịch.');
});

document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  $('main-content').focus();
});
window.addEventListener('hashchange', (event) => renderRoute(true, new URL(event.oldURL).hash));
trips.migrateLegacy();
renderRoute();

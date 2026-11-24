import { areas, exampleDraft, periodById, periods, places, transports, vibes } from './data.js';
import { icon } from './icons.js';
import { applyEdit, clock, createPlan, dateAt, dateIndex, inspectPlan, openingHours, prepareRequest, weekday } from './planner.js';
import { createTripStore, hasDraftChanges } from './trips.js';

const $ = (id) => document.getElementById(id);
const form = $('trip-form');
const days = $('day-list');
const timeline = $('timeline');
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
  errors = prepareRequest(draft).errors ?? {};
  renderErrors();
}

function renderStale() {
  $('stale-notice').hidden = !plan || viewingConfirmed || JSON.stringify(draft) === appliedDraft;
}

function onDraftChange() {
  renderStale();
  save();
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

$('form-errors').addEventListener('click', (event) => {
  const link = event.target.closest('[data-error-link]');
  if (!link) return;
  event.preventDefault();
  const id = link.dataset.errorLink;
  if (!$(id) && /^(start|end)-\d{4}-\d{2}-\d{2}-/.test(id)) {
    const date = id.match(/\d{4}-\d{2}-\d{2}/)[0];
    dayPage = Math.floor((dateIndex(date) - dateIndex(draft.startDate)) / dayPageSize);
    renderDays();
  }
  if (id === 'transport') form.querySelector('input[name="transport"]:checked')?.focus();
  else $(id)?.focus();
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
  renderErrors();
  if (result.errors) {
    $('form-errors').focus();
    return;
  }

  plan = createPlan(result.request);
  appliedDraft = JSON.stringify(draft);
  editing = false;
  undo = null;
  onDraftChange();
  renderPlan();
  const review = reviewPlan();
  announce(`Đã xếp lịch ${review.slots.length} buổi với ${review.stopCount} điểm dừng.`);
  $('itinerary-title').focus();
});

function reviewPlan() {
  const current = Number(draft.budget);
  const valid = String(draft.budget).trim() !== '' && Number.isSafeInteger(current) && current >= 0;
  const budget = valid ? current : plan.request.budget;
  return { ...inspectPlan(plan, budget), budget };
}

function warning(text) {
  return `<p class="warning">${icon('alert')}<span>${text}</span></p>`;
}

function summaryMarkup(review) {
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
    <div class="summary-metrics">
      <div><span>Chuyến đi</span><strong>${currency.format(tripDuration)} ngày <span>·</span> ${review.slots.length} buổi</strong></div>
      <div><span>Ước tính / người</span><strong class="total">${money(review.total)}</strong></div>
    </div>
    <div class="budget-line"><span>${icon('wallet')} Ngân sách cả lịch</span><strong>${money(review.budget)} / người</strong></div>
  </div>
  ${review.overBudget ? warning(`Vượt ngân sách ${money(review.overBudget)} / người. Bỏ điểm hoặc điều chỉnh ngân sách.`) : ''}
  ${review.missing.length ? warning(`Điểm muốn ghé chưa có trong lịch: ${review.missing.map((place) => place.name).join(', ')}. Thử đổi khung giờ hoặc ngân sách, hay hoàn tác nếu vừa bỏ điểm.`) : ''}`;
}

function stopMarkup(slot, stop, index, opened) {
  const { place, arrival, departure, walkToNext, wait, issues } = stop;
  const hours = openingHours(place, slot.date)
    .map((window) => `${window.start}–${window.end}`).join(', ') || 'Đóng cửa hôm đó';
  const area = areas.find((item) => item.id === place.area).label;
  return `<li class="stop">
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
          ${place.crowd ? `<div><dt>Độ đông mẫu</dt><dd>${place.crowd}</dd></div>` : ''}
        </dl>
      </details>
      <span class="stop-price">${place.cost ? money(place.cost) : 'Miễn phí'}</span>
    </div>
    ${issues.map(({ code, end }) => warning(code === 'opening' ? 'Lượt ghé nằm ngoài giờ mở cửa mẫu.' : `Vượt giờ kết thúc buổi (${clock(end)}).`)).join('')}
    ${wait ? `<p class="stop-wait">${icon('clock')} Chờ mở cửa ${wait} phút</p>` : ''}
    ${editing ? `<div class="stop-actions" role="group" aria-label="Sửa ${place.name}">
      ${editButton('up', 'Lên', slot, stop, index === 0)}
      ${editButton('down', 'Xuống', slot, stop, index === slot.stops.length - 1)}
      ${editButton('remove', 'Bỏ', slot, stop)}
    </div>` : ''}
    ${walkToNext === null ? '' : `<p class="walk-leg">${icon('walk')} ${walkToNext} phút đi bộ đến điểm kế</p>`}
  </li>`;
}

function editButton(action, label, slot, stop, disabled = false) {
  return `<button type="button" data-action="${action}" data-slot="${slot.id}" data-stop="${stop.id}" aria-label="${label === 'Bỏ' ? 'Bỏ' : 'Chuyển ' + label.toLowerCase()} ${stop.place.name}" ${disabled ? 'disabled' : ''}>
    ${icon(action === 'remove' ? 'trash' : action)}${label}
  </button>`;
}

function slotMarkup(slot, opened) {
  const period = periodById[slot.period];
  let shortage = '';
  if (!slot.stops.length) shortage = 'Buổi này còn trống. Chưa xếp được điểm phù hợp từ dữ liệu demo. Thử đổi giờ, ngân sách hoặc các buổi đã chọn.';
  else if (slot.freeMinutes >= 45) shortage = `Dữ liệu demo còn để trống ${slot.freeMinutes} phút trong buổi này.`;

  return `<section class="timeline-slot" aria-labelledby="label-${slot.id}">
    <div class="timeline-slot-heading">
      <h4 id="label-${slot.id}">${icon(period.icon)}${period.label}</h4>
      <span>${clock(slot.start)}–${clock(slot.end)}</span>
    </div>
    ${slot.stops.length ? `<ol class="stops">${slot.stops.map((stop, index) => stopMarkup(slot, stop, index, opened)).join('')}</ol>` : ''}
    ${shortage ? warning(shortage) : slot.freeMinutes > 0 ? `<p class="slot-slack">Còn ${slot.freeMinutes} phút linh động</p>` : ''}
    ${undo?.slotId === slot.id ? `<div class="undo-area">
      <span>Đã bỏ điểm khỏi lịch.</span>
      <button class="text-button" type="button" id="undo-edit">Hoàn tác</button>
    </div>` : ''}
  </section>`;
}

function renderPlan() {
  $('empty-plan').hidden = Boolean(plan);
  $('edit-plan').hidden = !plan || viewingConfirmed;
  if (!plan) {
    $('trip-summary').replaceChildren();
    timeline.replaceChildren();
    renderStale();
    return;
  }

  const review = reviewPlan();
  const opened = new Set(Array.from(timeline.querySelectorAll('details[open]'), (detail) => detail.dataset.detail));
  const grouped = Object.groupBy(review.slots, (slot) => slot.date);
  $('edit-plan').setAttribute('aria-pressed', editing);
  $('edit-plan').disabled = !review.stopCount && !editing;
  $('edit-label').textContent = editing ? 'Xong' : 'Chỉnh sửa';
  $('trip-summary').innerHTML = summaryMarkup(review);
  timeline.innerHTML = Object.entries(grouped).map(([date, slots]) => `
    <article class="timeline-day" aria-labelledby="title-${date}">
      <div class="timeline-day-heading">
        <span class="day-number" aria-hidden="true">${date.slice(8, 10)}</span>
        <div>
          <h3 id="title-${date}">${weekday(date)} <time datetime="${date}" class="sr-only">ngày ${shortDate(date)}</time></h3>
          <p>Tháng ${Number(date.slice(5, 7))} · ${slots.length} buổi</p>
        </div>
      </div>
      ${slots.map((slot) => slotMarkup(slot, opened)).join('')}
    </article>`).join('');
  renderStale();
}

$('edit-plan').addEventListener('click', () => {
  editing = !editing;
  renderPlan();
  announce(editing ? 'Đang chỉnh sửa. Có thể chuyển lên, xuống hoặc bỏ điểm trong cùng buổi.' : 'Đã đóng chế độ chỉnh sửa.');
});

timeline.addEventListener('click', (event) => {
  if (event.target.closest('#undo-edit')) {
    const { plan: previous, stopId } = undo;
    plan = previous;
    undo = null;
    save();
    renderPlan();
    const restored = timeline.querySelector(`[data-stop="${stopId}"][data-action="remove"]`);
    (restored ?? timeline.querySelector(`[data-detail="${stopId}"] summary`))?.focus();
    announce('Đã khôi phục điểm vừa bỏ.');
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, slot: slotId, stop: stopId } = control.dataset;
  const slot = plan.slots.find((item) => item.id === slotId);
  const oldIndex = slot.stops.findIndex((stop) => stop.id === stopId);
  if (action === 'remove') undo = { slotId, stopId, plan };
  const command = action === 'remove'
    ? { type: 'remove', slotId, stopId }
    : { type: 'move', slotId, stopId, toIndex: oldIndex + (action === 'up' ? -1 : 1) };
  plan = applyEdit(plan, command);
  if (action !== 'remove') undo = null;

  save();
  renderPlan();
  if (action === 'remove') {
    $('undo-edit').focus();
  } else {
    const controls = [...timeline.querySelectorAll(`[data-stop="${stopId}"]:enabled`)];
    const next = controls.find((button) => button.dataset.action === action) ?? controls[0];
    next?.focus({ preventScroll: true });
  }

  const review = reviewPlan();
  const issues = review.slots.flatMap((item) => item.stops.flatMap((stop) => stop.issues)).length;
  const flags = issues + Number(review.overBudget > 0);
  const actionText = action === 'remove' ? 'Đã bỏ điểm.' : 'Đã đổi thứ tự.';
  announce(`${actionText} Lịch hiện có ${review.stopCount} điểm.${flags ? ` Có ${flags} cảnh báo về giờ hoặc ngân sách.` : ''}`);
});

function tripHash(id, confirmed = false) {
  return `#trip/${id}${confirmed ? '/confirmed' : ''}`;
}

function tripDates(trip) {
  const { startDate, endDate } = trip.draft.form;
  const first = Number.isInteger(dateIndex(startDate)) ? `${shortDate(startDate)}/${year(startDate)}` : '';
  const last = Number.isInteger(dateIndex(endDate)) ? `${shortDate(endDate)}/${year(endDate)}` : '';
  if (first && last) return first === last ? first : `${first} – ${last}`;
  if (first) return `Đến ${first}`;
  if (last) return `Rời ${last}`;
  return 'Chưa chọn ngày';
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
    status.textContent = hasDraftChanges(trip) ? 'Đã chốt · Có nháp' : trip.confirmed ? 'Đã chốt' : 'Nháp';
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
  $('draft-link').href = tripHash(id);
  $('confirmed-link').href = tripHash(id, true);
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

function renderRoute(focus = false) {
  const previousId = activeTrip?.id;
  const route = location.hash.match(/^#trip\/([a-z0-9-]+)(\/confirmed)?$/);
  activeTrip = route ? trips.get(route[1]) : null;
  viewingConfirmed = Boolean(route?.[2] && activeTrip?.confirmed);
  $('trip-list-view').hidden = Boolean(activeTrip);
  $('trip-header').hidden = !activeTrip;
  $('trip-workspace').hidden = !activeTrip;
  $('trips-link').setAttribute('aria-current', activeTrip ? 'false' : 'page');

  if (activeTrip) {
    if (route[2] && !viewingConfirmed) history.replaceState(null, '', tripHash(activeTrip.id));
    const state = viewingConfirmed ? activeTrip.confirmed : activeTrip.draft;
    ({ form: draft, plan, appliedDraft, undo } = structuredClone(state));
    editing = false;
    dayPage = 0;
    errors = {};
    toggleRename(false);
    $('planner').hidden = viewingConfirmed;
    $('trip-workspace').classList.toggle('confirmed-workspace', viewingConfirmed);
    $('itinerary-title').textContent = viewingConfirmed ? 'Lịch đã chốt' : 'Lịch của bạn';
    if (!viewingConfirmed) {
      for (const detail of form.querySelectorAll('details[open]')) detail.open = false;
      syncDraft();
      renderErrors();
    }
    timeline.replaceChildren();
    updateTripControls();
    renderPlan();
    if (focus) $('trip-title').focus();
  } else {
    if (route) history.replaceState(null, '', '#trips');
    document.title = 'Lịch của tôi — NonLa Wander';
    renderTripList();
    if (focus) {
      const previous = previousId && $('trip-list').querySelector(`[data-trip-id="${previousId}"]`);
      (previous || $('trip-list-title')).focus();
    }
  }
  showStorageStatus();
}

$('create-trip').addEventListener('click', () => {
  const trip = trips.create();
  location.hash = tripHash(trip.id);
  announce('Đã tạo chuyến đi mới.');
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
  const wasConfirmed = Boolean(activeTrip.confirmed);
  const saved = trips.confirm(activeTrip.id);
  if (!saved) return;
  activeTrip = saved;
  location.hash = tripHash(activeTrip.id, true);
  announce(wasConfirmed ? 'Đã cập nhật lịch đã chốt.' : 'Đã chốt lịch.');
});

document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  $('main-content').focus();
});
window.addEventListener('hashchange', () => renderRoute(true));
trips.migrateLegacy();
renderRoute();

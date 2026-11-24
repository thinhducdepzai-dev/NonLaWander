import { areas, periodById, placeById, places } from './data.js';
import { icon } from './icons.js';
import { clock, hasKnownCost, prepareRequest } from './planner.js';

const $ = (id) => document.getElementById(id);
const query = $('library-query');
const category = $('library-category');
const results = $('library-places');
export const libraryGroups = [...new Set(places.map((place) => place.category).filter(Boolean))];
const areaLabels = new Map(areas.map((area) => [area.id, area.label]));
const currency = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const dayLabels = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

for (const label of libraryGroups) category.add(new Option(label, label));

function foldName(value) {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd').trim().replace(/\s+/g, ' ');
}

export function filterLibraryPlaces(query, group) {
  const name = foldName(query);
  return places.filter((place) => foldName(place.name).includes(name) && (!group || place.category === group));
}

function libraryHref(placeId, options = {}) {
  const params = new URLSearchParams();
  if (query.value.trim()) params.set('q', query.value.trim());
  if (category.value) params.set('group', category.value);
  for (const [key, value] of Object.entries(options)) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return `#library${placeId ? `/${placeId}` : ''}${search ? `?${search}` : ''}`;
}

function findPlaceId(path) {
  return path.match(/^#library\/([a-z0-9-]+)$/)?.[1];
}

export function getLibraryReturn(href) {
  const [path, search] = (href ?? '').split('?', 2);
  if (path === '#library') return { href };
  const id = findPlaceId(path);
  if (id && Object.hasOwn(placeById, id)) {
    const params = new URLSearchParams(search);
    const field = params.get('field');
    const isFormField = /^(arrival|departure|sessions|budget|transport|(start|end)-\d{4}-\d{2}-\d{2}-(morning|afternoon|evening))$/.test(field);
    return { href, place: placeById[id], field: isFormField ? field : null };
  }
  return null;
}

function placeCost(place) {
  return hasKnownCost(place) ? currency.format(place.cost) : 'Chưa có giá';
}

function renderResults() {
  const group = category.value;
  const matching = filterLibraryPlaces(query.value, group);

  results.replaceChildren(...matching.map((place) => {
    const item = $('library-place-template').content.firstElementChild.cloneNode(true);
    const link = item.querySelector('a');
    link.href = libraryHref(place.id);
    link.dataset.placeId = place.id;
    item.querySelector('h3').textContent = place.name;
    item.querySelector('.library-place-icon').innerHTML = icon(place.icon);
    item.querySelector('.library-place-meta').textContent = [place.category, areaLabels.get(place.area)].filter(Boolean).join(' · ');
    item.querySelector('.library-place-price').textContent = placeCost(place);
    return item;
  }));
  $('library-result-count').textContent = `${matching.length} địa điểm`;
  $('library-empty').hidden = matching.length > 0;
  $('library-reset').disabled = !query.value && !group;
}

function updateFilters() {
  const href = libraryHref();
  if (location.hash !== href) history.replaceState(history.state, '', href);
  renderResults();
}

const filters = $('library-filters');
filters.addEventListener('submit', (event) => event.preventDefault());
query.addEventListener('input', updateFilters);
category.addEventListener('change', updateFilters);
filters.addEventListener('reset', (event) => {
  event.preventDefault();
  query.value = '';
  category.value = '';
  query.focus();
  updateFilters();
});

function renderHours(hours) {
  const field = $('library-detail-hours');
  if (!hours?.length) {
    field.textContent = 'Chưa có giờ mở cửa';
    return;
  }

  const list = document.createElement('ul');
  for (const { start, end, days } of hours) {
    const row = document.createElement('li');
    const period = document.createElement('strong');
    period.textContent = `${start}–${end}`;
    const when = document.createElement('span');
    when.textContent = days ? dayLabels.filter((_, index) => days.includes((index + 1) % 7)).join(', ') : 'Hằng ngày';
    row.append(when, period);
    list.append(row);
  }
  field.replaceChildren(list);
}

function renderDetail(place) {
  $('library-back').href = libraryHref();
  $('library-detail-title').textContent = place?.name ?? 'Không tìm thấy địa điểm';
  $('library-detail-description').textContent = place
    ? place.description || 'Chưa có mô tả trong dữ liệu demo.'
    : 'Địa điểm này không có trong thư viện. Bạn có thể quay về danh sách để chọn điểm khác.';
  $('library-detail-category').hidden = !place?.category;
  $('library-detail-demo').hidden = !place;
  $('library-detail-content').hidden = !place;
  if (!place) return;

  $('library-detail-category').textContent = place.category;
  $('library-detail-area').textContent = areaLabels.get(place.area) ?? 'Chưa có khu vực';
  $('library-detail-cost').textContent = placeCost(place);
  $('library-detail-duration').textContent = Number.isFinite(place.duration) ? `${place.duration} phút` : 'Chưa có thời lượng';
  $('library-detail-note').hidden = !place.crowd;
  $('library-detail-note').textContent = place.crowd ? `Ghi chú demo: ${place.crowd}.` : '';
  renderHours(place.hours);
}

function slotLabel(slot) {
  const date = slot.date.split('-').reverse().join('/');
  return `${periodById[slot.period].label} ${date} · ${clock(slot.start)}–${clock(slot.end)}`;
}

function conflictMessage(conflict) {
  switch (conflict.code) {
    case 'window': return `${conflict.placeName} dự kiến kết thúc lúc ${clock(conflict.departure)}, sau giờ kết thúc buổi ${clock(conflict.end)}.`;
    case 'budget': return `Tổng ${currency.format(conflict.total)}/người vượt ngân sách ${currency.format(conflict.budget)}/người (vượt ${currency.format(conflict.overBudget)}).`;
    case 'fixed': return `Không thể đến ${conflict.placeName} đúng giờ cố định ${clock(conflict.start)}. Thời điểm đến sớm nhất là ${clock(conflict.ready)}.`;
    case 'overlap': return `Khung giờ đã chọn trùng với buổi có trong lịch: ${slotLabel(conflict.slot)}.`;
  }
}

export function setupLibraryAdd({ trips, createTrip, tripHash, showAdded }) {
  const toggle = $('library-add-toggle');
  const panel = $('library-add');
  const tripSelect = $('library-trip-select');
  const slotSelect = $('library-slot-select');
  const guidance = $('library-add-guidance');
  const feedback = $('library-add-feedback');
  const configure = $('library-add-configure');
  let place;

  function resumeHref(tripId, slotId, field) {
    return libraryHref(place.id, { add: '1', trip: tripId, slot: slotId, field });
  }

  function offerSetup(text, slotId, field) {
    configure.href = tripHash(tripSelect.value, false, resumeHref(tripSelect.value, slotId, field));
    configure.textContent = text;
    configure.hidden = false;
  }

  function renderSlots(selectedSlot) {
    const trip = tripSelect.value ? trips.get(tripSelect.value) : null;
    const result = trip && prepareRequest(trip.draft.form);
    const slots = result?.request?.slots ?? [];
    slotSelect.replaceChildren(...slots.map((slot) => new Option(slotLabel(slot), slot.id)));
    if (slots.some((slot) => slot.id === selectedSlot)) slotSelect.value = selectedSlot;
    $('library-slot-field').hidden = !slots.length;
    $('library-add-submit').hidden = !slots.length;
    configure.hidden = true;
    feedback.hidden = true;
    guidance.hidden = !!slots.length;
    if (!trip) {
      guidance.textContent = 'Tạo chuyến đi để chọn ngày, buổi và ngân sách trước khi thêm địa điểm này.';
    } else if (result.errors) {
      const [field, message] = Object.entries(result.errors)[0];
      guidance.textContent = message;
      offerSetup(field === 'budget' ? 'Thiết lập ngân sách' : 'Thiết lập ngày và buổi', selectedSlot, field);
    }
  }

  function renderTrips(selectedTrip, selectedSlot) {
    const available = trips.list();
    tripSelect.replaceChildren(...available.map((trip) => new Option(trip.name, trip.id)));
    if (available.some((trip) => trip.id === selectedTrip)) tripSelect.value = selectedTrip;
    $('library-add-fields').hidden = !available.length;
    const create = $('library-add-create');
    create.hidden = false;
    create.textContent = available.length ? 'Tạo chuyến mới' : 'Tạo chuyến đi';
    create.classList.toggle('primary-button', !available.length);
    create.classList.toggle('text-button', !!available.length);
    renderSlots(selectedSlot);
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open);
  }

  toggle.addEventListener('click', () => {
    if (!panel.hidden) {
      setOpen(false);
      return;
    }
    renderTrips(tripSelect.value, slotSelect.value);
    setOpen(true);
    (tripSelect.value ? tripSelect : $('library-add-create')).focus();
  });
  tripSelect.addEventListener('change', () => renderSlots());
  slotSelect.addEventListener('change', () => {
    feedback.hidden = true;
    configure.hidden = true;
  });
  $('library-add-create').addEventListener('click', () => createTrip((id) => resumeHref(id)));
  $('library-add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (panel.hidden || !place || !slotSelect.value) return;
    const result = trips.addVisit(tripSelect.value, { slotId: slotSelect.value, placeId: place.id });
    if (result.trip) {
      setOpen(false);
      showAdded(result.trip.id, place.name, libraryHref());
      return;
    }

    const selectedSlot = slotSelect.value;
    if (!result.conflicts) renderTrips(tripSelect.value, selectedSlot);
    const issues = result.conflicts?.map(conflictMessage) ?? Object.values(result.errors ?? {});
    const heading = document.createElement('strong');
    heading.textContent = 'Chưa thêm được địa điểm. Bản nháp vẫn giữ nguyên.';
    const list = document.createElement('ul');
    for (const message of issues.length ? issues : ['Chuyến hoặc buổi đã thay đổi. Hãy chọn lại.']) {
      const item = document.createElement('li');
      item.textContent = message;
      list.append(item);
    }
    feedback.replaceChildren(heading, list);
    feedback.hidden = false;
    feedback.focus();
    if (result.conflicts) {
      const field = result.conflicts.every(({ code }) => code === 'budget') ? 'budget' : `start-${selectedSlot}`;
      offerSetup('Mở bản nháp để điều chỉnh', selectedSlot, field);
    }
  });

  return (selectedPlace, params) => {
    const changedPlace = place?.id !== selectedPlace?.id;
    place = selectedPlace;
    toggle.hidden = !place;
    const open = !!place && params.get('add') === '1';
    setOpen(open);
    if (changedPlace) {
      tripSelect.replaceChildren();
      slotSelect.replaceChildren();
    }
    if (!open) return null;
    renderTrips(params.get('trip'), params.get('slot'));
    return tripSelect.value ? tripSelect : $('library-add-create');
  };
}

export function renderLibrary(hash, focus, previousHash, renderAdd) {
  const [path, search] = hash.split('?', 2);
  const params = new URLSearchParams(search);
  query.value = params.get('q') ?? '';
  category.value = params.get('group') ?? '';
  const isList = path === '#library';
  $('library-view').hidden = !isList;
  $('library-detail').hidden = isList;

  let addFocus;
  if (isList) renderResults();
  else {
    const id = findPlaceId(path);
    const place = Object.hasOwn(placeById, id) ? placeById[id] : null;
    renderDetail(place);
    addFocus = renderAdd(place, params);
  }

  const heading = $(isList ? 'library-title' : 'library-detail-title');
  document.title = isList ? 'Library · NonLa Wander' : `${heading.textContent} · Library · NonLa Wander`;
  if (!focus) return;

  const previousPlace = isList && findPlaceId(previousHash.split('?', 1)[0]);
  const previousCard = previousPlace && results.querySelector(`[data-place-id="${previousPlace}"]`);
  if (addFocus) addFocus.focus();
  else if (previousCard) previousCard.focus();
  else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    heading.focus({ preventScroll: true });
  }
}

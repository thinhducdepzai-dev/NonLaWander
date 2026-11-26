import { calendarOf } from './calendar.js';
import { areas, experienceById, experiencePlaces, experiences, placeById, places } from './data.js';
import { icon } from './icons.js';
import { hasKnownCost } from './planner.js';

const $ = (id) => document.getElementById(id);
const query = $('library-query');
const category = $('library-category');
const results = $('library-places');
export const libraryGroups = [...new Set(places.map((place) => place.category).filter(Boolean))];
const areaLabels = new Map(areas.map((area) => [area.id, area.label]));
const currency = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const dayLabels = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
let libraryTripId = null;
let libraryExperienceId = null;

for (const label of libraryGroups) category.add(new Option(label, label));

function foldName(value) {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd').trim().replace(/\s+/g, ' ');
}

export function filterLibraryPlaces(query, group) {
  const name = foldName(query);
  return places.filter((place) => foldName(place.name).includes(name) && (!group || place.category === group));
}

function libraryPath(placeId, params) {
  const search = params.toString();
  return `#library${placeId ? `/${placeId}` : ''}${search ? `?${search}` : ''}`;
}

const experiencePath = (id) => `experience/${id}`;

export function experienceHref(id, tripId) {
  const params = new URLSearchParams();
  if (tripId) params.set('fromTrip', tripId);
  return libraryPath(experiencePath(id), params);
}

export function experiencePlaceLabel(item) {
  const count = experiencePlaces(item).length;
  return count ? `${count} địa điểm để chọn` : 'Chưa có địa điểm';
}

export function tripLibraryHref(tripId, placeId, add = false) {
  const params = new URLSearchParams({ fromTrip: tripId });
  if (add) params.set('add', '1');
  return libraryPath(placeId, params);
}

function libraryHref(placeId, options = {}) {
  const params = new URLSearchParams();
  if (query.value.trim()) params.set('q', query.value.trim());
  if (category.value) params.set('group', category.value);
  if (libraryTripId) params.set('fromTrip', libraryTripId);
  if (libraryExperienceId && placeId && !placeId.includes('/')) params.set('experience', libraryExperienceId);
  for (const [key, value] of Object.entries(options)) {
    if (value) params.set(key, value);
  }
  return libraryPath(placeId, params);
}

function findPlaceId(path) {
  return path.match(/^#library\/([a-z0-9-]+)$/)?.[1];
}

function findExperienceId(path) {
  return path.match(/^#library\/experience\/([a-z0-9-]+)$/)?.[1];
}

export function getLibraryReturn(href) {
  const [path] = (href ?? '').split('?', 1);
  if (path === '#library') return { href };
  const id = findPlaceId(path);
  if (id && Object.hasOwn(placeById, id)) {
    return { href, place: placeById[id] };
  }
  return null;
}

function placeCost(place) {
  return hasKnownCost(place) ? currency.format(place.cost) : 'Chưa có giá';
}

function libraryCard(item, href, meta, price) {
  const row = $('library-place-template').content.firstElementChild.cloneNode(true);
  row.querySelector('a').href = href;
  row.querySelector('h3').textContent = item.name;
  row.querySelector('.library-place-icon').innerHTML = icon(item.icon);
  row.querySelector('.library-place-meta').textContent = meta;
  const priceLabel = row.querySelector('.library-place-price');
  priceLabel.hidden = !price;
  priceLabel.textContent = price ?? '';
  return row;
}

function placeCard(place, experienceId) {
  const meta = [place.category, areaLabels.get(place.area)].filter(Boolean).join(' · ');
  const row = libraryCard(place, libraryHref(place.id, { experience: experienceId }), meta, placeCost(place));
  row.querySelector('a').dataset.placeId = place.id;
  return row;
}

function renderResults() {
  const group = category.value;
  const matching = filterLibraryPlaces(query.value, group);
  const name = foldName(query.value);
  const ideas = experiences.filter((item) => foldName(item.name).includes(name));
  $('library-experiences').replaceChildren(...ideas.map((item) => {
    const row = libraryCard(item, libraryHref(experiencePath(item.id)), `${item.kind} · ${experiencePlaceLabel(item)}`);
    row.querySelector('a').dataset.experienceId = item.id;
    return row;
  }));
  results.replaceChildren(...matching.map((place) => placeCard(place)));
  $('library-experience-count').textContent = `${ideas.length} trải nghiệm`;
  $('library-experience-results').hidden = !ideas.length;
  $('library-result-count').textContent = `${matching.length} địa điểm`;
  $('library-place-results').hidden = !matching.length;
  $('library-empty').hidden = !!(matching.length || ideas.length);
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
  $('library-back').href = libraryHref(libraryExperienceId ? experiencePath(libraryExperienceId) : undefined);
  $('library-back-label').textContent = libraryExperienceId ? 'Quay về trải nghiệm' : 'Quay về thư viện';
  $('library-detail-title').textContent = place?.name ?? 'Không tìm thấy địa điểm';
  $('library-detail-description').textContent = place
    ? place.description || 'Chưa có mô tả trong dữ liệu demo.'
    : 'Địa điểm này không có trong thư viện. Bạn có thể quay về danh sách để chọn điểm khác.';
  $('library-detail-category').hidden = !place?.category;
  $('library-detail-demo').hidden = !place;
  $('library-detail-content').hidden = !place;
  $('library-experience-places').hidden = true;
  if (!place) return;

  $('library-detail-category').textContent = place.category;
  $('library-detail-area').textContent = areaLabels.get(place.area) ?? 'Chưa có khu vực';
  $('library-detail-cost').textContent = placeCost(place);
  $('library-detail-duration').textContent = Number.isFinite(place.duration) ? `${place.duration} phút` : 'Chưa có thời lượng';
  $('library-detail-note').hidden = !place.crowd;
  $('library-detail-note').textContent = place.crowd ? `Ghi chú demo: ${place.crowd}.` : '';
  renderHours(place.hours);
}

function renderExperience(item) {
  const related = item ? experiencePlaces(item) : [];
  $('library-detail-title').textContent = item?.name ?? 'Không tìm thấy trải nghiệm';
  $('library-detail-category').textContent = item?.kind ?? '';
  $('library-detail-category').hidden = !item;
  $('library-detail-demo').hidden = !item;
  const description = $('library-detail-description');
  description.textContent = 'Quay về thư viện để tìm trải nghiệm khác.';
  if (item) {
    description.textContent = libraryTripId ? 'Chọn một địa điểm để thêm vào lịch nháp của chuyến.'
      : 'Lưu ý tưởng vào chuyến hoặc chọn một địa điểm để xếp lịch.';
    if (!related.length) description.textContent = '';
  }
  $('library-detail-content').hidden = true;
  $('library-experience-places').hidden = !item;
  $('library-back').href = libraryHref();
  $('library-back-label').textContent = 'Quay về thư viện';
  if (!item) return;

  $('library-experience-places-title').textContent = related.length ? 'Chọn địa điểm' : 'Địa điểm liên quan';
  $('library-experience-empty').hidden = !!related.length;
  $('library-related-places').replaceChildren(...related.map((place) => placeCard(place, item.id)));
}

function fillTripOptions(select, available, selectedTrip) {
  select.replaceChildren(...available.map((trip) => new Option(trip.name, trip.id)));
  if (available.some((trip) => trip.id === selectedTrip)) select.value = selectedTrip;
}

export function setupLibraryActions({ trips, createTrip, tripHash, savedItemsHash, showStorageStatus }) {
  const toggle = $('library-add-toggle');
  const panel = $('library-add');
  const tripSelect = $('library-trip-select');
  const guidance = $('library-add-guidance');
  const configure = $('library-add-configure');
  const saveToggle = $('library-save-toggle');
  const savePanel = $('library-save');
  const saveSelect = $('library-save-trip');
  const saveCreate = $('library-save-create');
  const saveSubmit = $('library-save-submit');
  const saveError = $('library-save-error');
  let place;
  let experience;

  function availableTrips() {
    if (!libraryTripId) return trips.list();
    const trip = trips.get(libraryTripId);
    return trip ? [trip] : [];
  }

  function resumeHref(tripId) {
    return libraryHref(place.id, { add: '1', trip: tripId });
  }

  function renderCalendarLink() {
    const id = libraryTripId ?? tripSelect.value;
    const trip = id ? trips.get(id) : null;
    configure.hidden = !trip;
    if (!trip) {
      guidance.textContent = libraryTripId ? 'Chuyến này không còn khả dụng.' : 'Tạo chuyến đi để chọn thời gian trước khi thêm địa điểm này.';
      return;
    }
    const ready = !!calendarOf(trip.draft)?.mode;
    configure.href = tripHash(id, false, resumeHref(id));
    configure.textContent = ready ? 'Chọn giờ trong lịch' : 'Thiết lập thời gian chuyến';
    guidance.textContent = ready ? 'Chọn ngày và giờ trong lịch nháp của chuyến này.' : 'Địa điểm sẽ được giữ để bạn tiếp tục thêm vào lịch sau khi thiết lập chuyến.';
  }

  function renderTrips(selectedTrip) {
    const available = availableTrips();
    fillTripOptions(tripSelect, available, selectedTrip);
    $('library-add-fields').hidden = !available.length;
    $('library-trip-field').hidden = !!libraryTripId;
    $('library-add-fields').classList.toggle('library-add-fixed-trip', !!libraryTripId);
    const context = $('library-add-trip-context');
    context.hidden = !libraryTripId || !available.length;
    context.textContent = available.length ? `Thêm vào ${available[0].name}.` : '';
    const create = $('library-add-create');
    create.hidden = !!libraryTripId;
    create.textContent = available.length ? 'Tạo chuyến mới' : 'Tạo chuyến đi';
    create.classList.toggle('primary-button', !available.length);
    create.classList.toggle('text-button', !!available.length);
    renderCalendarLink();
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open);
  }

  function setSaveOpen(open) {
    savePanel.hidden = !open;
    saveToggle.setAttribute('aria-expanded', open);
  }

  function addFocusTarget() {
    if (!libraryTripId) return tripSelect.value ? tripSelect : $('library-add-create');
    return configure.hidden ? toggle : configure;
  }

  function renderSavedStatus() {
    const item = experience ?? place;
    const field = experience ? 'savedExperienceIds' : 'savedPlaceIds';
    const saved = item ? trips.list().filter((trip) => trip[field].includes(item.id)) : [];
    $('library-saved-status').hidden = !saved.length;
    $('library-saved-trips').replaceChildren(...saved.map((trip) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = savedItemsHash(trip.id, !!experience);
      link.textContent = trip.name;
      link.setAttribute('aria-label', `Xem ${experience ? 'trải nghiệm' : 'địa điểm'} đã lưu trong ${trip.name}`);
      item.append(link);
      return item;
    }));
  }

  function renderSaveTrips(selectedTrip) {
    const available = availableTrips();
    fillTripOptions(saveSelect, available, selectedTrip);
    $('library-save-field').hidden = !!libraryTripId || !available.length;
    saveSubmit.hidden = !available.length;
    saveCreate.hidden = !!libraryTripId;
    saveCreate.classList.toggle('primary-button', !available.length);
    saveCreate.classList.toggle('text-button', !!available.length);
    const hint = $('library-save-guidance');
    hint.hidden = !libraryTripId && !!available.length;
    const emptyMessage = libraryTripId ? 'Chuyến này không còn khả dụng.' : 'Bạn có thể tạo chuyến trống để lưu ngay.';
    hint.textContent = available.length ? `Lưu vào ${available[0].name}.` : emptyMessage;
    saveError.hidden = true;
  }

  toggle.addEventListener('click', () => {
    if (!panel.hidden) {
      setOpen(false);
      return;
    }
    setSaveOpen(false);
    renderTrips(tripSelect.value);
    setOpen(true);
    addFocusTarget().focus();
  });
  tripSelect.addEventListener('change', renderCalendarLink);
  $('library-add-create').addEventListener('click', () => createTrip(resumeHref));

  saveToggle.addEventListener('click', () => {
    if (!savePanel.hidden) {
      setSaveOpen(false);
      return;
    }
    setOpen(false);
    renderSaveTrips(saveSelect.value);
    setSaveOpen(true);
    if (libraryTripId) (saveSubmit.hidden ? saveToggle : saveSubmit).focus();
    else (saveSelect.value ? saveSelect : saveCreate).focus();
  });

  $('library-save-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (savePanel.hidden || !(experience || place)) return;
    const id = libraryTripId ?? saveSelect.value;
    const trip = experience ? trips.setSavedExperience(id, experience.id, true) : trips.setSavedPlace(id, place.id, true);
    if (!trip) {
      renderSaveTrips();
      saveError.textContent = 'Chuyến đã thay đổi. Hãy kiểm tra rồi lưu lại.';
      saveError.hidden = false;
      return;
    }
    saveError.hidden = true;
    renderSavedStatus();
    showStorageStatus();
  });

  saveCreate.addEventListener('click', () => {
    if (savePanel.hidden || !(experience || place) || libraryTripId) return;
    const trip = trips.create(experience ? { savedExperienceId: experience.id } : { savedPlaceId: place.id });
    setSaveOpen(false);
    renderSavedStatus();
    showStorageStatus();
    const link = Array.from($('library-saved-trips').querySelectorAll('a')).find((item) => item.hash === savedItemsHash(trip.id, !!experience));
    link?.focus();
  });

  return (selectedPlace, params, selectedExperience) => {
    const changedItem = place?.id !== selectedPlace?.id || experience?.id !== selectedExperience?.id;
    place = selectedPlace;
    experience = selectedExperience;
    const savedInOrigin = !!experience && !!libraryTripId && trips.get(libraryTripId)?.savedExperienceIds.includes(experience.id);
    toggle.hidden = !place;
    saveToggle.hidden = !(place || experience) || savedInOrigin;
    saveToggle.classList.toggle('primary-button', !!experience);
    saveToggle.classList.toggle('text-button', !experience);
    $('library-save-label').textContent = experience ? 'Lưu trải nghiệm' : 'Lưu để xếp sau';
    $('library-save-title').textContent = experience ? 'Lưu ý tưởng vào chuyến' : 'Lưu để xếp lịch sau';
    saveSubmit.textContent = experience ? 'Lưu trải nghiệm' : 'Lưu địa điểm';
    setSaveOpen(false);
    renderSavedStatus();
    if (libraryTripId && !libraryExperienceId) {
      $('library-back').href = savedItemsHash(libraryTripId, !!experience);
      $('library-back-label').textContent = experience ? 'Quay về trải nghiệm đã lưu' : 'Quay về địa điểm đã lưu';
    }
    const open = !!place && params.get('add') === '1';
    setOpen(open);
    if (changedItem) {
      tripSelect.replaceChildren();
      saveSelect.replaceChildren();
    }
    if (!open) return null;
    renderTrips(params.get('trip'));
    return addFocusTarget();
  };
}

export function renderLibrary(hash, focus, previousHash, renderActions, savedItemsHash) {
  const [path, search] = hash.split('?', 2);
  const params = new URLSearchParams(search);
  const fromTrip = params.get('fromTrip');
  libraryTripId = /^[a-z0-9-]+$/.test(fromTrip ?? '') ? fromTrip : null;
  const origin = params.get('experience');
  libraryExperienceId = findPlaceId(path) && Object.hasOwn(experienceById, origin) ? origin : null;
  query.value = params.get('q') ?? '';
  category.value = params.get('group') ?? '';
  const isList = path === '#library';
  const experienceId = findExperienceId(path);
  $('library-view').hidden = !isList;
  $('library-detail').hidden = isList;

  let addFocus;
  if (isList) {
    const back = $('library-trip-back');
    back.hidden = !libraryTripId;
    if (libraryTripId) back.href = savedItemsHash(libraryTripId);
    renderResults();
  } else if (experienceId) {
    const experience = Object.hasOwn(experienceById, experienceId) ? experienceById[experienceId] : null;
    renderExperience(experience);
    renderActions(null, params, experience);
  } else {
    const id = findPlaceId(path);
    const place = Object.hasOwn(placeById, id) ? placeById[id] : null;
    renderDetail(place);
    addFocus = renderActions(place, params);
  }

  const heading = $(isList ? 'library-title' : 'library-detail-title');
  document.title = isList ? 'Library · NonLa Wander' : `${heading.textContent} · Library · NonLa Wander`;
  if (!focus) return;

  const previousPath = previousHash.split('?', 1)[0];
  const previousPlace = findPlaceId(previousPath);
  const previousExperience = findExperienceId(previousPath);
  const previousCard = isList && previousExperience ? $('library-experiences').querySelector(`[data-experience-id="${previousExperience}"]`)
    : previousPlace && (isList ? results : experienceId ? $('library-related-places') : null)?.querySelector(`[data-place-id="${previousPlace}"]`);
  if (addFocus) addFocus.focus();
  else if (previousCard) previousCard.focus();
  else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    heading.focus({ preventScroll: true });
  }
}

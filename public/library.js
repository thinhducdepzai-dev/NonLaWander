import { calendarOf, sessionHasEnd, sessionTimeLabel } from './calendar.js';
import { areas, eventSessionById, experienceById, experiencePlaces, experiences, placeById, libraryPlaces as places } from './data.js';
import { icon } from './icons.js';
import { hasKnownCost } from './planner.js';
import { placeWard } from './wards.js';
import { eventDateFilters, eventLibraryHref, libraryEventRange, sessionKind, sessionsInRange, sessionTicketLabel } from './library-events.js';
import { fields } from './library-handoff.js';
import { hasCoordinates, isLocalLibrary } from './library-import.js';
import { libraryImage, sessionImage } from './library-images.js';

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
const eventFrom = $('library-event-from');
const eventTo = $('library-event-to');
const eventsPath = '#library/events';

for (const label of libraryGroups) category.add(new Option(label, label));

function foldName(value) {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd').trim().replace(/\s+/g, ' ');
}

export function filterLibraryPlaces(query, group) {
  const name = foldName(query);
  const related = new Set(experiences.filter((item) => foldName(item.name).includes(name)).flatMap((item) => item.placeIds));
  return places.filter((place) => (!group || place.category === group) &&
    (foldName(place.name).includes(name) || related.has(place.id)));
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

function findSessionId(path) {
  return path.match(/^#library\/events\/([a-z0-9-]+)$/)?.[1];
}

export function getLibraryReturn(href) {
  const [path, search] = (href ?? '').split('?', 2);
  const idSession = findSessionId(path);
  const session = Object.hasOwn(eventSessionById, idSession) && eventSessionById[idSession];
  if (path === eventsPath || session) return { href, session: new URLSearchParams(search).get('add') === '1' ? session : undefined };
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
  const link = row.querySelector('a');
  link.href = href;
  row.querySelector('h3').textContent = item.name;
  const fallback = row.querySelector('.library-place-icon');
  fallback.innerHTML = icon(item.icon);
  row.querySelector('.library-place-meta').textContent = meta;
  if (item.image) {
    link.classList.add('library-place-with-image');
    fallback.hidden = true;
    const caption = document.createElement('small');
    caption.className = 'library-card-caption';
    caption.hidden = !item.image.caption;
    caption.textContent = item.image.caption ? `Ảnh · ${item.image.caption}` : '';
    row.querySelector('.library-place-info').append(caption);
    row.querySelector('.library-card-media').append(libraryImage(item.image, { onError() {
      fallback.hidden = false;
      caption.hidden = true;
    } }));
  }
  const priceLabel = row.querySelector('.library-place-price');
  priceLabel.hidden = !price;
  priceLabel.textContent = price ?? '';
  return row;
}

function placeCard(place, experienceId) {
  const meta = [place.category, place.address || areaLabels.get(place.area), !hasCoordinates(place) && 'Chờ ghim vị trí'].filter(Boolean).join(' · ');
  const row = libraryCard(place, libraryHref(place.id, { experience: experienceId }), meta, placeCost(place));
  row.querySelector('a').dataset.placeId = place.id;
  return row;
}

let mapMode = false;
let mapController;
let mapRender = 0;
let mapOrigin;

function mapUrl(id, options) {
  return libraryHref(id, { view: 'map', ...options });
}

async function showMap(matching, restore, revision) {
  try {
    const { createPlaceMap } = await import('./library-map.js');
    if (revision !== mapRender || $('library-view').hidden || location.hash.split('?')[0] !== '#library') return;
    mapController ??= createPlaceMap();
    mapController.show(matching, {
      restore,
      target: new URLSearchParams(location.hash.split('?')[1]).get('pin'),
      detail: (id) => mapUrl(id),
      onDetail: (id) => { mapOrigin = { list: location.hash, detail: mapUrl(id) }; },
      cost: (p) => hasKnownCost(p) ? 'Ước tính ' + placeCost(p) + '/người' : '',
      area: (p) => areaLabels.get(p.area),
    });
  } catch (error) {
    if (revision !== mapRender) return;
    $('map-tile-error').hidden = false;
    console.error(error);
  }
}

$('map-retry').addEventListener('click', () => {
  if (mapController) mapController.retry();
  else location.reload();
});

results.addEventListener('click', (event) => {
  const id = event.target.closest('a')?.dataset.placeId;
  if (mapMode && id && mapController?.selectResult(id)) event.preventDefault();
});

$('library-back').addEventListener('click', (event) => {
  if (history.state?.mapParent && $('library-back').hash === history.state.mapParent &&
      !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    history.back();
  }
});

function renderResults(restore = history.state?.placeMap) {
  const group = category.value;
  const matching = filterLibraryPlaces(query.value, group);
  const name = foldName(query.value);
  const ideas = experiences.filter((item) => foldName(item.name).includes(name) &&
    (!group || experiencePlaces(item).some((place) => place.category === group)));
  $('library-experiences').replaceChildren(...ideas.map((item) => {
    const row = libraryCard(item, libraryHref(experiencePath(item.id)), `${item.kind} · ${experiencePlaceLabel(item)}`);
    row.querySelector('a').dataset.experienceId = item.id;
    return row;
  }));
  results.replaceChildren(...matching.map((place) => placeCard(place)));
  const mapped = mapMode && matching.some(hasCoordinates);
  $('library-view').classList.toggle('map-mode', mapMode);
  $('library-place-map').hidden = !mapped;
  $('library-list-mode').href = $('map-error-list').href = libraryHref();
  $('library-map-mode').href = mapUrl();
  $('library-list-mode').setAttribute('aria-current', mapMode ? 'false' : 'true');
  $('library-map-mode').setAttribute('aria-current', mapMode ? 'true' : 'false');
  const revision = ++mapRender;
  if (mapped) showMap(matching, restore, revision);
  $('library-experience-count').textContent = `${ideas.length} trải nghiệm`;
  $('library-experience-results').hidden = mapMode || !ideas.length;
  $('library-result-count').textContent = `${matching.length} địa điểm`;
  $('library-place-results').hidden = !matching.length;
  $('library-empty').hidden = !!(matching.length || (!mapMode && ideas.length));
  $('library-reset').disabled = !query.value && !group;
}

const dateLabel = (date) => date.split('-').reverse().join('/');

function renderEventResults(from, to) {
  const listing = sessionsInRange(libraryEventRange(from, to));
  const range = from === to ? dateLabel(from) : `${dateLabel(from)} – ${dateLabel(to)}`;
  $('library-event-count').textContent = listing.length
    ? `${listing.length} suất · ${range} · Giờ Hà Nội`
    : `Không có suất ${from === to ? 'ngày' : 'từ'} ${range} theo giờ Hà Nội. Hãy đổi khoảng ngày.`;
  $('library-event-results').replaceChildren(...listing.map((session) => {
    const href = eventLibraryHref({ sessionId: session.id, tripId: libraryTripId, from, to });
    const venue = placeById[session.placeId];
    const row = libraryCard({ ...session, icon: 'calendar', image: sessionImage(session, venue) }, href,
      venue?.name ?? 'Chưa có nơi tổ chức', sessionTicketLabel(session));
    const link = row.querySelector('a');
    link.dataset.sessionId = session.id;
    const time = document.createElement('p');
    time.className = 'event-card-time';
    time.textContent = sessionTimeLabel(session, true);
    const kind = document.createElement('small');
    kind.className = 'helper';
    kind.textContent = sessionKind(session);
    const info = row.querySelector('.library-place-info');
    info.querySelector('h3').after(time);
    info.append(kind);
    return row;
  }));
}

$('library-event-filters').addEventListener('submit', (event) => {
  event.preventDefault();
  const { value: from } = eventFrom;
  const { value: to } = eventTo;
  const error = $('library-event-error');
  const invalid = !libraryEventRange(from, to);
  error.hidden = !invalid;
  error.textContent = invalid ? 'Chọn đủ hai ngày. Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.' : '';
  if (invalid) {
    (!from ? eventFrom : eventTo).focus();
    return;
  }
  history.replaceState(history.state, '', eventLibraryHref({ tripId: libraryTripId, from, to }));
  renderEventResults(from, to);
});

function renderSession(session, params) {
  $('library-detail-title').textContent = session?.name ?? 'Không tìm thấy suất sự kiện';
  $('library-detail-category').textContent = session ? sessionKind(session) : '';
  $('library-detail-category').hidden = !session;
  $('library-detail-description').textContent = session ? '' : 'Quay về danh sách sự kiện để chọn suất khác.';
  $('library-detail-demo').hidden = true;
  $('library-detail-content').hidden = true;
  $('library-experience-places').hidden = true;
  $('library-event-detail').hidden = !session;
  $('library-event-missing-end').hidden = !session || sessionHasEnd(session);
  $('library-back').href = eventLibraryHref({ tripId: libraryTripId, from: params.get('from'), to: params.get('to') });
  $('library-back-label').textContent = 'Quay về sự kiện';
  if (!session) return;
  $('library-event-time').textContent = sessionTimeLabel(session, true);
  $('library-event-price').textContent = sessionTicketLabel(session);
  const venue = placeById[session.placeId];
  const holder = $('library-event-venue');
  if (!venue) holder.textContent = 'Chưa có nơi tổ chức';
  else {
    const link = document.createElement('a');
    link.className = 'back-link';
    link.href = libraryPath(venue.id, new URLSearchParams());
    link.textContent = venue.name;
    holder.replaceChildren(link);
  }
}

function renderSources(sources = []) {
  $('library-sources').hidden = !sources.length;
  $('library-source-list').replaceChildren(...sources.map(({ title, url, checkedOn, coverage, supports, note }) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'back-link';
    link.href = url;
    link.textContent = title ?? new URL(url).hostname;
    const details = document.createElement('p');
    details.className = 'helper';
    if (checkedOn) {
      const date = document.createElement('time');
      date.dateTime = checkedOn;
      date.textContent = dateLabel(checkedOn);
      details.append('Đối chiếu ', date);
    }
    const context = [coverage ?? supports?.map((key) => fields[key]).join(', '), note].filter(Boolean).join(' · ');
    if (context) details.append(checkedOn ? ` · ${context}` : context);
    item.append(link);
    if (details.hasChildNodes()) item.append(details);
    return item;
  }));
}

function renderDetailImage(image) {
  const figure = $('library-detail-image');
  figure.hidden = !image;
  figure.replaceChildren();
  if (!image) return;

  const frame = document.createElement('div');
  frame.className = 'library-detail-image-frame';
  frame.classList.toggle('library-detail-poster-frame', image.kind === 'poster');
  frame.style.setProperty('--image-ratio', image.width / image.height);
  const fallback = document.createElement('p');
  fallback.className = 'helper';
  fallback.textContent = 'Không tải được ảnh.';
  fallback.hidden = true;
  const caption = document.createElement('figcaption');
  const label = document.createElement('strong');
  label.textContent = image.caption ?? '';
  if (image.caption) caption.append(label);
  if (image.credit) {
    const { author, source, license, licenseUrl, changes } = image.credit;
    const credit = document.createElement('span');
    const original = document.createElement('a');
    original.href = source;
    original.textContent = `Ảnh của ${author}`;
    const terms = document.createElement('a');
    terms.href = licenseUrl;
    terms.textContent = license;
    credit.append(original, ' · ', terms, ...(changes ? [` · ${changes}`] : []));
    caption.append(credit);
  }
  caption.hidden = !caption.childNodes.length;
  frame.append(libraryImage(image, { detail: true, onError() {
    fallback.hidden = false;
    caption.hidden = true;
  } }), fallback);
  if (image.caption) figure.append(caption, frame);
  else figure.append(frame, caption);
}

function updateFilters() {
  const href = mapMode ? mapUrl() : libraryHref();
  history.replaceState({ ...history.state, placeMap: null }, '', href);
  renderResults(null);
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
    ? place.description || 'Chưa có mô tả.'
    : 'Địa điểm này không có trong thư viện. Bạn có thể quay về danh sách để chọn điểm khác.';
  $('library-detail-category').hidden = !place?.category;
  $('library-detail-demo').hidden = !place || !!place.sources?.length;
  $('library-detail-content').hidden = !place;
  $('library-experience-places').hidden = true;
  if (!place) return;

  $('library-detail-category').textContent = place.category;
  $('library-detail-address-row').hidden = !place.address;
  $('library-detail-address').textContent = place.address ?? '';
  $('library-detail-area-row').hidden = !!place.sources?.length && !place.area;
  $('library-detail-area').textContent = areaLabels.get(place.area) ?? 'Chưa có khu vực';
  const ward = placeWard(place.id);
  $('library-detail-ward').textContent = ward ? `Phường ${ward.name}` : 'Chưa xác minh';
  $('library-detail-cost').textContent = placeCost(place);
  $('library-detail-duration').textContent = Number.isFinite(place.duration) ? `${place.durationEstimated ? 'Gợi ý xếp lịch · ' : ''}Khoảng ${place.duration} phút` : 'Chưa có thời lượng';
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
  let session;
  let sessionParams;

  function availableTrips() {
    if (!libraryTripId) return trips.list();
    const trip = trips.get(libraryTripId);
    return trip ? [trip] : [];
  }

  function resumeHref(tripId) {
    if (session) return eventLibraryHref({ sessionId: session.id, tripId, from: sessionParams.get('from'), to: sessionParams.get('to'), add: true });
    return libraryHref(place.id, { add: '1', trip: tripId });
  }

  function renderCalendarLink() {
    const id = libraryTripId ?? tripSelect.value;
    const trip = id ? trips.get(id) : null;
    configure.hidden = !trip;
    if (!trip) {
      guidance.textContent = libraryTripId ? 'Chuyến này không còn khả dụng.' : 'Tạo chuyến đi để chọn thời gian trước khi thêm.';
      return;
    }
    const ready = !!calendarOf(trip.draft)?.mode;
    configure.href = tripHash(id, false, resumeHref(id));
    configure.textContent = ready ? session ? 'Thêm đúng suất vào nháp' : 'Chọn giờ trong lịch' : 'Thiết lập thời gian chuyến';
    guidance.textContent = ready ? session ? sessionTimeLabel(session) : 'Chọn ngày và giờ trong lịch nháp của chuyến này.'
      : session ? 'Suất này sẽ được giữ trong lúc bạn thiết lập chuyến.' : 'Địa điểm sẽ được giữ để bạn tiếp tục thêm vào lịch sau khi thiết lập chuyến.';
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

  return (selectedPlace, params, selectedExperience, selectedSession) => {
    const changedItem = place?.id !== selectedPlace?.id || experience?.id !== selectedExperience?.id || session?.id !== selectedSession?.id;
    place = selectedPlace;
    experience = selectedExperience;
    session = selectedSession;
    sessionParams = params;
    const savedInOrigin = !!experience && !!libraryTripId && trips.get(libraryTripId)?.savedExperienceIds.includes(experience.id);
    const canAdd = !!place || !!session && sessionHasEnd(session);
    toggle.hidden = !canAdd;
    $('library-add-label').textContent = session ? 'Thêm vào lịch nháp' : 'Thêm vào lịch';
    saveToggle.hidden = !(place || experience) || savedInOrigin;
    saveToggle.classList.toggle('primary-button', !!experience);
    saveToggle.classList.toggle('text-button', !experience);
    $('library-save-label').textContent = experience ? 'Lưu trải nghiệm' : 'Lưu để xếp sau';
    $('library-save-title').textContent = experience ? 'Lưu ý tưởng vào chuyến' : 'Lưu để xếp lịch sau';
    saveSubmit.textContent = experience ? 'Lưu trải nghiệm' : 'Lưu địa điểm';
    setSaveOpen(false);
    renderSavedStatus();
    if (libraryTripId && !libraryExperienceId && (place || experience)) {
      $('library-back').href = savedItemsHash(libraryTripId, !!experience);
      $('library-back-label').textContent = experience ? 'Quay về trải nghiệm đã lưu' : 'Quay về địa điểm đã lưu';
    }
    const open = canAdd && params.get('add') === '1';
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

export function renderLibrary(hash, focus, previousHash, renderActions, savedItemsHash, getTrip) {
  const [path, search] = hash.split('?', 2);
  const params = new URLSearchParams(search);
  const fromTrip = params.get('fromTrip');
  libraryTripId = /^[a-z0-9-]+$/.test(fromTrip ?? '') ? fromTrip : null;
  $('library-review-link').hidden = !!libraryTripId || !isLocalLibrary(location.hostname);
  const origin = params.get('experience');
  libraryExperienceId = findPlaceId(path) && Object.hasOwn(experienceById, origin) ? origin : null;
  query.value = params.get('q') ?? '';
  category.value = params.get('group') ?? '';
  const showingEvents = path === eventsPath;
  const isList = path === '#library' || showingEvents;
  mapMode = path === '#library' && params.get('view') === 'map';
  $('library-display').hidden = showingEvents;
  $('detail-on-map').hidden = true;
  $('library-view').classList.toggle('map-mode', mapMode);
  if (mapOrigin?.detail === hash && previousHash === mapOrigin.list) {
    history.replaceState({ ...history.state, mapParent: mapOrigin.list }, '', hash);
  }
  mapOrigin = null;
  const sessionId = findSessionId(path);
  const experienceId = findExperienceId(path);
  $('library-view').hidden = !isList;
  $('library-detail').hidden = isList;
  $('library-event-missing-end').hidden = true;
  let sources;
  let image;

  let addFocus;
  if (isList) {
    $('library-intro').hidden = showingEvents;
    $('library-list-demo').hidden = showingEvents;
    $('library-events-tab').href = eventLibraryHref({ tripId: libraryTripId });
    $('library-events-tab').setAttribute('aria-current', showingEvents ? 'page' : 'false');
    $('library-places-tab').setAttribute('aria-current', showingEvents ? 'false' : 'page');
    $('library-places-tab').href = libraryHref();
    $('library-events').hidden = !showingEvents;
    filters.hidden = showingEvents;
    const back = $('library-trip-back');
    back.hidden = !libraryTripId;
    if (libraryTripId) {
      back.href = showingEvents ? `#trip/${libraryTripId}` : savedItemsHash(libraryTripId);
      back.textContent = showingEvents ? 'Quay về lịch chuyến đi' : 'Quay về địa điểm đã lưu';
    }
    if (showingEvents) {
      for (const id of ['library-empty', 'library-experience-results', 'library-place-results']) $(id).hidden = true;
      const trip = libraryTripId && getTrip(libraryTripId);
      const dates = libraryEventRange(params.get('from'), params.get('to'))
        ? { from: params.get('from'), to: params.get('to') } : eventDateFilters(trip ? calendarOf(trip.draft) : null);
      eventFrom.value = dates.from;
      eventTo.value = dates.to;
      $('library-event-error').hidden = true;
      renderEventResults(dates.from, dates.to);
    } else renderResults();
  } else if (sessionId) {
    const session = Object.hasOwn(eventSessionById, sessionId) ? eventSessionById[sessionId] : null;
    sources = session?.sources;
    image = session && sessionImage(session, placeById[session.placeId]);
    renderSession(session, params);
    addFocus = renderActions(null, params, null, session);
  } else if (experienceId) {
    $('library-event-detail').hidden = true;
    const experience = Object.hasOwn(experienceById, experienceId) ? experienceById[experienceId] : null;
    image = experience?.image;
    renderExperience(experience);
    renderActions(null, params, experience);
  } else {
    $('library-event-detail').hidden = true;
    const id = findPlaceId(path);
    const place = Object.hasOwn(placeById, id) ? placeById[id] : null;
    sources = place?.sources;
    image = place?.image;
    renderDetail(place);
    addFocus = renderActions(place, params);
    if (place && hasCoordinates(place)) {
      if (params.get('view') === 'map') {
        $('library-back-label').textContent = 'Quay lại bản đồ';
        $('library-back').href = history.state?.mapParent || mapUrl(null, { pin: id });
      } else {
        $('detail-on-map').href = mapUrl(null, { pin: id });
        $('detail-on-map').hidden = false;
      }
    }
  }
  renderSources(sources);
  renderDetailImage(image);

  const heading = $(isList ? 'library-title' : 'library-detail-title');
  document.title = isList ? 'Library · NonLa Wander' : `${heading.textContent} · Library · NonLa Wander`;
  if (!focus || (mapMode && history.state?.placeMap)) return;

  const previousPath = previousHash.split('?', 1)[0];
  const previousPlace = findPlaceId(previousPath);
  const previousExperience = findExperienceId(previousPath);
  const previousSession = findSessionId(previousPath);
  const previousCard = showingEvents && previousSession ? $('library-event-results').querySelector(`[data-session-id="${previousSession}"]`)
    : isList && previousExperience ? $('library-experiences').querySelector(`[data-experience-id="${previousExperience}"]`)
    : previousPlace && (isList ? results : experienceId ? $('library-related-places') : null)?.querySelector(`[data-place-id="${previousPlace}"]`);
  if (addFocus) addFocus.focus();
  else if (previousCard) previousCard.focus();
  else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    heading.focus({ preventScroll: true });
  }
}

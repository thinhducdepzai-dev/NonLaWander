import { areas, placeById, places } from './data.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const query = $('library-query');
const category = $('library-category');
const results = $('library-places');
const groups = new Set(places.map((place) => place.category).filter(Boolean));
const areaLabels = new Map(areas.map((area) => [area.id, area.label]));
const currency = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const dayLabels = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

for (const label of groups) category.add(new Option(label, label));

function foldName(value) {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd').trim().replace(/\s+/g, ' ');
}

function libraryHref(placeId) {
  const params = new URLSearchParams();
  if (query.value.trim()) params.set('q', query.value.trim());
  if (category.value) params.set('group', category.value);
  const search = params.toString();
  return `#library${placeId ? `/${placeId}` : ''}${search ? `?${search}` : ''}`;
}

function findPlaceId(path) {
  return path.match(/^#library\/([a-z0-9-]+)$/)?.[1];
}

function placeCost(place) {
  return Number.isFinite(place.cost) && place.cost >= 0 ? currency.format(place.cost) : 'Chưa có giá';
}

function renderResults() {
  const name = foldName(query.value);
  const group = category.value;
  const matching = places.filter((place) => foldName(place.name).includes(name) && (!group || place.category === group));

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

export function renderLibrary(hash, focus, previousHash) {
  const [path, search] = hash.split('?', 2);
  const params = new URLSearchParams(search);
  query.value = params.get('q') ?? '';
  category.value = params.get('group') ?? '';
  const isList = path === '#library';
  $('library-view').hidden = !isList;
  $('library-detail').hidden = isList;

  if (isList) renderResults();
  else {
    const id = findPlaceId(path);
    renderDetail(Object.hasOwn(placeById, id) ? placeById[id] : null);
  }

  const heading = $(isList ? 'library-title' : 'library-detail-title');
  document.title = isList ? 'Library · NonLa Wander' : `${heading.textContent} · Library · NonLa Wander`;
  if (!focus) return;

  const previousPlace = isList && findPlaceId(previousHash.split('?', 1)[0]);
  const previousCard = previousPlace && results.querySelector(`[data-place-id="${previousPlace}"]`);
  if (previousCard) previousCard.focus();
  else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    heading.focus({ preventScroll: true });
  }
}

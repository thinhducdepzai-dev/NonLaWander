import { baseLibraryPlaces } from './data.js';
import { fields, isFixture, validateBatch } from './library-handoff.js';
import { approveLibrary, hasCoordinates, isLocalLibrary, materializeLibrary, readLibrary, reviewCandidate } from './library-import.js';

const $ = (id) => document.getElementById(id);
const file = $('review-file');
const form = $('review-form');
const rows = $('review-rows');
const publish = $('review-publish');
const allowed = isLocalLibrary(location.hostname);
const currency = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const selections = new Map();
let batch;
let busy = false;
let loadId = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function externalLink(title, url) {
  const link = element('a', title, 'back-link');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function feedback(message, error = '') {
  $('review-message').textContent = message;
  $('review-error').textContent = error;
  $('review-error').hidden = !error;
}

function syncSelection() {
  $('review-selected').textContent = `Đã chọn ${selections.size}`;
  publish.disabled = busy || !allowed || !selections.size;
}

function sourceInfo({ url, note }) {
  const { hostname, pathname, searchParams } = new URL(url);
  const on = (domain) => hostname === domain || hostname.endsWith('.' + domain);
  const path = pathname.split('/').filter(Boolean);
  const [first = ''] = path;
  const networks = [
    ['TikTok', 'tiktok.com', path[1] === 'video' || path[1] === 'photo' || first === 't' || /^(?:vm|vt)\./.test(hostname), first.startsWith('@') && path.length === 1],
    ['Facebook', 'facebook.com', path.some((part) => ['posts', 'videos', 'reel', 'reels', 'photos'].includes(part))
      || (['watch', 'permalink.php', 'story.php'].includes(first) && (searchParams.has('v') || searchParams.has('story_fbid')))
      || (first === 'share' && ['p', 'v', 'r'].includes(path[1])),
    first === 'profile.php' ? searchParams.has('id') : first === 'people' || (path.length === 1 && !['events', 'groups', 'login', 'share', 'watch', 'pages'].includes(first))],
    ['Instagram', 'instagram.com', ['p', 'reel', 'reels', 'tv'].includes(first) && path.length > 1,
      path.length === 1 && !['accounts', 'explore', 'stories', 'p', 'reel', 'reels', 'tv'].includes(first)],
    ['Threads', on('threads.net') ? 'threads.net' : 'threads.com', path[1] === 'post' || first === 't', first.startsWith('@') && path.length === 1],
  ];
  const [channel, , post, profile] = networks.find(([, domain]) => on(domain)) ?? [];
  const snippet = /chỉ (?:đọc|xem) được (?:tiêu đề|snippet)|chỉ có (?:tiêu đề|trích đoạn)/iu.test(note ?? '');
  const type = post ? 'Bài đăng / video' : profile ? 'Hồ sơ' : 'Nguồn';
  return { label: [channel, type, snippet && 'Chỉ đọc được tiêu đề/snippet'].filter(Boolean).join(' · '),
    rank: post ? Number(snippet) : profile ? 4 : 2 + Number(snippet) };
}

function sourceList(sources) {
  const list = element('ul', undefined, 'review-sources');
  const sorted = sources.map((source) => ({ source, ...sourceInfo(source) })).sort((a, b) => a.rank - b.rank);
  for (const { source, label } of sorted) {
    const item = element('li');
    item.append(element('small', label, 'review-source-label'), externalLink(source.title ?? new URL(source.url).hostname, source.url));
    const coverage = source.supports.map((key) => fields[key]).join(', ');
    item.append(element('p', [coverage, source.checkedOn && `Đối chiếu ${source.checkedOn}`].filter(Boolean).join(' · '), 'helper'));
    if (source.note) item.append(element('p', source.note, 'review-quote'));
    list.append(item);
  }
  return list;
}

function candidateRow(candidate, plan) {
  const row = element('li', undefined, 'review-row');
  const select = document.createElement('input');
  select.type = 'checkbox';
  select.id = `review-candidate-${candidate.id}`;
  const title = element('h3', candidate.name);
  const label = element('label', 'Chọn ' + candidate.name, 'sr-only');
  label.htmlFor = select.id;
  const identity = element('div', undefined, 'review-identity');
  identity.append(title, element('p', [candidate.branch, candidate.address].filter(Boolean).join(' · ') || 'Chưa có địa chỉ', 'helper'));
  const fixture = isFixture(candidate);
  const caption = fixture ? 'Dữ liệu thử · Chỉ xem trước' : plan.action === 'merge' ? 'Bổ sung nguồn'
    : plan.action === 'new' ? 'Thêm địa điểm' : 'Cần chọn chi nhánh';
  identity.append(element('strong', caption, 'review-action'));
  if (plan.action === 'merge') identity.append(element('p', `Library · ${plan.places[0].id}`, 'helper'));
  if (!fixture && plan.reason) identity.append(element('p', plan.reason, 'helper'));

  function hasPin() {
    const place = plan.action === 'merge' ? plan.places[0] : plan.places.find(({ id }) => id === choice?.value);
    return (place && hasCoordinates(place)) || (candidate.coordinates && candidate.sources.some(({ supports }) => supports.includes('coordinates')));
  }
  const pin = element('p', 'Chờ ghim vị trí', 'review-pin');
  identity.append(pin);
  let choice;
  if (!fixture && plan.action === 'choose' && (plan.places.length || plan.allowNew)) {
    const field = element('label', 'Chi nhánh nhận nguồn', 'review-choice');
    choice = document.createElement('select');
    choice.add(new Option('Bỏ qua', ''));
    for (const place of plan.places) choice.add(new Option(`${place.name} · ${place.address ?? 'Chưa có địa chỉ'} · ${place.id}`, place.id));
    if (plan.allowNew) choice.add(new Option('Thêm địa điểm tại địa chỉ trong tệp', 'new'));
    choice.addEventListener('change', () => {
      select.disabled = !choice.value || !allowed;
      select.checked = !!choice.value && allowed;
      pin.hidden = !!hasPin();
      changeSelection();
    });
    field.append(choice);
    identity.append(field);
  }
  if (Object.hasOwn(candidate, 'pricePerPersonVnd')) identity.append(element('p', `${currency.format(candidate.pricePerPersonVnd)}/người`, 'helper'));
  if (candidate.image) {
    const image = element('p', undefined, 'helper');
    image.append(externalLink('Ảnh tham khảo', candidate.image.referenceUrl));
    if (candidate.image.displayPermission) image.append(' · ', externalLink('Căn cứ quyền dùng ảnh', candidate.image.displayPermission.evidenceUrl));
    identity.append(image);
  }

  pin.hidden = fixture || !!hasPin();
  select.disabled = !allowed || fixture || plan.action === 'choose';
  const changeSelection = () => {
    if (select.checked) selections.set(candidate.id, choice?.value ?? (plan.action === 'new' ? 'new' : 'auto'));
    else selections.delete(candidate.id);
    syncSelection();
  };
  select.addEventListener('change', changeSelection);
  const selectable = element('div', undefined, 'review-checkbox');
  selectable.append(select, label);
  row.append(selectable, identity, sourceList(candidate.sources));
  return row;
}

function renderPendingPins(entries, places) {
  const ids = new Set(entries.map(({ libraryId }) => libraryId));
  const pending = places.filter((place) => ids.has(place.id) && !hasCoordinates(place));
  $('review-pending-pins').hidden = !pending.length;
  $('review-pins').replaceChildren(...pending.map((place) => {
    const item = element('li');
    const link = element('a', place.name, 'back-link');
    link.href = `/#library/${place.id}`;
    item.append(link);
    if (place.address) item.append(' · ', place.address);
    return item;
  }));
}

function render() {
  const entries = readLibrary(localStorage);
  const places = materializeLibrary(baseLibraryPlaces, entries);
  renderPendingPins(entries, places);
  rows.replaceChildren(...batch.candidates.map((candidate) => candidateRow(candidate, reviewCandidate(candidate, places, entries))));
  $('review-total').textContent = `${batch.candidates.length} ứng viên`;
  form.hidden = false;
  syncSelection();
}

file.disabled = !allowed;
if (!allowed) feedback('', 'Màn duyệt chỉ mở trên localhost.');
else {
  try {
    const entries = readLibrary(localStorage);
    renderPendingPins(entries, materializeLibrary(baseLibraryPlaces, entries));
  } catch (error) {
    feedback('', error.message);
  }
}

file.addEventListener('change', async () => {
  const version = ++loadId;
  const [selected] = file.files;
  batch = undefined;
  selections.clear();
  form.hidden = true;
  feedback(selected ? 'Đang đọc tệp…' : '');
  if (!selected) return;
  try {
    const parsed = JSON.parse((await selected.text()).replace(/^\uFEFF/, ''));
    if (version !== loadId) return;
    validateBatch(parsed);
    batch = parsed;
    render();
    feedback(parsed.candidates.length ? '' : 'Tệp này chưa có ứng viên.');
  } catch (error) {
    if (version === loadId) feedback('', error.message);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!allowed || !batch || busy || !selections.size) return;
  const chosen = new Map(selections);
  busy = true;
  file.disabled = true;
  syncSelection();
  try {
    const save = () => approveLibrary(localStorage, baseLibraryPlaces, batch, chosen);
    const approved = await (navigator.locks ? navigator.locks.request('nonla-wander-library', save) : save());
    selections.clear();
    render();
    feedback(`Đã duyệt ${approved.length} mục. Mở Library để xem địa điểm và nguồn đã lưu.`);
  } catch (error) {
    feedback('', error.message);
  } finally {
    busy = false;
    file.disabled = false;
    syncSelection();
  }
});

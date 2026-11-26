import { experienceHref, tripLibraryHref } from './library.js';
import { normalizeWardIds, wardById, wardLibrary, wards, wardSources } from './wards.js';

let boundaryRequest;
const svgNS = 'http://www.w3.org/2000/svg';
const mapWidth = 330;
const mapHeight = 242;

function boundaries() {
  boundaryRequest ??= fetch('/assets/hanoi-wards.geojson').then((response) => {
    if (!response.ok) throw new Error('Ward boundaries unavailable');
    return response.json();
  }).then(({ features }) => {
    if (!wards.every(({ id }) => features.some((feature) => feature.id === id))) throw new Error('Missing ward geometry');
    return features;
  });
  return boundaryRequest;
}

function svgNode(tag, attributes) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function drawMap(features, host, view) {
  const points = features.flatMap(({ geometry }) => geometry.coordinates.flat(2));
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const minLon = Math.min(...lons);
  const maxLat = Math.max(...lats);
  const width = (Math.max(...lons) - minLon) * Math.cos(maxLat * Math.PI / 180);
  const height = maxLat - Math.min(...lats);
  const scale = Math.min((mapWidth - 24) / width, (mapHeight - 18) / height);
  const project = ([lon, lat]) => [
    (lon - minLon) * Math.cos(maxLat * Math.PI / 180) * scale + (mapWidth - width * scale) / 2,
    (maxLat - lat) * scale + (mapHeight - height * scale) / 2,
  ].map((value) => value.toFixed(2));
  const svg = svgNode('svg', { viewBox: `0 0 ${mapWidth} ${mapHeight}`, 'aria-hidden': 'true' });
  const regions = new Map();
  const labels = [];
  for (const { id, geometry, properties } of features) {
    const d = geometry.coordinates.flatMap((polygon) => polygon.map((ring) => `M ${ring.map(project).join(' L ')} Z`)).join(' ');
    const region = svgNode('path', { d, 'fill-rule': 'evenodd', 'data-ward-map': id });
    region.addEventListener('click', () => view(id, true));
    const [x, y] = project(properties.label);
    const text = svgNode('text', { x, y, 'text-anchor': 'middle', 'data-ward-label': id });
    text.textContent = wardById[id].name;
    svg.append(region);
    labels.push(text);
    regions.set(id, { region, text });
  }
  svg.append(...labels);
  host.replaceChildren(svg);
  return regions;
}

function links(items, href) {
  return items.map((item) => {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = href(item.id);
    link.textContent = item.name;
    row.append(link);
    return row;
  });
}

export function setupWardPicker(root, change, openLink) {
  root.classList.add('ward-picker');
  root.innerHTML = `
    <div class="ward-explorer">
      <div class="ward-map-section">
        <div class="ward-map"><p role="status">Đang tải bản đồ phường…</p></div>
        <p class="ward-credit helper" hidden>Ranh giới tham khảo · <a href="${wardSources.boundaries}" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · ${wardSources.snapshot}</p>
        <div class="ward-names" role="group" aria-label="Xem phường theo tên"></div>
        <div class="ward-selections">
          <p class="helper ward-count" aria-live="polite"></p>
          <div class="ward-pills"></div>
          <button class="text-button ward-clear" type="button">Không ưu tiên khu vực</button>
        </div>
      </div>
      <section class="ward-details" aria-label="Chi tiết phường">
        <p class="helper ward-detail-status"></p>
        <h3 class="ward-name" tabindex="-1"></h3>
        <p class="ward-description"></p>
        <button class="primary-button ward-prioritize" type="button"></button>
        <div class="ward-library" hidden>
          <p class="helper ward-ideas-label">Món và hoạt động trong Library</p>
          <ul class="ward-ideas"></ul>
          <p class="helper">Địa điểm trong Library</p>
          <ul class="ward-places"></ul>
        </div>
        <p class="helper ward-empty" hidden>Library chưa có mục đã đối chiếu cho phường này.</p>
      </section>
    </div>`;
  const $ = (selector) => root.querySelector(selector);
  const names = $('.ward-names');
  const pills = $('.ward-pills');
  const prioritize = $('.ward-prioritize');
  const title = $('.ward-name');
  let selected = [];
  let viewed;
  let context;
  let tripId;
  let regions;
  let started = false;

  const buttons = wards.map(({ id, name }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.dataset.wardView = id;
    button.textContent = name;
    button.addEventListener('click', () => view(id, true));
    return button;
  });
  names.append(...buttons);

  function view(id, reveal) {
    viewed = id;
    renderView();
    if (reveal) {
      title.focus({ preventScroll: true });
      title.scrollIntoView({ block: 'nearest', container: 'nearest' });
    }
  }

  function renderView() {
    for (const button of buttons) {
      const id = button.dataset.wardView;
      const chosen = selected.includes(id);
      button.setAttribute('aria-pressed', id === viewed);
      button.dataset.selected = chosen;
      button.setAttribute('aria-label', `${wardById[id].name}${chosen ? ', đã ưu tiên' : ''}`);
    }
    for (const [id, { region, text }] of regions ?? []) {
      for (const node of [region, text]) {
        node.classList.toggle('is-selected', selected.includes(id));
        node.classList.toggle('is-viewed', id === viewed);
      }
    }
    const ward = wardById[viewed];
    const chosen = selected.includes(viewed);
    title.textContent = ward.name;
    $('.ward-detail-status').textContent = chosen ? 'Đang xem · Đã ưu tiên' : 'Đang xem';
    $('.ward-description').textContent = ward.description;
    prioritize.textContent = chosen ? 'Đã ưu tiên phường này' : 'Ưu tiên phường này';
    prioritize.setAttribute('aria-disabled', chosen);
    const { places, experiences } = wardLibrary(viewed);
    $('.ward-library').hidden = !places.length;
    $('.ward-empty').hidden = !!places.length;
    $('.ward-ideas-label').hidden = !experiences.length;
    $('.ward-ideas').hidden = !experiences.length;
    $('.ward-ideas').replaceChildren(...links(experiences.slice(0, 4), (id) => experienceHref(id, tripId)));
    $('.ward-places').replaceChildren(...links(places.slice(0, 4), (id) => tripLibraryHref(tripId, id)));
  }

  function select(ids) {
    selected = ids;
    change(ids);
    renderView();
    renderSelected();
  }

  function renderSelected() {
    $('.ward-count').textContent = selected.length ? `${selected.length} phường ưu tiên` : 'Không ưu tiên phường nào';
    pills.replaceChildren(...selected.map((id) => {
      const button = document.createElement('button');
      button.className = 'ai-pill';
      button.type = 'button';
      button.dataset.removeWard = id;
      button.textContent = `${wardById[id].name} ×`;
      button.setAttribute('aria-label', `Bỏ ưu tiên phường ${wardById[id].name}`);
      button.addEventListener('click', () => {
        const index = selected.indexOf(id);
        select(selected.filter((item) => item !== id));
        (pills.children[Math.min(index, pills.children.length - 1)] ?? $('.ward-clear')).focus({ preventScroll: true });
      });
      return button;
    }));
  }

  prioritize.addEventListener('click', () => {
    if (!selected.includes(viewed)) select([...selected, viewed]);
  });
  $('.ward-clear').addEventListener('click', () => select([]));
  $('.ward-library').addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (link && openLink) openLink(link);
  });

  return {
    render(ids, id) {
      selected = normalizeWardIds(ids);
      tripId = id;
      if (context !== id) {
        viewed = selected[0] ?? wards[0].id;
        context = id;
      }
      renderView();
      renderSelected();
      if (started) return;
      started = true;
      boundaries().then((features) => {
        regions = drawMap(features, $('.ward-map'), view);
        $('.ward-credit').hidden = false;
        renderView();
      }).catch(() => {
        $('.ward-map p').textContent = 'Bản đồ chưa tải được. Bạn có thể chọn phường theo tên bên dưới.';
        $('.ward-map').classList.add('ward-map-unavailable');
      });
    },
  };
}

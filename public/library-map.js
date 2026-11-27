import * as L from '/vendor/leaflet.js';
import { icon } from './icons.js';
import { hasCoordinates } from './library-import.js';
import { libraryImage } from './library-images.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = '/vendor/leaflet.css';
await new Promise((resolve, reject) => {
  css.onload = resolve;
  css.onerror = () => reject(new Error('Chưa tải được kiểu bản đồ'));
  document.head.append(css);
});

const $ = (id) => document.getElementById(id);
const position = (p) => [p.lat, p.lon];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const narrow = window.matchMedia('(max-width: 720px)');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function createPlaceMap() {
  const canvas = $('place-map-canvas');
  const preview = $('map-preview');
  const list = $('library-places');
  const map = L.map(canvas, { zoomControl: false, zoomAnimation: false, fadeAnimation: false,
    markerZoomAnimation: false, scrollWheelZoom: false, minZoom: 3, maxZoom: 19 });
  L.control.zoom({ position: 'topright', zoomInTitle: 'Phóng to', zoomOutTitle: 'Thu nhỏ' }).addTo(map);
  map.attributionControl.setPrefix(false);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    keepBuffer: 1,
  }).addTo(map);
  // Label the lakeside street at neighbourhood zoom, where raster labels can fall outside the viewport.
  const street = L.marker([21.0300, 105.8538], {
    interactive: false, keyboard: false, pane: 'overlayPane',
    icon: L.divIcon({ className: 'map-orientation street-label',
      html: element('span', 'Đinh Tiên Hoàng'), iconSize: [0, 0] }),
  });
  const markers = L.layerGroup().addTo(map);
  const pins = new Map();
  let places = [];
  let options;
  let selected;
  let pinned = false;
  let timer;
  let restoring = false;
  let route;
  let returningFocus = false;
  let label;

  function visible() {
    return route === location.hash && canvas.checkVisibility();
  }

  function save() {
    if (restoring || !visible()) return;
    const center = map.getCenter();
    const placeMap = { center: [center.lat, center.lng], zoom: map.getZoom(),
      selected: selected?.id, scroll: list.scrollTop, pageY: window.scrollY };
    history.replaceState({ ...history.state, placeMap }, '', location.href);
  }

  function positionCard() {
    if (preview.hidden || narrow.matches || !selected) return;
    const { x, y } = map.latLngToContainerPoint(position(selected));
    const { width, height } = canvas.getBoundingClientRect();
    const card = preview.getBoundingClientRect();
    const left = x + card.width + 20 <= width ? x + 16 : x - card.width - 16;
    preview.style.left = Math.max(4, Math.min(width - card.width - 4, left)) + 'px';
    preview.style.top = Math.max(4, Math.min(height - card.height - 20, y - card.height / 2)) + 'px';
  }

  function highlight() {
    for (const marker of new Set(pins.values())) {
      const active = selected && pins.get(selected.id) === marker;
      marker.getElement().classList.toggle('is-selected', !!active);
      marker.setZIndexOffset(active ? 1000 : 0);
    }
    for (const link of list.querySelectorAll('[data-place-id]')) {
      link.classList.toggle('is-selected', link.dataset.placeId === selected?.id);
    }
  }

  function close(focus = false) {
    clearTimeout(timer);
    const pin = pins.get(selected?.id)?.getElement();
    pinned = false;
    label?.remove();
    selected = null;
    preview.hidden = true;
    preview.replaceChildren();
    highlight();
    if (focus && pin) {
      returningFocus = true;
      pin.focus({ preventScroll: true });
      returningFocus = false;
    }
  }

  function choose(place, lock, group = []) {
    clearTimeout(timer);
    selected = place;
    pinned = lock;
    label?.remove();
    if (narrow.matches) {
      label = L.tooltip({ permanent: true, direction: 'auto', offset: [15, -21], opacity: 1 })
        .setLatLng(position(place)).setContent(element('strong', place.name)).addTo(map);
    }
    const name = element('h3', place.name);
    const closeButton = element('button', '', 'preview-close');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Đóng thẻ xem nhanh');
    closeButton.innerHTML = icon('close');
    closeButton.onclick = () => close(true);
    const body = element('div', '', 'preview-body');
    body.append(name);
    for (const text of [place.branch, [place.category, place.address || options.area(place)].filter(Boolean).join(' · '), options.cost(place)]) {
      if (text) body.append(element('p', text));
    }
    const detail = element('a', 'Xem chi tiết', 'primary-button');
    detail.href = options.detail(place.id);
    detail.onclick = () => {
      pinned = true;
      save();
      options.onDetail(place.id);
    };
    body.append(detail);
    if (group.length > 1) {
      const choices = element('select');
      choices.setAttribute('aria-label', 'Chọn địa điểm trong cụm');
      for (const item of group) choices.add(new Option([item.name, item.branch || item.address].filter(Boolean).join(' · '), item.id));
      choices.value = place.id;
      choices.onchange = () => {
        choose(group.find((item) => item.id === choices.value), true, group);
        preview.querySelector('select').focus();
      };
      body.prepend(choices);
    }
    preview.replaceChildren();
    if (place.image) preview.append(libraryImage(place.image, { onError: positionCard }));
    preview.append(body, closeButton);
    preview.hidden = false;
    positionCard();
    highlight();
  }

  function laterClose() {
    clearTimeout(timer);
    if (!pinned) timer = setTimeout(() => {
      if (!preview.matches(':hover, :focus-within')) close();
    }, 240);
  }
  preview.onpointerenter = () => clearTimeout(timer);
  preview.onpointerleave = laterClose;
  preview.onfocusin = () => clearTimeout(timer);
  preview.onfocusout = laterClose;

  function drawPins() {
    if (map.getZoom() >= 16 && map.getZoom() <= 18) street.addTo(map);
    else street.remove();
    markers.clearLayers();
    pins.clear();
    const groups = [];
    for (const place of places) {
      const point = map.project(position(place));
      const group = groups.find((g) => g.point.distanceTo(point) < 38);
      if (group) group.items.push(place);
      else groups.push({ point, items: [place] });
    }
    for (const { items } of groups) {
      const first = items[0];
      const cluster = items.length > 1;
      const title = cluster ? items.length + ' địa điểm gần nhau' : first.name;
      const marker = L.marker(position(first), {
        title, alt: title, autoPanOnFocus: false, bubblingMouseEvents: false,
        icon: L.divIcon({ className: 'wander-pin', iconSize: [44, 44], iconAnchor: [22, 42],
          html: '<span>' + (cluster ? items.length : icon(first.icon || 'pin')) + '</span>' }),
      }).addTo(markers);
      const node = marker.getElement();
      node.dataset.placeId = first.id;
      for (const item of items) pins.set(item.id, marker);
      node.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse' && !pinned) {
          clearTimeout(timer);
          timer = setTimeout(() => choose(first, false, items), 180);
        }
      });
      node.onpointerleave = laterClose;
      node.onfocus = () => {
        if (!returningFocus && !pinned && node.matches(':focus-visible')) choose(first, false, items);
      };
      node.onblur = laterClose;
      node.onkeydown = (event) => {
        if (['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          choose(first, true, items);
          preview.querySelector('select, a').focus();
        }
      };
      marker.on('click', () => choose(first, true, items));
      marker.options.group = items;
    }
    highlight();
  }

  function fit() {
    if (places.length === 1) map.setView(position(places[0]), 16, { animate: false });
    else if (places.length) map.fitBounds(places.map(position), { padding: [36, 48], maxZoom: 16, animate: false });
  }

  tiles.on('tileerror', () => { $('map-tile-error').hidden = false; });
  tiles.on('load', () => {
    $('map-tile-error').hidden = !canvas.querySelector('.leaflet-tile:not(.leaflet-tile-loaded)');
  });
  map.on('click', () => close());
  map.on('move', positionCard);
  map.on('zoomend', () => { if (!restoring) drawPins(); });
  map.on('moveend', save);
  $('map-fit').onclick = fit;
  $('library-place-map').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !preview.hidden) {
      event.preventDefault();
      close(true);
    }
  });
  list.addEventListener('pointerover', (event) => {
    const id = event.target.closest('[data-place-id]')?.dataset.placeId;
    pins.get(id)?.getElement()?.classList.add('list-hover');
  });
  list.addEventListener('pointerout', (event) => {
    const id = event.target.closest('[data-place-id]')?.dataset.placeId;
    pins.get(id)?.getElement()?.classList.remove('list-hover');
  });
  new ResizeObserver(positionCard).observe(preview);
  new ResizeObserver(() => {
    if (visible()) map.invalidateSize({ pan: false });
  }).observe(canvas);

  function selectResult(id) {
    const place = places.find((p) => p.id === id);
    if (!place) return false;
    choose(place, true, pins.get(id)?.options.group);
    return true;
  }

  return {
    selectResult,
    retry() { $('map-tile-error').hidden = true; tiles.redraw(); },
    show(matches, settings) {
      restoring = true;
      route = location.hash;
      options = settings;
      close();
      places = matches.filter(hasCoordinates);
      const saved = options.restore;
      map.invalidateSize({ pan: false });
      const target = places.find((p) => p.id === options.target);
      if (saved?.center) map.setView(saved.center, saved.zoom, { animate: false });
      else if (target) map.setView(position(target), 16, { animate: false });
      else fit();
      drawPins();
      if (saved?.selected || target) selectResult(saved?.selected || target.id);
      list.scrollTop = saved?.scroll || 0;
      if (saved) {
        window.scrollTo({ top: saved.pageY, behavior: 'instant' });
        if (saved.selected) preview.querySelector('a')?.focus({ preventScroll: true });
      }
      restoring = false;
      if (reduced.matches) map.options.inertia = false;
    },
  };
}

import { areas, placeById } from './data.js';
import { icon } from './icons.js';
import { conflictMessage, filterLibraryPlaces, libraryGroups, slotLabel } from './library.js';
import { prepareRequest } from './planner.js';

const $ = (id) => document.getElementById(id);

export function setupTripLibrary({ trips, refresh, changeLayout, focusSetup, onAdded }) {
  const panel = $('trip-library-panel');
  const toggle = $('trip-library-toggle');
  const query = $('trip-library-query');
  const group = $('trip-library-group');
  const results = $('trip-library-results');
  const selection = $('trip-library-selection');
  const slotSelect = $('trip-library-slot');
  const error = $('trip-library-error');
  const success = $('trip-library-success');
  const setup = $('trip-library-setup');
  const resume = $('trip-library-resume');
  const timeline = $('timeline');
  let tripId;
  let plan;
  let slots = [];
  let validation = {};
  let selected;
  let dragged;

  for (const name of libraryGroups) group.add(new Option(name, name));

  function renderCurrentPlace() {
    panel.classList.toggle('has-selection', !!selected);
    selection.hidden = !selected;
    $('trip-library-selected').textContent = selected?.name ?? '';
    for (const button of results.querySelectorAll('[data-library-place]')) {
      button.setAttribute('aria-pressed', button.dataset.libraryPlace === selected?.id);
    }
  }

  function renderResults() {
    const matches = filterLibraryPlaces(query.value, group.value);
    $('trip-library-empty').hidden = !!matches.length;
    results.replaceChildren(...matches.map((place) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'trip-library-place';
      button.dataset.libraryPlace = place.id;
      const name = document.createElement('strong');
      name.textContent = place.name;
      const meta = document.createElement('small');
      const area = areas.find((item) => item.id === place.area)?.label;
      meta.textContent = [place.category, area].filter(Boolean).join(' · ');
      button.append(name, meta);

      const grip = document.createElement('span');
      grip.className = 'timeline-grip trip-library-grip';
      grip.draggable = true;
      grip.dataset.libraryDrag = place.id;
      grip.setAttribute('aria-hidden', 'true');
      grip.title = `Kéo ${place.name}`;
      grip.innerHTML = `${icon('grip')} Kéo`;
      row.append(button, grip);
      return row;
    }));
    renderCurrentPlace();
  }

  function renderPlacement() {
    const slot = slots.find((item) => item.id === slotSelect.value);
    if (!slot) return;
    const last = plan?.slots.find((item) => item.id === slot.id)?.stops.at(-1);
    $('trip-library-placement').textContent = last ? `Thêm sau ${placeById[last.placeId].name}.` : 'Thêm làm điểm đầu tiên.';
  }

  function renderSlots(preferred = slotSelect.value) {
    slotSelect.replaceChildren(...slots.map((slot) => new Option(slotLabel(slot), slot.id)));
    if (slots.some(({ id }) => id === preferred)) slotSelect.value = preferred;
    const ready = !!slots.length;
    $('trip-library-slot-field').hidden = !ready;
    $('trip-library-submit').hidden = !ready;
    $('trip-library-guidance').hidden = ready;
    $('trip-library-guidance').textContent = Object.values(validation)[0] ?? '';
    setup.hidden = ready;
    renderPlacement();
  }

  function clearDrop() {
    const marker = timeline.querySelector('.trip-library-drop-active');
    if (!marker) return;
    marker.classList.remove('trip-library-drop-active');
    marker.querySelector('strong').textContent = 'Thả ở cuối buổi';
  }

  function finishDrag() {
    dragged = null;
    panel.classList.remove('is-library-dragging');
    timeline.classList.remove('is-library-dragging');
    clearDrop();
  }

  function close(restoreFocus = false) {
    if (panel.hidden) return;
    finishDrag();
    selected = null;
    resume.hidden = true;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    $('trip-library-toggle-label').textContent = 'Thêm từ thư viện';
    changeLayout(false);
    if (restoreFocus) {
      refresh();
      toggle.focus();
    }
  }

  function clearFeedback() {
    error.hidden = true;
    success.hidden = true;
  }

  function choose(placeId) {
    selected = placeById[placeId];
    clearFeedback();
    renderCurrentPlace();
    renderSlots();
  }

  function showError(messages) {
    const heading = document.createElement('strong');
    heading.textContent = 'Chưa thêm địa điểm. Hãy kiểm tra buổi đích hoặc chọn buổi khác.';
    const list = document.createElement('ul');
    for (const message of messages) {
      const item = document.createElement('li');
      item.textContent = message;
      list.append(item);
    }
    error.replaceChildren(heading, list);
    error.hidden = false;
    error.focus();
  }

  function add(placeId, slotId) {
    if (panel.hidden || !tripId || !slotId) return;
    clearFeedback();
    const result = trips.addVisit(tripId, { placeId, slotId });
    if (!result.trip) {
      const messages = result.conflicts?.map(conflictMessage) ?? Object.values(result.errors ?? {});
      refresh();
      renderSlots(slotId);
      showError(messages.length ? messages : ['Buổi đích đã thay đổi. Hãy chọn lại.']);
      return;
    }

    const slot = result.trip.draft.plan.slots.find((item) => item.id === slotId);
    success.textContent = `Đã thêm ${placeById[placeId].name} vào ${slotLabel(slot)}.`;
    success.hidden = false;
    onAdded(result.trip);
    slotSelect.value = slotId;
    renderPlacement();
  }

  toggle.addEventListener('click', () => {
    if (!panel.hidden) {
      close(true);
      return;
    }
    query.value = '';
    group.value = '';
    clearFeedback();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    $('trip-library-toggle-label').textContent = 'Đóng thư viện';
    changeLayout(true);
    renderResults();
    refresh();
    query.focus();
  });
  $('trip-library-close').addEventListener('click', () => close(true));
  query.addEventListener('input', renderResults);
  group.addEventListener('change', renderResults);
  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-library-place]');
    if (!button) return;
    choose(button.dataset.libraryPlace);
    (slots.length ? slotSelect : setup).focus();
  });
  $('trip-library-change').addEventListener('click', () => {
    selected = null;
    resume.hidden = true;
    clearFeedback();
    renderCurrentPlace();
    query.focus();
  });
  slotSelect.addEventListener('change', () => {
    clearFeedback();
    renderPlacement();
  });
  setup.addEventListener('click', () => {
    if (!selected) return;
    resume.textContent = `Tiếp tục thêm ${selected.name}`;
    resume.hidden = false;
    focusSetup(validation);
  });
  resume.addEventListener('click', () => {
    resume.hidden = true;
    (slots.length ? slotSelect : setup).focus();
  });
  $('trip-library-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (selected) add(selected.id, slotSelect.value);
  });

  results.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('[data-library-drag]');
    if (!handle) return;
    choose(handle.dataset.libraryDrag);
    if (!slots.length) {
      event.preventDefault();
      setup.focus();
      return;
    }
    dragged = selected;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-nonla-place', dragged.id);
    event.dataTransfer.setDragImage(handle.previousElementSibling, 16, 22);
    panel.classList.add('is-library-dragging');
    timeline.classList.add('is-library-dragging');
  });
  results.addEventListener('dragend', finishDrag);

  timeline.addEventListener('dragover', (event) => {
    if (!dragged) return;
    const zone = event.target.closest('[data-library-slot]');
    if (!zone) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (zone.classList.contains('trip-library-drop-active')) return;
    clearDrop();
    zone.classList.add('trip-library-drop-active');
    zone.querySelector('strong').textContent = `Thả ${dragged.name} ở cuối buổi`;
  });
  timeline.addEventListener('dragleave', (event) => {
    const zone = event.target.closest('.trip-library-drop-active');
    if (zone && !zone.contains(event.relatedTarget)) clearDrop();
  });
  timeline.addEventListener('drop', (event) => {
    const zone = event.target.closest('[data-library-slot]');
    if (!dragged || !zone) return;
    event.preventDefault();
    const placeId = dragged.id;
    finishDrag();
    add(placeId, zone.dataset.librarySlot);
  });

  return {
    get open() { return !panel.hidden; },
    close,
    sync(trip, form, currentPlan, confirmed) {
      tripId = trip?.id;
      plan = currentPlan;
      toggle.hidden = !trip || confirmed;
      if (panel.hidden || !trip || confirmed) return [];
      const result = prepareRequest(form);
      slots = result.request?.slots ?? [];
      validation = result.errors ?? {};
      renderSlots();
      return slots;
    },
  };
}

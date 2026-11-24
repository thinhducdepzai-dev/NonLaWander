import { areas, periodById, placeById } from './data.js';
import { filterLibraryPlaces, libraryGroups } from './library.js';
import { clock } from './planner.js';

const $ = (id) => document.getElementById(id);
const dialog = $('replace-dialog');
const query = $('replace-query');
const group = $('replace-group');
const results = $('replace-results');
const confirm = $('replace-confirm');
const currency = new Intl.NumberFormat('vi-VN');
const money = (amount) => `${currency.format(amount)} ₫`;

for (const name of libraryGroups) group.add(new Option(name, name));

function showContext(slot, placeId) {
  const date = slot.date.split('-').reverse().join('/');
  $('replace-context').textContent = `Đang thay ${placeById[placeId].name}`;
  $('replace-window').textContent = `${periodById[slot.period].label} ${date} · Khung giờ nháp ${clock(slot.start)}–${clock(slot.end)}`;
}

function showStep(preview) {
  $('replace-picker').hidden = preview;
  $('replace-preview').hidden = !preview;
  $('replace-actions').hidden = !preview;
  $('replace-refresh').hidden = true;
  $('replace-error').hidden = true;
}

function showErrors(messages) {
  const field = $('replace-error');
  field.hidden = !messages.length;
  const list = document.createElement('ul');
  for (const message of messages) {
    const item = document.createElement('li');
    item.textContent = message;
    list.append(item);
  }
  field.replaceChildren(list);
}

function errorMessages(preview) {
  const messages = preview.conflicts.map((issue) => {
    const name = placeById[issue.placeId].name;
    return issue.code === 'fixed'
      ? `Đến ${name} sớm nhất lúc ${clock(issue.ready)}, sau giờ cố định ${clock(issue.start)}.`
      : `${name} dự kiến kết thúc lúc ${clock(issue.departure)}, sau giờ kết thúc buổi ${clock(issue.end)}.`;
  });
  if (preview.after.overBudget) messages.push(`Vượt ngân sách ${money(preview.after.overBudget)}/người.`);
  return messages;
}

function costText({ total, missingCostCount }) {
  return missingCostCount ? `${money(total)} · ${missingCostCount} lượt chưa có giá` : money(total);
}

function showComparison({ before, after }) {
  const rows = [['Giờ đến dự kiến', clock(before.arrival), clock(after.arrival)]];
  if (before.incoming) rows.push([`Đi bộ từ ${placeById[before.incoming.placeId].name}`, `${before.incoming.minutes} phút`, `${after.incoming.minutes} phút`]);
  if (before.outgoing) rows.push([`Đi bộ đến ${placeById[before.outgoing.placeId].name}`, `${before.outgoing.minutes} phút`, `${after.outgoing.minutes} phút`]);
  rows.push(['Tổng chi phí/người', costText(before), costText(after)]);

  $('replace-comparison').replaceChildren(...rows.map(([label, oldValue, newValue]) => {
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    row.append(heading);
    row.insertCell().textContent = oldValue;
    row.insertCell().textContent = newValue;
    return row;
  }));
}

function showPreview(preview, changed) {
  showStep(true);
  showContext(preview.slot, preview.before.placeId);
  $('replace-route').textContent = `${placeById[preview.before.placeId].name} → ${placeById[preview.after.placeId].name}`;
  showComparison(preview);
  $('replace-budget').textContent = `Ngân sách bản nháp ${money(preview.budget)}/người.`;
  const opening = [...new Set(preview.openingWarnings)].map((id) => placeById[id].name);
  $('replace-opening').hidden = !opening.length;
  $('replace-opening').textContent = `Lượt ghé ngoài giờ mở cửa tham khảo ở ${opening.join(', ')}.`;
  const messages = errorMessages(preview);
  showErrors(messages);
  confirm.disabled = !!messages.length;
  if (changed) {
    $('replace-refresh').textContent = 'Bản nháp đã thay đổi. Hãy xem lại kết quả mới trước khi xác nhận.';
    $('replace-refresh').hidden = false;
  }
  $('replace-preview-title').focus();
  dialog.scrollTop = 0;
}

export function setupReplacement({ trips, onSaved, focusVisit }) {
  let context;
  let candidate;
  let fingerprint;

  function renderResults() {
    const matching = filterLibraryPlaces(query.value, group.value).filter((place) => place.id !== context.placeId);
    $('replace-result-count').textContent = matching.length ? `${matching.length} địa điểm` : 'Không tìm thấy địa điểm. Thử tên hoặc nhóm khác.';
    results.replaceChildren(...matching.map((place) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'replace-place';
      button.dataset.place = place.id;
      const name = document.createElement('strong');
      name.textContent = place.name;
      const meta = document.createElement('span');
      meta.textContent = [place.category, areas.find(({ id }) => id === place.area)?.label].filter(Boolean).join(' · ');
      button.append(name, meta);
      item.append(button);
      return item;
    }));
  }

  function showResult(result) {
    if (result.preview) {
      context.placeId = result.preview.before.placeId;
      fingerprint = result.fingerprint;
      showPreview(result.preview, result.changed);
    } else {
      confirm.disabled = true;
      const message = result.error === 'place'
        ? 'Điểm này không còn phù hợp để thay. Hãy chọn địa điểm khác.'
        : 'Lượt ghé đã thay đổi vị trí hoặc không còn trong buổi này. Hãy mở lại từ timeline.';
      showErrors([message]);
      $('replace-error').focus();
    }
  }

  query.addEventListener('input', renderResults);
  group.addEventListener('change', renderResults);
  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-place]');
    if (!button) return;
    candidate = button.dataset.place;
    const { tripId, slotId, stopId } = context;
    showResult(trips.previewReplacement(tripId, { slotId, stopId, placeId: candidate }));
  });
  $('replace-back').addEventListener('click', () => {
    showStep(false);
    renderResults();
    (results.querySelector(`[data-place="${candidate}"]`) ?? query).focus();
  });
  confirm.addEventListener('click', () => {
    if (!dialog.open || confirm.disabled) return;
    const { tripId, slotId, stopId } = context;
    const result = trips.replaceVisit(tripId, { slotId, stopId, placeId: candidate }, fingerprint);
    if (!result.trip) {
      showResult(result);
      return;
    }
    context.stopId = result.stopId;
    onSaved(result.trip, placeById[candidate].name);
    dialog.close();
  });
  $('replace-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => focusVisit(context));

  return {
    open(tripId, slotId, stopId) {
      const slot = trips.get(tripId)?.draft.plan?.slots.find((item) => item.id === slotId);
      const stop = slot?.stops.find((item) => item.id === stopId);
      if (!stop) return false;
      context = { tripId, slotId, stopId, placeId: stop.placeId };
      candidate = undefined;
      fingerprint = undefined;
      query.value = '';
      group.value = '';
      showContext(slot, stop.placeId);
      showStep(false);
      renderResults();
      dialog.showModal();
      query.focus();
      dialog.scrollTop = 0;
      return true;
    },
    close() { if (dialog.open) dialog.close(); },
  };
}

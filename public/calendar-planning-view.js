import { dayOf, momentLabel, timeOf } from './calendar.js';
import { planningForm, planningIssue, planningQuestions } from './calendar-planning.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);

export function setupCalendarPlanning({ getTrip, getCalendar, save, apply, undo }) {
  const form = $('calendar-planning-form');
  const choices = $('calendar-planning-choices');
  const number = $('calendar-planning-number');
  const free = $('calendar-planning-custom');
  const title = $('calendar-planning-question');
  const content = $('calendar-planning-body');
  const result = $('calendar-planning-result');
  const error = $('calendar-planning-error');
  let context;

  function render() {
    const trip = getTrip();
    const progress = planningForm(trip);
    const question = planningQuestions[progress.step];
    const done = progress.result && !progress.result.undone;
    const finalStep = progress.step === planningQuestions.length - 1;
    const value = progress.answers[question.key];
    const key = `${trip.id}/${question.key}`;
    if (key !== context) {
      error.textContent = '';
      context = key;
      content.scrollTop = 0;
    }
    $('calendar-planning-step').textContent = `Bước ${progress.step + 1}/${planningQuestions.length}`;
    const bar = $('calendar-planning-progress');
    bar.max = planningQuestions.length;
    bar.value = progress.step + 1;
    $('calendar-planning-progress-group').hidden = !!done;
    $('calendar-planning-controls').hidden = !!done;
    result.hidden = !done;
    $('calendar-planning-actions').hidden = !!done;
    $('calendar-planning-back').hidden = progress.step === 0;
    $('calendar-planning-skip').hidden = finalStep || Boolean(question.required);
    $('calendar-planning-submit').textContent = finalStep
      ? getCalendar().events.length ? 'Cập nhật lịch nháp' : 'Tạo lịch nháp'
      : 'Xác nhận';
    if (done) {
      renderReceipt(progress.result, trip.draft.calendarUndoId);
      return;
    }

    title.textContent = question.title;
    $('calendar-planning-hint').textContent = question.type === 'multiple' ? 'Có thể chọn nhiều mục'
      : question.key === 'transport' ? 'Bản demo hiện tính đường đi bộ.' : '';
    const calendar = getCalendar();
    const when = dayOf(calendar.start) === dayOf(calendar.end)
      ? `${momentLabel(calendar.start)}–${timeOf(calendar.end)}`
      : `${momentLabel(calendar.start)} → ${momentLabel(calendar.end)}`;
    $('calendar-planning-range').textContent = when;
    $('calendar-planning-range').hidden = progress.step !== 0;
    $('calendar-planning-number-field').hidden = question.type !== 'number';
    if (question.type === 'number') {
      $('calendar-planning-number-label').textContent = question.label;
      if (document.activeElement !== number || number.value !== value) number.value = value;
    }
    choices.hidden = !question.options;
    if (question.options && choices.dataset.question !== question.key) {
      choices.dataset.question = question.key;
      choices.replaceChildren(...question.options.map((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-pill';
        button.dataset.planningChoice = option.id;
        const mark = document.createElement('span');
        mark.innerHTML = icon('check');
        mark.className = 'planning-choice-mark';
        mark.setAttribute('aria-hidden', 'true');
        button.append(mark, option.label);
        return button;
      }), $('calendar-planning-other'));
    }
    if (question.options) {
      for (const button of choices.querySelectorAll('[data-planning-choice]')) {
        button.setAttribute('aria-pressed', value.ids.includes(button.dataset.planningChoice));
      }
    }
    const showCustom = value?.customOpen ?? Boolean(value?.custom);
    $('calendar-planning-custom-field').hidden = !question.custom || !showCustom;
    $('calendar-planning-other').setAttribute('aria-expanded', !!question.custom && showCustom);
    $('calendar-planning-custom-label').textContent = question.custom ?? '';
    if (question.custom && free.value !== value.custom) free.value = value.custom;
  }

  function renderReceipt(receipt, undoId) {
    const list = $('calendar-planning-changes');
    const heading = $('calendar-planning-result-title');
    heading.textContent = receipt.added.length || receipt.attached.length || receipt.preferencesChanged
      ? 'Đã cập nhật lịch nháp' : 'Lịch nháp giữ nguyên';
    const lines = [
      ...receipt.attached.map((item) => `Đã gắn ${item}`),
      ...receipt.added.map((item) => `Đã thêm ${item}`),
      receipt.preferencesChanged && 'Đã cập nhật số người hoặc ngân sách.',
      ...receipt.notes,
    ].filter(Boolean);
    if (!lines.length) lines.push('Các địa điểm phù hợp đã có trong lịch.');
    list.replaceChildren(...lines.map((text) => {
      const row = document.createElement('li');
      row.textContent = text;
      return row;
    }));
    $('calendar-planning-undo').hidden = !receipt.undoId || receipt.undoId !== undoId;
  }

  function current() {
    const progress = planningForm(getTrip());
    const question = planningQuestions[progress.step];
    return { progress, question, value: progress.answers[question.key] };
  }

  function update(value, step) {
    const { question } = current();
    return save({ key: question.key, value, step });
  }

  function go(step) {
    error.textContent = '';
    number.removeAttribute('aria-invalid');
    update(current().value, step);
    title.focus({ preventScroll: true });
  }

  number.addEventListener('input', () => {
    update(number.value);
    error.textContent = '';
    number.removeAttribute('aria-invalid');
  });
  free.addEventListener('input', () => {
    const { value } = current();
    update({ ...value, custom: free.value });
  });
  choices.addEventListener('click', (event) => {
    const button = event.target.closest('[data-planning-choice]');
    if (!button) return;
    const { question, value } = current();
    const { planningChoice: id } = button.dataset;
    const ids = value.ids.includes(id) ? value.ids.filter((item) => item !== id)
      : question.type === 'single' ? [id] : [...value.ids, id];
    update({ ...value, ids });
  });
  $('calendar-planning-other').addEventListener('click', () => {
    const { value } = current();
    const opened = !(value.customOpen ?? Boolean(value.custom));
    update({ ...value, customOpen: opened });
    if (opened) free.focus();
  });
  $('calendar-planning-back').addEventListener('click', () => go(current().progress.step - 1));
  $('calendar-planning-skip').addEventListener('click', () => {
    const { progress, question } = current();
    update(question.type === 'number' ? '' : { ids: [], custom: '' }, progress.step + 1);
    title.focus({ preventScroll: true });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const { progress, question, value } = current();
    const message = planningIssue(question, value);
    if (message) {
      error.textContent = message;
      number.setAttribute('aria-invalid', 'true');
      number.focus();
      return;
    }
    if (progress.step < planningQuestions.length - 1) {
      go(progress.step + 1);
      return;
    }
    const outcome = apply();
    if (outcome.error) error.textContent = outcome.error;
    else $('calendar-planning-result-title').focus({ preventScroll: true });
  });
  $('calendar-planning-undo').addEventListener('click', () => {
    const receipt = planningForm(getTrip()).result;
    if (receipt?.undoId && undo(receipt.undoId)) {
      error.textContent = 'Đã hoàn tác lần lập lịch.';
      title.focus({ preventScroll: true });
    }
  });
  $('calendar-planning-edit').addEventListener('click', () => go(0));

  return { render };
}

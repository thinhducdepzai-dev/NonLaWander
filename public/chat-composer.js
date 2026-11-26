import { readChatDocument } from './chat-documents.js';
import { activeChatModel } from './chat-models.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);

export function setupChatComposer({ getTrip, models, selectModel }) {
  const form = $('calendar-message-form');
  const input = $('calendar-message');
  const error = $('calendar-chat-error');
  const file = $('calendar-chat-file');
  const pill = $('calendar-chat-attachment');
  const filename = $('calendar-chat-filename');
  const add = $('calendar-chat-add');
  const select = $('calendar-chat-model');
  const menus = new Map([[add, $('calendar-chat-add-options')], [select, $('calendar-chat-model-options')]]);
  const drafts = new Map();
  let tripId;
  let openMenu;

  function current() {
    return drafts.get(tripId);
  }

  function closeMenu(focus = false) {
    if (!openMenu) return;
    const button = openMenu;
    openMenu = undefined;
    menus.get(button).hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  }

  for (const [button, panel] of menus) {
    button.addEventListener('click', () => {
      if (openMenu === button) return closeMenu();
      closeMenu();
      openMenu = button;
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      (panel.querySelector('[aria-pressed="true"]') ?? panel.querySelector('button')).focus();
    });
  }

  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !openMenu) return;
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
  });
  document.addEventListener('pointerdown', (event) => {
    if (openMenu && !openMenu.parentElement.contains(event.target)) closeMenu();
  });
  form.addEventListener('focusout', (event) => {
    if (openMenu && event.relatedTarget && !openMenu.parentElement.contains(event.relatedTarget)) closeMenu();
  });
  $('calendar-ai').querySelector('[data-calendar-close-panel]').addEventListener('click', () => closeMenu());
  const modelOptions = menus.get(select);
  for (const model of models) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button chat-model-option';
    button.dataset.modelId = model.id;
    button.innerHTML = icon('check');
    button.append(model.label);
    button.addEventListener('click', () => {
      if (!selectModel(model.id)) showError('Chưa lưu được lựa chọn model. Hãy thử lại.');
      else showError('');
      closeMenu(true);
    });
    modelOptions.append(button);
  }

  function showError(message) {
    current().error = message;
    error.textContent = message;
  }

  function renderDraft() {
    const draft = current();
    pill.hidden = !draft.attachment;
    filename.textContent = draft.attachment?.name ?? '';
    filename.title = filename.textContent;
    error.textContent = draft.error ?? '';
    form.setAttribute('aria-busy', Boolean(draft.reading));
  }

  $('calendar-chat-choose-file').addEventListener('click', () => {
    closeMenu(true);
    file.click();
  });
  file.addEventListener('change', async () => {
    const [selected] = file.files;
    file.value = '';
    if (!selected) return;
    const draft = current();
    const token = Symbol();
    draft.reading = token;
    showError('');
    form.setAttribute('aria-busy', 'true');
    try {
      const attachment = await readChatDocument(selected);
      if (draft.reading === token) draft.attachment = attachment;
    } catch (failure) {
      if (draft.reading === token) draft.error = failure.message;
    } finally {
      if (draft.reading === token) draft.reading = null;
      if (draft === current()) renderDraft();
    }
  });
  $('calendar-chat-remove-file').addEventListener('click', () => {
    Object.assign(current(), { attachment: null, reading: null, error: '' });
    renderDraft();
    input.focus();
  });
  input.addEventListener('input', () => { current().message = input.value; });

  return {
    render() {
      const trip = getTrip();
      if (tripId !== trip.id) {
        closeMenu();
        tripId = trip.id;
        if (!drafts.has(tripId)) drafts.set(tripId, { message: '' });
        input.value = current().message;
      }
      const model = activeChatModel(models, trip.conversation?.modelId);
      $('calendar-chat-model-label').textContent = model.label;
      for (const button of modelOptions.children) button.setAttribute('aria-pressed', button.dataset.modelId === model.id);
      renderDraft();
    },
    attachment() {
      return current().attachment;
    },
    isReading() {
      return Boolean(current().reading);
    },
    showError,
    clear() {
      Object.assign(current(), { message: '', attachment: null, error: '' });
      input.value = '';
      renderDraft();
    },
  };
}

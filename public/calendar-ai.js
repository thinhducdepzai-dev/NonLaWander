import { areas, experienceById, experiencePlaces, experiences, places, vibes } from './data.js';
import { availableStart, dayCount, dayMinutes, dayStart, momentLabel, placeCategory, timeOf } from './calendar.js';

const fold = (value) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');
const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('vi-VN');
const editVerb = /^(?:(?:hay|vui long|nho|chi)\s+)*(?:(dung(?: co)?|cho|khong(?: duoc| can)?)\s+)?(doi (?:ngay gio|gio|ngay)|bo su kien|xoa|dich|doi|thay|gan|them|tao)\b/;
const clockPattern = /\b([01]?\d|2[0-3])(?:\s*:\s*([0-5]\d)|\s*h\b)/;

export function parseCalendarMessage(message) {
  const text = fold(message);
  const people = text.match(/\b(\d+)\s*nguoi\b/);
  const amount = text.match(/\b(\d+)\s*(nghin|ngan|k|dong)\s*(?:moi\s+nguoi|\/\s*nguoi)/);
  const period = /\bchieu\b/.test(text) ? 'chieu'
    : /sáng/i.test(message) || /\b(?:buoi|vao) sang\b|^sang\b/.test(text) ? 'sang'
      : /tối/i.test(message) || /\b(?:buoi|vao) toi\b|^toi (?:thu|chu nhat)\b/.test(text) ? 'toi' : undefined;
  const weekday = text.match(/\b(thu\s+(?:hai|ba|tu|nam|sau|bay)|chu nhat)\b/);
  const numeric = (value) => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const participants = people && numeric(Number(people[1]));
  const budget = amount && numeric(Number(amount[1]) * (amount[2] === 'dong' ? 1 : 1000));
  return { participants: participants || undefined, budget: budget ?? undefined, period, weekday: weekday?.[1] };
}

const weekdays = ['chu nhat', 'thu hai', 'thu ba', 'thu tu', 'thu nam', 'thu sau', 'thu bay'];
function requestedStart(text, parsed, calendar, duration, contextStart = calendar.start) {
  const clock = text.match(clockPattern);
  const days = Array.from({ length: Math.min(dayCount(calendar), 7) }, (_, index) => dayStart(calendar.start) + index * dayMinutes);
  const day = parsed.weekday ? days.find((minute) => weekdays[new Date(minute * 60000).getUTCDay()] === parsed.weekday) : dayStart(contextStart);
  if (day === undefined) return null;
  if (clock) return day + Number(clock[1]) * 60 + Number(clock[2] ?? 0);
  const start = day + ({ sang: 9, chieu: 14, toi: 18 })[parsed.period] * 60;
  const fallback = parsed.weekday ? Math.max(calendar.start, day + 9 * 60) : contextStart;
  const open = availableStart(calendar, duration, Number.isNaN(start) ? fallback : start);
  return (parsed.weekday || parsed.period) && (open < day || open >= day + dayMinutes || Number.isFinite(start) && open < start) ? null : open;
}

function editInstructions(text) {
  const clauses = [];
  const separators = /\s*[,;.!]\s*|\s+(?:nhung|roi|sau do|dong thoi|va|hoac)\s+|\s+(?=(?:dung|cho|khong)\s)/g;
  let start = 0;
  for (const separator of text.matchAll(separators)) {
    const next = separator.index + separator[0].length;
    if (!editVerb.test(text.slice(next))) continue;
    clauses.push(text.slice(start, separator.index));
    start = next;
  }
  clauses.push(text.slice(start));
  return clauses.flatMap((clause) => {
    const match = editVerb.exec(clause);
    if (!match) return [];
    const [, negation, verb] = match;
    const action = /^(xoa|bo su kien)$/.test(verb) ? 'remove'
      : /^(dich|doi (gio|ngay))/.test(verb) || (verb === 'doi' && clockPattern.test(clause)) ? 'move'
        : /^(them|tao)$/.test(verb) ? 'create' : 'attach';
    return [{ clause, action, negated: Boolean(negation), verb }];
  });
}

export function calendarDemoReply(message, calendar, contextId, preferences = {}) {
  const original = fold(message).trim();
  let text = original;
  const isQuestion = /[?？]/.test(message) || /^(?:neu|gia su|lieu|cho hoi|minh co the|co the|ban co the)\b/.test(text) ||
    /\b(co kip|kip khong|duoc khong|co the khong|hop khong|thi sao|nen khong|co tot khong)\b|\bkhong[.!]?\s*$/.test(text);
  const hypothetical = /^(?:thu|muon xem)\b/.test(text);
  // Scope each verb to its instruction so “đừng xóa” cannot select remove.
  const hasInstruction = hypothetical || (!isQuestion && editVerb.test(text));
  const instructions = hasInstruction ? editInstructions(text.replace(/^(?:thu|muon xem)\s+/, '')) : [];
  const affirmative = instructions.filter(({ negated }) => !negated);
  const [instruction] = affirmative;
  const contradicts = instruction && instructions.some(({ action, negated, verb }) =>
    negated && (action === instruction.action || (verb === 'doi' && instruction.action === 'move')));
  if (affirmative.length > 1 || contradicts) {
    return { reply: 'Bạn có thể xác nhận lại thao tác muốn thực hiện không? Mình sẽ giữ nguyên lịch nháp trong lúc chờ.' };
  }
  if (instructions.length && !instruction) return { reply: 'Mình sẽ giữ nguyên lịch nháp.' };
  const isCommand = Boolean(instruction && !hypothetical);
  if (instruction) text = instruction.clause;
  const parsed = parseCalendarMessage(text === original ? message : text);
  const clocks = text.match(new RegExp(clockPattern.source, 'g')) ?? [];
  const clockSpecified = clocks.length > 0;
  if (isCommand && clocks.length > 1) return { reply: 'Bạn muốn dùng mốc giờ nào trước? Bản demo xử lý từng thay đổi một.' };
  const menu = experiences.find(({ name }) => text.includes(fold(name)));
  const matchedPlaces = places.filter(({ name }) => text.includes(fold(name)));
  const match = matchedPlaces.length === 1 ? matchedPlaces[0] : null;
  if (isCommand && matchedPlaces.length > 1) return { reply: 'Bạn muốn thao tác với địa điểm nào? Hãy chọn một nơi và cho mình biết ngày, giờ.' };
  const named = calendar.events.filter(({ title }) => text.includes(fold(title)));
  const context = calendar.events.find(({ id }) => id === contextId);
  const target = named.length === 1 ? named[0] : !named.length || named.includes(context) ? context : null;
  if (isQuestion && !hypothetical && clockSpecified && /\b(them|chen|gep|ghep|kip)\b/.test(text)) {
    if (!match) return { reply: 'Bạn đang cân nhắc quán nào và vào ngày nào? Thời lượng ghé và chặng đi phụ thuộc vào quán cụ thể.' };
    if (!parsed.weekday && dayCount(calendar) > 1) return { reply: `Bạn muốn ghé ${match.name} vào ngày nào?` };
    const start = requestedStart(text, parsed, calendar, match.duration);
    if (start === null) return { reply: 'Ngày đó nằm ngoài chuyến. Bạn đang cân nhắc ngày nào trong chuyến?' };
    return { consultation: { type: 'create', event: { title: match.name, category: placeCategory(match), placeId: match.id, start, end: start + match.duration } },
      label: `${match.name} mất khoảng ${match.duration} phút.` };
  }
  if (isCommand && instruction.action === 'create' && !match) {
    return { reply: 'Bạn muốn thêm địa điểm nào? Hãy ghi tên quán trong Library cùng ngày và giờ để mình kiểm tra.' };
  }
  const action = instruction?.action;
  const namedEdit = action && action !== 'create';
  // Thao tác chỉ chạy ngay khi lời nhắn chỉ đích danh một sự kiện hoặc có ngữ cảnh từ menu.
  if (/\b(?:ca|het|tat ca) (?:buoi|lich|su kien)\b/.test(text) && namedEdit) {
    return { reply: 'Bạn muốn bắt đầu từ sự kiện nào? Bản demo có thể xem trước thay đổi cho từng sự kiện.' };
  }
  if (namedEdit && !target && named.length > 1) return { reply: 'Có nhiều sự kiện cùng tên. Mở Hỏi ý kiến AI từ menu của lượt bạn muốn sửa.' };
  if (namedEdit && target) {
    if (action === 'remove') return { command: { type: 'remove', id: target.id }, direct: isCommand, label: `Xóa “${target.title}”.` };
    if (action === 'attach' && match) return { command: { type: 'attach', id: target.id, placeId: match.id }, direct: isCommand,
      label: `Gắn ${match.name} vào “${target.title}”.` };
    if (action === 'move' && clockSpecified) {
      const start = requestedStart(text, parsed, calendar, target.end - target.start, target.start);
      if (start !== null) return { command: { type: 'move', id: target.id, start }, direct: isCommand,
        label: `Đổi giờ “${target.title}”.` };
    }
  }
  if (namedEdit && !target) return { reply: 'Bạn muốn sửa sự kiện nào? Hãy nêu tên hoặc mở Hỏi ý kiến AI từ menu của sự kiện.' };
  const preferredIdea = fold(preferences.idea ?? '');
  const preferredMenu = !target && !match && experiences.find(({ name }) => preferredIdea.includes(fold(name)));
  const experience = menu || preferredMenu;
  const selectedAreas = areas.filter(({ label }) => fold(preferences.area ?? '').includes(fold(label)));
  const selectedVibes = vibes.filter(({ label }) => fold(preferences.vibe ?? '').includes(fold(label)));
  const asksForFood = /\b(an gi|quan an|mon gi)\b/.test(text);
  const asksForAfternoon = /\bgoi y mot buoi chieu\b/.test(text);
  const candidates = experience ? experiencePlaces(experience) : match ? [match] : places.filter((place) =>
    target ? placeCategory(place) === target.category
      : asksForFood ? placeCategory(place) === 'food' && (!/ho guom/.test(text) || place.area === 'lake')
        : asksForAfternoon || selectedAreas.length || selectedVibes.length || placeCategory(place) === 'cafe');
  const score = (place) => 2 * Number(selectedAreas.some(({ id }) => place.area === id)) +
    Number(selectedVibes.some(({ id }) => place.vibes.includes(id)));
  const related = candidates.toSorted((a, b) => score(b) - score(a));
  if (action === 'attach' && hypothetical && target && !match) {
    const replacement = related.find(({ id }) => id !== target.placeId);
    if (replacement) return { command: { type: 'attach', id: target.id, placeId: replacement.id },
      label: `Thử ${replacement.name} cho “${target.title}”.` };
    return { reply: 'Chưa có địa điểm khác phù hợp trong dữ liệu demo. Bạn muốn thử nhóm địa điểm nào?' };
  }
  if (namedEdit && target) return { reply: 'Bạn muốn đổi giờ hay đổi địa điểm? Hãy nêu giờ hoặc tên nơi bạn muốn thử.' };
  const wantsTime = /\b(tao|them|giu|muon|xep)\b/.test(text);
  if (experience && !related.length) {
    if (!menu || !wantsTime || isQuestion) return { reply: `Dữ liệu demo chưa có địa điểm cho ${experience.name}. Bạn có thể giữ một khung giờ để chọn địa điểm sau.` };
    const start = requestedStart(text, parsed, calendar, 60);
    if (start === null) return { reply: 'Khung bạn nêu chưa nằm trong chuyến. Bạn muốn thử ngày hoặc giờ nào?' };
    return { reply: `Dữ liệu demo chưa có địa điểm cho ${menu.name}. Mình có thể giữ khung để bạn tự chọn quán sau.`,
      command: { type: 'create', event: { title: menu.name, category: menu.kind === 'Món ăn' ? 'food' : 'other', start, end: start + 60 } },
      label: `Giữ khung “${menu.name}”.` };
  }
  if (wantsTime && match && !isQuestion && !hypothetical) {
    if (isCommand && !clockSpecified) return { reply: `Bạn muốn ghé ${match.name} vào giờ nào?` };
    if (isCommand && !parsed.weekday && dayCount(calendar) > 1) return { reply: `Bạn muốn ghé ${match.name} vào ngày nào?` };
    if (isCommand && parsed.weekday && dayCount(calendar) > 7) {
      const first = requestedStart(text, parsed, calendar, match.duration);
      if (first !== null && first + 7 * dayMinutes < calendar.end) return { reply: 'Chuyến có ngày này ở nhiều tuần. Hãy chọn giờ cụ thể trên lịch hoặc giới hạn vào một tuần.' };
    }
    const start = requestedStart(text, parsed, calendar, match.duration);
    if (start !== null) {
      if (calendar.events.some((event) => event.start === start && event.placeId === match.id)) {
        return { reply: `${match.name} đã có trong nháp lúc ${momentLabel(start)}.` };
      }
      return { command: { type: 'create', event: { title: match.name, category: placeCategory(match), placeId: match.id, start, end: start + match.duration } },
        direct: isCommand && clockSpecified, label: `Thêm ${match.name}.` };
    }
    return { reply: 'Ngày đó nằm ngoài chuyến. Bạn muốn chọn ngày nào trong lịch?' };
  }
  const asksForSuggestion = /\b(goi y|cho minh|co .* nao|quan nao|nen di|kham pha)\b/.test(text);
  if (related.length && (asksForSuggestion || asksForFood || match || experience)) {
    return { reply: asksForFood ? 'Quanh Hồ Gươm, Library demo có các lựa chọn ăn nhẹ này.'
      : asksForAfternoon ? 'Bạn có thể bắt đầu với một điểm dạo phố, tham quan hoặc nghỉ chân.'
        : 'Bạn có thể cân nhắc các địa điểm trong Library demo dưới đây.', choices: related.slice(0, 3).map(({ id }) => id) };
  }
  return { reply: 'Bản demo chưa xử lý được yêu cầu này. Mình có thể gợi ý địa điểm trong Library hoặc kiểm tra ngày giờ trong lịch chuyến.' };
}

export function setupCalendarChat({ getTrip, getCalendar, save, preview, apply, choosePlace, undo }) {
  const input = $('calendar-message');
  const history = $('calendar-chat-history');
  let rendered;
  function state() {
    return { messages: [], ...getTrip().conversation };
  }

  function render() {
    const trip = getTrip();
    const chat = state();
    const context = getCalendar().events.find(({ id }) => id === chat.contextId);
    $('calendar-chat-trip').textContent = trip.name;
    $('calendar-chat-welcome').hidden = !!chat.messages.length;
    $('calendar-chat-prompts').hidden = !!chat.messages.length;
    $('calendar-chat-context').hidden = !context;
    $('calendar-chat-context-name').textContent = context ? `Đang hỏi về “${context.title}”` : '';
    const signature = JSON.stringify([trip.id, chat.messages, trip.draft.calendarUndoId]);
    if (signature !== rendered) {
      const nearEnd = history.scrollHeight - history.clientHeight - history.scrollTop < 80;
      const switchedTrip = rendered === undefined || !rendered.startsWith(`["${trip.id}",`);
      rendered = signature;
      if (switchedTrip) input.value = '';
      $('calendar-messages').replaceChildren(...chat.messages.map(({ author, text, choices, undoId }) => {
        const row = document.createElement('li');
        row.className = author === 'you' ? 'calendar-message-user' : 'calendar-message-demo';
        const speaker = document.createElement('span');
        speaker.className = 'sr-only';
        speaker.textContent = author === 'you' ? 'Bạn: ' : 'AI demo: ';
        const body = document.createElement('p');
        body.textContent = text;
        row.append(speaker, body);
        for (const id of choices ?? []) {
          const item = places.find((place) => place.id === id);
          if (!item) continue;
          const button = document.createElement('button');
          button.className = 'text-button';
          button.type = 'button';
          button.dataset.chatPlace = id;
          button.textContent = item.name;
          row.append(button);
        }
        if (undoId && undoId === trip.draft.calendarUndoId) {
          const button = document.createElement('button');
          button.className = 'text-button';
          button.type = 'button';
          button.dataset.chatUndo = undoId;
          button.textContent = 'Hoàn tác';
          row.append(button);
        }
        return row;
      }));
      if (nearEnd || switchedTrip) history.scrollTop = history.scrollHeight;
    }
    $('calendar-proposal').hidden = !chat.proposal;
    $('calendar-proposal-text').textContent = [chat.proposal?.label, chat.proposal?.impact].filter(Boolean).join(' ');
    $('calendar-proposal-error').textContent = chat.proposal?.feedback ?? '';
    $('calendar-apply-proposal').textContent = chat.proposal?.blocked ? 'Kiểm tra lại' : 'Áp dụng vào nháp';
  }

  function resultIssue(result) {
    return result.error ?? result.issues.map(({ message }) => message).join(' ');
  }

  function proposalImpact(result) {
    const event = result.event;
    if (!event) return '';
    const timing = `${momentLabel(event.start)}–${timeOf(event.end)}.`;
    const { total, missingCostCount } = result.costs;
    const cost = total !== result.beforeCosts.total ? `Chi phí đã biết: ${money.format(total)} ₫/người.` : '';
    return [timing, cost, missingCostCount && `${missingCostCount} lượt chưa có giá.`, result.opening].filter(Boolean).join(' ');
  }

  function sendMessage(message) {
    if (!message) return;
    const chat = state();
    const trip = getTrip();
    const preferences = {
      area: areas.filter(({ id }) => trip.draft.form.areas.includes(id)).map(({ label }) => label).join(' '),
      vibe: vibes.filter(({ id }) => trip.draft.form.vibes.includes(id)).map(({ label }) => label).join(' '),
      idea: experienceById[trip.savedExperienceIds[0]]?.name,
    };
    const response = calendarDemoReply(message, getCalendar(), chat.contextId, preferences);
    const messages = [...chat.messages, { author: 'you', text: message }];
    const reply = (text, extras) => messages.push({ author: 'demo', text, ...extras });
    if (response.reply) reply(response.reply, { choices: response.choices });
    if (response.consultation) {
      const result = preview(response.consultation);
      const issue = resultIssue(result);
      reply([response.label, issue || 'Khung giờ này có thể xếp được theo dữ liệu demo.', proposalImpact(result)].filter(Boolean).join(' '));
    }
    if (response.command) {
      const result = response.direct ? apply(response.command) : preview(response.command);
      if (result.trip) {
        reply(`${response.label} Đã cập nhật nháp. ${proposalImpact(result)}`.trim(), { undoId: result.undoId });
        chat.proposal = null;
      } else if (result.error || response.direct) {
        reply(`${resultIssue(result)} Lịch nháp được giữ nguyên. Bạn muốn thử giờ hoặc địa điểm khác?`);
      } else {
        chat.proposal = { command: response.command, label: response.label, impact: proposalImpact(result),
          fingerprint: result.fingerprint, feedback: resultIssue(result), blocked: !!result.issues.length };
      }
    }
    save({ ...chat, messages });
    history.scrollTop = history.scrollHeight;
    input.value = '';
    input.focus({ preventScroll: true });
  }

  $('calendar-message-form').addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(input.value.trim());
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    sendMessage(input.value.trim());
  });
  $('calendar-chat-prompts').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button) sendMessage(button.textContent.trim());
  });
  $('calendar-clear-context').addEventListener('click', () => {
    save({ ...state(), contextId: null });
    input.focus();
  });
  $('calendar-messages').addEventListener('click', (event) => {
    const place = event.target.closest('[data-chat-place]');
    if (place) choosePlace(place.dataset.chatPlace, state().contextId);
    const button = event.target.closest('[data-chat-undo]');
    if (!button) return;
    const restored = undo(button.dataset.chatUndo);
    const chat = state();
    save({ ...chat, messages: [...chat.messages, { author: 'demo', text: restored
      ? 'Đã hoàn tác thay đổi trên lịch nháp.' : 'Lịch đã có thao tác mới hơn. Bạn có thể xem lại trên lịch.' }] });
    input.focus({ preventScroll: true });
  });
  $('calendar-dismiss-proposal').addEventListener('click', () => {
    save({ ...state(), proposal: null });
    input.focus();
  });
  $('calendar-apply-proposal').addEventListener('click', () => {
    const chat = state();
    const proposal = chat.proposal;
    if (!proposal) return;
    const result = apply(proposal.command, { expected: proposal.fingerprint });
    if (result.trip) {
      save({ ...chat, proposal: null, messages: [...chat.messages, { author: 'demo',
        text: `${proposal.label} Đã cập nhật nháp. ${proposalImpact(result)}`.trim(), undoId: result.undoId }] });
      input.focus();
      return;
    }
    const text = resultIssue(result);
    const feedback = result.stale ? `Lịch liên quan vừa thay đổi. Hãy xem lại trước khi áp dụng. ${text}`.trim() : text;
    save({ ...chat, proposal: { ...proposal, impact: proposalImpact(result), fingerprint: result.fingerprint, feedback,
      blocked: !!(result.error || result.issues?.length) } });
    $('calendar-proposal-error').focus();
  });

  return { render };
}

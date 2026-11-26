import { areas, eventSessionById, eventSessions, experienceById, experiencePlaces, experiences, libraryPlaces as places, placeById, vibes } from './data.js';
import { availableStart, dayCount, dayMinutes, dayStart, minuteInDay, momentLabel, placeCategory, sessionTimeLabel, sessionTiming, timeOf, wallMinute } from './calendar.js';
import { eventLibraryHref, sessionKind, sessionsInRange, sessionTicketLabel } from './library-events.js';
import { libraryImage } from './library-images.js';
import { wardPreference } from './wards.js';
import { setupChatComposer } from './chat-composer.js';
import { chatDocumentReply } from './chat-documents.js';
import { activeChatModel, availableChatModels } from './chat-models.js';

const fold = (value) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');
const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('vi-VN');
const editVerb = /^(?:(?:hay|vui long|nho|chi)\s+)*(?:(dung(?: co)?|cho|khong(?: duoc| can)?)\s+)?(doi (?:ngay gio|gio|ngay)|bo su kien|xoa|dich|doi|thay|gan|them|tao)\b/;
const clockPattern = /\b([01]?\d|2[0-3])(?:\s*[:h]\s*([0-5]\d)\b|\s*h\b)/;
const sessionDatePattern = /\b(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\s*(?:[./-]|thang\s+)\s*(\d{1,2})(?:\s*(?:[./-]|nam\s+)\s*(\d+))?)(?![\d/-])/g;
const sessionClockPattern = /\b(?:(\d+)(?:\s*:\s*(\d+)|\s*(?:h|gio)(?:\s*(\d+)\b(?!\s*(?:[./-]\s*\d|thang\b)))?)|luc\s+(\d+)\b(?!\s*(?:[./:-]\s*\d|(?:thang|h|gio)\b)))\b/g;

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

function sessionReply(text, calendar, action, isCommand, preferences) {
  const named = new Set(eventSessions.filter(({ name }) => text.includes(fold(name))).map(({ name }) => name));
  const refersToSession = named.size || /\b(su kien nao|cac su kien|buoi dien|suat dien|hoa nhac|suat nao)\b/.test(text);
  if (!refersToSession || (action && action !== 'create')) return null;
  const inTrip = sessionsInRange(calendar);
  if (named.size > 1) {
    const sessions = [...named].flatMap((name) => {
      const available = inTrip.filter((session) => session.name === name);
      return available.length ? available : eventSessions.filter((session) => session.name === name);
    }).toSorted((a, b) => sessionTiming(a).start - sessionTiming(b).start).map(({ id }) => id);
    return { reply: isCommand ? 'Bạn muốn thêm suất nào? Hãy cho mình tên chương trình và giờ bắt đầu.'
      : 'Đây là các suất đã biết của những chương trình bạn muốn so sánh.', sessions };
  }
  const dates = [...text.matchAll(sessionDatePattern)];
  const clocks = [...text.matchAll(sessionClockPattern)];
  const days = [...text.matchAll(/\b(?:thu\s+(hai|ba|tu|nam|sau|bay|[2-7])|chu nhat)\b/g)]
    .map(([, day]) => !day ? 0 : /^[2-7]$/.test(day) ? Number(day) - 1 : weekdays.indexOf(`thu ${day}`));
  if (dates.length > 1 || clocks.length > 1 || new Set(days).size > 1) {
    return { reply: 'Bạn có thể cho mình một ngày, thứ và giờ cụ thể để tìm đúng suất không?' };
  }
  if (!dates.length && /\bngay\s+\d/.test(text)) {
    return { reply: 'Bạn có thể ghi đủ ngày và tháng của suất không? Ví dụ ngày 18/12.' };
  }
  const matchesName = (session) => named.size ? named.has(session.name)
    : !/\bhoa nhac\b/.test(text) || fold(session.name).includes('hoa nhac');
  const date = dates[0];
  const year = date?.[1] ?? date?.[6];
  const month = (date?.[2] ?? date?.[5])?.padStart(2, '0');
  const day = (date?.[3] ?? date?.[4])?.padStart(2, '0');
  const clock = clocks[0];
  const hourText = clock?.[1] ?? clock?.[4];
  const minuteText = clock?.[2] ?? clock?.[3] ?? '0';
  const hours = Number(hourText);
  const minutes = Number(minuteText);
  if ((date && !Number.isFinite(wallMinute(`${year ?? '2000'}-${month}-${day}`, '00:00'))) ||
      (clock && (hourText.length > 2 || minuteText.length > 2 || hours > 23 || minutes > 59))) {
    return { reply: 'Bạn có thể kiểm tra lại ngày và giờ bắt đầu của suất không?' };
  }
  const matches = (session) => {
    const start = sessionTiming(session).start;
    const [sessionYear, sessionMonth, sessionDay] = session.date.split('-');
    return matchesName(session) && (!date || (sessionMonth === month && sessionDay === day && (!year || sessionYear === year))) &&
      (!clock || minuteInDay(start) === hours * 60 + minutes) &&
      (!days.length || new Date(start * 60000).getUTCDay() === days[0]);
  };
  const geography = wardPreference(preferences.wardIds);
  const alternatives = inTrip.filter(matches)
    .toSorted((a, b) => geography.score({ id: b.placeId }) - geography.score({ id: a.placeId }));
  const links = alternatives.map(({ id }) => id);
  if (!links.length && (date || days.length || clock)) {
    const outside = isCommand && named.size && clock ? eventSessions.filter(matches) : [];
    if (outside.length === 1) return { direct: true, command: { type: 'add-session', sessionId: outside[0].id },
      label: `Thêm “${outside[0].name}”.` };
    const suggestions = inTrip.filter(matchesName).map(({ id }) => id);
    return { reply: suggestions.length ? 'Không có suất khớp ngày, thứ và giờ bạn nêu trong chuyến. Bạn có thể xem các suất khác dưới đây.'
      : 'Không có suất khớp ngày, thứ và giờ bạn nêu trong chuyến.', sessions: suggestions };
  }
  if (!isCommand) return links.length ? { reply: 'Các suất sự kiện trong thời gian chuyến.', sessions: links }
    : { reply: 'Chưa có suất trong Library khớp yêu cầu trong thời gian chuyến.' };
  if (alternatives.length > 1) return { reply: 'Có nhiều suất phù hợp. Bạn muốn thêm suất lúc mấy giờ?', sessions: links };
  const exact = alternatives[0];
  if (!exact) return { reply: 'Chưa xác định được suất. Bạn có thể cho mình tên và giờ bắt đầu, hoặc chọn suất trong Library.' };
  return { direct: true, command: { type: 'add-session', sessionId: exact.id },
    label: `Thêm “${exact.name}”.` };
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
  const eventAnswer = sessionReply(text, calendar, instruction?.action, isCommand, preferences);
  if (eventAnswer) return eventAnswer;
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
  const geography = wardPreference(preferences.wardIds);
  const score = (place) => geography.score(place) + 2 * Number(selectedAreas.some(({ id }) => place.area === id)) +
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
    const results = related.slice(0, 3);
    const intro = asksForFood && /ho guom/.test(text) ? 'Quanh Hồ Gươm, Library demo có các lựa chọn ăn nhẹ này.'
      : asksForFood ? 'Bạn có thể thử các món này trong Library demo.'
      : asksForAfternoon ? 'Bạn có thể bắt đầu với một điểm dạo phố, tham quan hoặc nghỉ chân.'
        : 'Bạn có thể cân nhắc các địa điểm trong Library demo dưới đây.';
    const outside = geography.outsideNote(results, 'Các phường ưu tiên có ít điểm phù hợp với yêu cầu trong dữ liệu demo.');
    return { reply: [intro, outside].filter(Boolean).join(' '), choices: results.map(({ id }) => id) };
  }
  return { reply: 'Bản demo chưa xử lý được yêu cầu này. Mình có thể gợi ý địa điểm trong Library hoặc kiểm tra ngày giờ trong lịch chuyến.' };
}

export function setupCalendarChat({ getTrip, getCalendar, save, preview, apply, choosePlace, undo }) {
  const input = $('calendar-message');
  const history = $('calendar-chat-history');
  const providers = { demo: calendarDemoReply };
  const models = availableChatModels(providers);
  const saveError = 'Chưa lưu được hội thoại. Nội dung đang soạn vẫn còn. Hãy thử gửi lại.';
  const composer = setupChatComposer({ getTrip, models, selectModel: (id) => save({ ...state(), modelId: id }) });
  let rendered;
  function state() {
    return { messages: [], ...getTrip().conversation };
  }

  function render() {
    const trip = getTrip();
    const chat = state();
    composer.render();
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
      $('calendar-messages').replaceChildren(...chat.messages.map(({ author, text, attachmentName, choices, documentPlaces, sessions, undoId }) => {
        const row = document.createElement('li');
        row.className = author === 'you' ? 'calendar-message-user' : 'calendar-message-demo';
        const speaker = document.createElement('span');
        speaker.className = 'sr-only';
        speaker.textContent = author === 'you' ? 'Bạn: ' : 'AI demo: ';
        const body = document.createElement('p');
        body.textContent = text;
        row.append(speaker);
        if (attachmentName) {
          const attachment = document.createElement('p');
          attachment.className = 'chat-sent-document';
          attachment.textContent = attachmentName;
          attachment.title = attachmentName;
          row.append(attachment);
        }
        if (text) row.append(body);
        for (const id of choices ?? []) {
          const item = places.find((place) => place.id === id);
          if (!item) continue;
          const button = document.createElement('button');
          button.className = 'text-button';
          button.type = 'button';
          button.dataset.chatPlace = id;
          button.textContent = item.name;
          if (item.image) {
            button.classList.add('chat-place-with-image');
            button.prepend(libraryImage(item.image));
          }
          row.append(button);
        }
        for (const id of sessions ?? []) {
          const session = eventSessionById[id];
          if (!session) continue;
          const link = document.createElement('a');
          link.className = 'text-button chat-session-link chat-event-link';
          link.href = eventLibraryHref({ sessionId: id, tripId: trip.id });
          const title = document.createElement('span');
          title.textContent = session.name;
          const time = document.createElement('span');
          time.textContent = sessionTimeLabel(session, true);
          const facts = document.createElement('small');
          facts.textContent = [placeById[session.placeId]?.name, sessionTicketLabel(session), sessionKind(session)].filter(Boolean).join(' · ');
          link.append(title, time, facts);
          row.append(link);
        }
        for (const id of documentPlaces ?? []) {
          const place = places.find((entry) => entry.id === id);
          if (!place) continue;
          const link = document.createElement('a');
          link.className = 'text-button chat-session-link';
          link.href = `#library/${place.id}`;
          link.textContent = place.name;
          row.append(link);
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
    const attachment = composer.attachment();
    if (composer.isReading()) return composer.showError('Đang đọc tài liệu. Hãy gửi khi tên tệp xuất hiện.');
    if (!message && !attachment) return;
    const chat = state();
    const trip = getTrip();
    const preferences = {
      wardIds: trip.wardIds,
      area: trip.wardIds === undefined
        ? areas.filter(({ id }) => (trip.planning?.answers?.area?.ids ?? trip.draft.form.areas).includes(id)).map(({ label }) => label).join(' ')
        : '',
      vibe: vibes.filter(({ id }) => trip.draft.form.vibes.includes(id)).map(({ label }) => label).join(' '),
      idea: experienceById[trip.savedExperienceIds[0]]?.name,
    };
    const model = activeChatModel(models, chat.modelId);
    const response = (attachment ? chatDocumentReply(message, attachment) : null) ??
      providers[model.provider](message, getCalendar(), chat.contextId, preferences);
    const messages = [...chat.messages, { author: 'you', text: message,
      ...(attachment && { attachmentName: attachment.name }) }];
    const reply = (text, extras) => messages.push({ author: 'demo', text, ...extras });
    if (response.reply) reply(response.reply, { choices: response.choices, sessions: response.sessions, documentPlaces: response.documentPlaces });
    if (response.consultation) {
      const result = preview(response.consultation);
      const issue = resultIssue(result);
      reply([response.label, issue || 'Khung giờ này có thể xếp được theo dữ liệu demo.', proposalImpact(result)].filter(Boolean).join(' '));
    }
    let saved = false;
    if (response.command) {
      const result = response.direct ? apply(response.command, { withConversation(change) {
        reply(`${response.label} Đã cập nhật nháp. ${proposalImpact(change)}`.trim(), { undoId: change.undoId });
        return { ...chat, modelId: model.id, proposal: null, messages };
      } }) : preview(response.command);
      if (result.storageFailed) return composer.showError(saveError);
      if (result.trip) {
        saved = true;
      } else if (result.error || response.direct) {
        reply(`${resultIssue(result)} Lịch nháp được giữ nguyên. Bạn muốn thử giờ hoặc địa điểm khác?`);
      } else {
        chat.proposal = { command: response.command, label: response.label, impact: proposalImpact(result),
          fingerprint: result.fingerprint, feedback: resultIssue(result), blocked: !!result.issues.length };
      }
    }
    if (!saved && !save({ ...chat, modelId: model.id, messages })) return composer.showError(saveError);
    history.scrollTop = history.scrollHeight;
    composer.clear();
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
    if (!button) return;
    const prompt = button.textContent.trim();
    if (!input.value && !composer.attachment() && !composer.isReading()) sendMessage(prompt);
    else {
      if (!input.value) {
        input.value = prompt;
        input.dispatchEvent(new Event('input'));
      }
      input.focus();
    }
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
    const result = apply(proposal.command, { expected: proposal.fingerprint, withConversation(change) {
      return { ...chat, proposal: null, messages: [...chat.messages, { author: 'demo',
        text: `${proposal.label} Đã cập nhật nháp. ${proposalImpact(change)}`.trim(), undoId: change.undoId }] };
    } });
    if (result.storageFailed) return composer.showError(saveError);
    if (result.trip) {
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

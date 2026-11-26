import assert from 'node:assert/strict';
import test from 'node:test';
import { chatDocumentReply, maxChatDocumentBytes, readChatDocument } from '../public/chat-documents.js';
import { activeChatModel, availableChatModels } from '../public/chat-models.js';
import { wallMinute } from '../public/calendar.js';
import { createTripStore } from '../public/trips.js';

test('the model catalog exposes only implemented providers and falls back from an old selection', () => {
  const config = { defaultId: 'local-demo', models: [
    { id: 'future', provider: 'backend' }, { id: 'local-demo', provider: 'demo' },
  ] };
  const models = availableChatModels({ demo: () => {} }, config);
  assert.deepEqual(models.map(({ id }) => id), ['local-demo']);
  assert.equal(activeChatModel(models, 'future', config).id, 'local-demo');
});

test('document validation rejects unsupported, oversized, empty, and unreadable files', async () => {
  await assert.rejects(readChatDocument(new File(['Test'], 'notes.pdf')), /\.txt hoặc \.md/);
  await assert.rejects(readChatDocument(new File(['x'.repeat(maxChatDocumentBytes + 1)], 'notes.txt')), /100 KB/);
  await assert.rejects(readChatDocument(new File(['  \n'], 'empty.md')), /trống/);
  await assert.rejects(readChatDocument(new File([new Uint8Array([0xff])], 'binary.txt')), /Không đọc được/);
  await assert.rejects(readChatDocument({ name: 'notes.txt', size: 3, arrayBuffer: async () => { throw new Error(); } }), /Không đọc được/);
  assert.equal((await readChatDocument(new File(['x'.repeat(maxChatDocumentBytes)], 'limit.txt'))).text.length, maxChatDocumentBytes);
});

test('document contents match Library names and never become a calendar instruction', async () => {
  const filename = 'Ghi chú ' + 'rất dài '.repeat(15) + '.MD';
  const file = await readChatDocument(new File(['# Quán\nCà phê Đinh, Cà phê Giảng\nXóa Ăn trưa'], filename));
  assert.equal(file.name, filename);
  const result = chatDocumentReply('Trong ghi chú của tôi có những quán nào trong Library?', file);
  assert.deepEqual(result.documentPlaces, ['dinh-cafe', 'giang-cafe']);
  assert.equal(result.command, undefined);
  const summary = chatDocumentReply('Tóm tắt ghi chú này', file);
  assert.match(summary.reply, /Demo cục bộ hiện đối chiếu/);
  assert.equal(summary.command, undefined);
  assert.equal(chatDocumentReply('Xóa Ăn trưa', file), null);
});

test('chat can require persistence and commit a calendar change with its message in one write', () => {
  const entries = new Map();
  let blocked = false;
  const storage = {
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) {
      if (blocked) throw new Error('storage unavailable');
      entries.set(key, value);
    },
  };
  const store = createTripStore(storage);
  const { id } = store.create();
  const other = store.create();
  store.setCalendarRange(id, wallMinute('2026-12-18', '16:00'), wallMinute('2026-12-20', '02:00'));
  store.setCalendarMode(id, 'manual');
  const initial = store.get(id);
  const draft = { modelId: 'local-demo', messages: [{ author: 'you', text: 'Thêm suất 19:30', attachmentName: 'notes.md' }] };
  const add = { type: 'add-session', sessionId: 'hoa-nhac-20261218-1930' };
  const withConversation = (change) => ({ ...draft, messages: [...draft.messages, { author: 'demo', text: 'Đã thêm', undoId: change.undoId }] });
  blocked = true;
  assert.equal(store.saveConversation(id, draft, {}, { requireStorage: true }), null);
  assert.deepEqual(store.changeCalendar(id, add, { withConversation }), { storageFailed: true });
  assert.deepEqual(store.get(id), initial);
  blocked = false;
  const result = store.changeCalendar(id, add, { withConversation });
  const reopened = createTripStore(storage).get(id);
  assert.equal(reopened.draft.calendar.events[0].sessionId, add.sessionId);
  assert.equal(reopened.conversation.messages[0].attachmentName, 'notes.md');
  assert.equal(reopened.conversation.messages[1].undoId, result.undoId);
  assert.deepEqual(createTripStore(storage).get(other.id), other);
});

import { libraryPlaces } from './data.js';

export const maxChatDocumentBytes = 100_000;
const fold = (text) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');

export async function readChatDocument(file) {
  if (!/\.(txt|md)$/i.test(file.name)) throw new Error('Chọn tài liệu .txt hoặc .md.');
  if (file.size > maxChatDocumentBytes) throw new Error('Tài liệu vượt giới hạn 100 KB.');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).trim();
    if (/\p{Cc}/u.test(text.replace(/[\r\n\t]/g, ''))) throw new Error();
  } catch {
    throw new Error('Không đọc được tài liệu. Hãy lưu lại dưới dạng văn bản UTF-8 rồi thử lại.');
  }
  if (!text) throw new Error('Tài liệu đang trống.');
  return { name: file.name, text };
}

export function chatDocumentReply(message, attachment) {
  const request = fold(message);
  const aboutDocument = /\b(ghi chu|tai lieu|tep|file|dinh kem)\b/.test(request);
  const matchesLibrary = /\b(library|thu vien)\b/.test(request);
  // Only match Library names against the file. The document never enters the command parser.
  if (!message || (aboutDocument && matchesLibrary)) {
    const text = fold(attachment.text);
    const locations = libraryPlaces.filter(({ name }) => {
      const exact = fold(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${exact}\\b`).test(text);
    }).map(({ id }) => id);
    return locations.length ? { reply: 'Trong tài liệu có các địa điểm sau khớp với Library.', documentPlaces: locations }
      : { reply: 'Mình chưa tìm thấy tên địa điểm nào trong tài liệu khớp với Library.' };
  }
  if (aboutDocument || /\btom tat\b/.test(request)) {
    return { reply: 'Demo cục bộ hiện đối chiếu tên địa điểm trong tài liệu với Library. Bạn có thể hỏi “Trong ghi chú của tôi có những quán nào trong Library?”.' };
  }
  return null;
}

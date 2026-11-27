import { readFile } from 'node:fs/promises';
import { baseLibraryPlaces } from '../public/data.js';
import { sourcedPlaces } from '../public/library-sources.js';

import { fieldEvidence, fields, isFixture, rightsLabels, suggestMatch, validateBatch } from '../public/library-handoff.js';

const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replace(/[\\`*_[\]|]/g, '\\$&');
const link = (label, url) => `[${escape(label)}](<${url}>)`;
const vnd = new Intl.NumberFormat('vi-VN');

function displayValue(key, value) {
  if (key === 'coordinates') return `${value.lat}, ${value.lon}`;
  return key === 'pricePerPersonVnd' ? `${vnd.format(value)} ₫/người` : escape(value);
}

function imageDetails(image) {
  if (!image) return '- Ảnh · chưa cung cấp.';
  const reference = `- Ảnh · ${link('Tham khảo', image.referenceUrl)}`;
  const rights = image.displayPermission;
  if (!rights) return `${reference} · Chưa có bằng chứng quyền hiển thị.`;
  const basis = rights.license ? `${rightsLabels[rights.basis]} ${escape(rights.license)}` : rightsLabels[rights.basis];
  const evidence = link('Bằng chứng quyền hiển thị', rights.evidenceUrl);
  return [reference, basis, rights.author && escape(rights.author), evidence, rights.note && escape(rights.note), 'Chờ duyệt.']
    .filter(Boolean).join(' · ');
}

function report(batch) {
  const summary = ['| Tên quán | Link thông tin | Chi nhánh nếu biết | Ảnh hoặc link ảnh nếu có |', '|---|---|---|---|'];
  if (!batch.candidates.length) return [...summary, '', 'Lô này chưa có ứng viên.'].join('\n');
  const details = ['## Đối chiếu từng ứng viên', '', 'Nguồn do lô khai báo. Các URL và quyền dùng ảnh cần được người duyệt đối chiếu.'];
  for (const candidate of batch.candidates) {
    const evidence = fieldEvidence(candidate);
    const { review, reason, places } = suggestMatch(candidate, evidence, baseLibraryPlaces);
    const name = escape(candidate.name) + (isFixture(candidate) ? ' (dữ liệu thử)' : '');
    const branch = evidence.branch.length ? escape(candidate.branch) : '—';
    const source = candidate.sources[0];
    const image = candidate.image;
    summary.push(`| ${name} | ${link('Nguồn chính', source.url)} | ${branch} | ${image ? link('Xem ảnh tham khảo', image.referenceUrl) : '—'} |`);

    details.push('', `### ${candidate.id} · ${name}`, `${review} — ${reason}`);
    for (const place of places) {
      const importedPrice = Object.hasOwn(sourcedPlaces[place.id] ?? {}, 'cost');
      const price = place.cost == null ? 'chưa có giá'
        : `giá hiện tại ${displayValue('pricePerPersonVnd', place.cost)} (${importedPrice ? 'xem nguồn của mục hiện có' : 'demo'})`;
      details.push(`- Library \`${place.id}\` · ${place.address ? escape(place.address) : 'chưa có địa chỉ'} · ${price}.`);
    }
    for (const [key, label] of Object.entries(fields)) {
      const status = evidence[key].length ? `bằng chứng ${evidence[key].join(', ')}` : 'chưa có nguồn hỗ trợ';
      details.push(`- ${label} · ${Object.hasOwn(candidate, key) ? `${displayValue(key, candidate[key])} (${status})` : 'chưa cung cấp'}.`);
    }
    for (const [index, entry] of candidate.sources.entries()) {
      const checked = entry.checkedOn ? ` · Đối chiếu ${entry.checkedOn}` : '';
      const note = entry.note ? ` · ${escape(entry.note)}` : '';
      details.push(`- S${index + 1} · ${link(entry.title ?? 'Nguồn', entry.url)} · Hỗ trợ ${entry.supports.map((key) => fields[key]).join(', ')}${checked}${note}`);
    }
    details.push(imageDetails(image));
  }
  return [...summary, '', ...details].join('\n');
}

try {
  const [path, ...rest] = process.argv.slice(2);
  if (!path || rest.length) throw new Error('Dùng npm run library:review -- <file.json>');
  const batch = JSON.parse(await readFile(path, 'utf8'));
  validateBatch(batch);
  console.log(report(batch));
} catch (error) {
  console.error(`Không đọc được lô ứng viên. ${String(error.message).replace(/[\p{Cc}\p{Cf}]/gu, ' ')}`);
  process.exitCode = 1;
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const example = 'examples/library-handoff-v1.json';
const read = (path) => readFileSync(join(root, path), 'utf8');
const run = (...args) => spawnSync('npm', ['run', '--silent', 'library:review', '--', ...args], { cwd: root, encoding: 'utf8' });
const sections = (output) => new Map(output.split('\n### ').slice(1).map((section) => [section.split(' · ', 1)[0], section]));

function tempBatch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nonla-handoff-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'lô ứng viên.json');
  return (value) => {
    writeFileSync(path, JSON.stringify(value));
    return run(path);
  };
}

test('the npm review is deterministic, keeps branches apart and previews field-level evidence without writing', () => {
  const files = [example, 'public/data.js', 'public/library-sources.js'];
  const before = files.map(read);
  const first = run(example);
  const second = run(example);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
  assert.equal(second.stderr, '');
  assert.deepEqual(files.map(read), before);

  const table = first.stdout.split('\n\n', 1)[0];
  assert.match(table, /^\| Tên quán \| Link thông tin \| Chi nhánh nếu biết \| Ảnh hoặc link ảnh nếu có \|/);
  assert.match(table, /branch-a.*\| Chi nhánh A \| — \|/);
  assert.match(table, /branch-b.*\| Chi nhánh B \| .*photo-b/);
  assert.match(table, /brand-only.*\| — \| — \|/);
  const details = sections(first.stdout);
  assert.equal(details.size, 5);
  const theatre = details.get('sample:nha-hat-lon-ha-noi');
  assert.match(theatre, /Có thể khớp ID[\s\S]*Library `nha-hat-lon`/);
  assert.match(theatre, /Địa chỉ · Số 1 Tràng Tiền, phường Cửa Nam, Hà Nội \(bằng chứng S1\)/);
  assert.match(theatre, /Giấy phép CC BY-SA 4.0 · The Hanoian.*#Licensing.*Chờ duyệt/);
  assert.match(details.get('fixture:ca-phe-minh-hoa-a'), /Ứng viên mới[\s\S]*Ảnh · chưa cung cấp/);
  assert.match(details.get('fixture:ca-phe-minh-hoa-b'), /Ứng viên mới[\s\S]*Chưa có bằng chứng quyền hiển thị/);
  assert.match(details.get('fixture:kem-trang-tien-thuong-hieu'), /Cần kiểm tra thêm[\s\S]*Chi nhánh · chưa cung cấp/);
  const addressOnly = details.get('fixture:ca-phe-giang-dia-chi');
  assert.match(addressOnly, /Cần kiểm tra thêm[\s\S]*Library `giang-cafe`.*60\.000 ₫\/người \(demo\)/);
  assert.match(addressOnly, /Tên · Cà phê Giảng \(chưa có nguồn hỗ trợ\)/);
  assert.match(addressOnly, /Địa chỉ · 12 phố Giả Lập.*\(bằng chứng S1\)/);
  assert.match(addressOnly, /Chi phí mỗi người · chưa cung cấp/);
  assert.match(addressOnly, /Hỗ trợ Địa chỉ ·/);
});

test('matching normalizes Vietnamese names and full addresses, and evidence stays attached to each field', (t) => {
  const check = tempBatch(t);
  const [theatre] = JSON.parse(read(example)).candidates;
  theatre.name = 'Nha hat Lon Ha Noi';
  theatre.address = '01 Trang Tien - Phuong Cua Nam - Ha Noi';
  theatre.branch = 'Chi nhánh do pipeline đề xuất';
  theatre.pricePerPersonVnd = 0;
  theatre.coordinates = { lat: 21.02417, lon: 105.85744 };
  theatre.sources.push({ url: 'https://example.invalid/evidence', supports: ['address', 'pricePerPersonVnd'] });
  const result = check({ version: 1, candidates: [theatre] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Có thể khớp ID[\s\S]*Library `nha-hat-lon`/);
  assert.match(result.stdout, /Nguồn chính.*\| — \|/);
  assert.match(result.stdout, /Chi nhánh · Chi nhánh do pipeline đề xuất \(chưa có nguồn hỗ trợ\)/);
  assert.match(result.stdout, /Địa chỉ · .*\(bằng chứng S1, S2\)/);
  assert.match(result.stdout, /Chi phí mỗi người · 0 ₫\/người \(bằng chứng S2\)/);
  assert.match(result.stdout, /Tọa độ · 21\.02417, 105\.85744 \(chưa có nguồn hỗ trợ\)/);

  theatre.address = '99 Trang Tien - Phuong Cua Nam - Ha Noi';
  const differentAddress = check({ version: 1, candidates: [theatre] });
  assert.equal(differentAddress.status, 0, differentAddress.stderr);
  assert.match(differentAddress.stdout, /Cần kiểm tra thêm[\s\S]*Library `nha-hat-lon`/);
  assert.doesNotMatch(differentAddress.stdout, /Có thể khớp ID/);
});

test('the review accepts an empty batch and rejects invalid formats with a field path', (t) => {
  const check = tempBatch(t);
  const [theatre] = JSON.parse(read(example)).candidates;
  const empty = check({ version: 1, candidates: [] });
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /Lô này chưa có ứng viên/);
  for (const [batch, issue] of [
    [{ version: 2, candidates: [] }, /version:.*phiên bản/],
    [{ version: 1, candidates: [theatre, theatre] }, /candidates\[1\]\.id:.*trùng/],
    [{ version: 1, candidates: [{ ...theatre, sources: [{ url: 'file:///tmp/sample', supports: ['name'] }] }] }, /sources\[0\]\.url/],
    [{ version: 1, candidates: [{ ...theatre, sources: [{ ...theatre.sources[0], supports: ['pricePerPersonVnd'] }] }] }, /sources\[0\]\.supports/],
    [{ version: 1, candidates: [{ ...theatre, sources: [{ ...theatre.sources[0], checkedOn: '2026-02-30' }] }] }, /sources\[0\]\.checkedOn/],
    [{ version: 1, candidates: [{ ...theatre, coordinates: { lat: 91, lon: 0 } }] }, /coordinates/],
    [{ version: 1, candidates: [{ ...theatre, image: { ...theatre.image, displayPermission: { basis: 'license' } } }] }, /displayPermission\.evidenceUrl/],
  ]) {
    const result = check(batch);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, issue);
  }
});

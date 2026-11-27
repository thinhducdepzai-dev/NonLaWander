import assert from 'node:assert/strict';
import test from 'node:test';
import { baseLibraryPlaces } from '../public/data.js';
import { approveLibrary, hasCoordinates, materializeLibrary, readLibrary, reviewCandidate } from '../public/library-import.js';
import { walkMinutes } from '../public/planner.js';
import { createTripStore } from '../public/trips.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    key: (index) => [...values.keys()][index], get length() { return values.size; } };
}

const matching = {
  id: 'live:opera', name: 'Nha hat Lon Ha Noi', address: '01 Tràng Tiền, phường Cửa Nam, Hà Nội',
  coordinates: { lat: 12, lon: 60 },
  sources: [{ url: 'https://www.threads.com/@review/post/123', supports: ['name', 'address', 'coordinates'], note: 'Review và địa chỉ.' }],
};
const branch = (id, number) => ({
  id, name: 'Quán kiểm thử', address: `${number} phố Giả Lập, Hà Nội`,
  sources: [{ url: 'https://example.invalid/review/' + number, supports: ['name', 'address'] }],
});
const first = branch('live:branch-a', 12);
const second = branch('live:branch-b', 34);
const omitted = branch('live:branch-c', 56);
const fixture = { ...branch('fixture:gallery', 78), fixture: true };

test('chỉ lưu các lựa chọn, giữ ID/tọa độ cũ và đọc lại các chi nhánh mới sau tải lại', () => {
  const local = storage();
  const oldTrip = createTripStore(local).create();
  assert.ok(createTripStore(local).setSavedPlace(oldTrip.id, 'nha-hat-lon', true));
  const batch = { version: 1, candidates: [matching, first, second, omitted, fixture] };
  const selected = [[matching.id, 'auto'], [first.id, 'new'], [second.id, 'new']];
  const approved = approveLibrary(local, baseLibraryPlaces, batch, selected);
  approveLibrary(local, baseLibraryPlaces, batch, selected);
  const active = materializeLibrary(baseLibraryPlaces, readLibrary(local));
  const opera = active.find(({ id }) => id === 'nha-hat-lon');
  const prior = baseLibraryPlaces.find(({ id }) => id === 'nha-hat-lon');
  assert.equal(approved[0].libraryId, prior.id);
  assert.deepEqual([opera.lat, opera.lon], [prior.lat, prior.lon]);
  assert.deepEqual(opera.sources.map(({ url }) => url), [prior.sources[0].url, matching.sources[0].url]);
  assert.deepEqual(createTripStore(local).get(oldTrip.id).savedPlaceIds, ['nha-hat-lon']);
  const branches = active.filter(({ name }) => name === first.name);
  assert.deepEqual(branches.map(({ address }) => address), [first.address, second.address]);
  assert.ok(branches.every((place) => !hasCoordinates(place)));
  assert.equal(walkMinutes(opera, branches[0]), null);
  assert.equal(new Set(branches.map(({ id }) => id)).size, 2);
});

test('lựa chọn chi nhánh tường minh và khóa dữ liệu thử ngay tại bước lưu', () => {
  const local = storage();
  const existing = [{ id: 'branch-west', name: first.name }, { id: 'branch-east', name: first.name }];
  const plan = reviewCandidate(first, existing, []);
  assert.equal(plan.action, 'choose');
  assert.deepEqual(plan.places.map(({ id }) => id), ['branch-west', 'branch-east']);
  const batch = { version: 1, candidates: [first, fixture, { ...fixture, id: 'fixture:without-flag', fixture: false }] };
  assert.throws(() => approveLibrary(local, existing, batch, [[first.id, 'auto']]), /kiểm tra lại chi nhánh/u);
  assert.throws(() => approveLibrary(local, existing, batch, [[first.id, 'branch-west'], [fixture.id, 'auto']]), /Dữ liệu thử/u);
  assert.throws(() => approveLibrary(local, existing, batch, [['fixture:without-flag', 'auto']]), /Dữ liệu thử/u);
  assert.deepEqual(readLibrary(local), []);
  assert.equal(approveLibrary(local, existing, batch, [[first.id, 'branch-east']])[0].libraryId, 'branch-east');
});

test('cùng URL chỉ hiện một lần và nguồn mới của ứng viên đã duyệt được bổ sung', () => {
  const local = storage();
  const submit = (candidate) => approveLibrary(local, [], { version: 1, candidates: [candidate] }, [[candidate.id, 'auto']]);
  submit(first);
  submit({ ...first, sources: [{ ...first.sources[0], url: first.sources[0].url + '?utm_source=share', note: 'Đã đọc.' },
    { url: 'https://example.invalid/branch', supports: ['address'] }] });
  const [place] = materializeLibrary([], readLibrary(local));
  assert.deepEqual(place.sources.map(({ url, note }) => [url, note]), [[first.sources[0].url, 'Đã đọc.'], ['https://example.invalid/branch', undefined]]);
});

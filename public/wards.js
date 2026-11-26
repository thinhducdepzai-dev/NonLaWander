import { experiences, libraryPlaces, placeById } from './data.js';

export const wardSources = {
  boundaries: 'https://www.openstreetmap.org/copyright',
  names: 'https://congbao.chinhphu.vn/tai-ve-van-ban-so-1656-nq-ubtvqh15-45110-56820?format=pdf',
  codes: 'https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2025/6/45430/57438-1-2025919-92019-2025-qd-ttg.pdf',
  snapshot: '26/11/2026',
};

export const wards = [
  { id: '00070', name: 'Hoàn Kiếm', description: 'Dạo quanh hồ, ghé đền Ngọc Sơn hoặc tìm quán cà phê trong những phố nhỏ của khu phố cổ.' },
  { id: '00082', name: 'Cửa Nam', description: 'Những dãy phố kiến trúc Pháp quanh Nhà hát Lớn và quảng trường Cách mạng Tháng Tám.' },
  { id: '00004', name: 'Ba Đình', description: 'Khu vực Quán Thánh và Trúc Bạch, ở phía tây bắc cụm phường trên bản đồ.' },
];

export const wardById = Object.fromEntries(wards.map((ward) => [ward.id, ward]));

// Geography uses the pinned OSM polygons, checked against the demo coordinates.
// The older Kem Tràng Tiền record identifies the brand but has no branch address.
const wardForPlace = {
  'ho-guom': '00070', 'ngoc-son': '00070', 'dinh-cafe': '00070', 'nha-tho': '00070',
  'ma-may': '00070', 'giang-cafe': '00070', 'pho-gia-truyen': '00070',
  'dong-xuan': '00070', 'cho-dem': '00070',
};

const placeWardId = (id) => placeById[id]?.wardId ?? wardForPlace[id];
export const placeWard = (id) => wardById[placeWardId(id)];
export const normalizeWardIds = (ids) => Array.isArray(ids)
  ? [...new Set(ids.filter((id) => Object.hasOwn(wardById, id)))] : [];

export function wardLibrary(id) {
  const places = libraryPlaces.filter((place) => placeWardId(place.id) === id);
  const ids = new Set(places.map((place) => place.id));
  return { places, experiences: experiences.filter((item) => item.placeIds.some((placeId) => ids.has(placeId))) };
}

export function wardPreference(ids) {
  const selected = new Set(normalizeWardIds(ids));
  const matches = ({ id }) => selected.has(placeWardId(id));
  return {
    score: (place) => Number(matches(place)) * 4,
    outsideNote(places, reason) {
      const outside = places.filter((place) => !matches(place));
      if (!selected.size || !outside.length) return '';
      const names = outside.map(({ name }) => name).join(', ');
      return `${names} ${outside.length === 1 ? 'nằm' : 'đều nằm'} ngoài các phường ưu tiên. ${reason}`;
    },
  };
}

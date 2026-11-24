export const periods = [
  { id: 'morning', label: 'Sáng', icon: 'sunrise', start: '08:00', end: '11:00' },
  { id: 'afternoon', label: 'Chiều', icon: 'sun', start: '14:00', end: '17:00' },
  { id: 'evening', label: 'Tối', icon: 'moon', start: '18:00', end: '21:00' },
];

export const vibes = [
  { id: 'culture', label: 'Văn hóa', icon: 'landmark' },
  { id: 'cafe', label: 'Cà phê', icon: 'coffee' },
  { id: 'food', label: 'Ăn ngon', icon: 'food' },
  { id: 'photo', label: 'Chụp ảnh', icon: 'camera' },
  { id: 'slow', label: 'Thư thả', icon: 'leaf' },
];

export const areas = [
  { id: 'lake', label: 'Hồ Gươm' },
  { id: 'quarter', label: 'Phố cổ' },
];

export const transports = [
  { id: 'walk', label: 'Đi bộ', icon: 'walk' },
  { id: 'bike', label: 'Xe đạp', icon: 'bike' },
  { id: 'car', label: 'Taxi / xe công nghệ', icon: 'car' },
];

const daily = (start, end) => [{ start, end }];
const weekend = [0, 6];

// Toàn bộ thời gian, chi phí, độ đông và tọa độ bên dưới là dữ liệu demo.
export const places = [
  { id: 'ho-guom', name: 'Dạo quanh Hồ Gươm', category: 'Dạo phố', icon: 'leaf', area: 'lake', vibes: ['slow', 'photo'], cost: 0, duration: 55, lat: 21.02884, lon: 105.85244, hours: daily('06:00', '22:00'), crowd: 'Đông hơn vào tối cuối tuần' },
  { id: 'ngoc-son', name: 'Đền Ngọc Sơn', category: 'Văn hóa', icon: 'landmark', area: 'lake', vibes: ['culture', 'photo'], cost: 30_000, duration: 50, lat: 21.03070, lon: 105.85249, hours: daily('08:00', '17:30'), crowd: 'Vừa phải vào buổi sáng' },
  { id: 'dinh-cafe', name: 'Cà phê Đinh', category: 'Cà phê', icon: 'coffee', area: 'lake', vibes: ['cafe', 'slow'], cost: 55_000, duration: 55, lat: 21.03164, lon: 105.85206, hours: daily('08:00', '22:00'), crowd: 'Thường đông vào buổi chiều' },
  { id: 'nha-tho', name: 'Nhà thờ Lớn', category: 'Kiến trúc', icon: 'landmark', area: 'lake', vibes: ['culture', 'photo'], cost: 0, duration: 35, lat: 21.02873, lon: 105.84904, hours: daily('07:00', '21:00') },
  { id: 'trang-tien', name: 'Kem Tràng Tiền', category: 'Ăn nhẹ', icon: 'food', area: 'lake', vibes: ['food'], cost: 35_000, duration: 30, lat: 21.02538, lon: 105.85364, hours: daily('09:00', '22:00') },
  { id: 'ma-may', name: 'Nhà cổ 87 Mã Mây', category: 'Văn hóa', icon: 'landmark', area: 'quarter', vibes: ['culture', 'photo'], cost: 20_000, duration: 60, lat: 21.03381, lon: 105.85274, hours: [{ start: '08:30', end: '11:30' }, { start: '13:30', end: '17:00' }], crowd: 'Thường yên tĩnh đầu giờ chiều' },
  { id: 'giang-cafe', name: 'Cà phê Giảng', category: 'Cà phê', icon: 'coffee', area: 'quarter', vibes: ['cafe', 'slow'], cost: 60_000, duration: 60, lat: 21.03274, lon: 105.85372, hours: daily('08:00', '21:30') },
  { id: 'pho-gia-truyen', name: 'Phở Bát Đàn', category: 'Ăn uống', icon: 'food', area: 'quarter', vibes: ['food'], cost: 75_000, duration: 45, lat: 21.03309, lon: 105.84745, hours: [{ start: '06:00', end: '10:00' }, { start: '18:00', end: '21:00' }], crowd: 'Có thể phải xếp hàng đầu buổi sáng' },
  { id: 'dong-xuan', name: 'Chợ Đồng Xuân', category: 'Mua sắm', icon: 'bag', area: 'quarter', vibes: ['food', 'photo'], cost: 30_000, duration: 50, lat: 21.03704, lon: 105.85004, hours: daily('08:00', '18:00') },
  { id: 'cho-dem', name: 'Chợ đêm Phố cổ', category: 'Dạo phố', icon: 'bag', area: 'quarter', vibes: ['food', 'slow'], cost: 50_000, duration: 70, lat: 21.03440, lon: 105.85072, hours: [{ start: '19:00', end: '23:00', days: [5, ...weekend] }], crowd: 'Đông từ khoảng 20:00' },
];

export const placeById = Object.fromEntries(places.map((place) => [place.id, place]));
export const periodById = Object.fromEntries(periods.map((period) => [period.id, period]));

export function exampleDraft() {
  return {
    startDate: '2026-11-27',
    endDate: '2026-11-29',
    days: {
      '2026-11-27': { morning: { enabled: true, start: '08:00', end: '11:00' } },
      '2026-11-28': { afternoon: { enabled: true, start: '14:00', end: '17:00' } },
    },
    vibes: ['culture', 'cafe'],
    areas: ['lake', 'quarter'],
    mustVisit: ['ngoc-son'],
    budget: '350000',
    transport: 'walk',
    notes: { vibes: '', areas: '', mustVisit: '', budget: '', transport: '' },
  };
}

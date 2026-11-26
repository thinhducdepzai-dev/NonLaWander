const approvedProgram = 'https://sovhtt.hanoi.gov.vn/wp-content/uploads/2025/07/cv-2935-svhtt-qlnt.pdf';
const checkedOn = '2026-11-26';

export const sourcedPlaces = {
  'nha-hat-lon': {
    address: 'Số 1 Tràng Tiền, phường Cửa Nam, Hà Nội',
    wardId: '00082',
    image: {
      src: '/assets/nha-hat-lon-960.webp', width: 960, height: 640,
      thumbnail: { src: '/assets/nha-hat-lon-320.webp', width: 320, height: 214 },
      alt: 'Mặt tiền Nhà hát Lớn Hà Nội nhìn từ quảng trường, với hàng cột trắng và cờ Việt Nam trên mái',
      credit: {
        author: 'The Hanoian', source: 'https://commons.wikimedia.org/wiki/File:Nh%C3%A0_h%C3%A1t_L%E1%BB%9Bn_H%C3%A0_N%E1%BB%99i_-_2022-09-02_02.jpg',
        license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        changes: 'Thu nhỏ và nén WebP',
      },
    },
    sources: [{ title: 'Công văn 2935 của Sở Văn hóa và Thể thao Hà Nội', url: approvedProgram, checkedOn,
      coverage: 'Tên, địa chỉ và phường' }],
  },
};

export const sourcedSessions = {
  'luy-da-bat-tu-20250727-2000': {
    name: 'Lũy đá bất tử', date: '2025-07-27', starts: '20:00', placeId: 'nha-hat-lon',
    useVenueImage: true,
    sources: [{ title: 'Công văn 2935 của Sở Văn hóa và Thể thao Hà Nội', url: approvedProgram, checkedOn,
      coverage: 'Tên, nơi tổ chức và giờ bắt đầu được Sở chấp thuận' }],
  },
};

export function applyLibraryUpdates(entries, updates) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const [id, fields] of Object.entries(updates)) {
    byId.set(id, { ...byId.get(id), ...fields, id });
  }
  return [...byId.values()];
}

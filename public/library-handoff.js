export const fields = {
  name: 'Tên', branch: 'Chi nhánh', address: 'Địa chỉ',
  pricePerPersonVnd: 'Chi phí mỗi người', coordinates: 'Tọa độ',
};
export const rightsLabels = { license: 'Giấy phép', permission: 'Cho phép sử dụng', owned: 'Ảnh thuộc dự án' };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0 && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value);
const isId = (value) => typeof value === 'string' && /^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/.test(value);
const isVnd = (value) => Number.isSafeInteger(value) && value >= 0;
const isCoordinates = (value) => isRecord(value) && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 &&
  Number.isFinite(value.lon) && Math.abs(value.lon) <= 180;

function isWebUrl(value) {
  if (!isText(value) || !/^https?:\/\//i.test(value) || /[\s<>|\\]/u.test(value)) return false;
  const url = URL.parse(value);
  return Boolean(url && !url.username && !url.password);
}

function isDate(value) {
  if (!isText(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().startsWith(value);
}

export function validateBatch(batch) {
  function requireValid(condition, location, message) {
    if (!condition) throw new Error(`${location}: ${message}`);
  }
  const optional = (object, key, validate, path, message) => {
    requireValid(!Object.hasOwn(object, key) || validate(object[key]), `${path}.${key}`, message);
  };

  requireValid(isRecord(batch) && batch.version === 1, 'version', 'chỉ hỗ trợ phiên bản số 1');
  requireValid(Array.isArray(batch.candidates), 'candidates', 'cần một mảng ứng viên');
  const seen = new Set();
  for (const [index, candidate] of batch.candidates.entries()) {
    const path = `candidates[${index}]`;
    requireValid(isRecord(candidate), path, 'cần một đối tượng');
    requireValid(isId(candidate.id), `${path}.id`, 'cần mã ổn định viết thường, dùng chữ ASCII và số');
    requireValid(!seen.has(candidate.id), `${path}.id`, `mã bị trùng (${candidate.id})`);
    seen.add(candidate.id);
    requireValid(isText(candidate.name), `${path}.name`, 'cần tên địa điểm');
    for (const key of ['address', 'branch']) optional(candidate, key, isText, path, 'cần văn bản một dòng');
    optional(candidate, 'fixture', (value) => typeof value === 'boolean', path, 'cần true hoặc false');
    optional(candidate, 'pricePerPersonVnd', isVnd, path, 'cần số đồng nguyên không âm');
    optional(candidate, 'coordinates', isCoordinates, path, 'cần lat và lon hợp lệ');

    requireValid(Array.isArray(candidate.sources) && candidate.sources.length, `${path}.sources`, 'cần ít nhất một nguồn');
    for (const [sourceIndex, source] of candidate.sources.entries()) {
      const sourcePath = `${path}.sources[${sourceIndex}]`;
      requireValid(isRecord(source) && isWebUrl(source.url), `${sourcePath}.url`, 'cần URL HTTP(S)');
      for (const key of ['title', 'note']) optional(source, key, isText, sourcePath, 'cần văn bản một dòng');
      optional(source, 'checkedOn', isDate, sourcePath, 'cần ngày hợp lệ theo YYYY-MM-DD');
      requireValid(Array.isArray(source.supports) && source.supports.length && new Set(source.supports).size === source.supports.length &&
        source.supports.every((key) => typeof key === 'string' && Object.hasOwn(fields, key) && Object.hasOwn(candidate, key)),
      `${sourcePath}.supports`, 'chỉ liệt kê các trường dữ liệu có giá trị trong ứng viên, mỗi trường một lần');
    }

    if (Object.hasOwn(candidate, 'image')) {
      const image = candidate.image;
      const imagePath = `${path}.image`;
      requireValid(isRecord(image) && isWebUrl(image.referenceUrl), `${imagePath}.referenceUrl`, 'cần URL ảnh hoặc trang chứa ảnh');
      if (Object.hasOwn(image, 'displayPermission')) {
        const permission = image.displayPermission;
        const permissionPath = `${imagePath}.displayPermission`;
        requireValid(isRecord(permission) && typeof permission.basis === 'string' && Object.hasOwn(rightsLabels, permission.basis), `${permissionPath}.basis`,
          'chọn license, permission hoặc owned');
        requireValid(isWebUrl(permission.evidenceUrl), `${permissionPath}.evidenceUrl`, 'cần URL bằng chứng quyền dùng ảnh');
        if (permission.basis === 'license') requireValid(isText(permission.license), `${permissionPath}.license`, 'cần tên giấy phép');
        for (const key of ['license', 'author', 'note']) optional(permission, key, isText, permissionPath, 'cần văn bản một dòng');
      }
    }
  }
}

// Compare exact names and addresses after normalizing accents, punctuation and the leading house-number label.
const normalized = (value) => (value ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const addressKey = (value) => normalized(value).replace(/^so /, '').replace(/^0+(?=\d)/, '');

export function suggestMatch(candidate, evidence, libraryPlaces) {
  const name = normalized(candidate.name);
  const address = addressKey(candidate.address);
  const sameName = libraryPlaces.filter((place) => normalized(place.name) === name);
  if (!address || !evidence.address.length) {
    return { review: 'Cần kiểm tra thêm', reason: 'Thiếu địa chỉ có nguồn để phân biệt chi nhánh.', places: sameName };
  }
  const matching = sameName.filter((place) => addressKey(place.address) === address);
  if (matching.length === 1 && evidence.name.length) {
    return { review: 'Có thể khớp ID', reason: 'Tên và địa chỉ có nguồn trùng với Library.', places: matching };
  }
  const sameAddress = libraryPlaces.filter((place) => addressKey(place.address) === address);
  if (sameName.length || sameAddress.length || !evidence.name.length) {
    const reason = !evidence.name.length ? 'Nguồn chưa hỗ trợ tên ứng viên.'
      : 'Tên hoặc địa chỉ gợi ý mục liên quan, cần đối chiếu đúng chi nhánh.';
    return { review: 'Cần kiểm tra thêm', reason, places: [...new Set([...sameName, ...sameAddress])], exactCount: matching.length };
  }
  return { review: 'Ứng viên mới', reason: 'Tên và địa chỉ có nguồn. Chưa thấy mục tương ứng trong Library.', places: [] };
}

export function fieldEvidence(candidate) {
  const evidence = Object.fromEntries(Object.keys(fields).map((key) => [key, []]));
  for (const [index, source] of candidate.sources.entries()) {
    for (const key of source.supports) evidence[key].push(`S${index + 1}`);
  }
  return evidence;
}

export function isFixture(candidate) {
  return candidate.fixture === true || /^fixture(?:[-_.:]|$)/i.test(candidate.id);
}

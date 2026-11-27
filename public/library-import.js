import { fieldEvidence, fields, isFixture, suggestMatch, validateBatch } from './library-handoff.js';

export const libraryStorageKey = 'nonla-wander-library-v1';
export const isLocalLibrary = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
export const hasCoordinates = ({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon);

export function readLibrary(storage) {
  const stored = storage?.getItem(libraryStorageKey);
  if (!stored) return [];
  const { version, entries } = JSON.parse(stored);
  if (version !== 1 || !Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.libraryId !== 'string'
    || !/^[a-z0-9-]+$/.test(entry.libraryId))) throw new Error('Dữ liệu Library cục bộ không hợp lệ.');
  validateBatch({ version, candidates: entries.map(({ candidate }) => candidate) });
  if (entries.some(({ candidate }) => isFixture(candidate))) throw new Error('Library cục bộ chứa mục dữ liệu thử.');
  return entries;
}

function sourceKey(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

function mergeSources(sources) {
  const unique = new Map();
  for (const source of sources) {
    const key = sourceKey(source.url);
    if (!unique.has(key)) unique.set(key, { ...source });
    else {
      const saved = unique.get(key);
      saved.title ??= source.title;
      if (source.checkedOn && (!saved.checkedOn || source.checkedOn > saved.checkedOn)) saved.checkedOn = source.checkedOn;
      if (source.note && !saved.note?.includes(source.note)) saved.note = [saved.note, source.note].filter(Boolean).join(' · ');
      if (source.coverage && !saved.coverage?.includes(source.coverage)) saved.coverage = [saved.coverage, source.coverage].filter(Boolean).join(' · ');
      if (source.supports) saved.supports = [...new Set([...(saved.supports ?? []), ...source.supports])];
    }
  }
  return [...unique.values()];
}

export function materializeLibrary(base, entries) {
  const result = new Map(base.map((place) => [place.id, place]));
  for (const { libraryId, candidate } of entries) {
    const evidence = fieldEvidence(candidate);
    const place = { ...(result.get(libraryId) ?? {
      id: libraryId, name: candidate.name, category: 'Địa điểm', icon: 'landmark', duration: 45, durationEstimated: true, vibes: [],
    }) };
    if (evidence.address.length) place.address ??= candidate.address;
    if (evidence.branch.length) place.branch ??= candidate.branch;
    if (place.cost == null && evidence.pricePerPersonVnd.length) place.cost = candidate.pricePerPersonVnd;
    if (!hasCoordinates(place) && evidence.coordinates.length) Object.assign(place, { lat: candidate.coordinates.lat, lon: candidate.coordinates.lon });
    place.sources = mergeSources([...(place.sources ?? []), ...candidate.sources]);
    result.set(libraryId, place);
  }
  return [...result.values()];
}

export function reviewCandidate(candidate, places, entries) {
  const saved = entries.find((entry) => entry.candidate.id === candidate.id);
  const existing = saved && places.find((place) => place.id === saved.libraryId);
  if (existing) return { action: 'merge', places: [existing], reason: 'Ứng viên đã được duyệt vào chi nhánh này.' };

  const evidence = fieldEvidence(candidate);
  const match = suggestMatch(candidate, evidence, places);
  if (match.review === 'Có thể khớp ID') return { ...match, action: 'merge' };
  if (match.review === 'Ứng viên mới') return { ...match, action: 'new' };
  return { ...match, action: 'choose', allowNew: !!(evidence.name.length && evidence.address.length && !match.exactCount) };
}

function newLibraryId(candidate, places) {
  const stem = `discovery-${candidate.id.replace(/[^a-z0-9]/g, '-')}`;
  const ids = new Set(places.map((place) => place.id));
  let id = stem;
  for (let suffix = 2; ids.has(id); suffix += 1) id = `${stem}-${suffix}`;
  return id;
}

function mergeCandidate(prior, candidate) {
  if (!prior) return { ...candidate, sources: mergeSources(candidate.sources) };
  const current = { ...prior, ...candidate };
  const originalEvidence = fieldEvidence(prior);
  const newEvidence = fieldEvidence(candidate);
  for (const key of Object.keys(fields)) {
    if (originalEvidence[key].length || (!newEvidence[key].length && Object.hasOwn(prior, key))) current[key] = prior[key];
  }
  current.sources = mergeSources([...prior.sources, ...candidate.sources]);
  return current;
}

export function approveLibrary(storage, base, batch, selections) {
  validateBatch(batch);
  const candidates = new Map(batch.candidates.map((candidate) => [candidate.id, candidate]));
  const entries = readLibrary(storage);
  const approved = [];
  let places = materializeLibrary(base, entries);
  for (const [id, selection] of selections) {
    const candidate = candidates.get(id);
    if (!candidate) throw new Error('Ứng viên đã chọn không thuộc tệp hiện tại.');
    if (isFixture(candidate)) throw new Error('Dữ liệu thử chỉ được xem trước, không thể thêm vào Library.');
    const plan = reviewCandidate(candidate, places, entries);
    let libraryId;
    if (plan.action === 'merge' && (selection === 'auto' || selection === 'new' || selection === plan.places[0].id)) {
      libraryId = plan.places[0].id;
    } else if ((plan.action === 'new' && ['auto', 'new'].includes(selection)) || (plan.allowNew && selection === 'new')) {
      libraryId = newLibraryId(candidate, places);
    } else if (plan.action === 'choose' && plan.places.some((place) => place.id === selection)) {
      libraryId = selection;
    } else {
      throw new Error(`Hãy kiểm tra lại chi nhánh đã chọn cho ${candidate.name}.`);
    }
    const index = entries.findIndex((entry) => entry.candidate.id === id);
    const entry = { libraryId, candidate: mergeCandidate(entries[index]?.candidate, candidate) };
    if (index >= 0) entries[index] = entry;
    else entries.push(entry);
    places = materializeLibrary(base, entries);
    approved.push({ candidateId: id, libraryId });
  }
  if (approved.length) storage.setItem(libraryStorageKey, JSON.stringify({ version: 1, entries }));
  return approved;
}

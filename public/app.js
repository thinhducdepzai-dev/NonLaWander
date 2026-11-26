import { calendarOf } from './calendar.js';
import { setupCalendarView } from './calendar-view.js';
import { areas, experienceById, placeById } from './data.js';
import { setupHomeMotion } from './home.js';
import { icon } from './icons.js';
import { experienceHref, experiencePlaceLabel, getLibraryReturn, renderLibrary, setupLibraryActions, tripLibraryHref } from './library.js';
import { dateIndex } from './planner.js';
import { createTripStore, hasDraftChanges } from './trips.js';

const $ = (id) => document.getElementById(id);
setupHomeMotion($('home-view'));
const shortDate = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const year = (date) => date.slice(0, 4);

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const trips = createTripStore(browserStorage());
let activeTrip = null;
let viewingConfirmed = false;
let libraryReturn = null;

function announce(message) {
  $('status').textContent = message;
}

function showStorageStatus() {
  $('storage-notice').hidden = !trips.storageProblem;
}

document.querySelectorAll('[data-icon]').forEach((node) => {
  node.innerHTML = icon(node.dataset.icon);
});

function tripHash(id, confirmed = false, returnHref) {
  const path = `#trip/${id}${confirmed ? '/confirmed' : ''}`;
  return returnHref ? `${path}?${new URLSearchParams({ library: returnHref })}` : path;
}

function savedItemsHash(id, experience = false) {
  return `${tripHash(id)}?saved=${experience ? 'experience' : '1'}`;
}

function renderSavedPlaces() {
  const { id, savedPlaceIds } = activeTrip;
  $('trip-saved-library').href = tripLibraryHref(id);
  $('trip-saved-calendar').href = tripHash(id);
  $('trip-saved-calendar').textContent = calendarOf(activeTrip.draft)?.mode ? 'Mở lịch' : 'Thiết lập thời gian';
  $('trip-saved-empty').hidden = !!savedPlaceIds.length;
  $('trip-saved-list').replaceChildren(...savedPlaceIds.map((placeId) => {
    const place = placeById[placeId];
    const item = $('trip-saved-item').content.firstElementChild.cloneNode(true);
    const details = item.querySelector('.trip-saved-place');
    details.href = tripLibraryHref(id, placeId);
    details.querySelector('.trip-saved-icon').innerHTML = icon(place.icon);
    details.querySelector('strong').textContent = place.name;
    const area = areas.find((entry) => entry.id === place.area)?.label;
    details.querySelector('small').textContent = [place.category, area].filter(Boolean).join(' · ');
    const add = item.querySelector('.trip-saved-add');
    add.href = tripLibraryHref(id, placeId, true);
    add.textContent = viewingConfirmed ? 'Thêm vào nháp' : 'Thêm vào lịch';
    add.setAttribute('aria-label', `Thêm ${place.name} ${viewingConfirmed ? 'vào nháp' : 'vào lịch'}`);
    const remove = item.querySelector('.trip-saved-remove');
    remove.dataset.placeId = placeId;
    remove.setAttribute('aria-label', `Bỏ lưu ${place.name}`);
    return item;
  }));
}

$('trip-saved-list').addEventListener('click', (event) => {
  const button = event.target.closest('.trip-saved-remove');
  if (!button || !activeTrip) return;
  const { placeId } = button.dataset;
  const index = activeTrip.savedPlaceIds.indexOf(placeId);
  const trip = trips.setSavedPlace(activeTrip.id, placeId, false);
  if (!trip) return;
  activeTrip = trip;
  renderSavedPlaces();
  showStorageStatus();
  const remaining = $('trip-saved-list').querySelectorAll('.trip-saved-remove');
  (remaining[Math.min(index, remaining.length - 1)] ?? $('trip-saved-title')).focus();
  announce(`Đã bỏ lưu ${placeById[placeId].name}.`);
});

function renderSavedExperiences() {
  const { id, savedExperienceIds } = activeTrip;
  $('trip-experiences').hidden = !savedExperienceIds.length;
  $('trip-experiences-list').replaceChildren(...savedExperienceIds.map((experienceId) => {
    const experience = experienceById[experienceId];
    const row = $('trip-experience-item').content.firstElementChild.cloneNode(true);
    const link = row.querySelector('a');
    link.href = experienceHref(experienceId, id);
    row.querySelector('strong').textContent = experience.name;
    row.querySelector('small').textContent = `${experience.kind} · ${experiencePlaceLabel(experience)}`;
    row.querySelector('.trip-saved-icon').innerHTML = icon(experience.icon);
    const remove = row.querySelector('button');
    remove.dataset.experienceId = experience.id;
    remove.setAttribute('aria-label', `Bỏ lưu ${experience.name}`);
    return row;
  }));
}

$('trip-experiences-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-experience-id]');
  if (!button || !activeTrip) return;
  const { experienceId } = button.dataset;
  const index = activeTrip.savedExperienceIds.indexOf(experienceId);
  const trip = trips.setSavedExperience(activeTrip.id, experienceId, false);
  if (!trip) return;
  activeTrip = trip;
  renderSavedExperiences();
  showStorageStatus();
  const remaining = $('trip-experiences-list').querySelectorAll('button');
  (remaining[Math.min(index, remaining.length - 1)] ?? $('trip-saved-title')).focus();
  announce(`Đã bỏ lưu trải nghiệm ${experienceById[experienceId].name}.`);
});

function tripDates(trip) {
  const { startDate, endDate } = trip.draft.form;
  const first = Number.isInteger(dateIndex(startDate)) ? `${shortDate(startDate)}/${year(startDate)}` : '';
  const last = Number.isInteger(dateIndex(endDate)) ? `${shortDate(endDate)}/${year(endDate)}` : '';
  if (first && last) return first === last ? first : `${first} – ${last}`;
  if (first) return `Đến ${first}`;
  if (last) return `Rời ${last}`;
  return 'Chưa chọn ngày';
}

function tripStatus(trip) {
  if (hasDraftChanges(trip)) return 'Đã chốt · Có nháp';
  return trip.confirmed ? 'Đã chốt' : 'Nháp';
}

function renderHome() {
  const [recent] = trips.list();
  $('home-recent').hidden = !recent;
  if (!recent) return;

  const calendar = calendarOf(recent.draft);
  const details = calendar?.events.length ? `${calendar.events.length} sự kiện` : tripDates(recent);
  const href = tripHash(recent.id);
  $('recent-trip-link').href = href;
  $('recent-trip-name').textContent = recent.name;
  $('recent-trip-details').textContent = `${tripStatus(recent)} · ${details}`;
}

function renderTripList() {
  const allTrips = trips.list();
  $('empty-trips').hidden = allTrips.length > 0;
  $('trip-list').hidden = allTrips.length === 0;
  $('trip-list').replaceChildren(...allTrips.map((trip) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'trip-card';
    link.href = tripHash(trip.id);
    link.dataset.tripId = trip.id;
    link.innerHTML = `<span class="section-icon">${icon('calendar')}</span>
      <span class="trip-card-info"><strong></strong><span></span></span>
      <span class="trip-card-status"></span>`;
    link.querySelector('strong').textContent = trip.name;
    link.querySelector('.trip-card-info > span').textContent = tripDates(trip);
    const status = link.querySelector('.trip-card-status');
    status.textContent = tripStatus(trip);
    if (trip.confirmed) status.classList.add('is-confirmed');
    item.append(link);
    return item;
  }));
}

function updateTripControls() {
  const { id, name, confirmed } = activeTrip;
  const changed = hasDraftChanges(activeTrip);
  $('trip-title').textContent = name;
  $('version-links').hidden = !confirmed;
  $('draft-link').href = tripHash(id, false, libraryReturn?.href);
  $('confirmed-link').href = tripHash(id, true, libraryReturn?.href);
  $('draft-link').setAttribute('aria-current', viewingConfirmed ? 'false' : 'page');
  $('confirmed-link').setAttribute('aria-current', viewingConfirmed ? 'page' : 'false');
  $('draft-changed').hidden = !changed;
  document.title = `${name} — NonLa Wander`;
}

function toggleRename(show) {
  $('rename-form').hidden = !show;
  $('rename-trip').setAttribute('aria-expanded', show);
  if (show) {
    $('trip-name').value = activeTrip.name;
    $('trip-name').select();
    $('trip-name').focus();
  }
}

function renderRoute(focus = false, previousHash = '') {
  const previousId = activeTrip?.id;
  const { hash } = location;
  const [path, search] = hash.split('?', 2);
  const params = new URLSearchParams(search);
  const route = path.match(/^#trip\/([a-z0-9-]+)(\/confirmed)?$/);
  activeTrip = route ? trips.get(route[1]) : null;
  libraryReturn = activeTrip ? getLibraryReturn(params.get('library')) : null;
  const showProjects = !activeTrip && (hash === '#trips' || hash.startsWith('#trip/'));
  const showLibrary = /^#library(?:[/?]|$)/.test(hash);
  const showHome = !activeTrip && !showProjects && !showLibrary;
  viewingConfirmed = Boolean(route?.[2] && activeTrip?.confirmed);
  document.body.classList.toggle('is-home', showHome);
  document.body.classList.toggle('is-library', showLibrary);
  $('home-view').hidden = !showHome;
  $('trip-list-view').hidden = !showProjects;
  const saved = params.get('saved');
  const showSaved = !!activeTrip && !!saved;
  const version = viewingConfirmed ? activeTrip?.confirmed : activeTrip?.draft;
  const configured = version && calendarOf(version)?.mode;
  document.body.classList.toggle('is-calendar', !!activeTrip && !showSaved);
  $('hourly-workspace').hidden = !activeTrip || showSaved;
  $('trip-header').hidden = !activeTrip || !(showSaved || configured);
  $('trip-saved').hidden = !showSaved;
  $('trip-experiences').hidden = true;
  if (!activeTrip || showSaved) hourlyCalendar.render(null);
  $('site-footer').hidden = showHome || showLibrary;
  $('home-link').setAttribute('aria-current', showHome ? 'page' : 'false');
  $('trips-link').setAttribute('aria-current', showProjects ? 'page' : activeTrip ? 'location' : 'false');
  $('library-link').setAttribute('aria-current', showLibrary ? (hash.startsWith('#library/') ? 'location' : 'page') : 'false');
  if (!showLibrary) {
    $('library-view').hidden = true;
    $('library-detail').hidden = true;
  }

  if (activeTrip) {
    if (route[2] && !viewingConfirmed) history.replaceState(null, '', tripHash(activeTrip.id, false, libraryReturn?.href));
    toggleRename(false);
    $('trip-library-context').hidden = true;
    $('trip-version-guidance').textContent = viewingConfirmed ? 'Mở Nháp để chỉnh tiếp lịch.' : 'Nháp tự lưu trên trình duyệt này.';
    updateTripControls();
    if (showSaved) {
      renderSavedPlaces();
      renderSavedExperiences();
      if (focus) $(saved === 'experience' && activeTrip.savedExperienceIds.length ? 'trip-experiences-title' : 'trip-saved-title').focus();
    } else {
      if (libraryReturn) {
        $('trip-library-return').href = libraryReturn.href;
        $('trip-library-return').textContent = 'Quay về Library';
        $('trip-library-return').hidden = false;
        $('trip-library-context').hidden = false;
      }
      hourlyCalendar.render(activeTrip, viewingConfirmed, libraryReturn, focus);
    }
  } else if (showProjects) {
    if (hash !== '#trips') history.replaceState(null, '', '#trips');
    document.title = 'My Projects · NonLa Wander';
    renderTripList();
    if (focus) {
      const previous = previousId && $('trip-list').querySelector(`[data-trip-id="${previousId}"]`);
      (previous || $('trip-list-title')).focus();
    }
  } else if (showLibrary) {
    renderLibrary(hash, focus, previousHash, renderLibraryActions, savedItemsHash, trips.get);
  } else {
    document.title = 'Home · NonLa Wander';
    renderHome();
    if (focus) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      $('home-title').focus({ preventScroll: true });
    }
  }
  showStorageStatus();
}

function createTrip(resume) {
  const trip = trips.create();
  location.hash = tripHash(trip.id, false, resume?.(trip.id));
  announce('Đã tạo chuyến đi mới.');
}

for (const button of document.querySelectorAll('[data-create-trip]')) {
  button.addEventListener('click', () => createTrip());
}

const renderLibraryActions = setupLibraryActions({ trips, createTrip, tripHash, savedItemsHash, showStorageStatus });
const hourlyCalendar = setupCalendarView({
  trips, tripHash, savedHref: savedItemsHash, announce,
  updated(value) {
    activeTrip = value;
    $('trip-header').hidden = !calendarOf(value.draft)?.mode;
    updateTripControls();
    showStorageStatus();
  },
});

$('rename-trip').addEventListener('click', () => toggleRename($('rename-form').hidden));
$('trip-name').addEventListener('input', (event) => {
  activeTrip = trips.rename(activeTrip.id, event.target.value) ?? activeTrip;
  updateTripControls();
  showStorageStatus();
});
$('rename-form').addEventListener('submit', (event) => {
  event.preventDefault();
  toggleRename(false);
  $('rename-trip').focus();
});

document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  $('main-content').focus();
});
window.addEventListener('hashchange', (event) => renderRoute(true, new URL(event.oldURL).hash));
trips.migrateLegacy();
renderRoute();

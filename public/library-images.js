export function sessionImage(session, venue) {
  if (session.image) return session.image;
  if (session.useVenueImage && venue?.image) return { ...venue.image, caption: 'Địa điểm tổ chức' };
  return null;
}

export function libraryImage(image, { detail = false, onError } = {}) {
  const element = document.createElement('img');
  element.className = image.kind === 'poster' ? 'library-image library-image-poster' : 'library-image';
  element.alt = detail ? image.alt : '';
  element.decoding = 'async';
  element.loading = detail ? 'eager' : 'lazy';
  const size = detail ? image : image.thumbnail ?? image;
  element.width = size.width;
  element.height = size.height;
  element.addEventListener('error', () => {
    element.hidden = true;
    onError?.();
  }, { once: true });
  if (detail && image.thumbnail) {
    element.srcset = `${image.thumbnail.src} ${image.thumbnail.width}w, ${image.src} ${image.width}w`;
    element.sizes = '(min-width: 720px) 672px, calc(100vw - 32px)';
  }
  element.src = size.src;
  return element;
}

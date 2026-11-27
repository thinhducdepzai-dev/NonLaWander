import { wards } from './wards.js';

let boundaryRequest;

export function wardBoundaries() {
  boundaryRequest ??= fetch('/assets/hanoi-wards.geojson').then((response) => {
    if (!response.ok) throw new Error('Ward boundaries unavailable');
    return response.json();
  }).then(({ features }) => {
    if (!wards.every(({ id }) => features.some((feature) => feature.id === id))) throw new Error('Missing ward geometry');
    return features;
  });
  return boundaryRequest;
}

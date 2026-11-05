// OpenFreeMap's public instance permits commercial use. Keep its tile source's
// OpenMapTiles/OpenStreetMap attribution visible through MapLibre's control.
export const OVERSEAS_MAP_RESOURCE_ORIGIN = 'https://tiles.openfreemap.org';
export const OVERSEAS_MAP_STYLE_URL = `${OVERSEAS_MAP_RESOURCE_ORIGIN}/styles/positron`;
export const OVERSEAS_MAP_WORKER_URL = process.env.NEXT_PUBLIC_MAPLIBRE_WORKER_URL ?? '';

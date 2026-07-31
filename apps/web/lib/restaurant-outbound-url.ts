const MAX_RESTAURANT_DESTINATION_NAME_LENGTH = 200;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;

const NAVER_MAP_URL = 'https://map.naver.com/v5/search';
const KAKAO_MAP_URL = 'https://map.kakao.com/';
const GOOGLE_MAP_URL = 'https://www.google.com/maps/dir/';

export type RestaurantMapDestinationInput = {
  name: unknown;
  lat: unknown;
  lng: unknown;
};

export type RestaurantMapDestinationUrls = {
  naver: string;
  kakao: string;
  google: string;
};

type RestaurantMapDestination = {
  name: string;
  lat: number;
  lng: number;
};

function normalizeRestaurantDestinationName(value: unknown): string | null {
  if (typeof value !== 'string' || CONTROL_CHARACTER_PATTERN.test(value)) return null;

  const name = value.trim();
  if (!name || name.length > MAX_RESTAURANT_DESTINATION_NAME_LENGTH) return null;

  return name;
}

function normalizeCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return null;
  }

  return Object.is(value, -0) ? 0 : value;
}

function normalizeRestaurantMapDestination(
  input: unknown,
): RestaurantMapDestination | null {
  if (!input || typeof input !== 'object') return null;

  const { name, lat, lng } = input as RestaurantMapDestinationInput;
  const normalizedName = normalizeRestaurantDestinationName(name);
  const normalizedLat = normalizeCoordinate(lat, -90, 90);
  const normalizedLng = normalizeCoordinate(lng, -180, 180);

  if (normalizedName === null || normalizedLat === null || normalizedLng === null) return null;

  return { name: normalizedName, lat: normalizedLat, lng: normalizedLng };
}

function buildNaverMapDestinationUrlFromNormalizedDestination(
  destination: RestaurantMapDestination,
): string {
  const url = new URL(NAVER_MAP_URL);
  url.searchParams.set('query', destination.name);
  return url.toString();
}

function buildKakaoMapDestinationUrlFromNormalizedDestination(
  destination: RestaurantMapDestination,
): string {
  const url = new URL(KAKAO_MAP_URL);
  url.searchParams.set('q', destination.name);
  url.searchParams.set('urlX', String(destination.lng));
  url.searchParams.set('urlY', String(destination.lat));
  return url.toString();
}

function buildGoogleMapDestinationUrlFromNormalizedDestination(
  destination: RestaurantMapDestination,
): string {
  const url = new URL(GOOGLE_MAP_URL);
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
  return url.toString();
}

export function buildNaverMapDestinationUrl(input: unknown): string | null {
  const destination = normalizeRestaurantMapDestination(input);
  return destination ? buildNaverMapDestinationUrlFromNormalizedDestination(destination) : null;
}

export function buildKakaoMapDestinationUrl(input: unknown): string | null {
  const destination = normalizeRestaurantMapDestination(input);
  return destination ? buildKakaoMapDestinationUrlFromNormalizedDestination(destination) : null;
}

export function buildGoogleMapDestinationUrl(input: unknown): string | null {
  const destination = normalizeRestaurantMapDestination(input);
  return destination ? buildGoogleMapDestinationUrlFromNormalizedDestination(destination) : null;
}

export function buildRestaurantMapDestinationUrls(
  input: unknown,
): RestaurantMapDestinationUrls | null {
  const destination = normalizeRestaurantMapDestination(input);
  if (!destination) return null;

  return {
    naver: buildNaverMapDestinationUrlFromNormalizedDestination(destination),
    kakao: buildKakaoMapDestinationUrlFromNormalizedDestination(destination),
    google: buildGoogleMapDestinationUrlFromNormalizedDestination(destination),
  };
}

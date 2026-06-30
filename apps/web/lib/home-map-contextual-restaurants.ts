import type { Restaurant } from '@/types/restaurant';

export const HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM = 14;
export const HOME_MAP_CONTEXTUAL_DESKTOP_LIMIT = 12;
export const HOME_MAP_CONTEXTUAL_MOBILE_LIMIT = 20;

export type HomeMapRenderMode =
  | 'regional-cluster'
  | 'seoul-district'
  | 'supercluster'
  | 'individual';

export type HomeMapContextualRestaurantsIneligibilityReason =
  | 'below-threshold'
  | 'clustered-render-mode'
  | 'empty'
  | 'overseas-unverified'
  | 'map-unavailable';

export type HomeMapContextualRestaurantsPayload = {
  mode: 'domestic' | 'overseas';
  restaurants: Restaurant[];
  renderMode: HomeMapRenderMode;
  zoom: number | null;
  isEligible: boolean;
  ineligibilityReason?: HomeMapContextualRestaurantsIneligibilityReason;
  totalVisibleCount: number;
};

export const EMPTY_DOMESTIC_CONTEXTUAL_RESTAURANTS: HomeMapContextualRestaurantsPayload = {
  mode: 'domestic',
  restaurants: [],
  renderMode: 'individual',
  zoom: null,
  isEligible: false,
  ineligibilityReason: 'map-unavailable',
  totalVisibleCount: 0,
};

export const EMPTY_OVERSEAS_CONTEXTUAL_RESTAURANTS: HomeMapContextualRestaurantsPayload = {
  mode: 'overseas',
  restaurants: [],
  renderMode: 'individual',
  zoom: null,
  isEligible: false,
  ineligibilityReason: 'overseas-unverified',
  totalVisibleCount: 0,
};

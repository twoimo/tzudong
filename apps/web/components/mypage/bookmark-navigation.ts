import { buildHomeReturnHref } from "@/lib/home-return-href";
import { KOREA_BOUNDS } from "@/lib/home-map-mode-filter";

export function buildBookmarkDetailHref(restaurant: {
  id: string;
  lat: number | null;
  lng: number | null;
}): string {
  const { lat, lng } = restaurant;
  const hasCoordinates = typeof lat === "number" && Number.isFinite(lat)
    && typeof lng === "number" && Number.isFinite(lng);
  const isOverseas = hasCoordinates && (
    lat < KOREA_BOUNDS.minLat || lat > KOREA_BOUNDS.maxLat
    || lng < KOREA_BOUNDS.minLng || lng > KOREA_BOUNDS.maxLng
  );

  // A bookmark opens a new detail entry. A previous map/list restore key must
  // not be carried across the My Page navigation boundary.
  return buildHomeReturnHref({
    restaurantId: restaurant.id,
    mapMode: isOverseas ? "overseas" : "domestic",
    focusZoom: null,
  });
}

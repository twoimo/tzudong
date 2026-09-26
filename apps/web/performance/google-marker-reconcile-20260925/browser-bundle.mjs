// lib/map-view-google-helpers.ts
function getRestaurantLatLng(restaurant) {
  if (!restaurant)
    return null;
  const lat = Number(restaurant.lat);
  const lng = Number(restaurant.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  return { lat, lng };
}

// lib/map-view-helpers.ts
function getMapViewMarkerIcon(categories) {
  if (!categories)
    return "/images/maker-images/webp/korean.webp";
  const category = Array.isArray(categories) ? categories[0] : categories;
  const imageMap = {
    고기: "/images/maker-images/webp/meat_bbq.webp",
    치킨: "/images/maker-images/webp/chicken.webp",
    한식: "/images/maker-images/webp/korean.webp",
    중식: "/images/maker-images/webp/chinese.webp",
    일식: "/images/maker-images/webp/cutlet_sashimi.webp",
    양식: "/images/maker-images/webp/western.webp",
    분식: "/images/maker-images/webp/snack_bar.webp",
    "카페·디저트": "/images/maker-images/webp/cafe_dessert.webp",
    아시안: "/images/maker-images/webp/asian.webp",
    패스트푸드: "/images/maker-images/webp/fastfood.webp",
    "족발·보쌈": "/images/maker-images/webp/pork_feet.webp",
    "돈까스·회": "/images/maker-images/webp/cutlet_sashimi.webp",
    피자: "/images/maker-images/webp/pizza.webp",
    "찜·탕": "/images/maker-images/webp/stew.webp",
    야식: "/images/maker-images/webp/late_night.webp",
    도시락: "/images/maker-images/webp/lunch_box.webp"
  };
  return imageMap[category] || "/images/maker-images/webp/korean.webp";
}

// lib/html-escape.ts
var MARKER_IMAGE_FALLBACK = "/images/maker-images/webp/chicken.webp";
var MAX_MARKER_IMAGE_URL_LENGTH = 2048;
var MAX_PERCENT_DECODE_PASSES = 4;
var CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;
var ROOT_URL = "https://marker.invalid";
function decodeForMarkerImageSafety(value) {
  let decodedValue = value;
  for (let pass = 0;pass < MAX_PERCENT_DECODE_PASSES; pass += 1) {
    if (CONTROL_CHARACTER_PATTERN.test(decodedValue) || decodedValue.includes("\\")) {
      return null;
    }
    if (!decodedValue.includes("%")) {
      return decodedValue;
    }
    try {
      const nextValue = decodeURIComponent(decodedValue);
      if (nextValue === decodedValue) {
        return decodedValue;
      }
      decodedValue = nextValue;
    } catch {
      return null;
    }
  }
  return null;
}
function hasUnsafeDecodedMarkerPath(value) {
  const decodedPath = decodeForMarkerImageSafety(value);
  return decodedPath === null || decodedPath.includes("//") || decodedPath.split("/").some((segment) => segment === "." || segment === "..");
}
function isCanonicalRootRelativeMarkerPath(value) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("?") || value.includes("#")) {
    return false;
  }
  if (hasUnsafeDecodedMarkerPath(value)) {
    return false;
  }
  try {
    const url = new URL(value, ROOT_URL);
    return url.origin === ROOT_URL && url.pathname === value && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}
function isCanonicalHttpsMarkerUrl(value) {
  if (decodeForMarkerImageSafety(value) === null) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.hostname !== "" && url.href === value && !hasUnsafeDecodedMarkerPath(url.pathname);
  } catch {
    return false;
  }
}
function sanitizeMarkerImageUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_MARKER_IMAGE_URL_LENGTH || CONTROL_CHARACTER_PATTERN.test(value) || value.includes("\\")) {
    return MARKER_IMAGE_FALLBACK;
  }
  if (isCanonicalRootRelativeMarkerPath(value) || isCanonicalHttpsMarkerUrl(value)) {
    return value;
  }
  return MARKER_IMAGE_FALLBACK;
}
function escapeHtmlAttribute(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

// lib/map-view-marker-helpers.ts
var MAP_VIEW_MARKER_BASE_SIZE_CLASSES = ["h-8", "w-8"];
var MAP_VIEW_MARKER_SELECTED_SIZE_CLASSES = ["h-[42px]", "w-[42px]"];
function isMapViewMarkerSelected({
  restaurantId,
  searchedRestaurantId,
  selectedRestaurantId
}) {
  return selectedRestaurantId === restaurantId || searchedRestaurantId === restaurantId;
}
function getMapViewMarkerSize(isSelected) {
  return isSelected ? 42 : 32;
}
function buildMapViewMarkerHtml({
  imagePath,
  isSelected,
  markerSize,
  name
}) {
  const expectedMarkerSize = getMapViewMarkerSize(isSelected);
  const normalizedMarkerSize = Number.isFinite(markerSize) && markerSize === expectedMarkerSize ? markerSize : expectedMarkerSize;
  const markerSizeClasses = normalizedMarkerSize === 42 ? MAP_VIEW_MARKER_SELECTED_SIZE_CLASSES : MAP_VIEW_MARKER_BASE_SIZE_CLASSES;
  const safeImagePath = escapeHtmlAttribute(sanitizeMarkerImageUrl(imagePath));
  const safeName = escapeHtmlAttribute(name);
  return `
        <div class="relative ${markerSizeClasses.join(" ")} cursor-pointer hover:scale-125">
          <img src="${safeImagePath}" alt="${safeName}" class="h-full w-full object-contain" draggable="false" />
        </div>
      `;
}

// performance/google-marker-reconcile-20260925/baseline-effect.mjs
function baselineUpdate({ previous, restaurants, Marker, map, onActivate }) {
  const markersRef = { current: previous }, restaurantsToShow = restaurants;
  const googleMapRef = { current: map }, isLoaded = true;
  const google = { maps: { marker: { AdvancedMarkerElement: Marker } } };
  const searchedRestaurant = null, selectedRestaurant = null;
  const onMarkerClick = onActivate, onRestaurantSelect = undefined;
  const moveToRestaurant = () => {}, setHasGoogleRuntimeError = () => {};
  if (!googleMapRef.current || !isLoaded)
    return;
  markersRef.current.forEach(({ marker }) => {
    marker.map = null;
  });
  markersRef.current = [];
  const markerConstructor = google.maps.marker?.AdvancedMarkerElement;
  if (!markerConstructor) {
    console.warn("MapView: Advanced marker support unavailable");
    setHasGoogleRuntimeError(true);
    return;
  }
  restaurantsToShow.forEach((restaurant) => {
    const position = getRestaurantLatLng(restaurant);
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
      console.warn("MapView: marker skipped because restaurant coordinates are invalid", { restaurantId: restaurant.id });
      return;
    }
    const isSelected = isMapViewMarkerSelected({
      restaurantId: restaurant.id,
      searchedRestaurantId: searchedRestaurant?.id,
      selectedRestaurantId: selectedRestaurant?.id
    });
    const imagePath = getMapViewMarkerIcon(restaurant.categories);
    const markerSize = getMapViewMarkerSize(isSelected);
    const markerElement = document.createElement("div");
    markerElement.className = `custom-marker ${isSelected ? "selected-marker" : ""}`;
    markerElement.innerHTML = buildMapViewMarkerHtml({
      imagePath,
      isSelected,
      markerSize,
      name: restaurant.name
    });
    let marker;
    try {
      marker = new markerConstructor({
        map: googleMapRef.current,
        position,
        content: markerElement,
        title: restaurant.name
      });
    } catch {
      console.warn("MapView: Advanced marker creation skipped", { restaurantId: restaurant.id });
      return;
    }
    markerElement.addEventListener("click", () => {
      onMarkerClick?.(restaurant);
      onRestaurantSelect?.(restaurant);
      moveToRestaurant(restaurant);
    });
    markersRef.current.push({ marker, restaurantId: restaurant.id });
  });
  return markersRef.current;
}
// lib/map-view-marker-reconciliation.ts
function reconcileMapViewMarkers({
  previous,
  restaurants,
  createMarker,
  onActivate,
  selectedRestaurantId,
  searchedRestaurantId
}) {
  const remaining = new Map(previous.map((entry) => [entry.restaurantId, entry]));
  const next = [];
  const seen = new Set;
  for (const restaurant of restaurants) {
    const position = getRestaurantLatLng(restaurant);
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng) || seen.has(restaurant.id))
      continue;
    seen.add(restaurant.id);
    const imagePath = sanitizeMarkerImageUrl(getMapViewMarkerIcon(restaurant.categories));
    const retained = remaining.get(restaurant.id);
    if (retained) {
      remaining.delete(restaurant.id);
      if (retained.position.lat !== position.lat || retained.position.lng !== position.lng) {
        retained.marker.position = position;
        retained.position = position;
      }
      if (retained.imagePath !== imagePath || retained.name !== restaurant.name) {
        const image = retained.marker.content?.querySelector("img");
        if (retained.imagePath !== imagePath)
          image?.setAttribute("src", imagePath);
        if (retained.name !== restaurant.name) {
          image?.setAttribute("alt", restaurant.name);
          retained.marker.title = restaurant.name;
        }
        retained.imagePath = imagePath;
        retained.name = restaurant.name;
      }
      retained.restaurant = restaurant;
      retained.onActivate = onActivate;
      next.push(retained);
      continue;
    }
    const isSelected = isMapViewMarkerSelected({
      restaurantId: restaurant.id,
      selectedRestaurantId,
      searchedRestaurantId
    });
    const content = document.createElement("div");
    content.className = `custom-marker ${isSelected ? "selected-marker" : ""}`;
    content.innerHTML = buildMapViewMarkerHtml({
      imagePath,
      isSelected,
      markerSize: getMapViewMarkerSize(isSelected),
      name: restaurant.name
    });
    const marker = createMarker({ position, content, title: restaurant.name });
    if (!marker)
      continue;
    const entry = {
      marker,
      restaurantId: restaurant.id,
      restaurant,
      position,
      imagePath,
      name: restaurant.name,
      onActivate
    };
    content.addEventListener("click", () => entry.onActivate(entry.restaurant));
    next.push(entry);
  }
  for (const entry of remaining.values())
    entry.marker.map = null;
  return next;
}
export {
  baselineUpdate,
  reconcileMapViewMarkers
};

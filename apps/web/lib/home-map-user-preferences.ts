export const HOME_MAP_USER_PREFERENCES_EVENT =
  "home:map-user-preferences-changed";

export type HomeMapPanelDefault = "expanded" | "collapsed";
export type HomeMapLayoutMode = "panel-aware" | "map-first";

export type HomeMapUserPreferences = {
  desktopPanelDefault: HomeMapPanelDefault;
  desktopMapLayout: HomeMapLayoutMode;
  reduceMapMotion: boolean;
};

export const DEFAULT_HOME_MAP_USER_PREFERENCES: HomeMapUserPreferences = {
  desktopPanelDefault: "expanded",
  desktopMapLayout: "panel-aware",
  reduceMapMotion: true,
};

type HomeMapUserPreferencesEventDetail = {
  userId: string;
  preferences: HomeMapUserPreferences;
};

export type HomeMapUserPreferencesEvent = CustomEvent<HomeMapUserPreferencesEventDetail>;

const STORAGE_PREFIX = "tzudong:home-map-user-preferences";

export function getHomeMapUserPreferencesStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function isPanelDefault(value: unknown): value is HomeMapPanelDefault {
  return value === "expanded" || value === "collapsed";
}

function isMapLayoutMode(value: unknown): value is HomeMapLayoutMode {
  return value === "panel-aware" || value === "map-first";
}

export function normalizeHomeMapUserPreferences(
  value: unknown,
): HomeMapUserPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_HOME_MAP_USER_PREFERENCES;
  }

  const preferences = value as Partial<HomeMapUserPreferences>;
  return {
    desktopPanelDefault: isPanelDefault(preferences.desktopPanelDefault)
      ? preferences.desktopPanelDefault
      : DEFAULT_HOME_MAP_USER_PREFERENCES.desktopPanelDefault,
    desktopMapLayout: isMapLayoutMode(preferences.desktopMapLayout)
      ? preferences.desktopMapLayout
      : DEFAULT_HOME_MAP_USER_PREFERENCES.desktopMapLayout,
    reduceMapMotion:
      typeof preferences.reduceMapMotion === "boolean"
        ? preferences.reduceMapMotion
        : DEFAULT_HOME_MAP_USER_PREFERENCES.reduceMapMotion,
  };
}

export function readHomeMapUserPreferences(
  userId: string | null | undefined,
  storage: Pick<Storage, "getItem"> | undefined =
    typeof window !== "undefined" ? window.localStorage : undefined,
) {
  if (!userId || !storage) return DEFAULT_HOME_MAP_USER_PREFERENCES;

  try {
    const raw = storage.getItem(getHomeMapUserPreferencesStorageKey(userId));
    if (!raw) return DEFAULT_HOME_MAP_USER_PREFERENCES;
    return normalizeHomeMapUserPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_HOME_MAP_USER_PREFERENCES;
  }
}

export function writeHomeMapUserPreferences(
  userId: string,
  preferences: HomeMapUserPreferences,
  storage: Pick<Storage, "setItem"> | undefined =
    typeof window !== "undefined" ? window.localStorage : undefined,
) {
  const normalized = normalizeHomeMapUserPreferences(preferences);

  if (storage) {
    storage.setItem(
      getHomeMapUserPreferencesStorageKey(userId),
      JSON.stringify(normalized),
    );
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(HOME_MAP_USER_PREFERENCES_EVENT, {
        detail: { userId, preferences: normalized },
      }),
    );
  }

  return normalized;
}

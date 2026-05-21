import { describe, expect, test } from "bun:test";

import {
  DEFAULT_HOME_MAP_USER_PREFERENCES,
  getHomeMapUserPreferencesStorageKey,
  normalizeHomeMapUserPreferences,
  readHomeMapUserPreferences,
  writeHomeMapUserPreferences,
} from "../lib/home-map-user-preferences";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("home map user preferences", () => {
  test("keeps map and left-panel layout preferences scoped per account", () => {
    const userId = "user-123";
    const storage = createMemoryStorage();
    const saved = writeHomeMapUserPreferences(
      userId,
      {
        desktopPanelDefault: "collapsed",
        desktopMapLayout: "map-first",
        reduceMapMotion: true,
      },
      storage,
    );

    expect(saved).toEqual({
      desktopPanelDefault: "collapsed",
      desktopMapLayout: "map-first",
      reduceMapMotion: true,
    });
    expect(readHomeMapUserPreferences(userId, storage)).toEqual(saved);
    expect(readHomeMapUserPreferences("other-user", storage)).toEqual(
      DEFAULT_HOME_MAP_USER_PREFERENCES,
    );
    expect(getHomeMapUserPreferencesStorageKey(userId)).toBe(
      "tzudong:home-map-user-preferences:user-123",
    );
  });

  test("normalizes unsafe or stale preference payloads back to safe defaults", () => {
    expect(
      normalizeHomeMapUserPreferences({
        desktopPanelDefault: "right",
        desktopMapLayout: "freeform",
        reduceMapMotion: "yes",
      }),
    ).toEqual(DEFAULT_HOME_MAP_USER_PREFERENCES);
  });
});

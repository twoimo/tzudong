import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ADMIN_THEME_PREFERENCES,
  ADMIN_THEME_PRELUDE_SOURCE,
  ADMIN_THEME_STORAGE_KEY,
} from "../lib/admin/admin-theme-prelude";

const appRoot = join(import.meta.dir, "..");

function read(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

const FORBIDDEN_PRELUDE_MARKERS = [
  'type="password"',
  "document.cookie",
  "navigator.geolocation",
  "getCurrentPosition(",
  "watchPosition(",
  "rawOcr",
  "ocr_text",
  "residentRegistration",
  "주민등록번호",
  "email",
  "phone",
] as const;

function runPrelude(input: {
  stored: string | null;
  systemDark: boolean;
  throwOnRead?: boolean;
}) {
  const store = new Map<string, string>();
  if (input.stored != null) store.set(ADMIN_THEME_STORAGE_KEY, input.stored);
  const classList = new Set<string>();
  const window = {
    localStorage: {
      getItem(key: string) {
        if (input.throwOnRead) throw new Error("blocked");
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    },
    matchMedia() {
      return { matches: input.systemDark };
    },
  };
  const document = {
    documentElement: {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classList.add(name);
          else classList.delete(name);
        },
        contains(name: string) {
          return classList.has(name);
        },
      },
    },
  };
  const runner = new Function("window", "document", ADMIN_THEME_PRELUDE_SOURCE);
  runner(window, document);
  return {
    stored: store.get(ADMIN_THEME_STORAGE_KEY) ?? null,
    dark: classList.has("dark"),
  };
}

describe("admin console theme prelude source contract", () => {
  test("keeps a blocking inline script on the admin layout", () => {
    const layoutSource = read("app/admin/layout.tsx");
    expect(layoutSource).toContain("ADMIN_THEME_PRELUDE_SOURCE");
    expect(layoutSource).toContain("dangerouslySetInnerHTML={{ __html: ADMIN_THEME_PRELUDE_SOURCE }}");
    expect(layoutSource).toContain("AppRuntimeLayout");
    expect(layoutSource).not.toContain('strategy="beforeInteractive"');
    expect(layoutSource).not.toMatch(/<script\b[^>]*(?:\basync\b|\bdefer\b)/);
    expect(ADMIN_THEME_STORAGE_KEY).toBe("tzudong-admin-theme");
    expect(ADMIN_THEME_PREFERENCES).toEqual(["light", "dark", "system"]);
    expect(ADMIN_THEME_PRELUDE_SOURCE).toContain('var key = "tzudong-admin-theme"');
    expect(ADMIN_THEME_PRELUDE_SOURCE).toContain(
      'theme !== "light" && theme !== "dark" && theme !== "system"',
    );
    expect(ADMIN_THEME_PRELUDE_SOURCE).toContain(
      'window.localStorage.setItem(key, theme)',
    );
    expect(ADMIN_THEME_PRELUDE_SOURCE).toContain(
      'document.documentElement.classList.toggle("dark", resolved === "dark")',
    );
    expect(ADMIN_THEME_PRELUDE_SOURCE).not.toContain("</script");
    for (const marker of FORBIDDEN_PRELUDE_MARKERS) {
      expect(ADMIN_THEME_PRELUDE_SOURCE).not.toContain(marker);
      expect(layoutSource).not.toContain(marker);
    }
  });

  test("applies stored light and dark without rewriting them", () => {
    expect(runPrelude({ stored: "light", systemDark: true })).toEqual({
      stored: "light",
      dark: false,
    });
    expect(runPrelude({ stored: "dark", systemDark: false })).toEqual({
      stored: "dark",
      dark: true,
    });
    expect(runPrelude({ stored: "system", systemDark: true })).toEqual({
      stored: "system",
      dark: true,
    });
    expect(runPrelude({ stored: "system", systemDark: false })).toEqual({
      stored: "system",
      dark: false,
    });
  });

  test("records system when the stored theme is missing or invalid", () => {
    expect(runPrelude({ stored: null, systemDark: true })).toEqual({
      stored: "system",
      dark: true,
    });
    expect(runPrelude({ stored: "", systemDark: false })).toEqual({
      stored: "system",
      dark: false,
    });
    expect(runPrelude({ stored: "sepia", systemDark: true })).toEqual({
      stored: "system",
      dark: true,
    });
    expect(runPrelude({ stored: "LIGHT", systemDark: false })).toEqual({
      stored: "system",
      dark: false,
    });
  });
});

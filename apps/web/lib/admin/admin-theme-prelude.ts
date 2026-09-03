export const ADMIN_THEME_STORAGE_KEY = "tzudong-admin-theme";

export const ADMIN_THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type AdminThemePreference = (typeof ADMIN_THEME_PREFERENCES)[number];

export const ADMIN_THEME_PRELUDE_SOURCE = `(() => {
  var key = "tzudong-admin-theme";
  var theme = null;
  try {
    theme = window.localStorage.getItem(key);
  } catch (error) {}
  if (theme !== "light" && theme !== "dark" && theme !== "system") {
    theme = "system";
    try {
      window.localStorage.setItem(key, theme);
    } catch (error) {}
  }
  var resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
})();
`;

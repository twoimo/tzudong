import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeMapThemeFilters } from "../components/home/HomeMapThemeFilters";
import {
  HOME_MAP_THEME_FILTERS,
  type HomeMapThemeFilterId,
} from "../lib/home-map-theme-filters";

function render(activeThemeId: HomeMapThemeFilterId | null = null) {
  return renderToStaticMarkup(
    <HomeMapThemeFilters activeThemeId={activeThemeId} onThemeChange={() => {}} />,
  );
}

describe("HomeMapThemeFilters rendering", () => {
  for (const activeThemeId of [null, ...HOME_MAP_THEME_FILTERS.map((theme) => theme.id)]) {
    test(`exposes all five buttons and the controlled selection ${activeThemeId}`, () => {
      const html = render(activeThemeId);
      const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);

      expect(buttons).toHaveLength(HOME_MAP_THEME_FILTERS.length);
      HOME_MAP_THEME_FILTERS.forEach((theme, index) => {
        const button = buttons[index];
        expect(button).toContain('type="button"');
        expect(button).toContain(`aria-pressed="${activeThemeId === theme.id}"`);
        expect(button).toContain(`aria-label="${theme.label}: ${theme.ariaLabel}"`);
        expect(button).toContain(`title="${theme.label}: ${theme.description}"`);
        expect(button).toContain(`>${theme.label}</span>`);
        expect(button).not.toMatch(/\sdisabled(?:[=\s>])|tabindex="-1"/);
        expect(button).toContain('aria-hidden="true"');
        const descriptionId = button.match(/aria-describedby="([^"]+)"/)?.[1];
        expect(descriptionId).toBeDefined();
        expect(html).toContain(`<span id="${descriptionId}" class="sr-only">${theme.description}</span>`);
      });
    });
  }

  test("keeps descriptions distinct when mobile and desktop instances coexist", () => {
    const html = renderToStaticMarkup(
      <>
        <HomeMapThemeFilters activeThemeId={null} onThemeChange={() => {}} />
        <HomeMapThemeFilters activeThemeId="hot-view" onThemeChange={() => {}} />
      </>,
    );
    const descriptionIds = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(descriptionIds).toHaveLength(HOME_MAP_THEME_FILTERS.length * 2);
    expect(new Set(descriptionIds).size).toBe(descriptionIds.length);
  });

});

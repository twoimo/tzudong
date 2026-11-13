import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { HomeMapThemeFilters } from "../components/home/HomeMapThemeFilters";
import { cn } from "../lib/utils";
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
      const buttons = [...html.matchAll(/<button\b[^>]*aria-pressed="(?:true|false)"[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);

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

  test("uses the approved horizontal scroll owner only for the mobile reel", () => {
    const html = renderToStaticMarkup(
      <HomeMapThemeFilters activeThemeId={null} onThemeChange={() => {}} layout="reel" />,
    );
    expect(html).toContain('data-scroll-owner="mobile-theme-filter-reel"');
    expect(html).toContain('data-allow-horizontal-scroll="true"');
    expect(html).toContain('data-horizontal-scroll-owner="mobile-theme-filter-reel"');
    expect(html).toContain('overflow-x-auto');
    expect(render()).not.toContain('data-scroll-owner="mobile-theme-filter-reel"');
    expect(render()).not.toContain('data-allow-horizontal-scroll="true"');
  });

  test("selecting a theme and either deselection action preserve the controlled callback contract", () => {
    type Element = React.ReactElement<Record<string, unknown>>;
    const compiled = ts.transpileModule(readFileSync(new URL('../components/home/HomeMapThemeFilters.tsx', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: { HomeMapThemeFilters?: (props: React.ComponentProps<typeof HomeMapThemeFilters>) => Element } = {};
    vm.runInNewContext(compiled, { exports, require(name: string) {
      if (name === 'react') return { Fragment: React.Fragment, useId: () => 'theme-filter-fixture' };
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'lucide-react') return { Info: 'Info', X: 'X' };
      if (name === '@/components/ui/button') return { Button: 'Button' };
      if (name === '@/components/ui/popover') return { Popover: 'Popover', PopoverTrigger: 'PopoverTrigger', PopoverContent: 'PopoverContent' };
      if (name === '@/lib/home-map-theme-filters') return { HOME_MAP_THEME_FILTERS };
      if (name === '@/lib/utils') return { cn };
      if (name === './home-map-theme-filter-icons') return { HomeMapThemeFilterIcon: 'HomeMapThemeFilterIcon' };
      throw new Error(`UNEXPECTED_THEME_FILTER_IMPORT: ${name}`);
    } });

    const changes: Array<HomeMapThemeFilterId | null> = [];
    function buttons(activeThemeId: HomeMapThemeFilterId | null) {
      const tree = exports.HomeMapThemeFilters!({ activeThemeId, onThemeChange: (value) => changes.push(value) });
      const found: Element[] = [];
      function walk(node: React.ReactNode) {
        React.Children.forEach(node, (child) => {
          if (!React.isValidElement<Record<string, unknown>>(child)) return;
          if (child.type === 'Button') found.push(child);
          walk(child.props.children as React.ReactNode);
        });
      }
      walk(tree);
      return found;
    }

    for (const [index, theme] of HOME_MAP_THEME_FILTERS.entries()) {
      const initial = buttons(null).filter((button) => typeof button.props['aria-pressed'] === 'boolean');
      expect(initial).toHaveLength(HOME_MAP_THEME_FILTERS.length);
      (initial[index].props.onClick as () => void)();
      expect(changes.at(-1)).toBe(theme.id);

      const selected = buttons(theme.id);
      const toggle = selected.filter((button) => typeof button.props['aria-pressed'] === 'boolean')[index];
      expect(toggle.props['aria-pressed']).toBe(true);
      (toggle.props.onClick as () => void)();
      expect(changes.at(-1)).toBeNull();

      const clear = selected.find((button) => button.props['aria-pressed'] === undefined && typeof button.props.onClick === 'function')!;
      (clear.props.onClick as () => void)();
      expect(changes.at(-1)).toBeNull();
    }
    expect(changes).toHaveLength(HOME_MAP_THEME_FILTERS.length * 3);
  });

});

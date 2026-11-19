import { describe, expect, test } from 'bun:test';
import postcss from 'postcss';
import { compileResponsiveCss } from './fixtures/responsive-css';

const escapedClass = (utility: string) =>
  `.${[...utility].map(character => /[A-Za-z0-9_-]/.test(character) ? character : `\\${character}`).join('')}`;

function emittedRules(css: string) {
  const selectors = new Set<string>();
  postcss.parse(css).walkRules(rule => { selectors.add(rule.selector); });
  return selectors;
}

function hasUtility(selectors: Set<string>, utility: string) {
  const target = escapedClass(utility);
  return [...selectors].some(selector => selector === target
    || selector.startsWith(`${target}:`)
    || selector.startsWith(`${target} `));
}

describe('responsive styles travel with their rendering surface', () => {
  test('deferred home CSS emits stamp, focus and auxiliary-dialog rules without a prior detail visit', async () => {
    const css = await compileResponsiveCss(['home-interactive-globals.css']);
    const selectors = emittedRules(css);

    // These rules were previously supplied accidentally by unused wrappers or
    // by a stylesheet loaded only after opening a restaurant detail.
    for (const utility of [
      'pt-6', 'sm:px-6', 'md:pb-6', 'left-1', 'right-1', 'w-64',
      'focus-visible:ring-1', '[&>button]:hidden',
      'bg-card/80', 'border-b-2', 'my-4',
      'z-[120]', 'min-h-0', 'flex-1', 'shrink-0', 'pr-4',
      'h-[min(42rem,calc(100dvh-2rem))]', 'max-h-[calc(100dvh-2rem)]',
      // A later base text-2xl rule must not override the shared tablet title.
      'sm:text-[1.75rem]', 'sm:leading-9',
      'text-purple-600', 'bg-purple-50', 'text-green-600', 'bg-green-50',
    ]) {
      expect(hasUtility(selectors, utility), `${utility} must ship with deferred home surfaces`).toBe(true);
    }
  }, 60_000);

  test('legal CSS emits document spacing, width, typography and overflow rules independently', async () => {
    const css = await compileResponsiveCss(['legal-globals.css']);
    const selectors = emittedRules(css);
    for (const utility of [
      'px-4', 'py-10', 'p-5', 'sm:p-8', 'max-w-3xl', 'border',
      'rounded-2xl', 'text-2xl', 'sm:text-[1.75rem]', 'sm:leading-9',
      'overflow-x-auto', 'min-w-[880px]', 'break-all',
    ]) {
      expect(hasUtility(selectors, utility), `${utility} must ship on a cold legal URL`).toBe(true);
    }
    expect(css).not.toContain('--admin-sidebar-expanded-max-width');
    expect(selectors.has('.mobile-bottom-nav')).toBe(false);
  }, 60_000);
});

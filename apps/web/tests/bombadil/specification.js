import { always } from '@antithesishq/bombadil';
import { extract } from '@antithesishq/bombadil/browser';
import { clicks, inputs, scroll, waitOnce } from '@antithesishq/bombadil/browser/defaults/actions';
export { noUncaughtExceptions, noUnhandledPromiseRejections } from '@antithesishq/bombadil/browser/defaults/properties';

const state = extract(({ document, window }) => {
  const home = document.querySelector('[data-home-fixture]');
  const thumbnail = document.querySelector('[data-thumbnail-fixture]');
  const themes = document.querySelector('[aria-label="쯔양 영상 테마 필터"]');
  const activeThemeCount = themes?.querySelectorAll('[aria-pressed="true"]').length ?? 0;
  const visibleControls = [...document.querySelectorAll('button, input, select, textarea')]
    .filter(element => element.getClientRects().length && element.getAttribute('aria-hidden') !== 'true');
  return {
    origin: window.location.origin,
    ownedOrigin: window.location.hostname === '127.0.0.1' && window.location.pathname === '/fixture',
    rootFitsViewport: document.documentElement.scrollWidth <= window.innerWidth + 1,
    themeCountMatches: !home || activeThemeCount === (home.getAttribute('data-active-theme') ? 1 : 0),
    referencesAligned: !thumbnail || thumbnail.getAttribute('data-reference-count') === thumbnail.getAttribute('data-role-count'),
    controlsNamed: visibleControls.every(element => Boolean(
      element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')
      || element.textContent?.trim() || element.closest('label')
      || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)),
    )),
  };
});

export const onlyOwnedFixture = always(() => state.current.ownedOrigin);
export const pageFitsViewport = always(() => state.current.rootFitsViewport);
export const themeSelectionMatchesState = always(() => state.current.themeCountMatches);
export const referenceRolesStayAligned = always(() => state.current.referencesAligned);
export const visibleControlsHaveNames = always(() => state.current.controlsNamed);

// Only local component controls and same-document fixture navigation exist.
// File selection, provider calls and production routes are not action targets.
export const boundedClicks = clicks.filter(action => {
  if (typeof action !== 'object' || !('Click' in action)) return false;
  const fingerprint = action.Click.fingerprint;
  return fingerprint.inputType !== 'file'
    && (!fingerprint.href || fingerprint.href.startsWith('#')
      || fingerprint.href.startsWith(`${state.current.origin}/fixture#`));
});
export const boundedInputs = inputs.filter(action =>
  typeof action === 'object' && ('TypeText' in action || 'PressKey' in action),
).map(action => typeof action === 'object' && 'TypeText' in action
  ? { TypeText: { text: { Regexp: '(서울|부산|일본|fixture|[a-z]{0,12})' } } }
  : action);
export { scroll, waitOnce };

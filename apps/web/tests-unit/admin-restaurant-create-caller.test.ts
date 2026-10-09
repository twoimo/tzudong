import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { RECORD_ACTION_APPLIED_EVENT, RECORD_VIEWS_INVALIDATED_EVENT } from '../lib/admin/record-action-client';
const page = readFileSync(new URL('../app/admin/evaluations/page.tsx', import.meta.url), 'utf8');
function execute<T>(source: string, deps: Record<string, unknown>): T {
  const code = new Bun.Transpiler({ loader: 'tsx', tsconfig: { compilerOptions: { jsx: 'react' } } }).transformSync(`const {${Object.keys(deps).join(',')}}=deps;${source}`);
  return new Function('deps', code)(deps) as T;
}
function actions(overrides: Record<string, unknown> = {}) {
  const opens: boolean[] = [];
  const start = page.indexOf('  const reviewViewActions ='), end = page.indexOf('\n  return (', start);
  const deps = { React, Button: 'button', LayoutList: 'i', MonitorPlay: 'i', canSwitchEvaluationView: true, showSubmissionView: false,
    loading: false, recordActions: { busy: false }, recordViewsInvalidated: false, createRestaurantOpen: false, isAlternateView: false,
    switchToEvaluationListView: () => {}, switchToEvaluationSlideView: () => {}, setCreateRestaurantOpen: (open: boolean) => opens.push(open), ...overrides };
  const node = execute<React.ReactElement | false>(`${page.slice(start, end)};return reviewViewActions;`, deps);
  const children = node ? React.Children.toArray((node.props as { children: React.ReactNode }).children) : [];
  const trigger = children.find(child => React.isValidElement<Record<string, unknown>>(child) && child.props['data-admin-restaurant-create-trigger']) as React.ReactElement<{ disabled: boolean; onClick: () => void }> | undefined;
  return { trigger, opens };
}
describe('actual restaurant creation caller', () => {
  test('restaurant header opens one null-record editor; submission/review headers and busy/fenced states cannot launch it', () => {
    const ready = actions(); expect(ready.trigger).toBeDefined(); expect(ready.trigger!.props.disabled).toBe(false);
    ready.trigger!.props.onClick(); expect(ready.opens).toEqual([true]);
    for (const override of [{ loading: true }, { recordActions: { busy: true } }, { recordViewsInvalidated: true }, { createRestaurantOpen: true }]) expect(actions(override).trigger!.props.disabled).toBe(true);
    expect(actions({ showSubmissionView: true }).trigger).toBeUndefined(); expect(actions({ canSwitchEvaluationView: false }).trigger).toBeUndefined();
  });
  test('caller keeps the editor mounted outside the invalidated list and refreshes current records/discovery only through verified success', () => {
    const start = page.indexOf('      <AdminRestaurantModal\n'), end = page.indexOf('\n      />', start) + '\n      />'.length;
    expect(start).toBeGreaterThan(page.indexOf('records={recordViewsInvalidated ? []'));
    const closed: boolean[] = []; let records = 0, discovery = 0;
    const node = execute<React.ReactElement<{ restaurant: null; isOpen: boolean; onClose: () => void; onSuccess: () => void }>>(`return (${page.slice(start, end)});`, {
      React, AdminRestaurantModal: 'section', createRestaurantOpen: true, setCreateRestaurantOpen: (open: boolean) => closed.push(open),
      refreshRecordViews: async () => { records++; }, invalidateRestaurantDiscoveryQueries: async () => { discovery++; }, queryClient: {},
    });
    expect(node.props.restaurant).toBeNull(); expect(node.props.isOpen).toBe(true); expect([records, discovery]).toEqual([0, 0]);
    node.props.onSuccess(); expect([records, discovery]).toEqual([1, 1]); node.props.onClose(); expect(closed).toEqual([false]);
  });
  test('applied event waits for the creation editor current-row readback; invalidation is immediate in both contexts', () => {
    const start = page.indexOf('  useEffect(() => {\n    // Creation waits'), end = page.indexOf('\n\n  const notifyRecordActionError', start);
    for (const createRestaurantOpen of [false, true]) {
      const listeners = new Map<string, () => void>(); let refreshed = 0, invalidated = 0;
      execute(page.slice(start, end), { createRestaurantOpen, RECORD_ACTION_APPLIED_EVENT, RECORD_VIEWS_INVALIDATED_EVENT,
        useEffect: (callback: () => unknown) => callback(), invalidateRecordViews: () => { invalidated++; }, refreshRecordViews: async () => { refreshed++; },
        window: { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: () => {} },
      });
      listeners.get(RECORD_VIEWS_INVALIDATED_EVENT)!(); expect(invalidated).toBe(1);
      listeners.get(RECORD_ACTION_APPLIED_EVENT)!(); expect(refreshed).toBe(createRestaurantOpen ? 0 : 1);
    }
  });
});

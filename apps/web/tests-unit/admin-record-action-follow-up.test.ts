import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAdminModuleIdFromSearchParams } from '../lib/admin/admin-module-routing';
import { RECORD_ACTION_CONFIRMATION } from '../lib/admin/record-action-contract';
import type { RecordActionClientState } from '../lib/admin/record-action-client';
const source = readFileSync(new URL('../lib/admin/use-record-action.tsx', import.meta.url), 'utf8');
const executable = source.replace(/^import .*\n/gm, '').replace('export function useRecordAction', 'function useRecordAction');
function render(phase: RecordActionClientState['phase'], nextAction: RecordActionClientState['nextAction'], request: RecordActionClientState['request'] = null) {
  let cancelled = 0;
  const state: RecordActionClientState = { phase, nextAction, request, receipt: null, message: 'bounded fixture' };
  const client = { subscribe: () => () => {}, getSnapshot: () => state, canCancel: () => phase === 'failed', cancel: () => { cancelled++; }, run: () => {}, apply: () => {}, readback: () => {}, recover: () => {}, setOnRecovered: () => {} };
  const wrapper = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  const deps = { useAuth: () => ({ user: null, isAdmin: false }), React, RECORD_ACTION_CONFIRMATION, RECORD_VIEWS_INVALIDATED_EVENT: 'invalidated', RECORD_ACTION_APPLIED_EVENT: 'applied',
    useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => {}], useEffect: () => {},
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(), createRecordActionClient: () => client,
    Dialog: wrapper, DialogContent: wrapper, DialogHeader: wrapper, DialogTitle: wrapper, DialogDescription: wrapper, DialogFooter: wrapper, Input: wrapper,
    Button: ({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) => asChild ? children : React.createElement('button', null, children),
  };
  const code = new Bun.Transpiler({ loader: 'tsx', tsconfig: { compilerOptions: { jsx: 'react' } } }).transformSync(`const {${Object.keys(deps).join(',')}}=deps;${executable};return useRecordAction(()=>{});`);
  const result = new Function('deps', code)(deps) as { dialog: React.ReactElement };
  const links: React.ReactElement<{ href: string; onClick: () => void }>[] = [];
  function walk(node: React.ReactNode) {
    React.Children.forEach(node, child => {
      if (!React.isValidElement<{ children?: React.ReactNode; href: string; onClick: () => void }>(child)) return;
      if (child.type === 'a') links.push(child);
      walk(child.props.children);
    });
  }
  walk(result.dialog);
  return { links, html: renderToStaticMarkup(result.dialog), cancelled: () => cancelled };
}
test('definite duplicate conflict offers the actual restaurant review route, closes the failed operation, and offers no apply or uncertain readback', () => {
  const result = render('failed', 'review-duplicates');
  expect(result.links).toHaveLength(1);
  const url = new URL(result.links[0].props.href, 'https://fixture.invalid');
  expect(url.pathname).toBe('/admin'); expect(getAdminModuleIdFromSearchParams(url.searchParams)).toBe('restaurants');
  expect([...url.searchParams.keys()]).toEqual(['module']);
  result.links[0].props.onClick(); expect(result.cancelled()).toBe(1);
  expect(result.html).not.toContain('기존 작업 결과 조회'); expect(result.html).not.toContain('<input');
});
test('uncertain and other definite failures do not expose a duplicate-review navigation action', () => {
  for (const phase of ['uncertain', 'failed'] as const) {
    const result = render(phase, null); expect(result.links).toHaveLength(0); expect(result.cancelled()).toBe(0);
  }
});

test('preview renders every group-edit and merge payload value with Korean labels, retaining IDs and empty selections', () => {
  const target = '11111111-1111-4111-8111-111111111111';
  const result = render('confirming', null, { phase: 'preview', operationId: target, action: 'restaurant.edit', targetIds: [target], payload: {
    changes: { approved_name: '기존 맛집' }, perTargetChanges: [{ id: target, changes: { tzuyang_review: '영상별 보존 내용' } }],
    removeIds: [], additions: [{ approved_name: '추가 맛집', youtube_link: 'https://www.youtube.com/watch?v=ABCDEFGHIJK' }],
  } });
  for (const value of ['영상별 수정', '제외할 영상', '추가할 영상', '없음', target, '영상별 보존 내용', '추가 맛집', 'https://www.youtube.com/watch?v=ABCDEFGHIJK']) expect(result.html).toContain(value);
  for (const rawKey of ['perTargetChanges', 'removeIds', 'additions']) expect(result.html).not.toContain(rawKey);
  const merge = render('confirming', null, { phase: 'preview', operationId: target, action: 'restaurant.merge', targetIds: [target], payload: { mergeTargetId: target, incomingChanges: { tzuyang_review: '새 영상 보존 내용' } } });
  expect(merge.html).toContain('병합 대상'); expect(merge.html).toContain('새 영상 변경'); expect(merge.html).toContain('새 영상 보존 내용'); expect(merge.html).toContain(target);
  expect(merge.links).toHaveLength(0);
});

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecordActionClientError, recordActionErrorMessage, recordActionMediaNotice, isRecordActionCancelled } from '../lib/admin/record-action-client';
import type { RecordActionReceipt } from '../lib/admin/record-action-contract';

const id = '11111111-1111-4111-8111-111111111111';
const review = { id, user_id: id, restaurant_id: id, title: '검증 리뷰', content: '검증 내용', visited_at: '2026-10-07', food_photos: [], is_verified: false, admin_note: null, profiles: { nickname: '검증' }, restaurants: { name: '검증 맛집' } };
const source = readFileSync(new URL('../components/admin/AdminReviewPanel.tsx', import.meta.url), 'utf8');
const executable = source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export default function AdminReviewPanel', 'function AdminReviewPanel');
type Config = { mutationFn: (input: unknown) => Promise<unknown>; onSuccess: (receipt: RecordActionReceipt, input?: unknown) => Promise<void>; onError: (error: unknown) => void };
function harness(options: { busy?: boolean; isAdmin?: boolean; error?: boolean; nextError?: boolean; rows?: unknown[]; hasNext?: boolean } = {}) {
  const mutations: Config[] = [], notifications: unknown[][] = [], invalidations: unknown[] = [], requests: unknown[] = [], errors: string[] = [], callbacks: Array<() => void> = [];
  let recovery: ((receipt: RecordActionReceipt) => void) | undefined, recoverOption = false, nextPages = 0;
  const wrapper = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  const icon = () => null;
  const deps = { React, forwardRef: React.forwardRef,
    useState: (initial: unknown) => [initial, () => {}], useRef: () => ({ current: null }), useCallback: (callback: () => void) => { callbacks.push(callback); return callback; }, useEffect: () => {},
    useAuth: () => ({ user: { id }, isAdmin: options.isAdmin ?? true }),
    useQueryClient: () => ({ invalidateQueries: async (input: unknown) => { invalidations.push(input); } }),
    invalidateRestaurantDiscoveryQueries: async () => { invalidations.push('discovery'); },
    useInfiniteQuery: () => ({ data: { pages: [{ reviews: options.rows ?? [review] }] }, hasNextPage: options.hasNext ?? false, isError: options.error ?? false, isFetchNextPageError: options.nextError ?? false, isLoading: false, isFetchingNextPage: false, fetchNextPage: () => { nextPages++; }, refetch: () => {} }),
    useMutation: (config: Config) => { mutations.push(config); return { isPending: false, mutate: (input: unknown) => { requests.push(input); } }; },
    useRecordAction: (callback: (receipt: RecordActionReceipt) => void, value: { recover: boolean }) => { recovery = callback; recoverOption = value.recover; return { busy: options.busy ?? false, dialog: React.createElement('div', { 'data-shared-confirmation': true }), run: async (input: unknown) => { requests.push(input); return input; } }; },
    createUserNotification: async (...args: unknown[]) => { notifications.push(args); },
    toast: { success: () => {}, error: (message: string) => { errors.push(message); } }, recordActionErrorMessage, recordActionMediaNotice, isRecordActionCancelled,
    RECORD_VIEWS_INVALIDATED_EVENT: 'fixture-invalidated',
    ADMIN_PENDING_COUNTS_QUERY_KEY: ['fixture-shared-counts'],
    MapPanelHeader: ({ title, description }: { title: string; description?: string }) => React.createElement('header', null, title, description),
    Button: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('button', props, children), Input: wrapper, Textarea: wrapper, Card: wrapper, Badge: wrapper,
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => open ? React.createElement('div', null, children) : null,
    DialogContent: wrapper, DialogFooter: wrapper, DialogHeader: wrapper, DialogTitle: wrapper, DialogDescription: wrapper, Label: wrapper, Avatar: wrapper, AvatarFallback: wrapper,
    CheckCircle2: icon, XCircle: icon, Clock: icon, Trash2: icon, MapPin: icon, Calendar: icon, Loader2: icon, ChevronRight: icon, ChevronLeft: icon,
    ADMIN_MODAL_ACTION: '', ADMIN_MODAL_CONTENT_SM_FLEX: '', ADMIN_MODAL_FOOTER_DIVIDER: '',
  };
  const code = new Bun.Transpiler({ loader: 'tsx', tsconfig: { compilerOptions: { jsx: 'react' } } }).transformSync(`const {${Object.keys(deps).join(',')}}=deps;${executable};return AdminReviewPanel;`);
  const component = new Function('deps', code)(deps);
  const tree = component({ isOpen: true, onClose: () => {} });
  const buttons: React.ReactElement<{ children?: React.ReactNode; disabled?: boolean; onClick?: () => void }>[] = [];
  function walk(node: React.ReactNode) {
    React.Children.forEach(node, child => {
      if (!React.isValidElement<{ children?: React.ReactNode; disabled?: boolean; onClick?: () => void }>(child)) return;
      if (child.type === deps.Button) buttons.push(child);
      if (typeof child.type === 'function') walk(child.type(child.props));
      else if (typeof child.type === 'object' && child.type !== null && 'render' in child.type) walk((child.type.render as (props: unknown, ref: null) => React.ReactNode)(child.props, null));
      else walk(child.props.children);
    });
  }
  walk(tree);
  return { mutations, notifications, invalidations, requests, errors, buttons, autoLoadMore: callbacks[0], recover: (receipt: RecordActionReceipt) => recovery?.(receipt), recoverOption, nextPages: () => nextPages, html: renderToStaticMarkup(tree) };
}
function receipt(action: RecordActionReceipt['action'], status: string): RecordActionReceipt {
  return { action, operationId: id, state: 'applied', previewHash: 'a'.repeat(64), targetIds: [id], auditId: id, expiresAt: '2026-10-08T00:00:00Z', readback: [{ id, kind: 'review', status, fingerprint: status === 'deleted' ? null : 'b'.repeat(64) }], mediaCleanupPending: false };
}

test('actual home mutations route all three actions through the shared guarded client', async () => {
  const h = harness();
  await h.mutations[0].mutationFn({ review, note: ' 메모 ' });
  await h.mutations[1].mutationFn({ review, note: ' 사유 ' });
  await h.mutations[2].mutationFn(id);
  expect(h.requests).toEqual([
    { action: 'review.approve', targetIds: [id], payload: { note: '메모' } },
    { action: 'review.reject', targetIds: [id], payload: { reason: '사유' } },
    { action: 'review.delete', targetIds: [id], payload: { reason: '관리자에 의해 삭제됨' } },
  ]);
  expect(h.html).toContain('data-shared-confirmation');
});
test('notifications use the submitted row and only its confirmed readback status', async () => {
  const h = harness(), input = { review, note: '확인 사유' };
  await h.mutations[0].onSuccess(receipt('review.approve', 'approved'), input);
  expect(h.notifications).toHaveLength(1); expect(h.notifications[0][1]).toBe('review_approved');
  expect(h.invalidations).toContainEqual({ queryKey: ['admin-pending-counts'] }); expect(h.invalidations).toContain('discovery');
  for (const key of ['restaurant-reviews', 'review-feed', 'review-feed-overlay', 'user-reviews', 'admin-reviews-inline', 'fixture-shared-counts']) expect(h.invalidations).toContainEqual({ queryKey: [key] });
  const wrong = receipt('review.reject', 'rejected'); wrong.readback[0].id = '22222222-2222-4222-8222-222222222222';
  await h.mutations[1].onSuccess(wrong, input); expect(h.notifications).toHaveLength(1);
  await h.mutations[1].onSuccess(receipt('review.reject', 'rejected'), input); expect(h.notifications[1][1]).toBe('review_rejected');
});
test('recovered operations refresh views without sending duplicate author notifications', async () => {
  const h = harness(); h.recover(receipt('review.approve', 'approved')); await Promise.resolve(); await Promise.resolve();
  expect(h.recoverOption).toBe(true); expect(h.invalidations.length).toBeGreaterThan(0); expect(h.notifications).toHaveLength(0);
});
test('busy state disables every moderation action and rejects callback invocation', () => {
  const h = harness({ busy: true });
  const actions = h.buttons.filter(button => ['승인', '거부'].includes(String(button.props.children)) || Object.hasOwn(button.props, 'aria-label'));
  expect(actions).toHaveLength(3);
  for (const action of actions) { expect(action.props.disabled).toBe(true); action.props.onClick?.(); }
  expect(h.requests).toHaveLength(0);
});
test('empty pending first page still offers the next page and identifies counts as loaded', () => {
  const h = harness({ rows: [{ ...review, is_verified: true }], hasNext: true });
  expect(h.html).toContain('불러온 리뷰 1건'); expect(h.html).toContain('대기 중인 리뷰가 없습니다');
  h.buttons.find(button => button.props.children === '리뷰 더 불러오기')?.props.onClick?.(); expect(h.nextPages()).toBe(1);
});
test('ordinary admin notes do not hide pending reviews, and load failures are distinct', () => {
  expect(harness({ rows: [{ ...review, admin_note: '확인 필요' }] }).html).toContain('검증 리뷰');
  const h = harness({ error: true }); expect(h.html).toContain('리뷰를 불러오지 못했습니다.'); expect(h.html).toContain('다시 불러오기');
});
test('next-page failure retains loaded reviews and waits for explicit retry', () => {
  const h = harness({ error: true, nextError: true, hasNext: true });
  expect(h.html).toContain('검증 리뷰'); expect(h.html).toContain('다음 리뷰를 불러오지 못했습니다.'); h.autoLoadMore(); expect(h.nextPages()).toBe(0);
  h.buttons.find(button => button.props.children === '다음 리뷰 다시 불러오기')?.props.onClick?.(); expect(h.nextPages()).toBe(1);
});
test('cancelled operations report no success, notification or reload; revoked admin cannot recover', () => {
  const h = harness(); h.mutations[0].onError(new RecordActionClientError('CANCELLED'));
  expect(h.notifications).toHaveLength(0); expect(h.invalidations).toHaveLength(0); expect(h.errors).toHaveLength(0);
  const denied = harness({ isAdmin: false }); expect(denied.recoverOption).toBe(false); expect(denied.html).toContain('접근 권한 없음');
});

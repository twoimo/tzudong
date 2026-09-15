import React from 'react';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { AuthContext, type AuthContextType } from '../contexts/AuthContextBase';
import { UserProfilePanel } from '../components/profile/UserProfilePanel';
import { UserProfileProgressiveSkeleton } from '../components/profile/UserProfileProgressiveSkeleton';
import { ResetPasswordProgressiveSkeleton } from '../components/auth/ResetPasswordProgressiveSkeleton';

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const auth: AuthContextType = {
  user: null, session: null, isLoading: false, isAdmin: false, needsNicknameSetup: false, profileNickname: null,
  signIn: async () => {}, signOut: async () => {}, completeNicknameSetup: () => {}, resetPassword: async () => {}, updatePassword: async () => {},
};
function renderProfile(client: QueryClient) {
  return renderToStaticMarkup(<AppRouterContext.Provider value={router}><AuthContext.Provider value={auth}><QueryClientProvider client={client}><UserProfilePanel userId="public-profile-fixture" /></QueryClientProvider></AuthContext.Provider></AppRouterContext.Provider>);
}

test('profile first render preserves real tabs and activity heading without invented counts or empty claims', () => {
  const client = new QueryClient();
  try {
    const html = renderProfile(client);
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain('사용자 프로필');
    expect(html).toContain('리뷰로 인증한 맛집을 모았어요.');
    expect(html).toContain('data-data-pending="list"');
    expect(html).not.toContain('(0)');
    expect(html).not.toContain('아직 도장이 없습니다');
    expect(html).not.toContain('사용자를 찾을 수 없습니다');
    expect(html).not.toContain('data-user-profile-panel-skeleton');
  } finally { client.clear(); }
});

test('profile settled missing query preserves the existing not-found branch', () => {
  const client = new QueryClient();
  try {
    client.setQueryData(['user-profile', 'public-profile-fixture'], null);
    expect(renderProfile(client)).toContain('사용자를 찾을 수 없습니다');
    expect(renderProfile(client)).not.toContain('data-data-pending');
  } finally { client.clear(); }
});

test('activity can settle independently while identity is pending', () => {
  const client = new QueryClient();
  try {
    client.setQueryData(['user-stamps', 'public-profile-fixture'], []);
    const html = renderProfile(client);
    expect(html).toContain('사용자 프로필');
    expect(html).toContain('아직 도장이 없습니다');
    expect(html).toContain('(0)');
    expect(html).not.toContain('data-data-pending="list"');
  } finally { client.clear(); }
});

test('route compatibility profile frame retains actual headings and disabled tabs', () => {
  const html = renderToStaticMarkup(<UserProfileProgressiveSkeleton />);
  expect(html.match(/role="tab"/g)).toHaveLength(3);
  expect(html.match(/disabled=""/g)).toHaveLength(3);
  expect(html).toContain('방문 도장');
  expect(html).toContain('data-data-pending="list"');
});

test('recovery pending frame exposes empty password controls and blocks submission', () => {
  const html = renderToStaticMarkup(<ResetPasswordProgressiveSkeleton />);
  expect(html.match(/type="password"/g)).toHaveLength(2);
  expect(html).toContain('<fieldset disabled=""');
  expect(html).toContain('type="button"');
  expect(html).toContain('role="status"');
  expect(html).not.toContain('data-slot="skeleton"');
  expect(html).not.toContain('value=');
  const page = readFileSync(new URL('../app/auth/reset-password/page.tsx', import.meta.url), 'utf8');
  expect(page.match(/disabled=\{isCheckingSession \|\| !isValidSession \|\| isLoading\}/g)).toHaveLength(3);
  expect(page).toContain('if (isCheckingSession || !isValidSession || isLoading) return;');
  expect(page).toContain('if (!isCheckingSession && !isValidSession)');
  expect(page).not.toContain('<ResetPasswordProgressiveSkeleton');
});

test('reset route loading boundary renders the real disabled form rather than a blank or skeleton page', async () => {
  const { default: Loading } = await import('../app/auth/reset-password/loading');
  const html = renderToStaticMarkup(<Loading />);
  expect(html).toContain('<h1');
  expect(html).toContain('<form aria-busy="true"');
  expect(html).toContain('새 비밀번호 확인');
  expect(html.match(/type="password"/g)).toHaveLength(2);
  expect(html).toContain('<fieldset disabled=""');
  expect(html).not.toContain('data-slot="skeleton"');
});

test('incident initial render keeps real intake and refresh controls, pending only inside the list', async () => {
  const { default: Page } = await import('../app/admin/privacy-incidents/page');
  const html = renderToStaticMarkup(<Page />);
  expect(html).toContain('개인정보 사고 대응');
  expect(html).toContain('data-privacy-incident-detection-intake="true"');
  expect(html).toContain('심각도');
  expect(html).toContain('새로고침');
  expect(html).toContain('disabled="">탐지 등록');
  const listStart = html.indexOf('aria-label="사고 목록"');
  expect(listStart).toBeGreaterThan(0);
  expect(html.indexOf('data-data-pending="list"')).toBeGreaterThan(listStart);
  expect(html.slice(0, listStart)).not.toContain('data-slot="skeleton"');
  expect(html).not.toContain('표시할 사고가 없습니다');
  expect(html).not.toContain('사고 목록을 확인하지 못했습니다');
  expect(html).not.toContain('data-privacy-incident-preview-confirm-apply');
});

test('incident list distinguishes validated empty readback from pending/error while retaining prior rows on refresh', () => {
  const page = readFileSync(new URL('../app/admin/privacy-incidents/page.tsx', import.meta.url), 'utf8');
  const load = page.slice(page.indexOf('  const load = useCallback'), page.indexOf('  useEffect', page.indexOf('  const load = useCallback')));
  expect(load.indexOf("setListState('pending')")).toBeLessThan(load.indexOf('await fetch'));
  expect(load.indexOf("setListState('ready')")).toBeGreaterThan(load.indexOf('!nextActions) throw payload'));
  expect(load).toMatch(/catch \(error\) \{\s+setListState\('error'\);\s+setMessage\(errorMessage\(error\)\)/);
  expect(load).not.toContain('setIncidents([])');
  const list = page.slice(page.indexOf('aria-label="사고 목록"'), page.indexOf('{selectedIncident ? ('));
  expect(list).toContain("listState === 'pending' && hasListReadback");
  expect(list).toMatch(/!hasListReadback && listState === 'pending'[\s\S]*DataPending[\s\S]*incidents.length === 0 && listState === 'error'[\s\S]*incidents.length === 0 \? \(/);
});

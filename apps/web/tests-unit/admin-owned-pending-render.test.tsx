import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { AuthContext, type AuthContextType } from '../contexts/AuthContextBase';
import AdminUsersPanel from '../components/admin/AdminUsersPanel';
import InsightsClient from '../app/insights/insights-client';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { AdminPipelineDashboard } from '../components/admin/pipeline/AdminPipelineDashboard';

function auth(accountId: string | null, isLoading = false): AuthContextType {
  return {
    user: accountId ? { id: accountId } as User : null,
    session: null, isLoading, isAdmin: !!accountId, needsNicknameSetup: false, profileNickname: null,
    signIn: async () => {}, signOut: async () => {}, completeNicknameSetup: () => {},
    resetPassword: async () => {}, updatePassword: async () => {},
  };
}

function render(component: React.ReactNode, client: QueryClient, context = auth('current-account')) {
  return renderToStaticMarkup(<AuthContext.Provider value={context}><QueryClientProvider client={client}>{component}</QueryClientProvider></AuthContext.Provider>);
}

test('users first render contains actual search, summary, table columns and explicit selection panel', () => {
  const client = new QueryClient();
  try {
    const html = render(<AdminUsersPanel />, client);
    expect(html).toContain('data-admin-users-refresh');
    expect(html).toContain('data-admin-users-summary-metric');
    expect(html).toContain('<thead');
    expect(html).toContain('사용자를 선택하면 상세 정보와 변경 작업이 표시됩니다.');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('조건에 맞는 사용자가 없습니다.');
    expect(html).not.toContain('animate-pulse');
  } finally { client.clear(); }
});

test('pipeline pending keeps controls and does not claim there are no failures before readback', () => {
  const client = new QueryClient();
  try {
    const html = render(<AdminPipelineDashboard />, client);
    expect(html).toContain('data-admin-pipeline-enqueue');
    expect(html).toContain('data-admin-pipeline-jobs');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('최근 실패 없음');
  } finally { client.clear(); }
});

test('pipeline only renders current-account cache and hides it while auth is pending or signed out', () => {
  const client = new QueryClient();
  try {
    client.setQueryData(['admin-pipeline-status', 'previous-account'], { hardware: 'previous-private-fixture' });
    client.setQueryData(['admin-pipeline-status', 'current-account'], { hardware: 'current-private-fixture' });
    const html = render(<AdminPipelineDashboard />, client);
    expect(html).toContain('current-private-fixture');
    expect(html).not.toContain('previous-private-fixture');
    for (const context of [auth(null), auth('current-account', true)]) {
      const hidden = render(<AdminPipelineDashboard />, client, context);
      expect(hidden).not.toContain('current-private-fixture');
      expect(hidden).not.toContain('previous-private-fixture');
    }
  } finally { client.clear(); }
});

const router: AppRouterInstance = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};

test('both insights presentations keep real filters while pending, failed, and showing current-account data', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  const queryKey = ['insight-treemap', 'current-account', 'all', 'ALL', 'views'];
  const view = (embedded: boolean, context = auth('current-account')) => render(
    <AppRouterContext.Provider value={router}><InsightsClient embedded={embedded} /></AppRouterContext.Provider>, client, context,
  );
  try {
    client.setQueryData(['insight-treemap', 'previous-account', 'all', 'ALL', 'views'], { videos: [], totalVideos: 987654 });
    for (const embedded of [false, true]) {
      const pending = view(embedded);
      expect(pending).toContain('모드');
      expect(pending).toContain('트리맵 기준');
      expect(pending).toContain('role="status"');
      expect(pending).not.toContain('987,654');
      expect(pending).not.toContain('대상 데이터가 없습니다.');
      expect(pending).not.toContain('animate-pulse');
    }
    client.setQueryData(queryKey, { videos: [], totalVideos: 1234 });
    const query = client.getQueryCache().find({ queryKey })!;
    query.setState({ status: 'error', error: new Error('fixture-read-failed') });
    for (const embedded of [false, true]) {
      const failed = view(embedded);
      expect(failed).toContain('모드');
      expect(failed).toContain('다시 시도');
      expect(failed).toContain('1,234');
      expect(failed).not.toContain('fixture-read-failed');
      for (const context of [auth(null), auth('current-account', true)]) {
        expect(view(embedded, context)).not.toContain('1,234');
      }
    }
  } finally { client.clear(); }
});

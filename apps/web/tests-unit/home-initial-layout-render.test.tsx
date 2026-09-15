import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { AnonymousHomeAuthProvider } from '../contexts/AuthContextBase';
import { StaticNotificationProvider } from '../contexts/NotificationContextBase';
import { LayoutProvider } from '../contexts/LayoutContext';
import HomeClient from '../app/home-client';
import HomeClientLoader from '../app/home-client-loader';
import DesktopLeftPanelMapHome from '../components/home/DesktopLeftPanelMapHome';
import { useOverseasCountryCounts } from '../components/home/use-overseas-country-counts';

const router: AppRouterInstance = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};
function render(children: React.ReactNode, client: QueryClient) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/">
        <SearchParamsContext.Provider value={new URLSearchParams()}>
          <QueryClientProvider client={client}>
            <AnonymousHomeAuthProvider><StaticNotificationProvider><LayoutProvider>
              {children}
            </LayoutProvider></StaticNotificationProvider></AnonymousHomeAuthProvider>
          </QueryClientProvider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

test('home SSR includes actual map region, responsive controls and search before effects run', () => {
  const client = new QueryClient();
  try {
    const html = render(<HomeClient />, client);
    for (const marker of [
      '쯔동여지도 홈 지도 화면',
      'data-home-controls-viewport="desktop"',
      'data-home-controls-viewport="mobileOrTablet"',
      'data-desktop-left-map-panel="true"',
      'name="desktop-left-panel-restaurant-search"',
      '국내 맛집 지도 보기',
      '해외 맛집 지도 보기',
    ]) expect(html.includes(marker)).toBe(true);
    expect((html.match(/<button\b/g) ?? []).length).toBeGreaterThan(10);
    expect(html.includes('data-home-map-data-pending="true"')).toBe(true);
    // SSR/hydration-pending branches must not start a hidden viewport's observers.
    expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);
    for (const query of client.getQueryCache().getAll()) {
      expect(query.options.enabled).toBe(false);
      expect(query.state.fetchStatus).toBe('idle');
    }
  } finally { client.clear(); }
});

test('compatibility home loader renders the same real SSR controls rather than a hidden fallback', () => {
  const client = new QueryClient();
  try {
    const html = render(<HomeClientLoader />, client);
    expect(html.includes('data-desktop-left-map-panel="true"')).toBe(true);
    expect(html.includes('name="desktop-left-panel-restaurant-search"')).toBe(true);
    expect(html.includes('쯔동여지도 홈 지도 화면')).toBe(true);
    expect(html.includes('data-home-controls-viewport="mobileOrTablet"')).toBe(true);
  } finally { client.clear(); }
});

test('inactive desktop list preserves real headings and pending data slots without enabling list reads', () => {
  const client = new QueryClient();
  try {
    const html = render(<DesktopLeftPanelMapHome enabled={false} onRestaurantOpen={() => {}} />, client);
    expect(html.includes('인기 검색 맛집')).toBe(true);
    expect(html.includes('data-desktop-left-panel-latest-skeleton="true"')).toBe(true);
    expect(html.includes('이 지역에서 추천할 맛집을 아직 찾지 못했어요.')).toBe(false);
    expect(client.getQueryCache().getAll().every(query => query.options.enabled === false)).toBe(true);
  } finally { client.clear(); }
});

test('overseas counts remain disabled for a hidden viewport even when overseas is selected', () => {
  const client = new QueryClient();
  function Probe() { useOverseasCountryCounts('overseas', false); return null; }
  try {
    render(<Probe />, client);
    const query = client.getQueryCache().find({ queryKey: ['restaurants-count'] });
    expect(query?.options.enabled).toBe(false);
    expect(query?.state.fetchStatus).toBe('idle');
  } finally { client.clear(); }
});

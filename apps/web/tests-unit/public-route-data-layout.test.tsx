import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Bookmark } from 'lucide-react';
import { MyPageDataRegion } from '../app/mypage/my-page-data-region';
import { MyPageSectionFrame } from '../components/mypage/MyPageSectionFrame';
import { resolveMobileRouteHeader } from '../app/mypage/route-presentation';
import FeedLoading from '../app/feed/loading';
import StampLoading from '../app/stamp/loading';
import LeaderboardLoading from '../app/leaderboard/loading';
import GlobalMapLoading from '../app/global-map/loading';
import UserProfileLoading from '../app/user/[userId]/loading';

function renderRegion(pending: boolean, hasData: boolean, error: boolean) {
  return renderToStaticMarkup(
    <MyPageSectionFrame icon={Bookmark} eyebrow="내 활동" title="나의 북마크 내역" description="저장한 맛집" action={<button>목록 필터</button>}>
      <MyPageDataRegion pending={pending} hasData={hasData} error={error} label="북마크를 불러오는 중입니다." errorTitle="목록 조회 실패" errorDescription="다시 시도해주세요.">
        <article data-known-result="true">이전에 확인한 결과</article>
      </MyPageDataRegion>
    </MyPageSectionFrame>,
  );
}

test('initial data pending retains real section title and filter but no fabricated result', () => {
  const html = renderRegion(true, false, false);
  expect(html).toContain('나의 북마크 내역');
  expect(html).toContain('목록 필터');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('data-data-pending="list"');
  expect(html).not.toContain('data-known-result');
  expect(html.indexOf('</h1>')).toBeLessThan(html.indexOf('data-data-pending'));
});

test('refresh preserves cached content without inserting replacement data skeletons', () => {
  const html = renderRegion(true, true, false);
  expect(html).toContain('data-known-result');
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain('data-data-pending');
});

test('failed initial query retains layout and reports error, never a fake empty result', () => {
  const html = renderRegion(false, false, true);
  expect(html).toContain('나의 북마크 내역');
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('data-known-result');
  expect(html).not.toContain('data-data-pending');
});

test('failed refresh retains previously confirmed results beside the error', () => {
  const html = renderRegion(false, true, true);
  expect(html).toContain('data-known-result');
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('data-data-pending');
});

test('a cached successful empty result stays visible during refresh', () => {
  const html = renderToStaticMarkup(<MyPageDataRegion pending hasData error={false} label="조회 중" errorTitle="오류" errorDescription="재시도"><p>저장한 맛집이 없습니다.</p></MyPageDataRegion>);
  expect(html).toContain('저장한 맛집이 없습니다.');
  expect(html).not.toContain('data-data-pending');
});

for (const [Component, title] of [
  [FeedLoading, '쯔동여지도 리뷰'],
  [StampLoading, '쯔동여지도 도장'],
  [LeaderboardLoading, '쯔동여지도 랭킹'],
  [GlobalMapLoading, '해외 맛집 지도'],
  [UserProfileLoading, '사용자 프로필'],
] as const) {
  test(`${title} route fallback contains its real heading and a bounded data slot`, () => {
    const html = renderToStaticMarkup(<Component />);
    expect(html).toContain(title);
    expect(html).toContain('<h1');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-data-pending');
    const heading = html.slice(html.indexOf('<h1'), html.indexOf('</h1>'));
    expect(heading).not.toContain('data-slot="skeleton"');
  });
}

test('mypage fallback resolves the actual subroute title, including deep links', () => {
  expect(resolveMobileRouteHeader('/mypage/reviews').title).toBe('나의 리뷰 내역');
  expect(resolveMobileRouteHeader('/mypage/submissions/recommend').title).toBe('쯔양 맛집 제보');
  expect(resolveMobileRouteHeader('/mypage/bookmarks').title).toBe('나의 북마크 내역');
});

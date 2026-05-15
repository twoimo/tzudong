import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('header action loading source contract', () => {
  test('desktop header action icons use independent skeleton slots instead of one grouped auth placeholder', () => {
    const headerSource = source('components/layout/Header.tsx');

    expect(headerSource).toContain('function HeaderActionSkeleton');
    expect(headerSource).toContain('shouldShowNotificationSkeleton');
    expect(headerSource).toContain('shouldShowBookmarkSkeleton');
    expect(headerSource).toContain('shouldShowFullscreenSkeleton');
    expect(headerSource).toContain('shouldShowAccountSkeleton');
    expect(headerSource).toContain('label="알림 로딩 중"');
    expect(headerSource).toContain('label="북마크 로딩 중"');
    expect(headerSource).toContain('label="전체화면 로딩 중"');
    expect(headerSource).toContain('label="사용자 메뉴 로딩 중"');
    expect(headerSource).toContain('loading: () => <HeaderActionSkeleton label="북마크 로딩 중" />');
    expect(headerSource).toContain('fallback={<HeaderActionSkeleton label="북마크 로딩 중" />}');
    expect(headerSource).not.toContain('w-[84px] rounded-md md:ml-2 md:h-10 md:w-[96px]');
  });

  test('layout auth loading only blocks header icons until the user object is known', () => {
    expect(source('components/layout/MainLayout.tsx')).toContain('isAuthLoading={isLoading && !user}');
    expect(source('components/layout/OverlayLayout.tsx')).toContain('isAuthLoading={isLoading && !user}');
  });



  test('account dropdown does not expose the announcement shortcut', () => {
    const headerSource = source('components/layout/Header.tsx');

    expect(headerSource).not.toContain('handleAnnouncementListClick');
    expect(headerSource).not.toContain('<DropdownMenuItem onClick={handleAnnouncementListClick}');
    expect(headerSource).toContain('aria-label="관리자 콘솔에서 공지사항 관리"');
  });

  test('bookmark dropdown keeps its own list skeleton while bookmark data loads', () => {
    const bookmarkSource = source('components/layout/HeaderBookmarkMenuButton.tsx');

    expect(bookmarkSource).toContain('isLoading: isBookmarksLoading');
    expect(bookmarkSource).toContain('aria-label="북마크 목록 로딩 중"');
    expect(bookmarkSource).toContain('<Skeleton className="h-4 w-3/4 rounded" />');
  });
});

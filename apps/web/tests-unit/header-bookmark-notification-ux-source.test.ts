import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('header bookmark and notification UX source contracts', () => {
  test('desktop bookmark menu has intent-loaded data, responsive panel, and clear loading/empty/error states', () => {
    const bookmarkSource = source('components/layout/HeaderBookmarkMenuButton.tsx');
    const hookSource = source('hooks/use-bookmarks.tsx');

    expect(hookSource).toContain('interface UseBookmarksOptions');
    expect(hookSource).toContain('enabled: isEnabled && !!user?.id');
    expect(bookmarkSource).toContain('const [isOpen, setIsOpen] = useState(false);');
    expect(bookmarkSource).toContain('useBookmarks({ enabled: isOpen })');
    expect(bookmarkSource).toContain('setIsOpen(open);');
    expect(bookmarkSource).toContain('h-11 w-11 rounded-xl');
    expect(bookmarkSource).toContain('focus-visible:ring-2 focus-visible:ring-primary touch-manipulation');
    expect(bookmarkSource).toContain('`북마크, 저장한 맛집 ${bookmarksData.length}개`');
    expect(bookmarkSource).toContain('w-[min(calc(100vw-1rem),22rem)]');
    expect(bookmarkSource).toContain('aria-label="북마크 목록 로딩 중"');
    expect(bookmarkSource).toContain('북마크를 불러오지 못했습니다');
    expect(bookmarkSource).toContain('북마크한 맛집이 없습니다');
    expect(bookmarkSource).toContain('MapPin className="h-4 w-4');
  });

  test('desktop notification menu distinguishes loading, error, empty, unread, and destination states', () => {
    const headerSource = source('components/layout/Header.tsx');

    expect(headerSource).toContain('isLoading: isNotificationsLoading');
    expect(headerSource).toContain('isError: isNotificationsError');
    expect(headerSource).toContain('aria-label={unreadCount > 0 ? `알림, 안 읽은 알림');
    expect(headerSource).toContain('aria-label="알림 목록 로딩 중"');
    expect(headerSource).toContain('알림을 불러오지 못했습니다');
    expect(headerSource).toContain('새로운 알림이 없습니다');
    expect(headerSource).toContain('notifications.slice(0, 50)');
    expect(headerSource).toContain('onSelect={() => handleNotificationClick(notification)}');
    expect(headerSource).toContain('event.preventDefault();');
    expect(headerSource).toContain('알림 삭제');
    expect(headerSource).toContain('새 알림');
    expect(headerSource).toContain('aria-label="모든 알림 읽음 처리"');
    expect(headerSource).toContain('router.push(`/?r=${restaurantId}&z=13`)');
    expect(headerSource).toContain("router.push('/?panel=announcement')");
    expect(headerSource).toContain('w-[min(calc(100vw-1rem),22rem)]');
  });

  test('mobile bookmark and notification controls keep the same touch, state, and responsive affordances', () => {
    const mobileBookmarkSource = source('components/home/MobileBookmarkMenuButton.tsx');
    const mobileOverlaySource = source('components/home/MobileControlOverlay.tsx');

    expect(mobileBookmarkSource).toContain('useBookmarks({ enabled: isOpen })');
    expect(mobileBookmarkSource).toContain('relative h-11 w-11 rounded-full');
    expect(mobileBookmarkSource).toContain('aria-label="북마크 목록 로딩 중"');
    expect(mobileBookmarkSource).toContain('북마크를 불러오지 못했습니다');
    expect(mobileBookmarkSource).toContain('aria-label="북마크 전체보기 페이지로 이동"');
    expect(mobileBookmarkSource).toContain('MapPin className="h-4 w-4');

    expect(mobileOverlaySource).toContain('h-11 w-11 rounded-full');
    expect(mobileOverlaySource).toContain('aria-label="북마크 전체보기 로그인 안내"');
    expect(mobileOverlaySource).toContain('aria-label={unreadCount > 0 ? `알림, 안 읽은 알림');
    expect(mobileOverlaySource).toContain('aria-label="알림 목록 로딩 중"');
    expect(mobileOverlaySource).toContain('알림을 불러오지 못했습니다');
    expect(mobileOverlaySource).toContain('notifications.slice(0, 50)');
    expect(mobileOverlaySource).toContain('onSelect={() => handleNotificationItemClick(notification)}');
    expect(mobileOverlaySource).toContain('event.preventDefault();');
    expect(mobileOverlaySource).toContain('알림 삭제');
    expect(mobileOverlaySource).toContain('formatDistanceToNow(notification.createdAt');
    expect(mobileOverlaySource).toContain('removeNotification(notification.id)');
    expect(mobileOverlaySource).toContain('w-[min(calc(100vw-1rem),22rem)]');
  });

  test('notification context exposes loading/error without breaking static no-op provider', () => {
    const typeSource = source('types/notification.ts');
    const contextSource = source('contexts/NotificationContext.tsx');
    const baseSource = source('contexts/NotificationContextBase.tsx');

    expect(typeSource).toContain('isLoading: boolean;');
    expect(typeSource).toContain('isError: boolean;');
    expect(contextSource).toContain('const [isLoading, setIsLoading] = useState(false);');
    expect(contextSource).toContain('const [isError, setIsError] = useState(false);');
    expect(contextSource).toContain('setIsError(!isMissingNotificationsTable);');
    expect(baseSource).toContain('isLoading: false');
    expect(baseSource).toContain('isError: false');
  });
});

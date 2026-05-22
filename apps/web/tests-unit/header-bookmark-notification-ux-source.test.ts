import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('header bookmark and notification UX source contracts', () => {
  test('desktop bookmark menu has intent-loaded data, responsive panel, and clear loading/empty/error states', () => {
    const bookmarkSource = source('components/layout/HeaderBookmarkMenuButton.tsx');
    const leftPanelBookmarkSource = source('components/home/DesktopLeftPanelBookmarks.tsx');
    const hookSource = source('hooks/use-bookmarks.tsx');

    expect(hookSource).toContain('interface UseBookmarksOptions');
    expect(hookSource).toContain('enabled: isEnabled && !!user?.id');
    expect(bookmarkSource).toContain('const [isOpen, setIsOpen] = useState(false);');
    expect(bookmarkSource).toContain('useBookmarks({ enabled: isOpen })');
    expect(bookmarkSource).toContain('setIsOpen(open);');
    expect(bookmarkSource).toContain('h-11 w-11 rounded-xl');
    expect(bookmarkSource).toContain('focus-visible:ring-2 focus-visible:ring-primary touch-manipulation');
    expect(bookmarkSource).toContain('`북마크, 저장한 맛집 ${bookmarksData.length}개`');
    expect(bookmarkSource).toContain('flex h-5 min-w-5 items-center justify-center rounded-full border-primary/20 bg-primary px-1.5 py-0 text-[10px] font-bold leading-none tabular-nums text-primary-foreground');
    expect(bookmarkSource).toContain("bookmarksData.length > 99 ? '99+' : bookmarksData.length");
    expect(bookmarkSource).toContain('w-[min(calc(100vw-1rem),22rem)] rounded-2xl border-border bg-card p-2 font-serif shadow-primary');
    expect(bookmarkSource).toContain('rounded-xl bg-muted/40 px-3 py-2.5 text-foreground');
    expect(bookmarkSource).toContain('rounded-xl bg-background/70 p-4 text-center');
    expect(bookmarkSource).toContain('aria-label="북마크 목록 로딩 중"');
    expect(bookmarkSource).toContain('북마크를 불러오지 못했습니다');
    expect(bookmarkSource).toContain('북마크한 맛집이 없습니다');
    expect(bookmarkSource).toContain('MapPin className="h-8 w-8 shrink-0 rounded-full bg-primary/10 p-2 text-primary');
    expect(leftPanelBookmarkSource).toContain('onClose?: () => void;');
    expect(leftPanelBookmarkSource).toContain('aria-label="북마크 패널 닫기"');
    expect(leftPanelBookmarkSource).toContain('className="h-9 w-9 rounded-full hover:bg-muted"');
    expect(leftPanelBookmarkSource).toContain('flex flex-wrap items-start justify-between gap-2');
    expect(leftPanelBookmarkSource).toContain('basis-[min(10rem,100%)]');
    expect(leftPanelBookmarkSource).toContain('text-pretty');
    expect(leftPanelBookmarkSource).toContain(
      'className="group rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-accent"',
    );
    expect(leftPanelBookmarkSource).toContain(
      'className="flex w-full items-start gap-3 rounded-t-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"',
    );
    expect(leftPanelBookmarkSource).toContain(
      'className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground"',
    );
    expect(leftPanelBookmarkSource).not.toContain(
      'className="group flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"',
    );
  });

  test('desktop notification menu distinguishes loading, error, empty, unread, and destination states', () => {
    const headerSource = source('components/layout/Header.tsx');
    const leftPanelNotificationSource = source('components/home/DesktopLeftPanelNotifications.tsx');

    expect(headerSource).toContain('isLoading: isNotificationsLoading');
    expect(headerSource).toContain('isError: isNotificationsError');
    expect(headerSource).toContain('aria-label={unreadCount > 0 ? `알림, 안 읽은 알림');
    expect(headerSource).toContain('absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-800 px-1.5 py-0 text-[10px] font-bold leading-none tabular-nums text-white');
    expect(headerSource).toContain("unreadCount > 99 ? '99+' : unreadCount");
    expect(headerSource).toContain('aria-label="알림 목록 로딩 중"');
    expect(headerSource).toContain('알림을 불러오지 못했습니다');
    expect(headerSource).toContain('새로운 알림이 없습니다');
    expect(headerSource).toContain('notifications.slice(0, 50)');
    expect(headerSource).toContain('onSelect={() => handleNotificationClick(notification)}');
    expect(headerSource).toContain('event.preventDefault();');
    expect(headerSource).toContain('알림 삭제');
    expect(headerSource).toContain('새 알림');
    expect(headerSource).toContain('w-[min(calc(100vw-1rem),22rem)] rounded-2xl border-border bg-card p-2 font-serif shadow-primary');
    expect(headerSource).toContain('flex w-full max-w-full cursor-pointer items-center gap-3 rounded-xl p-2.5');
    expect(headerSource).toContain('!notification.isRead && "bg-primary/5"');
    expect(headerSource).toContain('aria-label="모든 알림 읽음 처리"');
    expect(headerSource).toContain('router.push(`/?r=${restaurantId}&z=13`)');
    expect(headerSource).toContain("router.push('/?panel=announcement')");
    expect(leftPanelNotificationSource).toContain('onClose?: () => void;');
    expect(leftPanelNotificationSource).toContain('aria-label="알림 패널 닫기"');
    expect(leftPanelNotificationSource).toContain('className="h-9 w-9 rounded-full hover:bg-muted"');
    expect(leftPanelNotificationSource).toContain('flex flex-wrap items-start justify-between gap-2');
    expect(leftPanelNotificationSource).toContain('className="min-w-0 flex-1 basis-[min(10rem,100%)]"');
    expect(leftPanelNotificationSource).toContain('basis-[min(10rem,100%)]');
    expect(leftPanelNotificationSource).toContain('className="mt-1 max-w-full text-pretty text-xs leading-5 text-muted-foreground"');
    expect(leftPanelNotificationSource).toContain('리뷰·맛집·공지 소식을 바로 확인해요.');
    expect(leftPanelNotificationSource).toContain('text-pretty');
    expect(leftPanelNotificationSource).toContain('className="mt-3 flex justify-end"');
    expect(leftPanelNotificationSource).not.toContain('className="grid gap-2"');
    expect(leftPanelNotificationSource).not.toContain('className="min-w-0 flex-1 pt-1"');
    expect(leftPanelNotificationSource).not.toContain('className="truncate text-xs text-muted-foreground"');
  });

  test('mobile bookmark and notification controls keep the same touch, state, and responsive affordances', () => {
    const mobileBookmarkSource = source('components/home/MobileBookmarkMenuButton.tsx');
    const mobileNotificationSource = source('components/home/MobileNotificationMenuButton.tsx');
    const mobileOverlaySource = source('components/home/MobileControlOverlay.tsx');

    expect(mobileBookmarkSource).toContain('useBookmarks({ enabled: isOpen })');
    expect(mobileBookmarkSource).toContain('relative h-9 w-9 rounded-full');
    expect(mobileBookmarkSource).toContain('flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0 text-[10px] font-bold leading-none tabular-nums text-primary-foreground');
    expect(mobileBookmarkSource).toContain("bookmarksData.length > 99 ? '99+' : bookmarksData.length");
    expect(mobileBookmarkSource).toContain('aria-label="북마크 목록 로딩 중"');
    expect(mobileBookmarkSource).toContain('북마크를 불러오지 못했습니다');
    expect(mobileBookmarkSource).toContain('aria-label="북마크 전체보기 페이지로 이동"');
    expect(mobileBookmarkSource).toContain('MapPin className="h-8 w-8 shrink-0 rounded-full bg-primary/10 p-2 text-primary');

    expect(mobileOverlaySource).toContain('h-9 w-9 rounded-full');
    expect(mobileOverlaySource).toContain('const mobileTopIconButtonClass = cn(');
    expect(mobileOverlaySource).toContain("const mobileTopIconGlyphClass = 'h-[18px] w-[18px]'");
    expect(mobileOverlaySource).toContain("const mobileTopUserIconGlyphClass = 'h-5 w-5'");
    expect(mobileOverlaySource).toContain("const mobileUserMenuContentClass = 'w-max max-w-[calc(100vw-1rem)] bg-card border-border font-serif z-[110]'");
    expect(mobileOverlaySource).toContain("const mobileUserMenuItemClass = 'text-foreground hover:bg-accent py-1.5 whitespace-nowrap'");
    expect(mobileOverlaySource).toContain('className={mobileTopIconButtonClass}');
    expect(mobileOverlaySource).toContain('className={mobileTopUserIconGlyphClass}');
    expect(mobileOverlaySource).toContain('className={mobileUserMenuContentClass}');
    expect(mobileOverlaySource).toContain("type MobileTopDropdown = 'bookmark' | 'notification' | 'user' | null");
    expect(mobileOverlaySource).toContain('const [openTopDropdown, setOpenTopDropdown] = useState<MobileTopDropdown>');
    expect(mobileOverlaySource).toContain("const isBookmarkMenuOpen = openTopDropdown === 'bookmark'");
    expect(mobileOverlaySource).toContain("const isNotificationMenuOpen = openTopDropdown === 'notification'");
    expect(mobileOverlaySource).toContain("const isUserMenuOpen = openTopDropdown === 'user'");
    expect(mobileOverlaySource).toContain('<DropdownMenu open={isUserMenuOpen} onOpenChange={handleUserMenuOpenChange}>');
    expect(mobileOverlaySource).not.toContain('bg-card border-border font-serif w-44 z-[110]');
    expect(mobileOverlaySource).toContain('aria-label="북마크 전체보기 로그인 안내"');
    expect(mobileOverlaySource).toContain('loadMobileNotificationMenuButton');
    expect(mobileOverlaySource).toContain('<DeferredMobileNotificationMenuButton user={user} open={isNotificationMenuOpen} onOpenChange={handleNotificationMenuOpenChange} />');
    expect(mobileOverlaySource).toContain('<DeferredMobileBookmarkMenuButton user={user} open={isBookmarkMenuOpen} onOpenChange={handleBookmarkMenuOpenChange} />');
    expect(mobileOverlaySource).not.toContain('useNotifications()');
    expect(mobileOverlaySource).not.toContain('formatDistanceToNow(notification.createdAt');

    expect(mobileNotificationSource).toContain('aria-label={');
    expect(mobileNotificationSource).toContain('알림, 안 읽은 알림');
    expect(mobileNotificationSource).toContain('absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-800 px-1.5 py-0 text-[10px] font-bold leading-none tabular-nums text-white');
    expect(mobileNotificationSource).toContain('unreadCount > 99 ? "99+" : unreadCount');
    expect(mobileNotificationSource).toContain('aria-label="알림 목록 로딩 중"');
    expect(mobileNotificationSource).toContain('알림을 불러오지 못했습니다');
    expect(mobileNotificationSource).toContain('notifications.slice(0, 50)');
    expect(mobileNotificationSource).toContain('onSelect={() => handleNotificationItemClick(notification)}');
    expect(mobileNotificationSource).toContain('event.preventDefault();');
    expect(mobileNotificationSource).toContain('알림 삭제');
    expect(mobileNotificationSource).toContain('formatDistanceToNow(notification.createdAt');
    expect(mobileNotificationSource).toContain('removeNotification(notification.id)');
    expect(mobileNotificationSource).toContain('h-9 w-9 rounded-full');
    expect(mobileNotificationSource).toContain('w-[min(calc(100vw-1rem),22rem)] rounded-2xl border-border bg-card p-2 font-serif shadow-primary');
    expect(mobileNotificationSource).toContain('flex w-full max-w-full cursor-pointer items-center gap-3 rounded-xl p-2.5');
    expect(mobileNotificationSource).toContain('!notification.isRead && "bg-primary/5"');
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

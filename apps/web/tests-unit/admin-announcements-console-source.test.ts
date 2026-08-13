import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin announcements console integration source contract', () => {
  test('routes announcement panels to inline admin CRUD instead of console CTA', () => {
    const headerSource = source('components/layout/Header.tsx');
    const announcementPanelSource = source('components/announcement/AnnouncementPanel.tsx');

    expect(headerSource).toContain('loadAnnouncementPanel');
    expect(headerSource).toContain('HeaderAnnouncementPanel');
    expect(headerSource).toContain('adminActionsMode="inline"');
    expect(headerSource).not.toContain('관리자 콘솔 열기');
    expect(headerSource).not.toContain('관리자 콘솔에서 공지사항 관리');
    expect(headerSource).not.toContain("from('announcements')");
    expect(headerSource).not.toContain('handleToggleAnnouncementActive');
    expect(headerSource).not.toContain('handleToggleAnnouncementBanner');
    expect(headerSource).not.toContain('handleDeleteAnnouncement');

    expect(announcementPanelSource).toContain("adminActionsMode = 'inline'");
    expect(announcementPanelSource).toContain("adminActionsMode === 'inline'");
    expect(announcementPanelSource).not.toContain('console-link');
    expect(announcementPanelSource).toContain('useAnnouncementsAdmin(canManageInline)');
    expect(announcementPanelSource).toContain('useActiveAnnouncements(!canManageInline)');
    expect(announcementPanelSource).toContain('canManageInline ? adminAnnouncements : activeAnnouncements');
    expect(announcementPanelSource).toContain('쯔동여지도 공지');
    expect(announcementPanelSource).toContain('shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4');
    expect(announcementPanelSource).toContain('h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted');
    expect(announcementPanelSource).toContain('flex min-w-0 flex-wrap items-center gap-1.5');
    expect(announcementPanelSource).not.toContain('공지 목록으로 돌아가기');
    expect(announcementPanelSource).not.toContain("isBottomSheet || canManageInline ? '' : 'border-l border-border'");
    expect(announcementPanelSource).not.toContain("router.push('/admin?module=announcements')");
    expect(announcementPanelSource).not.toContain('운영 변경은 관리자 콘솔에서 처리합니다');
    expect(announcementPanelSource).not.toContain('관리자 콘솔에서 공지 관리');
    expect(announcementPanelSource).not.toContain('공지 관리 열기');
  });

  test('keeps announcement admin operations in full-panel transitions instead of a split preview', () => {
    const announcementPanelSource = source('components/announcement/AnnouncementPanel.tsx');
    const headerSource = source('components/layout/Header.tsx');
    const desktopControlPanelSource = source('components/home/home-desktop-control-panel.tsx');
    const homeSidePanelsSource = source('app/home-client-sidepanels.tsx');

    expect(announcementPanelSource).not.toContain('xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]');
    expect(announcementPanelSource).not.toContain('목록과 상세·작성 패널을 반반으로 나눠');
    expect(announcementPanelSource).toContain("setViewMode('detail')");
    expect(announcementPanelSource).toContain("viewMode === 'detail'");
    expect(announcementPanelSource).not.toContain('목록 보기');
    expect(announcementPanelSource).toContain("onClick={viewMode === 'list' ? onClose : handleCancel}");
    expect(announcementPanelSource).toContain("aria-label={viewMode === 'list' ? '공지 패널 닫기' : '공지 목록으로 이동'}");
    expect(announcementPanelSource).toContain('group w-full rounded-xl border border-border/70 bg-card px-3 py-3 text-left');
    expect(announcementPanelSource).toContain('aria-label="공지사항 목록 로딩 중"');
    expect(announcementPanelSource).toContain('<AnnouncementListItemSkeleton key={index} index={index} />');
    expect(announcementPanelSource).not.toContain('공지사항을 불러오는 중입니다');
    expect(announcementPanelSource).not.toContain('line-clamp-2 break-words');
    expect(announcementPanelSource).not.toContain('우선순위:');
    expect(announcementPanelSource).not.toContain('hover:bg-muted/50 -mx-4 -mt-4 p-4 rounded-t-lg');
    expect(announcementPanelSource).not.toContain('공지 삭제 확인 문구');
    expect(announcementPanelSource).not.toContain('deleteConfirmation');
    expect(announcementPanelSource).not.toContain('공지 노출 상태 변경 확인 문구');
    expect(announcementPanelSource).not.toContain('toggleConfirmation');
    expect(announcementPanelSource).not.toContain('상태변경');
    expect(announcementPanelSource).not.toContain('배너변경');
    expect(announcementPanelSource).not.toContain('role="listitem"');
    expect(announcementPanelSource).not.toContain('confirm(`');

    expect(headerSource).toContain('AnnouncementPanelLoadingFallback');
    expect(headerSource).toContain('HeaderAnnouncementPanel ?');
    expect(desktopControlPanelSource).toContain('AnnouncementPanelLoadingFallback');
    expect(desktopControlPanelSource).toContain(
      'activeLeftPanelView === "announcement" && !isPublicRestrictedMode ?',
    );
    expect(homeSidePanelsSource).toContain('loading: () => <AnnouncementPanelLoadingFallback');
  });

  test('renders announcement detail content with preserved paragraphs and line breaks', () => {
    const announcementPanelSource = source('components/announcement/AnnouncementPanel.tsx');

    expect(announcementPanelSource).toContain('function normalizeAnnouncementContent(content: string): string');
    expect(announcementPanelSource).toContain(".replace(/\\\\n/g, '\\n')");
    expect(announcementPanelSource).toContain('function getAnnouncementContentParagraphs(content: string): string[]');
    expect(announcementPanelSource).toContain('normalizedContent.split(/\\n{2,}/)');
    expect(announcementPanelSource).toContain('getAnnouncementContentParagraphs(selectedAnnouncement.content).map');
    expect(announcementPanelSource).toContain('className="space-y-3 text-sm text-foreground leading-relaxed break-words"');
    expect(announcementPanelSource).toContain('className="whitespace-pre-line"');
    expect(announcementPanelSource).toContain("style={{ whiteSpace: 'pre-line' }}");
    expect(announcementPanelSource).not.toContain('{selectedAnnouncement.content}');
  });

  test('keeps multiple banner announcements toast-safe and query-refreshable', () => {
    const adminHookSource = source('hooks/use-announcements.tsx');
    const bannerHookSource = source('hooks/use-banner-announcements.tsx');
    const runtimeSource = source('components/map/NaverMapAnnouncementRuntime.tsx');

    expect(adminHookSource).toContain("toast.success(variables.showOnBanner ? '배너 노출이 설정되었습니다' : '배너 노출이 해제되었습니다')");
    expect(adminHookSource).toContain("queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_QUERY_KEY })");
    expect(bannerHookSource).toContain("['show_on_banner', 'eq.true']");
    expect(bannerHookSource).toContain('return parseAnnouncements(rows);');
    expect(bannerHookSource).not.toContain('limit(1)');
    expect(runtimeSource).toContain('announcementToastIndexRef.current = announcementPlan.nextIndex');
    expect(runtimeSource).toContain('bannerAnnouncements.length === 0');
  });

  test('removes announcement operations from the URL-backed admin console module list', () => {
    const adminConsoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(adminConsoleSource).not.toContain('id: "announcements"');
    expect(adminConsoleSource).not.toContain('title: "공지사항"');
    expect(adminConsoleSource).not.toContain('AdminAnnouncementModule');
    expect(adminConsoleSource).not.toContain('adminActionsMode="inline"');
    expect(adminConsoleSource).not.toContain('/admin?module=announcements');
    expect(adminConsoleSource).not.toContain('totalAnnouncements');
    expect(adminConsoleSource).not.toContain('bannerAnnouncements');
    expect(adminConsoleSource).not.toContain('latestAnnouncementUpdate');
  });
});

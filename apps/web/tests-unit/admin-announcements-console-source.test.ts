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

  test('keeps announcement admin operations in a two-pane no-modal console', () => {
    const announcementPanelSource = source('components/announcement/AnnouncementPanel.tsx');

    expect(announcementPanelSource).toContain('xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]');
    expect(announcementPanelSource).toContain('목록과 상세·작성 패널을 반반으로 나눠 모달 없이');
    expect(announcementPanelSource).toContain('공지 삭제 확인 문구');
    expect(announcementPanelSource).toContain("deleteConfirmation !== '공지삭제'");
    expect(announcementPanelSource).toContain('공지 노출 상태 변경 확인 문구');
    expect(announcementPanelSource).toContain("toggleConfirmation !== '상태변경'");
    expect(announcementPanelSource).toContain("toggleConfirmation !== '배너변경'");
    expect(announcementPanelSource).not.toContain('role="listitem"');
    expect(announcementPanelSource).not.toContain('confirm(`');
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

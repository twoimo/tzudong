import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin announcements console integration source contract', () => {
  test('routes header announcement management into the unified admin console', () => {
    const headerSource = source('components/layout/Header.tsx');
    const announcementPanelSource = source('components/announcement/AnnouncementPanel.tsx');

    expect(headerSource).toContain("router.push('/admin')");
    expect(headerSource).not.toContain("router.push('/admin?module=announcements')");
    expect(headerSource).toContain('관리자 콘솔 열기');
    expect(headerSource).not.toContain("from('announcements')");
    expect(headerSource).not.toContain('handleToggleAnnouncementActive');
    expect(headerSource).not.toContain('handleToggleAnnouncementBanner');
    expect(headerSource).not.toContain('handleDeleteAnnouncement');

    expect(announcementPanelSource).toContain("adminActionsMode = 'console-link'");
    expect(announcementPanelSource).toContain("adminActionsMode === 'inline'");
    expect(announcementPanelSource).toContain('useAnnouncementsAdmin(canManageInline)');
    expect(announcementPanelSource).toContain('useActiveAnnouncements(!canManageInline)');
    expect(announcementPanelSource).toContain('canManageInline ? adminAnnouncements : activeAnnouncements');
    expect(announcementPanelSource).toContain("isBottomSheet || canManageInline ? '' : 'border-l border-border'");
    expect(announcementPanelSource).toContain("router.push('/admin?module=announcements')");
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

  test('embeds announcement operations as a URL-backed admin module', () => {
    const adminConsoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(adminConsoleSource).toContain('id: "announcements"');
    expect(adminConsoleSource).toContain('title: "공지사항"');
    expect(adminConsoleSource).toContain('AdminAnnouncementModule');
    expect(adminConsoleSource).toContain('adminActionsMode="inline"');
    expect(adminConsoleSource).toContain('hideCloseButton');
    expect(adminConsoleSource).toContain('/admin?module=announcements');
    expect(adminConsoleSource).toContain('totalAnnouncements');
    expect(adminConsoleSource).toContain('bannerAnnouncements');
    expect(adminConsoleSource).toContain('latestAnnouncementUpdate');
  });
});

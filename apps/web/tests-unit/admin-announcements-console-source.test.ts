import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin announcements console integration source contract', () => {
  test('routes header announcement management into the unified admin console', () => {
    const headerSource = source('components/layout/Header.tsx');
    const announcementPanelSource = source('components/announcement/AnnouncementPanel.tsx');

    expect(headerSource).toContain("router.push('/admin?module=announcements')");
    expect(headerSource).toContain('관리자 콘솔에서 공지 관리');
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

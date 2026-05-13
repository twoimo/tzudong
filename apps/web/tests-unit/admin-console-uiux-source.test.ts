import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin console beginner-friendly UI/UX source contract', () => {
  test('keeps admin module state URL-backed and easy to recover', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('useSearchParams');
    expect(consoleSource).toContain('getAdminModuleIdFromSearchParams');
    expect(consoleSource).toContain('router.replace');
    expect(consoleSource).toContain('scroll: false');
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).not.toContain('window.history.replaceState');
  });

  test('adds beginner guidance without replacing the existing warm design system', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('초보자 안내 강화');
    expect(consoleSource).toContain('BeginnerGuideCard');
    expect(consoleSource).toContain('처음 쓰는 관리자 안내');
    expect(consoleSource).toContain('무엇부터 보면 되는지 3단계로 정리했어요');
    expect(consoleSource).toContain('beginnerTip');
    expect(consoleSource).toContain('safetyTip');
    expect(consoleSource).toContain('처음이라면');
    expect(consoleSource).toContain('안전하게 처리하려면');
    expect(consoleSource).toContain('ModuleContextHeader');
    expect(consoleSource).toContain('bg-gradient-to-br from-card via-card to-primary/5');
  });

  test('keeps announcement operations safer and accessible inside the console', () => {
    const panelSource = source('components/announcement/AnnouncementPanel.tsx');

    expect(panelSource).toContain('lastActionMessage');
    expect(panelSource).toContain('formError');
    expect(panelSource).toContain('저장 전 확인');
    expect(panelSource).toContain('게시 상태: {formData.isActive ?');
    expect(panelSource).toContain('홈 지도 배너: {formData.showOnBanner ?');
    expect(panelSource).toContain('공지 패널 닫기');
    expect(panelSource).toContain('첫 공지 페이지로 이동');
    expect(panelSource).toContain('이전 공지 페이지로 이동');
    expect(panelSource).toContain('다음 공지 페이지로 이동');
    expect(panelSource).toContain('마지막 공지 페이지로 이동');
    expect(panelSource).toContain('공지 작성 후 목록으로 돌아가기');
    expect(panelSource).toContain('수정 저장 후 목록으로 돌아가기');
    expect(panelSource).toContain('저장 중…');
    expect(panelSource).toContain('일반 50, 중요 80, 긴급 100을 권장합니다.');
    expect(panelSource).toContain('홈 배너에 노출');
    expect(panelSource).toContain('홈 배너에서 내리기');
    expect(panelSource).not.toContain('저장 중...');
  });

  test('uses one active-announcement read model for header and banner surfaces', () => {
    const bannerHookSource = source('hooks/use-banner-announcements.tsx');

    expect(bannerHookSource).toContain("useActiveAnnouncements as useBaseActiveAnnouncements");
    expect(bannerHookSource).toContain('return useBaseActiveAnnouncements(enabled)');
    expect(bannerHookSource).not.toContain('fetchSupabaseRows');
    expect(bannerHookSource).not.toContain('ANNOUNCEMENT_SELECT');
    expect(bannerHookSource).not.toContain('AnnouncementRow');
  });
  test('does not silently redirect unauthenticated admin visits to the home map', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('function AdminAccessGate');
    expect(consoleSource).toContain('관리자 로그인이 필요합니다');
    expect(consoleSource).toContain('로그인 창 열기');
    expect(consoleSource).toContain('AUTH_UI_REQUEST_EVENT');
    expect(consoleSource).not.toContain('if (!authLoading && (!user || !isAdmin))');
  });

});

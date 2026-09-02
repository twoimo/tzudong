import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const appRoot = join(import.meta.dir, '..');
const source = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');

const staticTitleContracts = [
  ['app/page.tsx', '쯔양이 다녀간 맛집 지도 - 쯔동여지도'],
  ['app/feed/layout.tsx', '피드 - 쯔동여지도'],
  ['app/global-map/layout.tsx', '국내·해외 맛집 지도 - 쯔동여지도'],
  ['app/stamp/layout.tsx', '도장 - 쯔동여지도'],
  ['app/leaderboard/layout.tsx', '랭킹 - 쯔동여지도'],
  ['app/insights/layout.tsx', '맛집 인사이트 - 쯔동여지도'],
  ['app/privacy/page.tsx', '개인정보 처리방침 - 쯔동여지도'],
  ['app/data-deletion/page.tsx', '데이터 삭제 요청 - 쯔동여지도'],
  ['app/s/layout.tsx', '리다이렉트 중 - 쯔동여지도'],
  ['app/s/[code]/page.tsx', '리다이렉트 중 - 쯔동여지도'],
  ['app/admin/layout.tsx', '관리자 콘솔 - 쯔동여지도'],
  ['app/admin/banners/layout.tsx', '배너 관리 - 관리자 콘솔 - 쯔동여지도'],
  ['app/admin/evaluations/layout.tsx', '맛집 관리 - 관리자 콘솔 - 쯔동여지도'],
  ['app/admin/submissions/page.tsx', '제보 관리 - 관리자 콘솔 - 쯔동여지도'],
  ['app/auth/layout.tsx', '인증 - 쯔동여지도'],
  ['app/auth/required/page.tsx', '로그인이 필요합니다 - 쯔동여지도'],
  ['app/auth/reset-password/layout.tsx', '비밀번호 재설정 - 쯔동여지도'],
  ['app/mypage/layout.tsx', '마이페이지 - 쯔동여지도'],
  ['app/submissions/layout.tsx', '제보 내역 - 쯔동여지도'],
  ['app/user/layout.tsx', '사용자 프로필 - 쯔동여지도'],
  ['app/home-frame/layout.tsx', '지도 프레임 - 쯔동여지도'],
] as const;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const absolutePath = join(dir, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return listSourceFiles(absolutePath);
    }

    if (!/\.(ts|tsx)$/.test(entry)) {
      return [];
    }

    return [relative(appRoot, absolutePath).replace(/\\/g, '/')];
  });
}

describe('browser title source contracts', () => {
  test('normalizes every approved static route title explicitly', () => {
    for (const [relativePath, expectedTitle] of staticTitleContracts) {
      expect(existsSync(join(appRoot, relativePath))).toBe(true);
      expect(source(relativePath)).toContain(expectedTitle);
    }
  });

  test('keeps route title policy explicit without a root metadata template', () => {
    const rootLayoutSource = source('app/layout.tsx');
    const seoSource = source('lib/seo.ts');

    expect(rootLayoutSource).not.toContain('title: {');
    expect(rootLayoutSource).not.toContain('template:');
    expect(seoSource).not.toContain('metadata.title.template');
    expect(seoSource).toContain("export const DEFAULT_TITLE = `${DEFAULT_BROWSER_TITLE_LABEL} - ${SITE_NAME}`");
  });

  test('wires dynamic titles through the shared hook and safe state labels', () => {
    const homeClientSource = source('app/home-client.tsx');
    const adminSource = source('components/admin/AdminConsoleOverview.tsx');
    const myPageSource = source('app/mypage/mypage-layout-content.tsx');

    expect(homeClientSource).toContain('state.isPanelOpen');
    expect(homeClientSource).toContain('state.panelRestaurant ?? state.selectedRestaurant');
    expect(homeClientSource).toContain('useDocumentTitle(visibleDetailTitle)');
    expect(homeClientSource).toContain('buildBrowserTitle(visibleDetailRestaurant.name)');

    expect(adminSource).toContain('getAdminConsoleMenu(activeModuleId).title');
    expect(adminSource).toContain('buildScopedBrowserTitle([');
    expect(adminSource).toContain('activeModuleLabel,');
    expect(adminSource).toContain('"관리자 콘솔"');
    expect(adminSource).not.toContain('? "대시보드 (KPI)"');
    expect(adminSource).not.toContain('searchParams.get("module") ??');
    expect(adminSource).not.toContain('작업 화면으로 전환됨');

    expect(myPageSource).toContain('resolveMobileRouteHeader(pathname)');
    expect(myPageSource).toContain('getMyPageBrowserTitleLabel(mobileRouteHeader)');
    expect(myPageSource).toContain('return header.href === "/mypage/profile" ? "마이페이지" : header.title;');
    expect(myPageSource).toContain('쯔동여지도 마이페이지');
  });

  test('centralizes real document.title assignments in the hook', () => {
    const files = ['app', 'components', 'hooks', 'lib'].flatMap((directory) =>
      listSourceFiles(join(appRoot, directory)),
    ).filter((relativePath) => {
      if (relativePath === 'hooks/use-document-title.ts') return false;
      if (relativePath.startsWith('tests-unit/browser-title')) return false;
      return true;
    });
    const offenders = files.filter((relativePath) => /document\.title\s*=/.test(source(relativePath)));

    expect(offenders).toEqual([]);
  });
});

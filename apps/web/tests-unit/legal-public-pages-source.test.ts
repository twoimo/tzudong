import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const exists = (relativePath: string) => existsSync(join(import.meta.dir, '..', relativePath));

describe('public legal and app-review readiness contracts', () => {
  test('privacy and data deletion pages are public route files with shared metadata and cross-links', () => {
    expect(exists('app/privacy/page.tsx')).toBe(true);
    expect(exists('app/data-deletion/page.tsx')).toBe(true);

    const privacyPage = source('app/privacy/page.tsx');
    const dataDeletionPage = source('app/data-deletion/page.tsx');
    const seoSource = source('lib/seo.ts');

    expect(privacyPage).toContain('PrivacyPolicyContent');
    expect(privacyPage).toContain('buildPublicMetadata');
    expect(privacyPage).toContain('siteConfig.legal.privacyPath');
    expect(privacyPage).toContain('siteConfig.legal.dataDeletionPath');

    expect(dataDeletionPage).toContain('계정 완전 삭제');
    expect(dataDeletionPage).toContain('supportMailto');
    expect(dataDeletionPage).toContain('siteConfig.legal.myPageProfilePath');
    expect(dataDeletionPage).toContain('작성한 리뷰와 제보 내역은 서비스 무결성을 위해 작성자를 탈퇴한 사용자로 익명화');

    expect(seoSource).toContain("path: '/privacy'");
    expect(seoSource).toContain("path: '/data-deletion'");
  });

  test('privacy policy content is shared between auth modal and public privacy page', () => {
    const authModal = source('components/auth/AuthModal.tsx');
    const privacyContent = source('components/legal/PrivacyPolicyContent.tsx');

    expect(authModal).toContain('import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";');
    expect(authModal).not.toContain('const PrivacyPolicyContent = memo');
    expect(privacyContent).toContain('export const PrivacyPolicyContent');
    expect(privacyContent).toContain('siteConfig.contact.email');
  });

  test('support and operator copy is centralized away from UI components', () => {
    const siteConfig = source('lib/site-config.ts');
    const uiFiles = [
      'components/layout/Header.tsx',
      'components/mypage/MyPageTopActions.tsx',
      'components/home/MobileControlOverlay.tsx',
      'components/home/HomeMapUserMenu.tsx',
    ];

    expect(siteConfig).toContain('NEXT_PUBLIC_SUPPORT_EMAIL');
    expect(siteConfig).toContain('NEXT_PUBLIC_OPERATOR_COMPANY_NAME');
    expect(siteConfig).toContain('NEXT_PUBLIC_OPERATOR_BUSINESS_REGISTRATION_NUMBER');

    for (const file of uiFiles) {
      const uiSource = source(file);
      expect(uiSource).toContain('siteConfig');
      expect(uiSource).not.toContain('cs@tzudong.app');
      expect(uiSource).not.toContain('v2.0.0 © 타이니번');
      expect(uiSource).not.toContain('601-09-04613');
    }
  });
});

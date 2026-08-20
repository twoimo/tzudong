import type { Metadata } from 'next';
import Link from 'next/link';

import { PrivacyPolicyContent } from '@/components/legal/PrivacyPolicyContent';
import { buildPublicMetadata } from '@/lib/seo';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = buildPublicMetadata({
  title: '개인정보 처리방침 - 쯔동여지도',
  description: '쯔동여지도 서비스의 개인정보 수집, 이용, 보관, 파기 및 이용자 권리 행사 방법을 안내합니다.',
  path: siteConfig.legal.privacyPath,
  keywords: ['쯔동여지도 개인정보 처리방침', '개인정보 보호', '데이터 삭제'],
});

export default function PrivacyPage() {
  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-muted/30 px-4 py-10 text-foreground" data-legal-page="true">
      <article className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-8">
        <header className="mb-6 border-b pb-5">
          <p className="text-sm font-medium text-primary">{siteConfig.name}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">개인정보 처리방침</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            앱 심사와 사용자가 모두 확인할 수 있도록 공개 URL에서 제공하는 개인정보 처리방침입니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Link className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-muted" href={siteConfig.legal.dataDeletionPath}>
              데이터 삭제 요청 안내
            </Link>
            <a className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-muted" href={`mailto:${siteConfig.contact.email}`}>
              문의하기
            </a>
          </div>
        </header>
        <PrivacyPolicyContent />
      </article>
    </main>
  );
}

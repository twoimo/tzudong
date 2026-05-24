import type { Metadata } from 'next';
import Link from 'next/link';

import { buildPublicMetadata } from '@/lib/seo';
import { siteConfig, supportMailto } from '@/lib/site-config';

export const metadata: Metadata = buildPublicMetadata({
  title: '데이터 삭제 요청 | 쯔동여지도',
  description: '쯔동여지도 계정과 개인정보 삭제 방법, 앱 내 삭제 경로, 이메일 요청 절차를 안내합니다.',
  path: siteConfig.legal.dataDeletionPath,
  keywords: ['쯔동여지도 데이터 삭제', '계정 삭제', '개인정보 삭제 요청'],
});

const deletionSteps = [
  '쯔동여지도에 로그인합니다.',
  '마이페이지 > 프로필/계정 관리로 이동합니다.',
  '위험 구역에서 계정 완전 삭제를 선택합니다.',
  '계정 이메일을 다시 입력해 본인 확인을 완료합니다.',
] as const;

const deletedData = [
  '이메일, 비밀번호 인증 정보, 닉네임 등 계정 개인정보',
  '북마크, 알림, 사용자 통계, 권한 정보 등 계정에 연결된 부가 데이터',
  '업로드 이미지 등 계정 식별과 연결된 부가 정보',
] as const;

const retainedData = [
  '작성한 리뷰와 제보 내역은 서비스 무결성을 위해 작성자를 탈퇴한 사용자로 익명화하여 보관될 수 있습니다.',
  '법령상 보관 의무가 있는 접속 기록 등은 정해진 기간 동안 분리 보관 후 파기합니다.',
] as const;

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10 text-foreground">
      <article className="mx-auto w-full max-w-3xl rounded-2xl border bg-background p-5 shadow-sm sm:p-8">
        <header className="mb-8 border-b pb-6">
          <p className="text-sm font-medium text-primary">{siteConfig.name}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">데이터 삭제 요청 안내</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            계정 삭제와 개인정보 삭제 요청 방법을 앱 제출 심사자와 사용자 모두 확인할 수 있도록 공개합니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Link className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-muted" href={siteConfig.legal.privacyPath}>
              개인정보 처리방침
            </Link>
            <a className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-muted" href={supportMailto('쯔동여지도 데이터 삭제 요청')}>
              이메일로 삭제 요청
            </a>
          </div>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">앱/웹에서 직접 삭제하는 방법</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            {deletionSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="rounded-xl bg-muted/50 p-4 text-sm leading-6 text-muted-foreground">
            바로 이동: 로그인 후{' '}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" href={siteConfig.legal.myPageProfilePath}>
              마이페이지 프로필/계정 관리
            </Link>
            에서 계정 완전 삭제를 진행할 수 있습니다.
          </div>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">이메일로 삭제를 요청하는 방법</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            로그인이 어렵거나 직접 삭제가 불가능한 경우 {siteConfig.contact.email}로 요청해 주세요. 본인 확인을 위해 가입 이메일 주소와 요청 내용을 함께 보내야 하며, 확인 후 지체 없이 처리합니다.
          </p>
          <a className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" href={supportMailto('쯔동여지도 데이터 삭제 요청')}>
            {siteConfig.contact.email}로 요청하기
          </a>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border p-4">
            <h2 className="text-base font-semibold">삭제되는 데이터</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              {deletedData.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border p-4">
            <h2 className="text-base font-semibold">익명화 또는 보관될 수 있는 데이터</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              {retainedData.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="mt-8 rounded-xl bg-muted/40 p-4 text-xs leading-5 text-muted-foreground">
          <p>최종 확인일: 2026년 5월 24일</p>
          <p className="mt-1">문의처: {siteConfig.contact.email}</p>
        </footer>
      </article>
    </main>
  );
}

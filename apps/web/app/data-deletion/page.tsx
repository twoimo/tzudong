import type { Metadata } from 'next';
import Link from 'next/link';

import { buildPublicMetadata } from '@/lib/seo';
import { siteConfig, supportMailto } from '@/lib/site-config';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_PUBLICATION,
} from '@/lib/privacy/policy';

export const metadata: Metadata = buildPublicMetadata({
  title: '데이터 삭제 요청 - 쯔동여지도',
  description: '쯔동여지도 계정 삭제의 미리보기, 확인, 적용, 읽기검증과 지원 요청 경계를 안내합니다.',
  path: siteConfig.legal.dataDeletionPath,
  keywords: ['쯔동여지도 데이터 삭제', '계정 삭제', '개인정보 삭제 요청'],
});

const deletionSteps = [
  '쯔동여지도에 로그인한 뒤 마이페이지의 프로필/계정 관리로 이동합니다.',
  '계정 삭제 미리보기를 요청해 삭제·익명화·분리·보존으로 분류된 항목별 개수와 적용 조건을 확인합니다.',
  '최근 로그인 확인 뒤 정확한 확인 문구를 입력하여 미리보기 해시와 연결된 삭제 요청을 확정합니다.',
  '적용 결과에서 데이터베이스, 저장소, 세션, Auth 읽기검증이 모두 통과한 applied 영수증만 완료로 확인합니다.',
] as const;

const itemizedOutcomes = [
  {
    title: '삭제',
    detail: '계정·세션, 프로필 부가 정보, 북마크·알림 등 실제 미리보기에서 삭제 대상으로 확인된 항목입니다. 저장소 객체는 별도 목록과 읽기검증을 거칩니다.',
  },
  {
    title: '익명화',
    detail: '리뷰·제보 등 서비스 무결성 검토가 필요한 콘텐츠는 승인된 기준이 있을 때 작성자 연결을 제거하거나 대체 표시할 수 있습니다. 미리보기와 영수증의 항목별 결과를 확인해야 합니다.',
  },
  {
    title: '분리·보존',
    detail: '승인된 보존 근거 또는 활성 보류가 있는 항목은 활성 서비스 경로와 분리하고 접근을 제한해야 합니다. 근거·기산점·기간은 운영자 승인 전 이 페이지에서 확정하지 않습니다.',
  },
  {
    title: '보류·부분·실패',
    detail: '읽기검증 실패, 제공자·백업 경계 또는 승인되지 않은 보존 기준이 있으면 완료로 표시하지 않습니다. 상태와 사유 코드를 확인한 뒤 재시도 또는 지원 경로를 이용합니다.',
  },
] as const;

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-muted/30 px-4 py-10 text-foreground" data-legal-page="true">
      <article className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-8">
        <header className="mb-8 border-b pb-6">
          <p className="text-sm font-medium text-primary">{siteConfig.name}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">데이터 삭제 요청 안내</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            계정 삭제 요청은 미리보기 → 확인 → 적용 → 독립 읽기검증 → 영수증 순서로 처리합니다. 이 안내는 모든 시스템 또는 제공자 백업에서의 삭제 완료를 단정하지 않습니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Link className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-muted" href={siteConfig.legal.privacyPath}>
              개인정보 처리방침
            </Link>
            <a className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-muted" href={supportMailto('쯔동여지도 데이터 삭제 요청')}>
              지원 요청 보내기
            </a>
          </div>
        </header>

        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <p className="font-semibold">처리방침 버전 연결</p>
          <p className="mt-1">버전: {PRIVACY_POLICY_PUBLICATION.version}</p>
          <p className="min-w-0 break-all font-mono text-xs">내용 SHA-256: {PRIVACY_POLICY_CONTENT_SHA256}</p>
          <p className="mt-1">공개 효력 발생일과 게시 시각은 개인정보 처리방침 화면에서 일치하는 배포 읽기검증이 확인될 때만 표시합니다.</p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">앱/웹에서 계정 완전 삭제를 요청하는 방법</h2>
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
            에서 계정 삭제 미리보기를 시작할 수 있습니다.
          </div>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">삭제 결과를 읽는 방법</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {itemizedOutcomes.map((outcome) => (
              <div className="rounded-2xl border p-4" key={outcome.title}>
                <h3 className="text-base font-semibold">{outcome.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{outcome.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            applied 영수증이 없는 보류·partial·failed 결과는 삭제 완료가 아닙니다. 지원 담당자는 삭제된 원문, 이미지, 인증 정보 또는 정확한 위치를 영수증·감사기록에 다시 넣지 않아야 합니다.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">로그인할 수 없을 때의 지원 요청</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {siteConfig.contact.email}로 삭제 요청 사실만 알려 주세요. 이메일 본문에 비밀번호, 인증 토큰, 주민등록번호, 이미지 원본, 원시 OCR 결과, 정확한 위치 또는 그 밖의 개인정보를 붙이지 마세요. 지원 담당자가 최소 정보 확인이 가능한 안전한 후속 절차를 안내하며, 확인 전에는 요청을 완료로 처리하지 않습니다.
          </p>
          <a className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" href={supportMailto('쯔동여지도 데이터 삭제 요청')}>
            {siteConfig.contact.email}로 지원 요청하기
          </a>
        </section>

        <footer className="mt-8 rounded-xl bg-muted/40 p-4 text-xs leading-5 text-muted-foreground">
          <p>처리방침 연결 버전: {PRIVACY_POLICY_PUBLICATION.version}</p>
          <p className="mt-1 min-w-0 break-all font-mono">내용 SHA-256: {PRIVACY_POLICY_CONTENT_SHA256}</p>
          <p className="mt-1">문의처: {siteConfig.contact.email}</p>
        </footer>
      </article>
    </main>
  );
}

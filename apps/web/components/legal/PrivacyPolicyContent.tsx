import { memo } from 'react';

import { siteConfig } from '@/lib/site-config';
import {
  OFFICIAL_PRIVACY_AUTHORITY_LINKS,
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_PUBLICATION,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_TITLE,
  privacyPolicyPublicationLabel,
} from '@/lib/privacy/policy';
import { PROCESSING_INVENTORY } from '@/lib/privacy/processing-inventory';

export const PrivacyPolicyContent = memo(() => (
  <div
    className="space-y-6 text-sm"
    data-policy-content-sha256={PRIVACY_POLICY_CONTENT_SHA256}
    data-policy-version={PRIVACY_POLICY_PUBLICATION.version}
  >
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="font-semibold">{PRIVACY_POLICY_TITLE}</p>
      <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <dt className="font-medium">버전</dt>
        <dd>{PRIVACY_POLICY_PUBLICATION.version}</dd>
        <dt className="font-medium">내용 SHA-256</dt>
        <dd className="break-all font-mono">{PRIVACY_POLICY_CONTENT_SHA256}</dd>
        <dt className="font-medium">공개 효력 발생일</dt>
        <dd>{PRIVACY_POLICY_PUBLICATION.effectiveAt ?? '미정'}</dd>
        <dt className="font-medium">게시 시각</dt>
        <dd>{PRIVACY_POLICY_PUBLICATION.publishedAt ?? '미정'}</dd>
        <dt className="font-medium">게시 상태</dt>
        <dd>{privacyPolicyPublicationLabel()}</dd>
      </dl>
    </section>

    {PRIVACY_POLICY_SECTIONS.map((section) => (
      <section key={section.id} aria-labelledby={`privacy-${section.id}`}>
        <h3 className="mb-2 text-base font-semibold" id={`privacy-${section.id}`}>
          {section.title}
        </h3>
        <div className="space-y-2 text-muted-foreground">
          {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        {'bullets' in section && section.bullets ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {section.bullets.map((bullet: string) => <li key={bullet}>{bullet}</li>)}
          </ul>
        ) : null}

        {section.id === 'processing-scope' ? (
          <div className="mt-3 overflow-x-auto rounded-md border">
            <table className="w-full min-w-[880px] text-left text-xs text-muted-foreground">
              <thead className="bg-muted text-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">데이터 종류</th>
                  <th className="px-3 py-2 font-medium">목적·출처</th>
                  <th className="px-3 py-2 font-medium">저장·전달 위치</th>
                  <th className="px-3 py-2 font-medium">보존·삭제</th>
                  <th className="px-3 py-2 font-medium">운영 상태</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {PROCESSING_INVENTORY.map((item) => (
                  <tr key={item.dataClass} className="align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium text-foreground">{item.label}</p>
                      <p className="mt-1">{item.fields.join(', ')}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p>{item.purpose}</p>
                      <p className="mt-1">출처: {item.source}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p>{item.sink.join(', ')}</p>
                      <p className="mt-1">경계: {item.providerBoundary}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p>보존: {item.retention}</p>
                      <p className="mt-1">삭제: {item.deletion}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p>{item.operatorState}</p>
                      {'externalPrerequisite' in item && item.externalPrerequisite ? (
                        <p className="mt-1">{item.externalPrerequisite}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {section.id === 'rights-contact' ? (
          <div className="mt-3 rounded-md bg-muted p-3 text-muted-foreground">
            <p>문의처: {siteConfig.contact.email}</p>
          </div>
        ) : null}

        {section.id === 'changes' ? (
          <div className="mt-3 rounded-md border p-3 text-muted-foreground">
            <p>이전 공개본: {PRIVACY_POLICY_PUBLICATION.previousVersion ?? '배포된 정책 버전 읽기검증 전 확인 불가'}</p>
            <p className="mt-1">변경 요약: {PRIVACY_POLICY_PUBLICATION.changeSummary}</p>
          </div>
        ) : null}
      </section>
    ))}

    <section aria-labelledby="privacy-authorities">
      <h3 className="mb-2 text-base font-semibold" id="privacy-authorities">10. 공식 확인 경로</h3>
      <p className="text-muted-foreground">
        아래 링크는 공식 정보 확인 경로입니다. 이 검토본이 법령 해석이나 실제 운영 상태를 대신하지 않습니다.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        {OFFICIAL_PRIVACY_AUTHORITY_LINKS.map((link) => (
          <li key={link.href}>
            <a className="underline underline-offset-4" href={link.href} rel="noreferrer" target="_blank">
              {link.label}
            </a>
            <span>: {link.description}</span>
          </li>
        ))}
      </ul>
    </section>
  </div>
));

PrivacyPolicyContent.displayName = 'PrivacyPolicyContent';

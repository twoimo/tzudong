'use client';

import { useSyncExternalStore } from 'react';

import { siteConfig, supportMailto } from '@/lib/site-config';

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function HydratedContactEmail() {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  // Cloudflare rewrites email text in the HTML document, including addresses
  // serialized as Server Component props. Read the public contact value only
  // after hydration so the document and the first client render stay equal.
  return (
    <span
      className="inline-block min-w-[18ch] break-all"
      aria-busy={!hydrated}
      aria-live="polite"
      data-hydrated-contact-email="true"
    >
      {hydrated ? siteConfig.contact.email : '이메일 표시 중'}
    </span>
  );
}

const supportLabels = {
  request: { pending: '지원 요청 준비 중', ready: (_email: string) => '지원 요청 보내기' },
  address: { pending: '지원 요청 준비 중', ready: (email: string) => `${email}로 지원 요청하기` },
  contact: { pending: '문의 준비 중', ready: (_email: string) => '문의하기' },
} as const;

export function HydratedSupportLink({
  subject,
  className,
  label,
}: {
  subject: string;
  className: string;
  label: keyof typeof supportLabels;
}) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const copy = supportLabels[label];

  if (!hydrated) {
    return (
      <span className={className} aria-busy="true" data-hydrated-support-link="true">
        {copy.pending}
      </span>
    );
  }

  return (
    <a className={className} href={supportMailto(subject)} data-hydrated-support-link="true">
      {copy.ready(siteConfig.contact.email)}
    </a>
  );
}

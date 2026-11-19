import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { HydratedContactEmail, HydratedSupportLink } from '../components/legal/HydratedContactEmail';
import DataDeletionPage from '../app/data-deletion/page';
import PrivacyPage from '../app/privacy/page';
import { siteConfig } from '../lib/site-config';

describe('contact text hydration across HTML email rewriting', () => {
  test('keeps SSR readable while leaving no visible address for an edge HTML rewrite', () => {
    const html = renderToString(<HydratedContactEmail />);

    expect(html).toContain('이메일 표시 중');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(siteConfig.contact.email);
    expect(html).not.toContain('@');
    expect(html).not.toContain('<a');
  });

  test('does not accept the address as a prop a server component can serialize', () => {
    const source = readFileSync(new URL('../components/legal/HydratedContactEmail.tsx', import.meta.url), 'utf8');
    expect(source).toContain('export function HydratedContactEmail()');
    expect(source).toContain('siteConfig.contact.email');
    expect(source).not.toContain('HydratedContactEmail({ email }');
  });

  test('keeps a support link free of the address until hydration', () => {
    const html = renderToString(createElement(HydratedSupportLink, {
      subject: '삭제 요청',
      className: 'support',
      label: 'address',
    }));

    expect(html).toContain('지원 요청 준비 중');
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('@');
  });

  test('legal pages leave no address in the server document', () => {
    const html = `${renderToString(createElement(PrivacyPage))}${renderToString(createElement(DataDeletionPage))}`;

    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('@');
    expect(html).toContain('data-hydrated-support-link="true"');
    expect(html).toContain('data-hydrated-contact-email="true"');
  });
});

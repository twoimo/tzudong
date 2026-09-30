import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';

import { HydratedContactEmail } from '../components/legal/HydratedContactEmail';

describe('contact text hydration across HTML email rewriting', () => {
  test('keeps SSR readable while leaving no visible address for an edge HTML rewrite', () => {
    const email = 'contact@example.test';
    const html = renderToString(<HydratedContactEmail email={email} />);

    expect(html).toContain('이메일 표시 중');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(email);
    expect(html).not.toContain('<a');
  });

  test('has the same initial server markup for different configured contact values', () => {
    // A provider can rewrite visible addresses in HTML but not a stable status
    // label. Client hydration must therefore begin with this same markup.
    const first = renderToString(<HydratedContactEmail email="first@example.test" />);
    const second = renderToString(<HydratedContactEmail email="second@example.test" />);
    expect(first).toBe(second);
  });
});

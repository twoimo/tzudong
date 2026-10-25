import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect as ui } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const reviewed = JSON.parse(readFileSync(resolve(appRoot, '../../docs/evidence/marker-evidence-live-20261021-v1/reviewed-frames.json'), 'utf8'));
const frame = reviewed.frames[0].frame;

async function bundle() {
  const entry = `import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { RestaurantEvidenceCarousel } from './components/restaurant/RestaurantEvidenceCarousel';
    const frame = ${JSON.stringify(frame)};
    function App() { const [path, setPath] = useState('valid.webp');
      return <><button onClick={() => setPath('missing.webp')}>실패 재현</button>
        <button onClick={() => setPath('restored.webp')}>새 이미지</button>
        <RestaurantEvidenceCarousel frames={[[{ ...frame, image_url: 'https://frame-failure.test/' + path }]]} /></>; }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<App />);`;
  const built = await Bun.build({ entrypoints: ['frame-failure-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'frame-failure', setup(builder) {
      builder.onResolve({ filter: /^frame-failure-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), appRoot) }));
    }}] });
  expect(built.success).toBe(true); return built.outputs[0].text();
}

(existsSync(chrome) ? test : test.skip)('context-only frames keep an honest heading and original video link after image failure, and recover for a new source', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    const bytes = readFileSync(resolve(appRoot, 'public/evidence-frames', frame.storage_object_key));
    for (const width of [390, 820, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      try {
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
          const url = route.request().url();
          if (url.endsWith('valid.webp') || url.endsWith('restored.webp')) return route.fulfill({ contentType: 'image/webp', body: bytes });
          if (url.endsWith('missing.webp')) return route.fulfill({ status: 404, body: '' });
          if (url === 'https://frame-failure.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          return route.abort();
        });
        await page.goto('https://frame-failure.test/'); await page.addScriptTag({ content: script });
        await ui(page.locator('summary')).toHaveText('영상 속 장면1장');
        await ui(page.locator('section img')).not.toBeVisible();
        await page.locator('summary').press('Enter');
        await ui(page.locator('section')).toContainText('현장 장면은 영상의 맥락');
        await ui(page.locator('section img')).toBeVisible();
        await ui.poll(() => page.locator('section img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(640);
        await page.getByRole('button', { name: '실패 재현' }).click();
        await ui(page.getByRole('status')).toContainText('원본 영상에서 확인');
        await ui(page.locator('section img')).toHaveCount(0);
        await ui(page.locator('section a')).toHaveAttribute('href', frame.youtube_seek_url);
        await page.getByRole('button', { name: '새 이미지' }).click();
        await ui(page.locator('section img')).toHaveAttribute('src', 'https://frame-failure.test/restored.webp');
        await ui.poll(() => page.locator('section img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(640);
        await ui(page.getByRole('status')).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}, 60000);

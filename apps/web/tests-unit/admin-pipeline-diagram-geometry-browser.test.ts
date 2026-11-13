import { expect, test } from 'bun:test';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { join } from 'node:path';

const appRoot = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const verticalLayoutMinHeight = 2 * 24 + 7 * 64 + 6 * 24;

async function bundleDiagram() {
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { PipelineFlowDiagram } from './components/admin/pipeline/PipelineFlowDiagram';
    import styles from './components/admin/pipeline/PipelineFlowDiagram.module.css';
    const stages = [
      ['collect', '수집', 'completed'], ['media', '미디어', 'completed'],
      ['transcript', '자막', 'completed'], ['extract', '추출', 'completed'],
      ['select', '선별', 'completed'], ['evaluate', '평가', 'failed'],
      ['persist', '저장', 'unknown'], ['review', '검수', 'manual'],
    ].map(([id, label, state]) => ({ id, label, state, durationSeconds: 2 }));
    function Fixture() {
      const [selected, setSelected] = useState('collect');
      return <main className={styles.workspace} style={{ width: '100vw', height: '100vh' }}>
        <section className={styles.canvas}>
          <PipelineFlowDiagram stages={stages} selected={selected} onSelect={setSelected} />
        </section>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  `;
  const built = await Bun.build({
    entrypoints: ['pipeline-diagram-geometry-fixture'],
    target: 'browser',
    format: 'iife',
    write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{
      name: 'pipeline-diagram-geometry-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^pipeline-diagram-geometry-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
        builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      },
    }],
  });
  expect(built.success).toBe(true);
  const scriptOutput = built.outputs.find(output => output.path.endsWith('.js'));
  const cssOutput = built.outputs.find(output => output.path.endsWith('.css'));
  return {
    script: scriptOutput ? await scriptOutput.text() : '',
    css: cssOutput ? await cssOutput.text() : '',
  };
}

async function renderedGeometry(page: Page) {
  return page.locator('[data-pipeline-flow-diagram]').evaluate((host) => {
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('PIPELINE_DIAGRAM_SVG_MISSING');
    const nodes = [...host.querySelectorAll<SVGGElement>('[data-pipeline-stage]')].map((node) => {
      const rect = node.querySelector('rect')?.getBoundingClientRect();
      if (!rect) throw new Error('PIPELINE_STAGE_RECT_MISSING');
      return {
        id: node.dataset.pipelineStage,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        rx: node.querySelector('rect')?.getAttribute('rx'),
      };
    });
    return {
      direction: host.getAttribute('data-flow-direction'),
      canvasHeight: host.parentElement?.getBoundingClientRect().height ?? 0,
      svgHeight: svg.getBoundingClientRect().height,
      nodes,
    };
  });
}

test('pipeline diagram renders without overlapping nodes at 390, 834, and 1423px', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const built = await bundleDiagram();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
    await page.route('**/*', route => route.request().url() === 'https://pipeline-diagram.test/'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:auto} body{--border:0 0% 75%;--muted:0 0% 92%;--muted-foreground:0 0% 40%;--background:0 0% 100%;--foreground:0 0% 12%;--primary:210 80% 40%;--destructive:0 70% 45%}</style></head><body><div id="root"></div></body></html>' })
      : route.abort());
    await page.goto('https://pipeline-diagram.test/');
    if (built.css) await page.addStyleTag({ content: built.css });
    await page.addScriptTag({ content: built.script });
    await playwrightExpect(page.locator('[data-pipeline-flow-diagram]')).toBeVisible();
    await playwrightExpect(page.locator('[data-pipeline-stage]')).toHaveCount(8);

    for (const width of [390, 834, 1423]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      await page.waitForFunction(() => {
        const host = document.querySelector('[data-pipeline-flow-diagram]');
        const svg = host?.querySelector('svg');
        if (!host || !svg) return false;
        const box = host.getBoundingClientRect();
        const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number);
        return box.height >= 280 && viewBox?.[2] === Math.floor(box.width) && viewBox?.[3] === Math.floor(box.height);
      });
      const geometry = await renderedGeometry(page);
      const expectedDirection = width < 1050 ? 'vertical' : 'horizontal';
      console.log('PIPELINE_GEOMETRY', JSON.stringify({ width, direction: geometry.direction, canvasHeight: geometry.canvasHeight, nodes: geometry.nodes.map(({ id, left, top, width: nodeWidth, height: nodeHeight }) => ({ id, x: Math.round(left), y: Math.round(top), width: Math.round(nodeWidth), height: Math.round(nodeHeight) })) }));
      expect(geometry.direction).toBe(expectedDirection);
      expect(geometry.nodes).toHaveLength(8);
      for (const node of geometry.nodes) {
        expect(node.rx).toBe('0');
        expect(node.width).toBeGreaterThan(0);
        expect(node.height).toBeGreaterThanOrEqual(63);
      }
      if (expectedDirection === 'vertical') {
        expect(geometry.canvasHeight).toBeGreaterThanOrEqual(verticalLayoutMinHeight);
        expect(geometry.svgHeight).toBeGreaterThanOrEqual(verticalLayoutMinHeight);
      }
      for (let first = 0; first < geometry.nodes.length; first += 1) {
        for (let second = first + 1; second < geometry.nodes.length; second += 1) {
          const a = geometry.nodes[first];
          const b = geometry.nodes[second];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          expect(overlapX > 1 && overlapY > 1, `${a.id} overlaps ${b.id} at ${width}px`).toBe(false);
        }
      }
    }

    const collect = page.locator('[data-pipeline-stage="collect"]');
    await collect.focus();
    await page.keyboard.press('ArrowDown');
    await playwrightExpect(page.locator('[data-pipeline-stage="media"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await playwrightExpect(page.locator('[data-pipeline-stage="media"]')).toHaveAttribute('aria-pressed', 'true');
    await playwrightExpect(collect).toHaveAttribute('aria-pressed', 'false');
    expect(pageErrors).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
  }
}, 60_000);

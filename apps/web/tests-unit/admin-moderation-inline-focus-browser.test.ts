import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = chromium.executablePath();

function functionSource(source: string, name: string): string {
  const tree = ts.createSourceFile('SubmissionListView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!found) throw new Error(`FOCUS_HELPER_MISSING:${name}`);
  return found.getText(tree);
}

async function bundle(): Promise<string> {
  const source = readFileSync(join(appRoot, 'components/admin/SubmissionListView.tsx'), 'utf8');
  const helper = functionSource(source, 'shouldRestoreModerationRowFocus');
  const script = `
    import React, { useLayoutEffect, useRef, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    ${helper}

    function Fixture() {
      const [open, setOpen] = useState(false);
      const [rowState, setRowState] = useState('present');
      const rowRef = useRef(null);
      const inspectorRef = useRef(null);

      useLayoutEffect(() => {
        if (open) inspectorRef.current?.focus();
      }, [open]);

      function restoreRowTriggerFocus() {
        if (shouldRestoreModerationRowFocus(document.activeElement)
          && rowRef.current?.isConnected && !rowRef.current.disabled) {
          rowRef.current?.focus();
        }
      }

      function close(kind) {
        if (kind === 'remove') setRowState('removed');
        if (kind === 'disable') setRowState('disabled');
        window.requestAnimationFrame(() => {
          restoreRowTriggerFocus();
          setOpen(false);
        });
        if (kind === 'preserve-search') queueMicrotask(() => document.getElementById('search')?.focus());
      }

      return <main>
        <input id="search" aria-label="리뷰 검색" />
        <button id="reset-row" onClick={() => setRowState('present')}>행 복원</button>
        {rowState !== 'removed' && <button id="row" ref={rowRef} disabled={rowState === 'disabled'} onClick={() => setOpen(true)}>리뷰 행</button>}
        {open && <section ref={inspectorRef} tabIndex={-1} data-admin-moderation-inspector="true">
          <button id="close-normal" onClick={() => close('normal')}>닫기</button>
          <button id="close-preserve" onClick={() => close('preserve-search')}>검색 보존 닫기</button>
          <button id="close-remove" onClick={() => close('remove')}>행 제거 닫기</button>
          <button id="close-disable" onClick={() => close('disable')}>행 비활성 닫기</button>
        </section>}
      </main>;
    }

    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;
  const built = await Bun.build({
    entrypoints: ['inline-focus-fixture'],
    target: 'browser',
    format: 'iife',
    write: false,
    plugins: [{
      name: 'inline-focus-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^inline-focus-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: script, loader: 'tsx', resolveDir: appRoot }));
      },
    }],
  });
  expect(built.success).toBe(true);
  return built.outputs[0].text();
}

async function settleFrames(page: import('@playwright/test').Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

(existsSync(chrome) ? test : test.skip)('inline moderation teardown restores only unclaimed connected row focus', async () => {
  const script = await bundle();
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let externalRequests = 0;
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://inline-focus.test/') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      }
      externalRequests += 1;
      return route.abort();
    });
    await page.goto('https://inline-focus.test/');
    await page.addScriptTag({ content: script });

    const row = page.locator('#row');
    await row.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-admin-moderation-inspector="true"]');
    expect(await page.locator('[data-admin-moderation-inspector="true"]').evaluate(element => element === document.activeElement)).toBe(true);
    await page.locator('#close-normal').click();
    await settleFrames(page);
    expect(await row.evaluate(element => element === document.activeElement)).toBe(true);

    await page.keyboard.press('Space');
    await page.locator('#close-preserve').click();
    await settleFrames(page);
    expect(await page.locator('#search').evaluate(element => element === document.activeElement)).toBe(true);

    await row.focus();
    await page.keyboard.press('Enter');
    await page.locator('#close-remove').click();
    await settleFrames(page);
    expect(await page.locator('#row').count()).toBe(0);
    expect(await page.locator('#search').evaluate(element => element === document.activeElement)).toBe(false);

    await page.locator('#reset-row').click();
    await row.focus();
    await page.keyboard.press('Enter');
    await page.locator('#close-disable').click();
    await settleFrames(page);
    expect(await page.locator('#row').evaluate(element => element === document.activeElement)).toBe(false);

    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
  }
}, 30_000);

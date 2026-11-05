import { chromium } from 'playwright';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const tasteRoot = resolve(homedir(), '.codex/skills/taste-skill');
const { probe } = await import(pathToFileURL(resolve(tasteRoot, 'scripts/lib/probe.mjs')));
const { judge } = await import(pathToFileURL(resolve(tasteRoot, 'scripts/lib/rules.mjs')));

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('AUDIT_PHASE_REQUIRED');
const origin = 'http://127.0.0.1:18822';
const allModules = ['overview', 'restaurants', 'submissions', 'reviews', 'users', 'banners', 'insights', 'pipeline', 'knowledge-graph', 'sentry', 'youtube-thumbnail-generator', 'storyboard', 'routes', 'llm', 'audit'];
const modules = process.env.AUDIT_MODULES?.split(',') ?? allModules;
if (!modules.length || modules.some(module => !allModules.includes(module)) || new Set(modules).size !== modules.length) throw new Error('AUDIT_MODULES_INVALID');
const theme = process.env.AUDIT_THEME ?? 'light';
if (!['light', 'dark'].includes(theme)) throw new Error('AUDIT_THEME_INVALID');
const titles = { overview: '대시보드 (KPI)', restaurants: '맛집 관리', submissions: '제보 관리', reviews: '리뷰 관리', users: '사용자 관리', banners: '배너 관리', insights: '영상 성과 분석', pipeline: '크롤러 파이프라인', 'knowledge-graph': '지식 그래프', sentry: '오류 모니터링', 'youtube-thumbnail-generator': '유튜브 썸네일 생성', storyboard: '스토리보드 생성', routes: '맛집 동선 추천', llm: '운영 보조', audit: '감사 로그' };
const widths = process.env.AUDIT_WIDTHS?.split(',').map(Number) ?? [1440, 834, 390];
const variant = process.env.AUDIT_VARIANT ?? '';
if (!/^[a-z0-9-]*$/.test(variant)) throw new Error('AUDIT_VARIANT_INVALID');
const output = resolve(import.meta.dirname, `${phase}${variant ? `-${variant}` : ''}`);
await mkdir(output, { recursive: true });
const webRoot = resolve(import.meta.dirname, '../..');
async function sourceManifest() {
  const result = {};
  async function walk(directory) {
    for (const entry of await readdir(resolve(webRoot, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|css|json)$/.test(entry.name)) {
        result[path] = createHash('sha256').update(await readFile(resolve(webRoot, path))).digest('hex');
      }
    }
  }
  for (const directory of ['app', 'components', 'hooks', 'integrations', 'lib', 'styles', 'types']) await walk(directory);
  for (const path of ['next.config.mjs', 'package.json', 'package-lock.json']) {
    result[path] = createHash('sha256').update(await readFile(resolve(webRoot, path))).digest('hex');
  }
  return result;
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { schemaVersion: 2, phase, theme, startedAt: new Date().toISOString(), environment: `${process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`} / Playwright 1.63 / Chrome; synthetic loopback fixture; no hosted API or provider calls`, cases: [], source: await sourceManifest() };
if (process.env.AUDIT_BUILD_RECEIPT) {
  const file = process.env.AUDIT_BUILD_RECEIPT;
  if (!/^build-report(?:-[a-z0-9-]+)?\.json$/.test(file)) throw new Error('AUDIT_BUILD_RECEIPT_INVALID');
  const bytes = await readFile(resolve(import.meta.dirname, file));
  const build = JSON.parse(bytes);
  if (build.exitCode !== 0 || build.sourceDrift.length || build.cleanupFailures.length) throw new Error('AUDIT_BUILD_NOT_ADMITTED');
  report.buildReceipt = { file, sha256: createHash('sha256').update(bytes).digest('hex'), sourceInputs: Object.keys(build.source).length, runtime: 'local production bundle' };
}
report.tasteSkill = { repository: 'Leonxlnx/taste-skill', commit: 'f624f37a8c650b9cc550253104925efe4c8de246', files: {} };
for (const file of ['SKILL.md', 'scripts/lib/probe.mjs', 'scripts/lib/rules.mjs']) {
  report.tasteSkill.files[file] = createHash('sha256').update(await readFile(resolve(tasteRoot, file))).digest('hex');
}
for (const file of ['styles/admin-ui.css', 'components/admin/AdminPageHeader.tsx', 'components/admin/AdminConsoleOverview.tsx']) {
  const bytes = await readFile(resolve(import.meta.dirname, '../..', file));
  report.source[file] = createHash('sha256').update(bytes).digest('hex');
}
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width < 640 ? 844 : 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript((selectedTheme) => {
      localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1');
      localStorage.setItem('tzudong-admin-theme', selectedTheme);
      localStorage.setItem('tzudong-admin-sidebar-collapsed', 'false');
    }, theme);
    const page = await context.newPage();
    let pageErrors = 0;
    let blockedExternal = 0;
    let blockedMutation = 0;
    let consoleErrors = 0;
    let requestFailures = 0;
    page.on('pageerror', () => { pageErrors += 1; });
    page.on('console', message => { if (message.type() === 'error') consoleErrors += 1; });
    page.on('requestfailed', () => { requestFailures += 1; });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && !['GET', 'HEAD'].includes(route.request().method())) { blockedMutation += 1; return route.abort(); }
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
        blockedExternal += 1;
        return route.abort();
      }
      if (process.env.AUDIT_LOOPBACK_CSP === '1' && route.request().resourceType() === 'document') {
        const response = await route.fetch();
        const headers = response.headers();
        const original = headers['content-security-policy'];
        if (!original || !/connect-src [^;]+/.test(original)) throw new Error('FIXTURE_CSP_CONTRACT_MISSING');
        headers['content-security-policy'] = original.replace(/connect-src [^;]+/, value => `${value} http://127.0.0.1:18821`);
        (report.syntheticTransportCspExceptions ??= []).push({ origin: 'http://127.0.0.1:18821', originalSha256: createHash('sha256').update(original).digest('hex'), scope: 'owned browser response only; all other directives retained; production source unchanged; CSP/security success is not claimed' });
        return route.fulfill({ response, headers });
      }
      return route.continue();
    });
    if (process.env.AUDIT_SYNTHETIC_AUTH === '1') {
      const { installSyntheticSession } = await import('./session-fixture.mjs');
      const network = await installSyntheticSession(page);
      (report.syntheticSessionContexts ??= []).push(network);
      report.source['performance/admin-taste-20261015/session-fixture.mjs'] = createHash('sha256').update(await readFile(resolve(import.meta.dirname, 'session-fixture.mjs'))).digest('hex');
    }
    if (process.env.AUDIT_SUCCESS_FIXTURE === '1') {
      const { installTasteFixture } = await import('./taste-fixture.mjs');
      report.successFixture = await installTasteFixture(page);
      report.source['performance/admin-taste-20261015/taste-fixture.mjs'] = createHash('sha256').update(await readFile(resolve(import.meta.dirname, 'taste-fixture.mjs'))).digest('hex');
    }
    for (const module of modules) {
      const beforeErrors = pageErrors;
      const beforeConsoleErrors = consoleErrors;
      const beforeRequestFailures = requestFailures;
      await page.goto(`${origin}/admin${module === 'overview' ? '' : `?module=${module}`}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.locator('[data-admin-console-shell="true"]').waitFor({ state: 'visible', timeout: 90_000 });
      await page.waitForFunction(({ selectedModule, expectedTitle, expectedTheme }) => {
        const canvas = document.querySelector(`[data-admin-console-active-module="${selectedModule}"]`);
        const visible = node => { const r = node.getBoundingClientRect(); return Boolean(r.width && r.height && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && getComputedStyle(node).visibility !== 'hidden'); };
        return document.documentElement.classList.contains('dark') === (expectedTheme === 'dark') && canvas && [...canvas.querySelectorAll('[data-admin-page-header="true"]')].some(node => visible(node) && node.querySelector('.admin-page-header-title')?.textContent?.trim() === expectedTitle)
          && ![...canvas.querySelectorAll('[data-admin-sidebar-module-loading-grid], [aria-busy="true"], [data-slot="skeleton"]')].some(visible);
      }, { selectedModule: module, expectedTitle: titles[module], expectedTheme: theme }, { timeout: 90_000 });
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await page.evaluate(() => {
        const visible = node => { const r = node.getBoundingClientRect(); return Boolean(r.width && r.height && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && getComputedStyle(node).visibility !== 'hidden'); };
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const headers = [...document.querySelectorAll('[data-admin-page-header="true"]')].filter(visible);
        const header = headers[0];
        const title = header?.querySelector('.admin-page-header-title');
        const canvas = document.querySelector('#admin-console-canvas');
        const rows = [...(canvas?.querySelectorAll('tbody tr') ?? [])].filter(visible);
        return {
          visibleHeaders: headers.length,
          resolvedTheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          title: title?.textContent?.trim(),
          header: header ? rect(header) : null,
          titleStyle: title ? { size: getComputedStyle(title).fontSize, weight: getComputedStyle(title).fontWeight, lineHeight: getComputedStyle(title).lineHeight } : null,
          documentOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
          canvasRect: canvas ? rect(canvas) : null,
          mainLandmarks: document.querySelectorAll('main').length,
          canvasOverflow: canvas ? Math.max(0, canvas.getBoundingClientRect().right - innerWidth) : null,
          tableRows: rows.length,
          visibleTableRows: rows.filter(node => { const r = node.getBoundingClientRect(); return r.top >= (header?.getBoundingClientRect().bottom ?? 0) && r.bottom <= innerHeight; }).length,
          rowHeight: rows[0]?.getBoundingClientRect().height ?? null,
          navigationTargets: [...document.querySelectorAll('[data-admin-console-menu-item-mode="desktop-sidebar"]')].filter(visible).length,
          mainFont: getComputedStyle(document.querySelector('main') ?? document.body).fontFamily,
          renderedPath: location.pathname,
        };
      });
      await writeFile(resolve(output, 'last-view-metrics.json'), JSON.stringify({ module, width, ...metrics }, null, 2));
      if (metrics.title !== titles[module] || !metrics.header || metrics.visibleHeaders !== 1 || metrics.mainLandmarks !== 1 || !metrics.canvasRect || metrics.canvasRect.width < width * (width >= 768 ? 0.65 : 0.9)) throw new Error(`AUDIT_VIEW_NOT_SETTLED:${module}:${width}`);
      const tasteMetrics = await page.evaluate(probe);
      if (!Array.isArray(tasteMetrics.color?.lowContrast)) throw new Error('TASTE_PROBE_CONTRACT_CHANGED');
      const taste = {
        findings: judge(tasteMetrics, { width }).map(({ level, id }) => ({ level, id })),
        smallTextBlocks: tasteMetrics.type.smallText,
        lowContrastSamples: tasteMetrics.color.lowContrast.map(({ ratio, need, size, fg, bg }) => ({ ratio, need, size, fg, bg })),
      };
      const screenshot = `${module}-${width}.png`;
      await page.screenshot({ path: resolve(output, screenshot), animations: 'disabled' });
      report.cases.push({ module, width, ...metrics, taste, pageErrors: pageErrors - beforeErrors, consoleErrors: consoleErrors - beforeConsoleErrors, requestFailures: requestFailures - beforeRequestFailures, screenshot });
      console.log(JSON.stringify({ phase, module, width, title: metrics.title, overflow: metrics.documentOverflow, pageErrors: pageErrors - beforeErrors }));
    }
    report.blockedExternalRequests = (report.blockedExternalRequests ?? 0) + blockedExternal;
    report.blockedMutationRequests = (report.blockedMutationRequests ?? 0) + blockedMutation;
    await context.close();
  }
} finally {
  await browser.close();
  const after = await sourceManifest();
  report.sourceDrift = [...new Set([...Object.keys(report.source), ...Object.keys(after)])].filter(path => !path.startsWith('performance/') && report.source[path] !== after[path]);
  report.completedAt = new Date().toISOString();
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.sourceDrift.length) process.exitCode = 1;
}

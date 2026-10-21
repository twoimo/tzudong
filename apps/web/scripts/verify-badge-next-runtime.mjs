// Real production Next App Router server; no bundler alias or component mock.
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.find(x => x.startsWith('--out='));
if (!outArg) throw Error('Use --out=<new evidence directory>');
const out = resolve(outArg.slice(6));
await mkdir(out); // Refuse overwriting an earlier attempt.
const project = await mkdtemp(join(resolve(web, '../..'), '.tmp-badge-next-'));
const require = createRequire(join(web, 'package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const node = process.execPath;
const next = require.resolve('next/dist/bin/next');
const result = { observedAt: new Date().toISOString(), node: process.version,
  next: require('next/package.json').version, react: require('react/package.json').version,
  sourceSha256: hash(await readFile(join(web, 'components/restaurant/PopularityBadge.tsx'))),
  scope: 'Production Next webpack build/start, actual App Router SSR/hydration and lazy chunk failure. Isolated route with real product component/dependencies; synthetic navigator/software GL; no whole-site, physical or field claim.', cases: [] };
let server, browser;
const log = [];
async function build() {
  const child = spawn(node, [next, 'build', project, '--webpack'], { cwd: web,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' } });
  child.stdout.on('data', x => log.push(String(x))); child.stderr.on('data', x => log.push(String(x)));
  const exit = await new Promise((res, rej) => { child.on('error', rej); child.on('exit', res); });
  await writeFile(join(out, 'build.log'), log.join(''));
  if (exit !== 0) throw Error('NEXT_BUILD_FAILED:' + exit);
}
try {
  await mkdir(join(project, 'app/[mode]'), { recursive: true });
  const fixture = join(web, 'tests/fixtures/badge-next-runtime');
  await cp(join(fixture, 'app'), join(project, 'app'), { recursive: true });
  await symlink(join(web, 'node_modules'), join(project, 'node_modules'), 'dir');
  await symlink(join(web, 'public'), join(project, 'public'), 'dir');
  await writeFile(join(project, 'package.json'), JSON.stringify({ private: true, name: 'badge-next-runtime', dependencies: { next: result.next, react: result.react, 'react-dom': require('react-dom/package.json').version } }));
  await writeFile(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['dom', 'esnext'], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true, jsx: 'react-jsx', paths: { '@/*': [relative(project, web) + '/*'] } }, include: ['**/*.ts', '**/*.tsx', '.next/types/**/*.ts', join(web, 'types/three.d.ts')], exclude: ['node_modules'] }));
  await writeFile(join(project, 'next.config.mjs'), `export default { outputFileTracingRoot: ${JSON.stringify(resolve(web, '../..'))}, experimental: { cpus: 2 } };\n`);
  await build();
  const manifest = JSON.parse(await readFile(join(project, '.next/react-loadable-manifest.json'), 'utf8'));
  const chunks = [...new Set(Object.entries(manifest).filter(([k]) => k.includes('Badge3DViewer')).flatMap(([, v]) => v.files))];
  if (!chunks.length) throw Error('NO_ACTUAL_VIEWER_CHUNK');
  result.viewerChunks = [];
  for (const path of chunks) {
    const bytes = await readFile(join(project, '.next', path));
    result.viewerChunks.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  result.buildId = (await readFile(join(project, '.next/BUILD_ID'), 'utf8')).trim();
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(node, [next, 'start', project, '--hostname', '127.0.0.1', '--port', String(port)], { cwd: web, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' } });
  server.stdout.on('data', x => log.push(String(x))); server.stderr.on('data', x => log.push(String(x)));
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/off')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
  if (!ready) throw Error('NEXT_START_NOT_READY');
  for (const mode of ['off', 'on']) {
    const response = await fetch(base + '/' + mode); const html = await response.text();
    await writeFile(join(out, `ssr-${mode}.html`), html);
    if (response.status !== 200 || !html.includes('Badge server boundary') || !html.includes('data-hydrated="false"') || !html.includes('badge_popular_fire_40.webp') || html.includes('<canvas')) throw Error('SSR_BRANCH_FAILED:' + mode);
  }
  browser = await chromium.launch({ executablePath: process.env.TZUDONG_TEST_CHROMIUM || undefined,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  result.browser = browser.version();
  const viewerRequest = url => chunks.some(path => new URL(url).pathname === '/_next/' + path);
  async function contextFor(mobile = false) {
    const context = await browser.newContext({ reducedMotion: 'reduce', ...(mobile ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } : {}) });
    await context.addInitScript(({ mobile }) => { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); Object.defineProperty(navigator, 'deviceMemory', { get: () => mobile ? undefined : 8 }); }, { mobile });
    const page = await context.newPage(); const errors = []; const hydrationErrors = []; const requests = [];
    page.on('pageerror', x => errors.push(x.message));
    page.on('console', x => { if (/hydration|didn't match|did not match|#418/.test(x.text())) hydrationErrors.push(x.text()); });
    page.on('request', x => { if (viewerRequest(x.url())) requests.push(x.url()); });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    return { context, page, errors, hydrationErrors, requests };
  }
  async function enter(s, mode = 'on') { await s.page.goto(base + '/' + mode); await expect(s.page.locator('[data-hydrated="true"]')).toBeVisible(); }
  async function finish(s, name, extra = {}) {
    expect(s.errors).toEqual([]); expect(s.hydrationErrors).toEqual([]);
    result.cases.push({ name, passed: true, pageErrors: s.errors, hydrationErrors: s.hydrationErrors, viewerRequests: s.requests.length, ...extra }); await s.context.close();
  }
  let s = await contextFor(); await enter(s, 'off'); await expect(s.page.getByRole('button', { name: '3D 보기' })).toHaveCount(0); expect(s.requests.length).toBe(0); await finish(s, 'SSR and hydration default-off');
  for (const action of ['close', 'escape', 'unmount']) {
    s = await contextFor(); let release; const held = new Promise(r => { release = r; });
    await s.page.route('**/_next/static/chunks/**', async route => { if (!viewerRequest(route.request().url())) return route.continue(); await held; await route.continue(); });
    await enter(s); await s.page.getByRole('button', { name: '3D 보기' }).click();
    await expect(s.page.locator('[data-badge-viewer="loading"]')).toBeVisible();
    if (action === 'close') await s.page.getByRole('button', { name: '닫기', exact: true }).click();
    if (action === 'escape') await s.page.getByRole('dialog').press('Escape');
    if (action === 'unmount') await s.page.getByRole('button', { name: 'Unmount badge' }).click();
    release(); await s.page.waitForLoadState('networkidle'); await expect(s.page.getByRole('dialog')).toHaveCount(0); await expect(s.page.locator('canvas')).toHaveCount(0);
    if (action !== 'unmount') { await expect(s.page.getByRole('button', { name: '3D 보기' })).toBeFocused(); await s.page.getByRole('button', { name: '3D 보기' }).click(); await expect(s.page.locator('[data-badge-viewer="viewer"] canvas')).toHaveCount(1); await s.page.getByRole('dialog').press('Escape'); await expect(s.page.locator('canvas')).toHaveCount(0); }
    await finish(s, 'Hydrated delayed chunk ' + action, { noLateMount: true });
  }
  s = await contextFor(); let release; const held = new Promise(r => { release = r; }); let failures = 0;
  await s.page.route('**/_next/static/chunks/**', async route => { if (!viewerRequest(route.request().url())) return route.continue(); await held; failures++; await route.fulfill({ status: 503, body: '', contentType: 'text/javascript' }); });
  await enter(s); await s.page.getByRole('button', { name: '3D 보기' }).click(); await expect(s.page.locator('[data-badge-viewer="loading"]')).toBeVisible(); release();
  await expect(s.page.locator('[data-badge-viewer="fallback"]')).toBeVisible(); await expect(s.page.locator('[data-route-error]')).toHaveCount(0); await expect(s.page.getByRole('button', { name: 'Unmount badge' })).toBeVisible();
  await s.page.screenshot({ path: join(out, 'chunk-503-local-fallback.png') });
  await s.page.getByRole('button', { name: '닫기', exact: true }).click(); await expect(s.page.getByRole('button', { name: '3D 보기' })).toBeFocused(); await s.page.getByRole('button', { name: '3D 보기' }).click(); await expect(s.page.locator('[data-badge-viewer="fallback"]')).toBeVisible(); await s.page.getByRole('dialog').press('Escape'); await expect(s.page.getByRole('dialog')).toHaveCount(0); expect(failures).toBeGreaterThan(0);
  await finish(s, 'Hydrated actual chunk503 local containment', { failureResponses: failures, routeBoundaryUnused: true, closeReopenEscape: true });
  s = await contextFor(true); await enter(s); await s.page.getByRole('button', { name: '3D 보기' }).click(); await expect(s.page.locator('[data-badge-viewer="fallback"]')).toBeVisible(); expect(s.requests.length).toBe(0); await s.page.getByRole('dialog').press('Escape'); await finish(s, 'Hydrated unknown-mobile static request0');
  result.passed = true;
} catch (error) { result.passed = false; result.failure = String(error); process.exitCode = 1; }
finally {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exited; }
  await writeFile(join(out, 'server.log'), log.join(''));
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  await rm(project, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: result.passed, cases: result.cases.length, failure: result.failure, evidence: out }));

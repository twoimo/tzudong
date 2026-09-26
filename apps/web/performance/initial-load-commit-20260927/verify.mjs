import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = fileURLToPath(new URL('./', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'tzudong-initial-load-'));
const bundlePath = join(temporary, 'bundle.mjs');
let browser;
let server;
try {
    execFileSync('bun', [
        'build', join(here, 'browser-entry.tsx'), '--target=browser', '--format=esm',
        '--define', 'process.env.NODE_ENV="production"', '--outfile', bundlePath,
    ], { cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'pipe' });
    const bundle = await readFile(bundlePath);
    server = createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': request.url === '/bundle.mjs' ? 'text/javascript' : 'text/html' });
        response.end(request.url === '/bundle.mjs'
            ? bundle
            : '<!doctype html><html><body><script type="module" src="/bundle.mjs"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof window.verifyInitialLoadPending === 'function');
    const checks = await page.evaluate(() => window.verifyInitialLoadPending());
    if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
    console.log(JSON.stringify({ status: 'passed', checks: checks.length, cases: checks }, null, 2));
} finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
}

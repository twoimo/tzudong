import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { installViewportContinuityMocks } from '../../tests/home-viewport-continuity-helpers.ts';

const root = new URL('./', import.meta.url);
const nodeExecutable = process.env.TZUDONG_NODE24_EXECUTABLE ?? (typeof Bun === 'undefined' ? process.execPath : 'node');
if (!/^v24\./.test(execFileSync(nodeExecutable, ['--version'], { encoding: 'utf8' }).trim())) throw new Error('Use Node 24');
await mkdir(new URL('diagnostic-v1/', root));
const browser = await chromium.launch({ headless: true });
const records = [];
let server;
function classify(message) {
    if (/Content Security Policy/.test(message)) return 'csp_block';
    if (/Access-Control-Allow-Origin|CORS/.test(message)) return 'cors_block';
    if (/net::ERR_BLOCKED_BY_CLIENT/.test(message)) return 'fenced_resource';
    if (/Failed to load resource/.test(message)) return 'resource_load_failure';
    if (/hydration|Hydration/.test(message)) return 'hydration_error';
    return 'other_console_error';
}
function group(url) {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === 'www.tzudong.app' ? 'application'
        : /naver|pstatic/.test(host) ? 'map_provider' : /supabase/.test(host) ? 'persistence' : 'external';
}
try {
    server = spawn(nodeExecutable, ['.next-viewport-candidate-20260930/standalone/apps/web/server.js'], {
        cwd: new URL('../../', root), env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
            NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3000' }, stdio: 'ignore',
    });
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode !== null) throw new Error('Owned diagnostic server terminated');
        try { if ((await fetch('http://localhost:3000', { signal: AbortSignal.timeout(500) })).ok) { started = true; break; } }
        catch { /* bounded owned-server startup */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!started) throw new Error('Owned diagnostic startup timeout');
    for (const kind of ['local-fixture', 'live']) {
        const origin = kind === 'live' ? 'https://www.tzudong.app' : 'http://localhost:3000';
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
        if (kind === 'local-fixture') {
            await context.routeWebSocket('**/*', socket => socket.close());
            await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
        }
        const page = await context.newPage();
        if (kind === 'local-fixture') {
            await installViewportContinuityMocks(page);
            await page.route('**/rest/v1/rpc/read_public_profile_summaries', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: {
                'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
            } }));
        }
        const errors = [], failures = [], statuses = [];
        page.on('console', message => {
            if (message.type() === 'error') errors.push({ code: classify(message.text()),
                sourceGroup: message.location().url ? group(message.location().url) : 'unspecified',
                line: message.location().lineNumber });
        });
        page.on('requestfailed', request => failures.push({ group: group(request.url()), type: request.resourceType(),
            code: ['net::ERR_ABORTED', 'net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_FAILED'].includes(request.failure()?.errorText)
                ? request.failure().errorText : 'other_network_failure' }));
        page.on('response', response => { if (response.status() >= 400) statuses.push({ group: group(response.url()),
            type: response.request().resourceType(), status: response.status() }); });
        try {
            await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForFunction(() => document.querySelector('.cluster-marker-container,[data-testid="marker"]'), null, { timeout: 45000 });
            await page.waitForTimeout(1500);
            records.push({ kind, errors, failures, statuses });
        } finally { await context.close(); }
    }
    await writeFile(new URL('diagnostic-v1/result.json', root), JSON.stringify({ scope: 'One desktop visit per environment. Fixed classification codes only; no URLs, payloads or provider diagnostics retained.', records }, null, 2) + '\n');
    console.log(JSON.stringify(records));
} finally {
    await browser.close();
    if (server?.exitCode === null) server.kill('SIGTERM');
}

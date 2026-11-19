#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { chromium } = createRequire(path.join(repo, 'apps/web/package.json'))('@playwright/test');

const JEONGWON = { id: '00000000-0000-4000-8000-000000000101', name: '정원분식' };
const BACKUP_ADMIN_EMAIL = 'verify-backup-admin@local.invalid';

const journey = process.argv[2] ?? '';
const origin = process.env.TZV_APP_ORIGIN;
const evidenceDir = process.env.TZV_EVIDENCE_DIR ? path.join(process.env.TZV_EVIDENCE_DIR, journey) : '';
let shotIndex = 0;

function stackEnv() {
  const values = {};
  for (const line of readFileSync(path.join(process.env.TZV_STATE_DIR, 'stack.env'), 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
  }
  return values;
}

function log(message) {
  const line = `${new Date().toISOString()} ${journey} ${message}`;
  process.stdout.write(`${line}\n`);
  if (evidenceDir) appendFileSync(path.join(evidenceDir, 'steps.log'), `${line}\n`);
}

async function step(name, action) {
  try {
    const detail = await action();
    log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    log(`FAIL ${name}: ${String(error?.message ?? error).split('\n')[0]}`);
    throw error;
  }
}

async function capture(page, name, scope = page.locator('body')) {
  const base = path.join(evidenceDir, `${String(++shotIndex).padStart(2, '0')}-${name}`);
  await page.screenshot({ path: `${base}.png` });
  writeFileSync(`${base}.aria.yml`, `${await scope.ariaSnapshot()}\n`);
}

function sql(query, role = 'postgres') {
  const result = spawnSync('docker', [
    'exec', '-i', process.env.TZV_DB_CONTAINER, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', role, '-d', 'postgres', '-tA', '-c', query,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr.trim().split('\n').pop()}`);
  return result.stdout.trim();
}

function readback(name, query) {
  const value = sql(query);
  writeFileSync(path.join(evidenceDir, `readback-${name}.txt`), `${query}\n=> ${value}\n`);
  return value;
}

async function until(read, expected, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let value = read();
  while (value !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    value = read();
  }
  if (value !== expected) throw new Error(`expected ${expected}, observed ${value}`);
  return value;
}

async function openContext(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    return local || !url.protocol.startsWith('http') ? route.continue() : route.abort('blockedbyclient');
  });
  const problems = path.join(evidenceDir, 'browser-problems.log');
  const note = (line) => appendFileSync(problems, `${new Date().toISOString()} ${line.split('\n')[0].slice(0, 300)}\n`);
  context.on('page', (page) => {
    page.on('pageerror', (error) => note(`pageerror ${error.message}`));
    page.on('console', (message) => message.type() === 'error' && note(`console ${message.text()}`));
    page.on('response', (response) => {
      if (response.status() >= 400) note(`http ${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    });
  });
  return context;
}

async function signIn(page, email, password) {
  await page.goto(`${origin}/?auth=login`);
  const form = page.locator('form').filter({ has: page.locator('#login-email') }).filter({ visible: true });
  await form.getByLabel('이메일').fill(email);
  await form.getByLabel('비밀번호').fill(password);
  await form.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByText('로그인했습니다').first().waitFor({ timeout: 30_000 });
}

async function openHome(page) {
  await page.goto(`${origin}/`);
  await page.getByTestId('map-container').waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => Boolean(window.__TZUDONG_DEBUG_MAP__), null, { timeout: 120_000 });
}

async function openDetail(page, restaurant) {
  await page.getByRole('button', { name: `${restaurant.name} 인기 맛집 상세 보기` }).click();
  const panel = page.getByTestId('restaurant-detail-panel');
  await panel.getByRole('heading', { name: restaurant.name, level: 2 }).waitFor({ timeout: 30_000 });
  if (!page.url().includes(`restaurant=${restaurant.id}`)) throw new Error(`url lacks restaurant=${restaurant.id}`);
  return panel;
}

function requireRestaurantsBackupRow(restaurant) {
  if (sql(`select count(*) from public.restaurants_backup where id = '${restaurant.id}'`) !== '1') {
    throw new Error(`restaurants_backup has no row for ${restaurant.name}; the synthetic seed lacks it, so the write would fail its foreign key`);
  }
}

function nightlyUserId() {
  return sql("select id from auth.users where email = 'nightly-ci@local.invalid'");
}

const journeys = {
  async 'login-check'() {
    const env = stackEnv();
    const response = await fetch(`${env.SUPABASE_PUBLIC_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: env.ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: env.NIGHTLY_ADMIN_EMAIL, password: env.NIGHTLY_ADMIN_PASSWORD }),
    });
    const authenticated = response.ok && Boolean((await response.json()).access_token);
    process.stdout.write(`${JSON.stringify({ http_status: response.status, authenticated })}\n`);
    if (!authenticated) process.exitCode = 1;
  },

  async 'map-detail'(browser) {
    const page = await (await openContext(browser)).newPage();
    await step('open home map', async () => {
      await openHome(page);
      await capture(page, 'home');
    });
    let panel;
    await step(`open ${JEONGWON.name} from the popular list`, async () => {
      panel = await openDetail(page, JEONGWON);
      await capture(page, 'detail', panel);
      return page.url().replace(origin, '');
    });
    await step('close the detail panel', async () => {
      await panel.getByRole('group', { name: '패널 동작' })
        .getByRole('button', { name: /맛집 상세 닫기|이전 목록으로 돌아가기|이전 화면으로 돌아가기/ }).click();
      await panel.waitFor({ state: 'hidden', timeout: 15_000 });
      await capture(page, 'closed');
    });
  },

  async bookmark(browser) {
    const env = stackEnv();
    const userId = nightlyUserId();
    const countQuery = `select count(*) from public.user_bookmarks where user_id = '${userId}' and restaurant_id = '${JEONGWON.id}'`;
    await step('precondition: no bookmark for the seeded restaurant', async () => {
      if (sql(countQuery) !== '0') throw new Error('bookmark already present; remove it from /mypage/bookmarks first');
    });
    await step('precondition: the bookmark foreign key target exists', async () => requireRestaurantsBackupRow(JEONGWON));
    const page = await (await openContext(browser)).newPage();
    await step('sign in as the seeded account through the login dialog', () => signIn(page, env.NIGHTLY_ADMIN_EMAIL, env.NIGHTLY_ADMIN_PASSWORD));
    let actions;
    await step(`open ${JEONGWON.name} detail`, async () => {
      await openHome(page);
      const panel = await openDetail(page, JEONGWON);
      actions = panel.getByRole('group', { name: '패널 동작' });
      await capture(page, 'detail-before', panel);
    });
    await step('add bookmark', async () => {
      await actions.locator('button[title="북마크 추가"]').click();
      await actions.locator('button[title="북마크 해제"]').waitFor({ timeout: 15_000 });
      await capture(page, 'detail-bookmarked', actions);
      return `db count ${await until(() => readback('after-add', countQuery), '1')}`;
    });
    await step('see it on /mypage/bookmarks', async () => {
      await page.goto(`${origin}/mypage/bookmarks`);
      await page.getByRole('button', { name: `${JEONGWON.name} 북마크 삭제` }).waitFor({ timeout: 60_000 });
      await capture(page, 'bookmarks-list');
    });
    await step('remove it from /mypage/bookmarks', async () => {
      await page.getByRole('button', { name: `${JEONGWON.name} 북마크 삭제` }).click();
      await page.getByText('아직 저장한 맛집이 없습니다').waitFor({ timeout: 15_000 });
      await capture(page, 'bookmarks-empty');
      return `db count ${await until(() => readback('after-remove', countQuery), '0')}`;
    });
  },

  async 'edit-request'(browser) {
    const env = stackEnv();
    const userId = nightlyUserId();
    const countQuery = `select count(*) from public.restaurant_submissions s join public.restaurant_submission_items i on i.submission_id = s.id where s.user_id = '${userId}' and s.submission_type = 'edit' and i.target_restaurant_id = '${JEONGWON.id}'`;
    await step('precondition: the submission item foreign key target exists', async () => requireRestaurantsBackupRow(JEONGWON));
    let before;
    await step('record the current edit submission count', async () => {
      before = Number(readback('before', countQuery));
      return String(before);
    });
    const page = await (await openContext(browser)).newPage();
    await step('sign in as the seeded account through the login dialog', () => signIn(page, env.NIGHTLY_ADMIN_EMAIL, env.NIGHTLY_ADMIN_PASSWORD));
    let dialog;
    await step(`open the edit request for ${JEONGWON.name}`, async () => {
      await openHome(page);
      const panel = await openDetail(page, JEONGWON);
      await panel.getByRole('button', { name: '수정 요청', exact: true }).click();
      dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '맛집 수정 요청' }) });
      await dialog.waitFor({ timeout: 30_000 });
      await capture(page, 'edit-open', dialog);
    });
    await step('change the phone number, add a video link, and reach the review step', async () => {
      await dialog.getByLabel('전화번호').fill('02-0000-0199');
      await dialog.getByRole('button', { name: '다음', exact: true }).click();
      await dialog.getByText('2 / 3').waitFor({ timeout: 15_000 });
      await dialog.getByLabel('유튜브 링크').first().fill('https://www.youtube.com/watch?v=verifyTzv01');
      await dialog.getByRole('button', { name: '다음', exact: true }).click();
      await dialog.getByText('3 / 3').waitFor({ timeout: 15_000 });
      await capture(page, 'edit-review', dialog);
    });
    await step('submit', async () => {
      await dialog.getByRole('button', { name: '수정 요청 제출' }).click();
      await page.getByText('맛집 수정 요청이 성공적으로 제출되었습니다!').first().waitFor({ timeout: 30_000 });
      await capture(page, 'edit-submitted');
      return `db count ${await until(() => readback('after', countQuery), String(before + 1))}`;
    });
  },

  async 'edit-request-global'(browser) {
    const page = await (await openContext(browser)).newPage();
    await step('open /global-map', async () => {
      await page.goto(`${origin}/global-map`);
      await page.getByText('지도 없이 글로벌 맛집 둘러보기').waitFor({ timeout: 120_000 });
      await capture(page, 'global-map');
    });
    await step('precondition: an overseas restaurant to open', async () => {
      const count = sql("select count(*) from public.restaurants where status = 'approved' and coalesce(road_address, jibun_address, '') not like '서울%'");
      if (count === '0') throw new Error('the synthetic seed has only Seoul restaurants; this entry point cannot be driven');
      return `${count} candidates`;
    });
  },

  async presence(browser) {
    const watcher = await (await openContext(browser)).newPage();
    const badge = watcher.getByRole('status').filter({ hasText: /명이 함께 보는 중/ }).first();
    const shownCount = async () => {
      const text = await badge.textContent({ timeout: 1_000 }).catch(() => null);
      const match = text?.match(/(\d+)명/);
      return match ? Number(match[1]) : null;
    };
    const waitForCount = async (accept, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const count = await shownCount();
        if (count !== null && accept(count)) return count;
        await watcher.waitForTimeout(500);
      }
      throw new Error(`no matching count within ${timeoutMs / 1000}s`);
    };
    let start;
    await step('first visitor opens the map', async () => {
      await openHome(watcher);
      start = await waitForCount(() => true, 75_000);
      await capture(watcher, 'one-viewer');
      return `${start} viewing`;
    });
    const second = await (await openContext(browser)).newPage();
    await step('second visitor joins and the first sees the count rise', async () => {
      await openHome(second);
      const now = await waitForCount((count) => count > start, 75_000);
      await capture(watcher, 'two-viewers');
      return `${start} -> ${now}`;
    });
  },

  async 'admin-gate'(browser) {
    const env = stackEnv();
    const anonymous = await openContext(browser);
    const visitor = await anonymous.newPage();
    await step('signed-out visitor is sent to the login dialog', async () => {
      await visitor.goto(`${origin}/admin`);
      const url = new URL(visitor.url());
      if (url.pathname !== '/' || url.searchParams.get('auth') !== 'login' || url.searchParams.get('reason') !== 'admin') {
        throw new Error(`landed on ${url.pathname}${url.search}`);
      }
      await visitor.locator('#login-email').filter({ visible: true }).waitFor({ timeout: 30_000 });
      await capture(visitor, 'signed-out');
      const api = await anonymous.request.get(`${origin}/api/admin/pending-counts`);
      if (api.status() !== 401) throw new Error(`api returned ${api.status()}`);
      return 'api 401';
    });

    const adminContext = await openContext(browser);
    const admin = await adminContext.newPage();
    await step('seeded admin signs in and reaches the console', async () => {
      await signIn(admin, env.NIGHTLY_ADMIN_EMAIL, env.NIGHTLY_ADMIN_PASSWORD);
      await admin.goto(`${origin}/admin`);
      await admin.getByRole('navigation', { name: '관리자 통합 메뉴' }).waitFor({ timeout: 120_000 });
      await capture(admin, 'admin-console');
      const api = await adminContext.request.get(`${origin}/api/admin/pending-counts`);
      if (api.status() !== 200) throw new Error(`api returned ${api.status()}`);
      return 'api 200';
    });

    const userId = nightlyUserId();
    const statusQuery = `select account_status from public.user_account_status where user_id = '${userId}'`;
    let backupId;
    try {
      await step('arrange: add a backup admin so the seeded admin may be disabled', async () => {
        const response = await fetch(`${env.SUPABASE_PUBLIC_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {
            apikey: env.SERVICE_ROLE_KEY,
            authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ email: BACKUP_ADMIN_EMAIL, password: crypto.randomUUID(), email_confirm: true }),
        });
        if (!response.ok) throw new Error(`create backup admin returned ${response.status}`);
        backupId = (await response.json()).id;
        sql(`insert into public.user_roles (user_id, role) values ('${backupId}', 'admin')`, 'supabase_admin');
        sql(`update public.user_account_status set account_status = 'disabled', disabled_at = now() where user_id = '${userId}'`, 'supabase_admin');
        return `status ${readback('disabled', statusQuery)}`;
      });
      await step('disabled admin is turned away from the console', async () => {
        await admin.goto(`${origin}/admin`);
        const url = new URL(admin.url());
        if (url.pathname.startsWith('/admin')) throw new Error(`still on ${url.pathname}`);
        if (await admin.getByRole('navigation', { name: '관리자 통합 메뉴' }).count()) throw new Error('admin menu rendered');
        if (url.pathname === '/') await admin.getByTestId('map-container').waitFor({ timeout: 120_000 });
        await capture(admin, 'disabled-admin');
        const api = await adminContext.request.get(`${origin}/api/admin/pending-counts`);
        if (![401, 403].includes(api.status())) throw new Error(`api returned ${api.status()}`);
        return `landed on ${url.pathname}${url.search}; api ${api.status()}`;
      });
    } finally {
      await step('restore: re-enable the seeded admin and delete the backup admin', async () => {
        sql(`update public.user_account_status set account_status = 'active', disabled_at = null where user_id = '${userId}'`, 'supabase_admin');
        if (backupId) {
          sql(`delete from public.user_roles where user_id = '${backupId}'`, 'supabase_admin');
          const response = await fetch(`${env.SUPABASE_PUBLIC_URL}/auth/v1/admin/users/${backupId}`, {
            method: 'DELETE',
            headers: { apikey: env.SERVICE_ROLE_KEY, authorization: `Bearer ${env.SERVICE_ROLE_KEY}` },
          });
          if (!response.ok) throw new Error(`delete backup admin returned ${response.status}`);
        }
        const status = readback('restored', statusQuery);
        const users = readback('restored-users', 'select count(*) from auth.users');
        if (status !== 'active' || users !== '1') throw new Error(`status ${status}, auth users ${users}`);
        return `status ${status}; auth users ${users}`;
      });
    }
  },
};

const run = journeys[journey];
if (!run) {
  process.stderr.write(`usage: tzv drive <${Object.keys(journeys).filter((name) => name !== 'login-check').join('|')}>\n`);
  process.exit(2);
}
if (journey === 'login-check') {
  await run();
} else {
  if (!origin || !evidenceDir || !process.env.TZV_DB_CONTAINER) throw new Error('run through `tzv drive`');
  mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: process.env.TZV_HEADED !== '1' });
  try {
    await run(browser);
    log('PASS');
  } catch {
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: path.join(evidenceDir, `failure-${index + 1}.png`) }).catch(() => {});
    }
    log('FAIL');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

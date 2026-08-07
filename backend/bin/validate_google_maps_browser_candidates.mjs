#!/usr/bin/env node
/**
 * Validate address mismatch rows by opening Google Maps in a browser.
 *
 * This script intentionally avoids Google Geocoding/Places/Maps Web Service APIs.
 * It does not bypass login, consent, CAPTCHA, or bot checks. If Google blocks
 * automation, the row is marked blocked_or_captcha for human review.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { logSafeError } from '../utils/privacy-log.mjs';

function parseArgs(argv) {
  const args = { reportDir: '', input: '', out: '', limit: 0, offset: 0, headless: true, delayMs: 1500 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report-dir') args.reportDir = argv[++i] || '';
    else if (arg === '--input') args.input = argv[++i] || '';
    else if (arg === '--out') args.out = argv[++i] || '';
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg === '--offset') args.offset = Number(argv[++i] || 0);
    else if (arg === '--delay-ms') args.delayMs = Number(argv[++i] || 0);
    else if (arg === '--headed') args.headless = false;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/validate_google_maps_browser_candidates.mjs --report-dir DIR [--offset N] [--limit N] [--headed]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.reportDir && !args.input) throw new Error('--report-dir or --input is required');
  if (!args.input) args.input = path.join(args.reportDir, 'google-maps-browser-review-queue.jsonl');
  if (!args.out) args.out = args.reportDir || path.dirname(args.input);
  return args;
}

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCoordinates(text) {
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /\[null,null,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { lat: Number(match[1]), lng: Number(match[2]) };
  }
  return { lat: null, lng: null };
}

function safeFilenamePart(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown';
}

function titleToCandidateName(title) {
  return norm(title).replace(/ - Google 지도$/i, '').replace(/ - Google Maps$/i, '');
}

function isBlockedText(text) {
  const t = text.toLowerCase();
  return t.includes('unusual traffic') || t.includes('captcha') || t.includes('sorry') || t.includes('로봇이 아닙니다') || t.includes('비정상적인 트래픽');
}

function buildSearchUrl(row) {
  const query = row.search_query || `${row.origin_name || row.approved_name || ''} ${row.origin_address_text || row.road_address || row.jibun_address || row.english_address || ''}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(norm(query))}`;
}

async function extractPageCandidate(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const title = document.title || '';
    const h1 = document.querySelector('h1.DUwDvf, h1')?.textContent?.trim() || '';
    const addressButton = document.querySelector('button[data-item-id*="address"]');
    const address = addressButton?.querySelector('.Io6YTe, .fontBodyMedium')?.textContent?.trim() || '';
    const resultItems = Array.from(document.querySelectorAll('[role="article"], a[href*="/maps/place/"]')).slice(0, 5).map((el) => el.textContent?.trim()).filter(Boolean);
    const coordinateHints = Array.from(document.querySelectorAll('a[href*="/maps/"], meta[itemprop="image"], meta[property="og:image"]'))
      .slice(0, 50)
      .map((el) => el.getAttribute('href') || el.getAttribute('content') || '')
      .filter(Boolean);
    const consent = Array.from(document.querySelectorAll('button')).map((el) => el.textContent || '').some((value) => /동의|accept|agree/i.test(value));
    return { title, h1, address, bodyTextSample: text.slice(0, 1000), resultItems, coordinateHints, consentPromptVisible: consent };
  });
}

function verdictFor(candidate) {
  if (candidate.blocked) return { verdict: 'blocked_or_captcha', reason_ko: 'Google Maps가 자동화 접근을 차단했거나 CAPTCHA/동의 화면을 표시했습니다.' };
  if (/^(검색 결과|Search results)$/i.test(candidate.candidate_name || '')) return { verdict: 'ambiguous', reason_ko: '장소 상세가 아니라 검색 결과 화면이라 단일 장소로 확정하지 않습니다.' };
  if (!candidate.candidate_name && candidate.result_items_count > 1) return { verdict: 'ambiguous', reason_ko: '검색 결과 목록이 여러 개라 단일 장소로 확정하지 않습니다.' };
  if (!candidate.candidate_name && !candidate.candidate_address && candidate.result_items_count === 0) return { verdict: 'no_result', reason_ko: '브라우저 검색에서 장소 후보를 추출하지 못했습니다.' };
  if (candidate.lat === null || candidate.lng === null) return { verdict: 'manual_review', reason_ko: '장소 후보는 있으나 URL에서 좌표를 안정적으로 추출하지 못했습니다.' };
  return { verdict: 'browser_candidate', reason_ko: 'Google Maps 브라우저 검색에서 장소 후보와 좌표를 추출했습니다. 자동 반영하지 말고 관리자 확인 후 적용하세요.' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(args.out, { recursive: true });
  const screenshotsDir = path.join(args.out, 'google-maps-browser-screenshots');
  await fs.mkdir(screenshotsDir, { recursive: true });
  const rows = (await fs.readFile(args.input, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const slice = rows.slice(args.offset, args.limit ? args.offset + args.limit : undefined);

  const browser = await puppeteer.launch({
    headless: args.headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36');
    await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });

    for (let i = 0; i < slice.length; i += 1) {
      const row = slice[i];
      const searchUrl = buildSearchUrl(row);
      const screenshotName = `${String(args.offset + i + 1).padStart(4, '0')}-${safeFilenamePart(row.id)}.png`;
      const screenshotPath = path.join(screenshotsDir, screenshotName);
      let result;
      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(args.delayMs);
        const extracted = await extractPageCandidate(page);
        const currentUrl = page.url();
        let coords = extractCoordinates(currentUrl);
        if (coords.lat === null || coords.lng === null) {
          coords = extractCoordinates((extracted.coordinateHints || []).join('\n'));
        }
        const blocked = currentUrl.includes('/sorry/') || isBlockedText(extracted.bodyTextSample);
        const candidate = {
          id: row.id,
          queue: row.queue,
          origin_name: row.origin_name,
          origin_address_text: row.origin_address_text,
          search_query: row.search_query,
          search_url: searchUrl,
          final_url: currentUrl,
          candidate_name: norm(extracted.h1) || titleToCandidateName(extracted.title),
          candidate_address: norm(extracted.address),
          lat: coords.lat,
          lng: coords.lng,
          result_items_count: extracted.resultItems.length,
          result_items_sample: extracted.resultItems,
          consent_prompt_visible: extracted.consentPromptVisible,
          blocked,
          screenshot_path: screenshotPath,
          google_api_used: false,
        };
        await page.screenshot({ path: screenshotPath, fullPage: false });
        result = { ...candidate, ...verdictFor(candidate) };
      } catch (error) {
        logSafeError(error, (line) => process.stderr.write(`google_maps_browser_row_failed ${line}`));
        result = {
          id: row.id,
          queue: row.queue,
          origin_name: row.origin_name,
          origin_address_text: row.origin_address_text,
          search_query: row.search_query,
          search_url: searchUrl,
          final_url: page.url(),
          candidate_name: '',
          candidate_address: '',
          lat: null,
          lng: null,
          result_items_count: 0,
          result_items_sample: [],
          consent_prompt_visible: false,
          blocked: false,
          screenshot_path: '',
          google_api_used: false,
          verdict: 'browser_error',
          reason_ko: 'Google Maps browser validation failed; keep this row for manual review.',
        };
      }
      results.push(result);
      await sleep(Math.max(args.delayMs, 750));
    }
  } finally {
    await browser.close();
  }

  const summary = results.reduce((acc, row) => {
    acc[row.verdict] = (acc[row.verdict] || 0) + 1;
    return acc;
  }, {});
  const payload = {
    generated_at: new Date().toISOString(),
    mode: 'read_only_google_maps_browser_validation',
    db_write_performed: false,
    google_api_used: false,
    offset: args.offset,
    limit: args.limit || null,
    input_count: slice.length,
    summary,
    screenshots_dir: screenshotsDir,
    results,
  };
  const suffix = args.limit ? `-${args.offset}-${args.offset + args.limit}` : '';
  await fs.writeFile(path.join(args.out, `google-maps-browser-validation${suffix}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(args.out, `google-maps-browser-candidates${suffix}.jsonl`), results.map((r) => JSON.stringify(r)).join('\n') + (results.length ? '\n' : ''), 'utf8');
  console.log(JSON.stringify({ ...payload, results: undefined }, null, 2));
}

main().catch((error) => {
  logSafeError(error, (line) => process.stderr.write(`google_maps_browser_validation_failed ${line}`));
  process.exitCode = 1;
});

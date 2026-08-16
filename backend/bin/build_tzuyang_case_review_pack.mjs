#!/usr/bin/env node
/**
 * Build a case-by-case evidence pack for Tzuyang manual address review rows.
 *
 * This script does not write to Supabase. It records each manual-review row,
 * local video-derived evidence, external search attempts, extracted place
 * candidates, and a conservative review decision.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logSafeError } from '../utils/privacy-log.mjs';

const DEFAULT_REPORT_ROOT = 'backend/restaurant-evaluation/reports';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SCHEMA_VERSION = 1;
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_CONNECT_TIMEOUT_MS = 5_000;
const MAX_NAVER_RESPONSE_BYTES = 1_000_000;
const MAX_SCRAPLING_JSON_DEPTH = 6;
const MAX_SCRAPLING_URL_BYTES = 4_096;
const MAX_SCRAPLING_DIAGNOSTIC_BYTES = 256;
const SCRAPLING_FETCHER_TERMINATION_GRACE_MS = 500;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRAPLING_FETCHER_SCRIPT = path.join(SCRIPT_DIR, 'naver_scrapling_fetch.py');
const VIDEO_EVIDENCE_FAMILIES = new Set(['transcript_region', 'multimodal_region', 'visual_signage', 'visual_phone', 'neighbor_street']);
const CONFIRMED_PLACE_CONTRACT = Object.freeze({
  required_signals: [
    'same_place_id_from_at_least_two_query_attempts',
    'one_or_more_local_video_evidence_families',
    'one_or_more_high_confidence_local_video_evidence_items',
    'external_text_matches_name_or_phone',
    'external_text_matches_region_or_candidate_has_address',
    'candidate_has_lat_lng',
  ],
  non_apply_boundary: 'confirmed_external_place is an operator evidence state only; it is never a DB apply candidate.',
});

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseArgs(argv) {
  const args = {
    ledgerDir: '',
    manualReview: '',
    out: '',
    limit: 0,
    maxQueriesPerRow: 2,
    delayMs: 0,
    liveSearch: false,
    searchProvider: 'fetch',
    scraplingPython: process.env.SCRAPLING_PYTHON || process.env.PYTHON || 'python3',
    scraplingFetcherScript: process.env.TZUYANG_SCRAPLING_FETCHER_SCRIPT || DEFAULT_SCRAPLING_FETCHER_SCRIPT,
    fixtureSearchJson: '',
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ledger-dir') args.ledgerDir = argv[++i] || '';
    else if (arg === '--manual-review') args.manualReview = argv[++i] || '';
    else if (arg === '--out') args.out = argv[++i] || '';
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg === '--max-queries-per-row') args.maxQueriesPerRow = Number(argv[++i] || 0);
    else if (arg === '--delay-ms') args.delayMs = Number(argv[++i] || 0);
    else if (arg === '--live-search') args.liveSearch = true;
    else if (arg === '--search-provider') args.searchProvider = argv[++i] || 'fetch';
    else if (arg === '--scrapling-search') {
      args.liveSearch = true;
      args.searchProvider = 'scrapling';
    }
    else if (arg === '--scrapling-python') args.scraplingPython = argv[++i] || args.scraplingPython;
    else if (arg === '--scrapling-fetcher-script') args.scraplingFetcherScript = argv[++i] || args.scraplingFetcherScript;
    else if (arg === '--fixture-search-json') args.fixtureSearchJson = argv[++i] || '';
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node backend/bin/build_tzuyang_case_review_pack.mjs [--ledger-dir DIR] [--manual-review FILE] [--out DIR] [--live-search|--scrapling-search] [--search-provider fetch|scrapling] [--limit N] [--max-queries-per-row N] [--json]\n\nBuilds a no-write case-by-case review pack from manual-review-queue.jsonl.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!['fetch', 'scrapling'].includes(args.searchProvider)) {
    throw new Error(`Unknown --search-provider: ${args.searchProvider}`);
  }
  if (!args.out) args.out = path.join(DEFAULT_REPORT_ROOT, `tzuyang-address-case-review-${timestampSlug()}`);
  return args;
}

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function compact(items) {
  return items.filter((item) => item !== null && item !== undefined && String(item).trim() !== '');
}

function uniq(items) {
  return [...new Set(compact(items).map((item) => String(item).trim()))];
}

function stripPrivatePrefix(name) {
  return norm(name).replace(/^\[비공개\]\s*/, '').trim();
}

function normalizeComparable(value) {
  return stripPrivatePrefix(value).replace(/[\s·・()[\]{}'"“”‘’,.~-]/g, '').toLowerCase();
}

function significantNameTokens(name) {
  const stripped = stripPrivatePrefix(name);
  if (!stripped || stripped.length < 2) return [];
  const tokens = stripped
    .split(/[\s/()·・,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^(맛집|식당|집|가게|푸드트럭|부스|비공개)$/.test(token));
  return uniq([stripped, ...tokens]).slice(0, 8);
}

function regionTokens(...values) {
  const text = values.map((value) => norm(value)).join(' ');
  const tokens = [];
  for (const regex of [
    /[가-힣]+(?:특별시|광역시|특별자치도|도|시|군|구|읍|면|동|리|역)/g,
    /[가-힣0-9]+(?:대로|로|길)(?:\d+길)?/g,
    /(?:Seoul|Busan|Daegu|Daejeon|Gwangju|Incheon|Ulsan|Jeju|Chuncheon|Bangkok|Taipei|Istanbul|Las Vegas|Los Angeles|Budapest|Bali|Hong Kong)/gi,
  ]) {
    for (const match of text.matchAll(regex)) tokens.push(match[0]);
  }
  return uniq(tokens)
    .filter((token) => !/^(?:거리|으로|바로|따로|서로|가로|세로)$/.test(token))
    .slice(0, 20);
}

function phoneTokens(...values) {
  const text = values.map((value) => norm(value)).join(' ');
  return uniq([...text.matchAll(/(?:0\d{1,2}[-.\s]?)?\d{3,4}[-.\s]?\d{4}/g)].map((match) => match[0].replace(/\s+/g, '-'))).slice(0, 10);
}

function evidencePhones(row) {
  return phoneTokens(
    row.db_snapshot?.phone,
    ...((row.evidence || []).flatMap((item) => [
      item.summary,
      ...(Array.isArray(item.payload?.phones) ? item.payload.phones : []),
    ])),
  );
}

function rowRegionTokens(row) {
  return regionTokens(
    row.db_snapshot?.origin_address_text,
    row.db_snapshot?.road_address,
    row.db_snapshot?.jibun_address,
    row.evidence?.map((item) => `${item.summary} ${JSON.stringify(item.payload || {})}`).join(' '),
  );
}

function buildQueries(row, maxQueries) {
  const name = stripPrivatePrefix(row.db_snapshot?.origin_name || row.candidate_places?.[0]?.name || '');
  const address = norm(row.db_snapshot?.origin_address_text || row.candidate_places?.[0]?.origin_address_text || '');
  const phones = evidencePhones(row);
  const regions = rowRegionTokens(row);
  const region = regions[0] || address.split(/\s+/).slice(0, 2).join(' ');
  const existing = (row.search_queries || []).map((item) => item.query);
  const queries = uniq([
    phones[0] || '',
    phones[0] && name ? `${name} ${region} ${phones[0]}` : '',
    name && region ? `${region} ${name}` : '',
    name && address ? `${name} ${address}` : '',
    name ? `${name} ${region} 전화번호 주소` : '',
    name ? `${name} ${region} 상호변경 폐업 블로그` : '',
    ...existing.map((query) => String(query).replace(/^\[비공개\]\s*/, '')),
  ]).filter((query) => query.length >= 2 && !/^\(?상세 주소 불명\)?$/.test(query));
  return queries.slice(0, Math.max(1, maxQueries || 1));
}

function extractNaverMapPlace(href) {
  const url = norm(href);
  const id = url.match(/place\/(\d+)/)?.[1] || '';
  if (!id) return null;
  const lat = url.match(/[?&]lat=([0-9.-]+)/)?.[1] || '';
  const lng = url.match(/[?&]lng=([0-9.-]+)/)?.[1] || '';
  return {
    provider: 'naver_map',
    place_id: id,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    url,
  };
}

function htmlToAnchorItems(html) {
  const anchors = [];
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchorRegex.exec(html))) {
    const attrs = match[1] || '';
    const href = (attrs.match(/\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(Boolean) || '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    const text = norm(match[2]
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[<>]/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '')
      .replace(/&gt;/g, '')
      .replace(/&amp;/g, '&'));
    if (text || href) anchors.push({ text, href });
  }
  return anchors;
}

function looksAddress(text) {
  const value = norm(text);
  if (/(?:Thailand|Taiwan|Budapest|Istanbul|Vegas|Angeles|Bali|Hong Kong|New York|Bangkok|Taipei)/i.test(value)) return true;
  return [
    /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충청|전북|전라|경북|경상|제주|특별시|광역시|특별자치도|도)\s*[가-힣]+(?:시|군|구)/,
    /[가-힣]+(?:시|군|구)\s+[가-힣]+(?:읍|면|동)/,
    /[가-힣]+(?:읍|면|동)\s+[가-힣0-9]+(?:로|길|리|번지)/,
    /[가-힣0-9]+(?:대로|로|길|번길)\s*\d+/,
  ].some((regex) => regex.test(value));
}

function isRelevantAnchor(anchor, nameTokens, regions, phones) {
  const text = `${anchor.text} ${anchor.href}`;
  const comparable = normalizeComparable(text);
  return [
    ...nameTokens.map(normalizeComparable),
    ...regions.map(normalizeComparable),
    ...phones.map(normalizeComparable),
  ].some((needle) => needle.length >= 2 && comparable.includes(needle));
}

function parseNaverSearch(html, row, query, fetchedAt, provider = 'naver_search') {
  const anchors = htmlToAnchorItems(html);
  const nameTokens = significantNameTokens(row.db_snapshot?.origin_name || '');
  const regions = rowRegionTokens(row);
  const phones = evidencePhones(row);
  const results = [];
  const placeCandidates = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    const mapPlace = extractNaverMapPlace(anchor.href);
    const relevant = mapPlace || isRelevantAnchor(anchor, nameTokens, regions, phones);
    if (!relevant) continue;
    const window = anchors.slice(Math.max(0, i - 2), Math.min(anchors.length, i + 4));
    const context = norm(window.map((item) => item.text).filter(Boolean).join(' | ')).slice(0, 700);
    const source = {
      provider,
      query,
      fetched_at: fetchedAt,
      title: anchor.text.slice(0, 180),
      url: anchor.href,
      context,
    };
    results.push(source);
    if (mapPlace) {
      const addressHit = window.map((item) => item.text).find((text) => looksAddress(text)) || '';
      const anchorName = /^(?:예약|주문|메뉴|저장|길찾기|공유)$/.test(anchor.text)
        ? stripPrivatePrefix(row.db_snapshot?.origin_name || '')
        : anchor.text.replace(/\s+(?:막국수|한식|중식|일식|양식|분식|카페|음식점)$/u, '').trim();
      placeCandidates.push({
        ...mapPlace,
        name: anchorName || stripPrivatePrefix(row.db_snapshot?.origin_name || ''),
        address: addressHit,
        source_title: anchor.text,
        source_context: context,
        query,
        fetched_at: fetchedAt,
      });
    }
  }
  return {
    provider,
    query,
    fetched_at: fetchedAt,
    status: 'ok',
    result_count: results.length,
    results: results.slice(0, 12),
    place_candidates: placeCandidates.slice(0, 6),
  };
}

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function boundedPositiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
}

function discardResponseBody(response) {
  if (typeof response?.body?.cancel === 'function') {
    void response.body.cancel().catch(() => {});
  }
}

function responseContentTypeIsHtml(response) {
  const contentType = response?.headers?.get?.('content-type');
  return typeof contentType === 'string'
    && /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType);
}

function declaredContentLength(response, maxBytes) {
  const value = response?.headers?.get?.('content-length');
  if (value === null || value === undefined) return;
  if (typeof value !== 'string' || value.length > 20 || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw fixedError('NAVER_SEARCH_CONTENT_LENGTH_INVALID');
  }
  if (BigInt(value) > BigInt(maxBytes)) {
    throw fixedError('NAVER_SEARCH_RESPONSE_TOO_LARGE');
  }
}

function abortableReaderRead(reader, signal) {
  if (signal.aborted) return Promise.reject(fixedError('NAVER_SEARCH_TOTAL_TIMEOUT'));

  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      void reader.cancel().catch(() => {});
      complete(reject, fixedError('NAVER_SEARCH_TOTAL_TIMEOUT'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (value) => complete(resolve, value),
      () => complete(reject, fixedError(signal.aborted ? 'NAVER_SEARCH_TOTAL_TIMEOUT' : 'NAVER_SEARCH_BODY_READ_FAILED')),
    );
  });
}

async function readBoundedNaverHtml(response, { maxBytes, signal }) {
  if (!responseContentTypeIsHtml(response)) {
    discardResponseBody(response);
    throw fixedError('NAVER_SEARCH_CONTENT_TYPE_REJECTED');
  }
  try {
    declaredContentLength(response, maxBytes);
  } catch (error) {
    discardResponseBody(response);
    throw error;
  }
  if (typeof response?.body?.getReader !== 'function') {
    throw fixedError('NAVER_SEARCH_BODY_INVALID');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fragments = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await abortableReaderRead(reader, signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        void reader.cancel().catch(() => {});
        throw fixedError('NAVER_SEARCH_BODY_INVALID');
      }
      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        void reader.cancel().catch(() => {});
        throw fixedError('NAVER_SEARCH_RESPONSE_TOO_LARGE');
      }
      try {
        fragments.push(decoder.decode(value, { stream: true }));
      } catch {
        throw fixedError('NAVER_SEARCH_TEXT_INVALID');
      }
    }
    try {
      fragments.push(decoder.decode());
    } catch {
      throw fixedError('NAVER_SEARCH_TEXT_INVALID');
    }
    return fragments.join('');
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The response has already been canceled or closed.
    }
  }
}

async function fetchNaverWithLimits(query, options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;
  const connectTimeoutMs = boundedPositiveInteger(options.connectTimeoutMs, FETCH_CONNECT_TIMEOUT_MS);
  const totalTimeoutMs = boundedPositiveInteger(options.totalTimeoutMs, FETCH_TIMEOUT_MS);
  const maxBytes = boundedPositiveInteger(options.maxResponseBytes, MAX_NAVER_RESPONSE_BYTES);
  const url = new URL('https://search.naver.com/search.naver');
  url.searchParams.set('query', query);

  const controller = new AbortController();
  let connectTimedOut = false;
  let totalTimedOut = false;
  const connectTimeout = setTimeout(() => {
    connectTimedOut = true;
    controller.abort();
  }, connectTimeoutMs);
  const totalTimeout = setTimeout(() => {
    totalTimedOut = true;
    controller.abort();
  }, totalTimeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      if (connectTimedOut) throw fixedError('NAVER_SEARCH_CONNECT_TIMEOUT');
      if (totalTimedOut) throw fixedError('NAVER_SEARCH_TOTAL_TIMEOUT');
      throw fixedError('NAVER_SEARCH_REQUEST_FAILED');
    } finally {
      clearTimeout(connectTimeout);
    }

    if (!response || response.redirected) {
      discardResponseBody(response);
      throw fixedError('NAVER_SEARCH_REDIRECT_REJECTED');
    }

    const html = await readBoundedNaverHtml(response, { maxBytes, signal: controller.signal });
    return { status: response.status, url: String(url), html };
  } finally {
    clearTimeout(connectTimeout);
    clearTimeout(totalTimeout);
  }
}

async function fetchNaver(query) {
  return fetchNaverWithLimits(query);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalProcessTree(child, force) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
  if (process.platform === 'win32') {
    try {
      const taskkill = spawn('taskkill.exe', force
        ? ['/pid', String(child.pid), '/T', '/F']
        : ['/pid', String(child.pid), '/T'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      taskkill.once('error', () => {});
      taskkill.unref();
    } catch {
      // A later forced termination attempt still runs.
    }
    return;
  }

  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    try {
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // The child has already exited.
    }
  }
}

async function terminateProcessTree(child, closePromise) {
  signalProcessTree(child, false);
  const closedDuringGrace = await Promise.race([
    closePromise.then(() => true),
    delay(SCRAPLING_FETCHER_TERMINATION_GRACE_MS).then(() => false),
  ]);
  if (!closedDuringGrace) {
    signalProcessTree(child, true);
    await closePromise;
  }
}

function validateScraplingPayload(payload, maxBytes) {
  if (!payload || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype) {
    throw fixedError('SCRAPLING_FETCHER_SCHEMA_INVALID');
  }
  const expectedKeys = ['status', 'url', 'html', 'fetcher', 'blocked_reason'];
  const actualKeys = Object.keys(payload).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys.sort()[index])) {
    throw fixedError('SCRAPLING_FETCHER_SCHEMA_INVALID');
  }
  if (!Number.isInteger(payload.status) || payload.status < 0 || payload.status > 599) {
    throw fixedError('SCRAPLING_FETCHER_SCHEMA_INVALID');
  }
  for (const key of ['url', 'html', 'fetcher', 'blocked_reason']) {
    if (typeof payload[key] !== 'string') throw fixedError('SCRAPLING_FETCHER_SCHEMA_INVALID');
  }
  if (
    Buffer.byteLength(payload.html, 'utf8') > maxBytes
    || Buffer.byteLength(payload.url, 'utf8') > MAX_SCRAPLING_URL_BYTES
    || Buffer.byteLength(payload.fetcher, 'utf8') > MAX_SCRAPLING_DIAGNOSTIC_BYTES
    || Buffer.byteLength(payload.blocked_reason, 'utf8') > MAX_SCRAPLING_DIAGNOSTIC_BYTES
  ) {
    throw fixedError('SCRAPLING_FETCHER_SCHEMA_INVALID');
  }

  const stack = [{ value: payload, depth: 1 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    if (depth > MAX_SCRAPLING_JSON_DEPTH) throw fixedError('SCRAPLING_FETCHER_SCHEMA_INVALID');
    if (Array.isArray(value)) {
      for (const entry of value) stack.push({ value: entry, depth: depth + 1 });
    } else if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) stack.push({ value: entry, depth: depth + 1 });
    }
  }
  return payload;
}

function spawnFileJson(command, args, options = {}) {
  const timeoutMs = boundedPositiveInteger(options.timeoutMs, FETCH_TIMEOUT_MS);
  const maxBytes = boundedPositiveInteger(options.maxOutputBytes, MAX_NAVER_RESPONSE_BYTES);
  if (options.signal?.aborted) return Promise.reject(fixedError('SCRAPLING_FETCHER_ABORTED'));

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch {
      reject(fixedError('SCRAPLING_FETCHER_SPAWN_FAILED'));
      return;
    }

    let stdoutBytes = 0;
    const stdout = [];
    let failureCode = null;
    let terminationPromise = null;
    let timer;
    let onAbort;
    let closeResult;
    let resolveClose;
    const closePromise = new Promise((resolveClosePromise) => {
      resolveClose = resolveClosePromise;
    });
    const cleanup = () => {
      clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    };
    const requestFailure = (code) => {
      if (failureCode) return;
      failureCode = code;
      if (child.stdout && !child.stdout.destroyed) child.stdout.destroy();
      terminationPromise = terminateProcessTree(child, closePromise);
    };

    child.once('error', () => requestFailure('SCRAPLING_FETCHER_SPAWN_FAILED'));
    child.once('close', (code, signal) => {
      closeResult = { code, signal };
      resolveClose(closeResult);
    });
    if (!child.stdout) {
      requestFailure('SCRAPLING_FETCHER_STDOUT_FAILED');
    } else {
      child.stdout.on('error', () => requestFailure('SCRAPLING_FETCHER_STDOUT_FAILED'));
      child.stdout.on('data', (chunk) => {
        if (failureCode) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes += bytes.byteLength;
        if (stdoutBytes > maxBytes) {
          requestFailure('SCRAPLING_FETCHER_STDOUT_TOO_LARGE');
          return;
        }
        stdout.push(bytes);
      });
    }

    timer = setTimeout(() => requestFailure('SCRAPLING_FETCHER_TIMEOUT'), timeoutMs);
    if (options.signal) {
      onAbort = () => requestFailure('SCRAPLING_FETCHER_ABORTED');
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    void (async () => {
      await closePromise;
      if (terminationPromise) await terminationPromise;
      cleanup();

      if (failureCode) {
        reject(fixedError(failureCode));
        return;
      }
      if (closeResult.code !== 0) {
        reject(fixedError('SCRAPLING_FETCHER_EXIT'));
        return;
      }

      let payload;
      try {
        payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout)));
      } catch {
        reject(fixedError('SCRAPLING_FETCHER_INVALID_JSON'));
        return;
      }
      try {
        resolve(validateScraplingPayload(payload, maxBytes));
      } catch (error) {
        reject(error);
      }
    })();
  });
}

async function fetchNaverWithScrapling(query, args) {
  const payload = await spawnFileJson(args.scraplingPython, [
    args.scraplingFetcherScript,
    '--query', query,
    '--timeout-ms', String(FETCH_TIMEOUT_MS),
  ], { timeoutMs: FETCH_TIMEOUT_MS });
  return {
    status: payload.status,
    url: payload.url,
    html: payload.html,
    provider: 'naver_search_scrapling',
    blocked_reason: payload.status >= 200 && payload.status < 300 ? '' : 'SCRAPLING_FETCHER_HTTP_ERROR',
    fetcher: 'scrapling',
  };
}

async function fetchNaverLive(query, args) {
  if (args.searchProvider === 'scrapling') return fetchNaverWithScrapling(query, args);
  const fetched = await fetchNaver(query);
  return { ...fetched, provider: 'naver_search', fetcher: 'node_fetch' };
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonl(file) {
  const text = await fs.readFile(file, 'utf8');
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(file, rows) {
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

async function latestLedgerDir(reportRoot) {
  const entries = await fs.readdir(reportRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && /^tzuyang-address-evidence-ledger-\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => path.join(reportRoot, entry.name))
    .sort()
    .reverse();
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, 'manual-review-queue.jsonl'));
      return candidate;
    } catch {
      // Keep scanning older reports; missing files make a report unusable.
    }
  }
  throw new Error(`No tzuyang-address-evidence-ledger-* report with manual-review-queue.jsonl found under ${reportRoot}`);
}

function loadFixtureSearchMap(text) {
  if (!text) return new Map();
  const parsed = JSON.parse(text);
  return new Map(Object.entries(parsed));
}

function localEvidenceSummary(row) {
  return (row.evidence || []).map((item) => ({
    family: item.family,
    source: item.source,
    confidence: item.confidence,
    summary: item.summary,
  }));
}

function includesComparable(haystack, needles) {
  const hay = normalizeComparable(haystack);
  return needles.map(normalizeComparable).some((needle) => needle.length >= 2 && hay.includes(needle));
}

function scoreCase(row, searchAttempts) {
  const phones = evidencePhones(row);
  const regions = rowRegionTokens(row);
  const nameTokens = significantNameTokens(row.db_snapshot?.origin_name || '');
  const allText = searchAttempts.flatMap((attempt) => attempt.results || []).map((item) => `${item.title} ${item.context} ${item.url}`).join(' ');
  const placeCandidates = searchAttempts.flatMap((attempt) => attempt.place_candidates || []);
  const matchedPhones = phones.filter((phone) => includesComparable(allText, [phone]));
  const matchedRegions = regions.filter((region) => includesComparable(allText, [region]));
  const matchedNames = nameTokens.filter((token) => includesComparable(allText, [token]));
  const placeQueryAgreement = new Map();
  for (const candidate of placeCandidates) {
    if (!candidate.place_id) continue;
    const existing = placeQueryAgreement.get(candidate.place_id) || new Set();
    existing.add(candidate.query);
    placeQueryAgreement.set(candidate.place_id, existing);
  }
  const agreedPlaceIds = new Set([...placeQueryAgreement.entries()]
    .filter(([, queries]) => queries.size >= 2)
    .map(([placeId]) => placeId));
  const exactMapCandidates = placeCandidates.filter((candidate) => {
    const candidateText = `${candidate.name} ${candidate.address} ${candidate.source_context}`;
    return (!nameTokens.length || includesComparable(candidateText, nameTokens))
      && (!regions.length || includesComparable(candidateText, regions) || looksAddress(candidate.address))
      && candidate.lat !== null
      && candidate.lng !== null
      && agreedPlaceIds.has(candidate.place_id);
  }).sort((a, b) => {
    const aName = includesComparable(a.name, nameTokens) ? 1 : 0;
    const bName = includesComparable(b.name, nameTokens) ? 1 : 0;
    const aAddress = looksAddress(a.address) ? 1 : 0;
    const bAddress = looksAddress(b.address) ? 1 : 0;
    return (bName - aName) || (bAddress - aAddress);
  });
  const fixedLocationUnavailable = /푸드트럭|부스|야시장|시장/.test(row.db_snapshot?.origin_name || '')
    && /특정 상호는 영상에서 식별되지 않음|고정된 주소 및 전화번호 정보 없음|모자이크|유추 불가능/.test((row.evidence || []).map((item) => item.summary).join(' '));
  const localVideoFamilies = (row.evidence_families || []).filter((family) => VIDEO_EVIDENCE_FAMILIES.has(family));
  const highConfidenceLocalVideoEvidence = (row.evidence || []).filter((item) => VIDEO_EVIDENCE_FAMILIES.has(item.family) && item.confidence === 'high');
  const externalSourceCount = searchAttempts.reduce((sum, attempt) => sum + (attempt.results?.length || 0), 0);
  const decisionBlockers = [];
  if (!agreedPlaceIds.size) decisionBlockers.push('insufficient_confirmed_place_agreement');
  if (!localVideoFamilies.length) decisionBlockers.push('insufficient_local_video_evidence');
  if (!highConfidenceLocalVideoEvidence.length) decisionBlockers.push('insufficient_high_confidence_local_video_evidence');
  if (!matchedPhones.length && !matchedNames.length) decisionBlockers.push('insufficient_name_or_phone_match');
  if (!matchedRegions.length && !exactMapCandidates[0]?.address) decisionBlockers.push('insufficient_region_or_address_match');
  if (!exactMapCandidates.length) decisionBlockers.push('no_cross_checked_precise_map_candidate');

  let decision = 'needs_manual_review';
  let confidence = 'low';
  const reasons = [];
  if (fixedLocationUnavailable) {
    decision = 'fixed_location_unavailable';
    confidence = 'medium';
    reasons.push('local_video_context_indicates_temporary_or_masked_vendor_without_fixed_store');
  } else if (decisionBlockers.length === 0) {
    decision = 'confirmed_external_place';
    confidence = matchedPhones.length ? 'high' : 'medium';
    reasons.push('naver_map_place_candidate_cross_checked_by_two_queries_with_video_name_or_phone_and_region');
  } else if (externalSourceCount > 0 && localVideoFamilies.length && (matchedPhones.length || matchedNames.length) && matchedRegions.length) {
    decision = 'externally_supported_needs_operator_review';
    confidence = 'medium';
    reasons.push('external_search_supports_name_region_but_no_precise_map_coordinate_candidate');
  } else if (externalSourceCount > 0) {
    decision = 'external_hits_inconclusive';
    confidence = 'low';
    reasons.push('external_search_returned_hits_but_cross_check_is_insufficient');
  } else {
    reasons.push('no_relevant_external_hits_collected');
  }

  const selected = exactMapCandidates[0] || placeCandidates[0] || null;
  return {
    decision,
    confidence,
    reasons,
    matched: {
      phones: matchedPhones,
      regions: matchedRegions.slice(0, 8),
      names: matchedNames.slice(0, 8),
      local_video_family_count: localVideoFamilies.length,
      external_source_count: externalSourceCount,
      map_place_candidate_count: placeCandidates.length,
      exact_map_candidate_count: exactMapCandidates.length,
      agreed_place_ids: [...agreedPlaceIds],
      high_confidence_local_video_evidence_count: highConfidenceLocalVideoEvidence.length,
    },
    decision_blockers: decision === 'confirmed_external_place' ? [] : decisionBlockers,
    selected_place_candidate: selected,
  };
}

export function buildCaseReviewRow(row, searchAttempts, generatedAt) {
  const scoring = scoreCase(row, searchAttempts);
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    id: row.id,
    video_id: row.video_id,
    youtube_link: row.youtube_link,
    origin_name: row.db_snapshot?.origin_name || null,
    origin_address_text: row.db_snapshot?.origin_address_text || null,
    local_evidence: localEvidenceSummary(row),
    local_evidence_families: row.evidence_families || [],
    search_queries_attempted: searchAttempts.map((attempt) => attempt.query),
    search_attempts: searchAttempts.map((attempt) => ({
      provider: attempt.provider,
      query: attempt.query,
      fetched_at: attempt.fetched_at,
      status: attempt.status,
      result_count: attempt.result_count || 0,
      blocked_reason: attempt.blocked_reason || null,
      top_results: (attempt.results || []).slice(0, 5),
      place_candidates: attempt.place_candidates || [],
    })),
    case_decision: scoring.decision,
    confidence: scoring.confidence,
    decision_reasons: scoring.reasons,
    decision_contract: CONFIRMED_PLACE_CONTRACT,
    decision_blockers: scoring.decision_blockers,
    matched_evidence: scoring.matched,
    selected_place_candidate: scoring.selected_place_candidate,
    db_write_performed: false,
    next_action_ko: scoring.decision === 'confirmed_external_place'
      ? '운영자가 selected_place_candidate 및 근거 URL을 확인한 뒤 별도 strict apply 후보 승격을 검토하세요.'
      : scoring.decision === 'fixed_location_unavailable'
        ? '고정 매장/정확 상호가 없어 자동 주소 반영하지 말고 검토 상태로 유지하세요.'
        : '외부 근거가 부족하거나 모호하므로 검토 상태로 유지하고 추가 수동 확인이 필요합니다.',
  };
}

function summarize(rows, out) {
  const decision_counts = rows.reduce((acc, row) => {
    acc[row.case_decision] = (acc[row.case_decision] || 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: 'read_only_tzuyang_case_by_case_review_pack',
    db_write_performed: false,
    output_dir: out,
    total_case_rows: rows.length,
    decision_counts: Object.fromEntries(Object.entries(decision_counts).sort(([a], [b]) => a.localeCompare(b))),
    confirmed_external_place_rows: rows.filter((row) => row.case_decision === 'confirmed_external_place').length,
    fixed_location_unavailable_rows: rows.filter((row) => row.case_decision === 'fixed_location_unavailable').length,
    needs_operator_review_rows: rows.filter((row) => row.case_decision !== 'confirmed_external_place').length,
    destructive_apply_allowed_by_this_script: false,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manualReview) {
    const ledgerDir = args.ledgerDir || await latestLedgerDir(DEFAULT_REPORT_ROOT);
    args.ledgerDir = ledgerDir;
    args.manualReview = path.join(ledgerDir, 'manual-review-queue.jsonl');
  }
  const fixtureMap = args.fixtureSearchJson
    ? loadFixtureSearchMap(await fs.readFile(args.fixtureSearchJson, 'utf8'))
    : new Map();
  const generatedAt = new Date().toISOString();
  await fs.mkdir(args.out, { recursive: true });
  let rows = await readJsonl(args.manualReview);
  if (args.limit) rows = rows.slice(0, args.limit);
  const caseRows = [];
  const searchLog = [];

  for (const row of rows) {
    const queries = buildQueries(row, args.maxQueriesPerRow);
    const attempts = [];
    for (const query of queries) {
      const fetchedAt = new Date().toISOString();
      try {
        const fixtureHtml = fixtureMap.get(query);
        if (fixtureHtml !== undefined) {
          const parsed = parseNaverSearch(fixtureHtml, row, query, fetchedAt);
          attempts.push(parsed);
          searchLog.push({ id: row.id, video_id: row.video_id, query, provider: 'fixture_naver_search', fetched_at: fetchedAt, status: 'ok', result_count: parsed.result_count });
        } else if (args.liveSearch) {
          const fetched = await fetchNaverLive(query, args);
          const provider = fetched.provider || 'naver_search';
          if (fetched.status < 200 || fetched.status >= 300) {
            const failure = {
              provider,
              query,
              fetched_at: fetchedAt,
              status: 'http_error',
              blocked_reason: fetched.blocked_reason || 'NAVER_SEARCH_HTTP_ERROR',
              http_status: fetched.status,
              fetch_url: fetched.url,
              fetcher: fetched.fetcher,
              result_count: 0,
              results: [],
              place_candidates: [],
            };
            attempts.push(failure);
            searchLog.push({ id: row.id, video_id: row.video_id, query, provider, fetched_at: fetchedAt, status: 'http_error', http_status: fetched.status, blocked_reason: failure.blocked_reason, result_count: 0 });
          } else {
            const parsed = parseNaverSearch(fetched.html, row, query, fetchedAt, provider);
            attempts.push({ ...parsed, http_status: fetched.status, fetch_url: fetched.url });
            searchLog.push({ id: row.id, video_id: row.video_id, query, provider, fetched_at: fetchedAt, status: 'ok', http_status: fetched.status, result_count: parsed.result_count });
          }
          await sleep(args.delayMs);
        } else {
          attempts.push({ provider: 'naver_search', query, fetched_at: fetchedAt, status: 'skipped', blocked_reason: 'live_search_not_enabled', result_count: 0, results: [], place_candidates: [] });
          searchLog.push({ id: row.id, video_id: row.video_id, query, provider: 'naver_search', fetched_at: fetchedAt, status: 'skipped', blocked_reason: 'live_search_not_enabled', result_count: 0 });
        }
      } catch (error) {
        logSafeError(error, (line) => process.stderr.write(`case_review_search_failed ${line}`));
        const failure = { provider: 'naver_search', query, fetched_at: fetchedAt, status: 'failed', blocked_reason: 'search_failed', result_count: 0, results: [], place_candidates: [] };
        attempts.push(failure);
        searchLog.push({ id: row.id, video_id: row.video_id, query, provider: 'naver_search', fetched_at: fetchedAt, status: 'failed', blocked_reason: 'search_failed', result_count: 0 });
      }
      const minimumConfirmationAttempts = Math.min(2, queries.length);
      if (attempts.length >= minimumConfirmationAttempts && scoreCase(row, attempts).decision === 'confirmed_external_place') break;
    }
    caseRows.push(buildCaseReviewRow(row, attempts, generatedAt));
  }

  const summary = summarize(caseRows, args.out);
  await writeJson(path.join(args.out, 'summary.json'), summary);
  await writeJsonl(path.join(args.out, 'case-review.jsonl'), caseRows);
  await writeJsonl(path.join(args.out, 'confirmed-external-place.jsonl'), caseRows.filter((row) => row.case_decision === 'confirmed_external_place'));
  await writeJsonl(path.join(args.out, 'needs-operator-review.jsonl'), caseRows.filter((row) => row.case_decision !== 'confirmed_external_place'));
  await writeJsonl(path.join(args.out, 'search-log.jsonl'), searchLog);
  await fs.writeFile(path.join(args.out, 'README.md'), `# 쯔양 주소 수동검수 케이스별 evidence pack\n\n- 생성시각: ${summary.generated_at}\n- 모드: 읽기 전용 / DB 쓰기 없음\n- 대상 rows: ${summary.total_case_rows}\n- 외부 place 확정 후보: ${summary.confirmed_external_place_rows}\n- 고정 위치 없음/마스킹 등 자동 반영 불가: ${summary.fixed_location_unavailable_rows}\n- 운영자 검토 유지: ${summary.needs_operator_review_rows}\n\n## 파일\n\n- case-review.jsonl: 1 row = 1 케이스 검수 결과\n- confirmed-external-place.jsonl: 영상 근거 + 외부 place 후보가 교차 확인된 후보\n- needs-operator-review.jsonl: 자동 반영 금지/추가 검토 대상\n- search-log.jsonl: query/provider/status/snapshot log\n\n주의: 이 패키지는 Supabase를 갱신하지 않습니다. confirmed 후보도 별도 strict ledger 승격 및 guarded dry-run/readback 후에만 반영하세요.\n`, 'utf8');

  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(`Wrote ${args.out} (${summary.total_case_rows} rows, confirmed=${summary.confirmed_external_place_rows}, review=${summary.needs_operator_review_rows})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logSafeError(error, (line) => process.stderr.write(`case_review_pack_failed ${line}`));
    process.exitCode = 1;
  });
}

export {
  buildQueries,
  fetchNaverWithLimits,
  parseNaverSearch,
  scoreCase,
  spawnFileJson,
};

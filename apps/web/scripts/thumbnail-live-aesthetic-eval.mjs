#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile, copyFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logCliError, safeCliErrorName } from './privacy-safe-cli-log.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, '..');
const repoRoot = resolve(appRoot, '../..');

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_ARTIFACT_ROOT = resolve(repoRoot, '.omx/artifacts/thumbnail-live-aesthetic');
const TARGET = { width: 1280, height: 720, aspectRatio: '16:9' };
const EXACT_PROVIDER = { providerId: 'local-codex', model: 'gpt-image-2', modelProvenance: 'exact' };
const V1_VISUAL_GATE = { average: 94, min: 90, releaseMinScore: 90 };
const ISSUE_TAGS = ['blank_space', 'synthetic_host', 'weak_focus', 'text_conflict', 'food_density', 'lighting', 'none'];
const ASSIGNED_BY = ['script', 'human-vision-adjudication', 'script+human-vision-adjudication'];
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const DEFAULT_RETRY_CAP = 0;
const OPERATION_CODE = 'thumbnail_live_aesthetic_evaluation';
const SAFE_OPERATION_ERROR_CODES = new Set([
  'thumbnail_exact_provenance_unavailable',
  'thumbnail_invalid_response',
  'thumbnail_live_aesthetic_failed',
  'thumbnail_provider_failed',
  'thumbnail_provider_quota',
  'thumbnail_provider_timeout',
  'thumbnail_readiness_failed',
]);
const SAFE_RETRIEVAL_STATUSES = new Set(['disabled', 'fallback', 'partial', 'used']);
const SAFE_RETRIEVAL_FALLBACK_CODES = new Set([
  'disabled',
  'empty_result',
  'invalid_json',
  'missing_dependency',
  'missing_supabase_env',
  'rpc_unavailable',
  'timeout',
  'unknown_error',
  'unsafe_reference',
]);

function createOperationError(code) {
  const error = new Error(code);
  error.name = 'thumbnail_live_aesthetic_error';
  error.code = code;
  return error;
}

function safeOperationErrorCode(error) {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
      return 'thumbnail_live_aesthetic_failed';
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    const code = descriptor && 'value' in descriptor ? descriptor.value : null;
    return typeof code === 'string' && SAFE_OPERATION_ERROR_CODES.has(code)
      ? code
      : 'thumbnail_live_aesthetic_failed';
  } catch {
    return 'thumbnail_live_aesthetic_failed';
  }
}

function boundedCount(value, maximum = 10_000) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, maximum)
    : 0;
}

function safeBaseUrlScope(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
    if (!localHosts.has(parsed.hostname)) return 'non_local';
    return parsed.protocol === 'https:' ? 'local_https' : parsed.protocol === 'http:' ? 'local_http' : 'unsupported';
  } catch {
    return 'invalid';
  }
}

const subjects = [
  {
    id: 'spicy-pork-rice',
    preset: 'grilled-meat-feast',
    topic: '제육볶음과 갓 지은 흰밥을 크게 차린 한국 먹방 썸네일. 사람, 얼굴, 실루엣, 컷아웃 없이 음식만 주인공으로 구성한다.',
    headline: '제육볶음 먹방',
    subHeadline: '밥도둑 인정?',
    textLayers: [
      layer('main', '제육볶음 먹방', 648, 536, 102, '#ffffff', '#101010', 10, 0),
      layer('hook', '밥도둑 인정?', 1000, 170, 54, '#fff200', '#111111', 7, -6),
    ],
  },
  {
    id: 'tteokbokki-ramen',
    preset: 'tzuyang-food-travel-collage',
    topic: '매운 떡볶이, 라면, 김밥이 화면 가득한 한국 분식 먹방 썸네일. 사람, 얼굴, 실루엣, 컷아웃 없이 음식만 주인공으로 구성한다.',
    headline: '떡볶이 먹방',
    subHeadline: '맵기 실화?',
    textLayers: [
      layer('main', '떡볶이 먹방', 636, 540, 104, '#ffffff', '#101010', 10, 0),
      layer('hook', '맵기 실화?', 982, 166, 58, '#fff200', '#111111', 7, -5),
    ],
  },
  {
    id: 'seafood-crab',
    preset: 'sushi-seafood-table',
    topic: '대게, 킹크랩, 새우, 해산물이 푸짐하게 놓인 고급 해산물 먹방 썸네일. 사람, 얼굴, 실루엣, 컷아웃 없이 음식만 주인공으로 구성한다.',
    headline: '대게 먹방',
    subHeadline: '퀄리티 미쳤다',
    textLayers: [
      layer('main', '대게 먹방', 620, 532, 106, '#ffffff', '#101010', 10, 0),
      layer('hook', '퀄리티 미쳤다', 962, 166, 52, '#fff200', '#111111', 7, -4),
    ],
  },
  {
    id: 'night-market-skewers',
    preset: 'night-market-reaction',
    topic: '야시장 꼬치, 어묵, 닭꼬치, 튀김이 화려하게 펼쳐진 한국 길거리 음식 먹방 썸네일. 사람, 얼굴, 실루엣, 컷아웃 없이 음식만 주인공으로 구성한다.',
    headline: '꼬치 먹방',
    subHeadline: '야시장 클라스',
    textLayers: [
      layer('main', '꼬치 먹방', 626, 532, 104, '#ffffff', '#101010', 10, 0),
      layer('hook', '야시장 클라스', 956, 166, 52, '#fff200', '#111111', 7, -4),
    ],
  },
];

function layer(id, content, x, y, fontSize, fill, stroke, strokeWidth, rotation) {
  return {
    id,
    content,
    x,
    y,
    fontFamily: 'Pretendard',
    fontSize,
    fontWeight: 900,
    fill,
    stroke,
    strokeWidth,
    shadow: '0 10px 22px rgba(0,0,0,0.66)',
    align: 'center',
    rotation,
    zIndex: id === 'main' ? 20 : 21,
  };
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.THUMBNAIL_BATCH_BASE_URL || DEFAULT_BASE_URL,
    artifactRoot: process.env.THUMBNAIL_BATCH_ARTIFACT_ROOT || DEFAULT_ARTIFACT_ROOT,
    timeoutMs: Number(process.env.THUMBNAIL_BATCH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    retryCap: Number(process.env.THUMBNAIL_BATCH_RETRY_CAP || DEFAULT_RETRY_CAP),
    samplesPerSubject: Number(process.env.THUMBNAIL_BATCH_SAMPLES_PER_SUBJECT || 3),
    token: process.env.THUMBNAIL_ADMIN_BYPASS_TOKEN || process.env.E2E_ADMIN_ROUTE_BYPASS_TOKEN || '',
    syncOnly: false,
    baselineRoot: process.env.THUMBNAIL_BATCH_BASELINE_ROOT || '',
    compareOut: process.env.THUMBNAIL_BATCH_COMPARE_OUT || '',
    runLabel: process.env.THUMBNAIL_BATCH_RUN_LABEL || 'candidate',
    baselineLabel: process.env.THUMBNAIL_BATCH_BASELINE_LABEL || 'baseline',
  };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--base-url') { args.baseUrl = value; index += 1; }
    else if (key === '--artifact-root') { args.artifactRoot = value; index += 1; }
    else if (key === '--timeout-ms') { args.timeoutMs = Number(value); index += 1; }
    else if (key === '--retry-cap') { args.retryCap = Number(value); index += 1; }
    else if (key === '--samples-per-subject') { args.samplesPerSubject = Number(value); index += 1; }
    else if (key === '--token') { args.token = value; index += 1; }
    else if (key === '--baseline-root') { args.baselineRoot = value; index += 1; }
    else if (key === '--compare-out') { args.compareOut = value; index += 1; }
    else if (key === '--run-label') { args.runLabel = value; index += 1; }
    else if (key === '--baseline-label') { args.baselineLabel = value; index += 1; }
    else if (key === '--sync-only') { args.syncOnly = true; }
    else if (key === '--help') {
      console.log('Usage: node apps/web/scripts/thumbnail-live-aesthetic-eval.mjs [--base-url URL] [--artifact-root PATH] [--timeout-ms N] [--retry-cap N] [--samples-per-subject N] [--token TOKEN] [--sync-only] [--baseline-root PATH] [--compare-out PATH] [--run-label LABEL] [--baseline-label LABEL]');
      process.exit(0);
    }
  }
  args.artifactRoot = resolve(args.artifactRoot);
  if (args.baselineRoot) args.baselineRoot = resolve(args.baselineRoot);
  if (args.compareOut) args.compareOut = resolve(args.compareOut);
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 60_000) throw new Error('--timeout-ms must be at least 60000');
  if (!Number.isFinite(args.retryCap) || args.retryCap < 0 || args.retryCap > 2) throw new Error('--retry-cap must be 0..2');
  if (!Number.isFinite(args.samplesPerSubject) || args.samplesPerSubject < 1 || args.samplesPerSubject > 3) throw new Error('--samples-per-subject must be 1..3');
  return args;
}

function listenerPidsForPort(port) {
  try {
    const output = execFileSync('ss', ['-ltnp'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output
      .split(/\r?\n/)
      .filter((line) => line.includes(`:${port} `))
      .map((line) => [...line.matchAll(/pid=(\d+)/g)].map((match) => match[1]))
      .flat();
  } catch {
    return [];
  }
}

async function readProcEnv(pid, key) {
  try {
    const raw = await readFile(`/proc/${pid}/environ`);
    for (const entry of raw.toString('utf8').split('\0')) {
      if (entry.startsWith(`${key}=`)) return entry.slice(key.length + 1);
    }
  } catch {
    return '';
  }
  return '';
}

async function resolveBypassToken(args) {
  if (args.token) return args.token;
  const port = new URL(args.baseUrl).port || (new URL(args.baseUrl).protocol === 'https:' ? '443' : '80');
  for (const pid of listenerPidsForPort(port)) {
    const token = await readProcEnv(pid, 'E2E_ADMIN_ROUTE_BYPASS_TOKEN');
    if (token) return token;
  }
  throw new Error('E2E admin bypass token was not found in env or listener process; refusing unauthenticated admin calls.');
}

function assertLocalDevBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing unsupported dev admin bypass protocol: ${parsed.protocol}`);
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error('Refusing to send dev admin bypass token to non-local base URL.');
  }
}

function cookieHeaderFromResponse(response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const cookie = raw.map((item) => item.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('Bootstrap did not return a dev admin bypass cookie.');
  return cookie;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw createOperationError('thumbnail_provider_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function bootstrapSession(args) {
  assertLocalDevBaseUrl(args.baseUrl);
  const token = await resolveBypassToken(args);
  const nextPath = '/admin?module=youtube-thumbnail-generator';
  const bootstrapUrl = new URL('/api/dev/admin-thumbnail-bootstrap', args.baseUrl);
  bootstrapUrl.searchParams.set('token', token);
  bootstrapUrl.searchParams.set('next', nextPath);
  const response = await fetchWithTimeout(bootstrapUrl, { redirect: 'manual' }, 20_000);
  if (!response.ok) throw createOperationError('thumbnail_readiness_failed');
  return cookieHeaderFromResponse(response);
}

async function preflight(args, cookie) {
  const response = await fetchWithTimeout(new URL('/api/admin/youtube-thumbnail-generator', args.baseUrl), {
    headers: { cookie },
  }, 30_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw createOperationError('thumbnail_readiness_failed');
  const localCodex = body?.providers?.localCodex;
  const exactReady = Boolean(
    localCodex?.available === true &&
    localCodex?.providerId === EXACT_PROVIDER.providerId &&
    localCodex?.model === EXACT_PROVIDER.model &&
    localCodex?.modelProvenance === EXACT_PROVIDER.modelProvenance &&
    localCodex?.strictExactModelRequired === true
  );
  if (!exactReady) throw createOperationError('thumbnail_exact_provenance_unavailable');
  return {
    target: TARGET,
    localCodex: {
      available: true,
      ...EXACT_PROVIDER,
      strictExactModelRequired: true,
    },
  };
}

function makeRuns(samplesPerSubject) {
  const runs = [];
  for (const subject of subjects) {
    for (let repeat = 1; repeat <= samplesPerSubject; repeat += 1) {
      runs.push({
        id: `${String(runs.length + 1).padStart(2, '0')}-${subject.id}-r${repeat}`,
        subject,
        repeat,
      });
    }
  }
  return runs;
}

function payloadForRun(run) {
  return {
    providerId: EXACT_PROVIDER.providerId,
    generationMode: 'direct_provider',
    topic: `${run.subject.topic} 반복 ${run.repeat}/3. 음식이 프레임의 70-85%를 채우고, 최종 한국어 문구가 들어갈 자연스러운 어두운 배경/얕은 심도 영역만 남기되 빈 박스, 베이지색 placeholder strip, 흰색 라벨 영역은 절대 그리지 않는 16:9 라이브 미학 평가 샘플.`,
    headline: run.subject.headline,
    subHeadline: run.subject.subHeadline,
    stylePreset: run.subject.preset,
    referenceImageRoles: [],
    acknowledgedSafety: true,
    textLayers: run.subject.textLayers,
  };
}
function safeRequestSummary(run) {
  return {
    operationCode: 'thumbnail_generation_request',
    subjectId: run.subject.id,
    repeat: run.repeat,
    providerId: EXACT_PROVIDER.providerId,
    generationMode: 'direct_provider',
    target: TARGET,
    textLayerCount: run.subject.textLayers.length,
  };
}

function decodeDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!match) throw new Error('baseImage.dataUrl was not a supported image data URL.');
  return { mime: match[1].toLowerCase(), bytes: Buffer.from(match[2], 'base64') };
}

function assertExactBaseImage(baseImage) {
  if (
    !baseImage ||
    baseImage.providerId !== EXACT_PROVIDER.providerId ||
    baseImage.model !== EXACT_PROVIDER.model ||
    baseImage.modelProvenance !== EXACT_PROVIDER.modelProvenance ||
    baseImage.targetWidth !== TARGET.width ||
    baseImage.targetHeight !== TARGET.height
  ) {
    throw createOperationError('thumbnail_exact_provenance_unavailable');
  }
}

function responseFailureCode(status) {
  if (status === 429) return 'thumbnail_provider_quota';
  if (status === 408 || status === 504) return 'thumbnail_provider_timeout';
  return 'thumbnail_provider_failed';
}

async function postRun(args, cookie, run) {
  const payload = payloadForRun(run);
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  const startedAt = Date.now();
  const response = await fetchWithTimeout(new URL('/api/admin/youtube-thumbnail-generator', args.baseUrl), {
    method: 'POST',
    headers: { cookie },
    body: form,
  }, args.timeoutMs);
  const text = await response.text();
  const elapsedMs = Date.now() - startedAt;
  if (!response.ok) throw createOperationError(responseFailureCode(response.status));
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw createOperationError('thumbnail_invalid_response');
  }
  assertExactBaseImage(body.baseImage);
  const image = decodeDataUrl(body.baseImage.dataUrl);
  if (image.mime !== 'image/png') throw createOperationError('thumbnail_invalid_response');
  return { body, imageBytes: image.bytes, elapsedMs };
}

function safeWarningSummary(value) {
  const warningCount = Array.isArray(value) ? Math.min(value.length, 100) : 0;
  return {
    warningCount,
    warnings: warningCount > 0 ? ['provider_warning'] : [],
  };
}

function safeRetrievalDiagnostics(value) {
  const diagnostics = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const status = SAFE_RETRIEVAL_STATUSES.has(diagnostics.status) ? diagnostics.status : 'unknown';
  const fallbackCode = SAFE_RETRIEVAL_FALLBACK_CODES.has(diagnostics.fallbackReason)
    ? diagnostics.fallbackReason
    : null;
  const operations = diagnostics.operations && typeof diagnostics.operations === 'object' && !Array.isArray(diagnostics.operations)
    ? diagnostics.operations
    : {};
  return {
    status,
    fallbackCode,
    candidateCount: boundedCount(diagnostics.candidateCount),
    denseSparseHybrid: operations.denseSparseHybrid === true,
    mmrApplied: operations.mmrApplied === true,
    rerankerApplied: operations.rerankerApplied === true,
    captionEnrichmentApplied: operations.captionEnrichmentApplied === true,
    localVectorSearch: operations.localVectorSearch === true,
    lexicalRerank: operations.lexicalRerank === true,
  };
}

function summarizeResponse(body) {
  const warningSummary = safeWarningSummary(body.warnings);
  return {
    baseImage: body.baseImage ? {
      mime: 'image/png',
      width: TARGET.width,
      height: TARGET.height,
      targetWidth: TARGET.width,
      targetHeight: TARGET.height,
      ...EXACT_PROVIDER,
    } : null,
    ...warningSummary,
    retrieval: body.retrieval ? {
      diagnostics: safeRetrievalDiagnostics(body.retrieval.diagnostics),
      evidenceCount: Array.isArray(body.retrieval.evidence) ? Math.min(body.retrieval.evidence.length, 100) : 0,
    } : null,
    promptRecorded: false,
  };
}

async function runOne(args, cookie, dirs, run) {
  let lastError;
  for (let attempt = 0; attempt <= args.retryCap; attempt += 1) {
    const attemptStartedAt = new Date().toISOString();
    try {
      const result = await postRun(args, cookie, run);
      const responseSummary = summarizeResponse(result.body);
      const pngPath = join(dirs.generated, `${run.id}.png`);
      const responsePath = join(dirs.responses, `${run.id}.json`);
      await writeFile(pngPath, result.imageBytes);
      await writeFile(responsePath, JSON.stringify({
        id: run.id,
        subjectId: run.subject.id,
        repeat: run.repeat,
        startedAt: attemptStartedAt,
        elapsedMs: result.elapsedMs,
        payload: safeRequestSummary(run),
        response: responseSummary,
      }, null, 2), 'utf8');
      return {
        id: run.id,
        subjectId: run.subject.id,
        repeat: run.repeat,
        status: 'passed',
        attempts: attempt + 1,
        startedAt: attemptStartedAt,
        completedAt: new Date().toISOString(),
        elapsedMs: result.elapsedMs,
        imagePath: relative(repoRoot, pngPath),
        responsePath: relative(repoRoot, responsePath),
        bytes: result.imageBytes.length,
        sha256: createHash('sha256').update(result.imageBytes).digest('hex'),
        providerId: EXACT_PROVIDER.providerId,
        model: EXACT_PROVIDER.model,
        modelProvenance: EXACT_PROVIDER.modelProvenance,
        warnings: responseSummary.warnings,
        warningCount: responseSummary.warningCount,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= args.retryCap) break;
    }
  }
  return {
    id: run.id,
    subjectId: run.subject.id,
    repeat: run.repeat,
    status: 'failed',
    attempts: args.retryCap + 1,
    completedAt: new Date().toISOString(),
    errorName: safeCliErrorName(lastError),
    errorCode: safeOperationErrorCode(lastError),
  };
}

function technicalScore(run) {
  if (run.status !== 'passed') return { score: 0, status: 'failed', reasons: [run.errorCode || 'thumbnail_provider_failed'] };
  const reasons = [];
  let score = 0;
  score += 25; reasons.push('exact local-codex provider passed');
  score += 25; reasons.push('gpt-image-2 exact provenance passed');
  score += 15; reasons.push('image/png response persisted');
  score += 15; reasons.push('1280x720 target contract passed');
  if (run.elapsedMs <= DEFAULT_TIMEOUT_MS) { score += 10; reasons.push('latency within configured timeout'); }
  else reasons.push('latency exceeded default timeout');
  if (run.bytes > 100_000) { score += 10; reasons.push('non-trivial raster output size'); }
  else reasons.push('small output size watch');
  return { score, status: score >= 90 ? 'passed' : 'watch', reasons };
}

function isExactRun(run) {
  return run?.status === 'passed' &&
    run.providerId === EXACT_PROVIDER.providerId &&
    run.model === EXACT_PROVIDER.model &&
    run.modelProvenance === EXACT_PROVIDER.modelProvenance;
}

function normalizeIssueTags(inputTags, score, notes = '') {
  const explicitTags = Array.isArray(inputTags) ? inputTags.filter(Boolean) : [];
  const unknown = explicitTags.filter((tag) => !ISSUE_TAGS.includes(tag));
  if (unknown.length) throw new Error(`Unknown visual issue tag(s): ${unknown.join(', ')}`);
  let tags = explicitTags.length ? [...new Set(explicitTags)] : [];
  if (!tags.length) {
    const lowerNotes = String(notes).toLowerCase();
    if (/빈 공간|과도.*여백|blank/.test(notes) || lowerNotes.includes('empty')) tags.push('blank_space');
    if (/합성|일러스트|컷아웃/.test(notes) || lowerNotes.includes('synthetic')) tags.push('synthetic_host');
    if (/집중도|분산|흐림|어둡/.test(notes) || lowerNotes.includes('focus')) tags.push('weak_focus');
    if (/텍스트.*충돌|텍스트 여백|빡빡/.test(notes) || lowerNotes.includes('text')) tags.push('text_conflict');
    if (/밀도.*부족|풍성하나/.test(notes) || lowerNotes.includes('density')) tags.push('food_density');
    if (/조명|밝기|어둡/.test(notes) || lowerNotes.includes('lighting')) tags.push('lighting');
    if (!tags.length) tags.push(Number(score) >= V1_VISUAL_GATE.releaseMinScore ? 'none' : 'weak_focus');
  }
  tags = [...new Set(tags)];
  if (tags.includes('none') && tags.length > 1) tags = tags.filter((tag) => tag !== 'none');
  return tags.length ? tags : ['none'];
}

function normalizeAssignedBy(value, hasVisualScore) {
  if (ASSIGNED_BY.includes(value)) return value;
  return hasVisualScore ? 'human-vision-adjudication' : 'script';
}

function visualScoreOf(run) {
  const score = run?.visualAestheticScore?.score ?? run?.visual?.score;
  return Number.isFinite(score) ? Number(score) : null;
}

function normalizeTzuyangHostPresence(value) {
  const proof = value && typeof value === 'object' ? value : null;
  if (!proof) return null;
  const hostPresence = proof.hostPresence && typeof proof.hostPresence === 'object' ? proof.hostPresence : proof;
  const creatorText = [
    hostPresence.creator,
    hostPresence.creatorId,
    hostPresence.identity,
    hostPresence.identityName,
    hostPresence.name,
    hostPresence.person,
    hostPresence.subject,
    hostPresence.channel,
  ].filter(Boolean).join(' ');
  const visible = hostPresence.visible === true
    || hostPresence.hostVisible === true
    || hostPresence.personVisible === true
    || hostPresence.tzuyangVisible === true
    || hostPresence.containsTzuyang === true;
  if (!visible || !/(쯔양|tzuyang)/i.test(creatorText)) return null;
  return {
    creator: 'tzuyang',
    visible: true,
    evidence: String(hostPresence.evidence || hostPresence.source || hostPresence.verifiedBy || 'visual-host-proof').slice(0, 120),
  };
}

function decorateVisualMetadata(runs, batchPassed = false) {
  return runs.map((run) => {
    const score = visualScoreOf(run);
    const existingVisual = run.visual && typeof run.visual === 'object' ? run.visual : {};
    const notes = run.visualAestheticScore?.notes || existingVisual.notes || '';
    const issueTags = normalizeIssueTags(existingVisual.issueTags || run.visualAestheticScore?.issueTags, score ?? 0, notes);
    const assignedBy = normalizeAssignedBy(existingVisual.assignedBy || run.visualAestheticScore?.assignedBy, score !== null);
    const hostPresence = normalizeTzuyangHostPresence(existingVisual.hostPresence)
      || normalizeTzuyangHostPresence(run.visualAestheticScore?.hostPresence)
      || normalizeTzuyangHostPresence(run.hostPresence);
    const releaseCandidate = Boolean(
      batchPassed &&
      isExactRun(run) &&
      hostPresence &&
      score !== null &&
      score >= V1_VISUAL_GATE.releaseMinScore &&
      issueTags.length === 1 &&
      issueTags[0] === 'none'
    );
    return {
      ...run,
      visual: {
        ...existingVisual,
        score,
        issueTags,
        assignedBy,
        ...(hostPresence ? { hostPresence } : {}),
        releaseCandidate,
      },
      visualAestheticScore: run.visualAestheticScore ? {
        ...run.visualAestheticScore,
        issueTags,
        assignedBy,
      } : run.visualAestheticScore,
      releaseCandidate,
    };
  });
}

function issueTagCounts(runs) {
  const counts = Object.fromEntries(ISSUE_TAGS.map((tag) => [tag, 0]));
  for (const run of runs) {
    const tags = run.visual?.issueTags || ['none'];
    for (const tag of tags) counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function summarizeVisualAesthetics(runs) {
  const scored = runs.filter((run) => visualScoreOf(run) !== null);
  const scores = scored.map((run) => visualScoreOf(run));
  if (!scores.length) {
    return {
      status: 'unscored',
      average: null,
      min: null,
      max: null,
      passed90Count: 0,
      total: runs.length,
      scoredCount: 0,
      issueTagCounts: issueTagCounts(decorateVisualMetadata(runs, false)),
      releaseCandidateCount: 0,
      gate: V1_VISUAL_GATE,
      passedV1Gate: false,
      finding: 'No human/vision visual scores are present yet; exact technical generation is not enough for aesthetic release.',
    };
  }
  const average = Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2));
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const passed90Count = scores.filter((score) => score >= V1_VISUAL_GATE.releaseMinScore).length;
  const technicalExact = runs.length > 0 && runs.every(isExactRun);
  const passedV1Gate = technicalExact && scored.length === runs.length && average >= V1_VISUAL_GATE.average && min >= V1_VISUAL_GATE.min;
  const decorated = decorateVisualMetadata(runs, passedV1Gate);
  return {
    status: passedV1Gate ? 'passed' : 'watch',
    average,
    min,
    max,
    passed90Count,
    total: runs.length,
    scoredCount: scored.length,
    issueTagCounts: issueTagCounts(decorated),
    releaseCandidateCount: decorated.filter((run) => run.releaseCandidate === true).length,
    gate: V1_VISUAL_GATE,
    passedV1Gate,
    rubricScale: '100 total = 20 appetite + 20 composition + 20 text-safe space + 20 non-identifying host safety + 20 repeat consistency',
    finding: passedV1Gate
      ? 'Candidate batch meets the v1 stabilization gate; only issueTags [none] runs are release candidates.'
      : 'Candidate batch remains below the v1 stabilization gate or has watch tags; keep watch cases in QA history only.',
  };
}

function subjectStats(runs) {
  const groups = new Map();
  for (const run of runs) {
    if (!groups.has(run.subjectId)) groups.set(run.subjectId, []);
    groups.get(run.subjectId).push(run);
  }
  return Object.fromEntries([...groups.entries()].map(([subjectId, subjectRuns]) => {
    const scores = subjectRuns.map(visualScoreOf).filter((score) => score !== null);
    const average = scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : null;
    return [subjectId, {
      total: subjectRuns.length,
      scoredCount: scores.length,
      average,
      min: scores.length ? Math.min(...scores) : null,
      passed90Count: scores.filter((score) => score >= V1_VISUAL_GATE.releaseMinScore).length,
    }];
  }));
}

function compareVisualBatches({ baseline, candidate, baselineLabel, candidateLabel }) {
  const baselineComputedSummary = summarizeVisualAesthetics(decorateVisualMetadata(baseline.runs || [], false));
  const candidateComputedSummary = summarizeVisualAesthetics(decorateVisualMetadata(candidate.runs || [], candidate.visualAestheticSummary?.passedV1Gate === true));
  const baselineSummary = { ...baselineComputedSummary, ...(baseline.visualAestheticSummary || {}) };
  if (!baselineSummary.issueTagCounts) baselineSummary.issueTagCounts = baselineComputedSummary.issueTagCounts;
  const candidateSummary = { ...candidateComputedSummary, ...(candidate.visualAestheticSummary || {}) };
  if (!candidateSummary.issueTagCounts) candidateSummary.issueTagCounts = candidateComputedSummary.issueTagCounts;
  const baselineSubjects = subjectStats(baseline.runs || []);
  const candidateSubjects = subjectStats(candidate.runs || []);
  const perSubject = {};
  for (const subjectId of new Set([...Object.keys(baselineSubjects), ...Object.keys(candidateSubjects)])) {
    const before = baselineSubjects[subjectId] || {};
    const after = candidateSubjects[subjectId] || {};
    perSubject[subjectId] = {
      baselineAverage: before.average ?? null,
      candidateAverage: after.average ?? null,
      deltaAverage: before.average != null && after.average != null ? Number((after.average - before.average).toFixed(2)) : null,
      baselineMin: before.min ?? null,
      candidateMin: after.min ?? null,
      deltaMin: before.min != null && after.min != null ? Number((after.min - before.min).toFixed(2)) : null,
      baselinePass90: before.passed90Count ?? 0,
      candidatePass90: after.passed90Count ?? 0,
    };
  }
  return {
    status: candidateSummary.passedV1Gate ? 'passed' : 'watch',
    baselineLabel,
    candidateLabel,
    baseline: {
      average: baselineSummary.average,
      min: baselineSummary.min,
      pass90: baselineSummary.passed90Count,
      issueTagCounts: baselineSummary.issueTagCounts || null,
    },
    candidate: {
      average: candidateSummary.average,
      min: candidateSummary.min,
      pass90: candidateSummary.passed90Count,
      issueTagCounts: candidateSummary.issueTagCounts || null,
      releaseCandidateCount: candidateSummary.releaseCandidateCount || 0,
      passedV1Gate: candidateSummary.passedV1Gate === true,
    },
    delta: {
      average: baselineSummary.average != null && candidateSummary.average != null ? Number((candidateSummary.average - baselineSummary.average).toFixed(2)) : null,
      min: baselineSummary.min != null && candidateSummary.min != null ? Number((candidateSummary.min - baselineSummary.min).toFixed(2)) : null,
      pass90: (candidateSummary.passed90Count || 0) - (baselineSummary.passed90Count || 0),
      requiredAverage: baselineSummary.average != null ? Number((V1_VISUAL_GATE.average - baselineSummary.average).toFixed(2)) : null,
      requiredMin: baselineSummary.min != null ? Number((V1_VISUAL_GATE.min - baselineSummary.min).toFixed(2)) : null,
    },
    perSubject,
    gate: V1_VISUAL_GATE,
  };
}

async function maybeCompareBatches(args, candidatePayload) {
  if (!args.baselineRoot) return null;
  const baseline = await readJson(join(args.baselineRoot, 'scores.json'));
  const comparison = compareVisualBatches({
    baseline,
    candidate: candidatePayload,
    baselineLabel: args.baselineLabel,
    candidateLabel: args.runLabel,
  });
  const comparePath = args.compareOut || join(args.artifactRoot, 'comparison.json');
  await mkdir(dirname(comparePath), { recursive: true });
  await writeJson(comparePath, comparison);
  return { ...comparison, path: relative(repoRoot, comparePath) };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function safeHistoryTimestamp(value) {
  const date = Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  return date.toISOString().replace(/[:.]/g, '-');
}

function safeHistoryId(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 120) || `thumbnail-history-${Date.now()}`;
}

async function syncReadbackHistory(artifactRoot, runs) {
  const passedRuns = runs.filter((run) => run.status === 'passed' && run.imagePath && run.responsePath);
  const publicImageDir = resolve(appRoot, 'public/qa-history/youtube-thumbnail-generator/generated/live-aesthetic');
  const historyRoot = resolve(appRoot, '.omx/runtime/youtube-thumbnail-history');
  const runsRoot = join(historyRoot, 'runs');
  const historyPath = join(historyRoot, 'history.json');
  const latestPath = join(historyRoot, 'latest.json');
  await mkdir(publicImageDir, { recursive: true });
  await mkdir(runsRoot, { recursive: true });

  let existingRuns = [];
  try {
    const existing = await readJson(historyPath);
    existingRuns = Array.isArray(existing.runs) ? existing.runs : [];
  } catch {}

  const syncedRuns = [];
  for (const run of passedRuns) {
    const sourcePng = resolve(repoRoot, run.imagePath);
    const responseJson = await readJson(resolve(repoRoot, run.responsePath));
    const fileName = `${safeHistoryId(run.id)}.png`;
    const publicImagePath = join(publicImageDir, fileName);
    await copyFile(sourcePng, publicImagePath);
    const completedAt = run.completedAt || new Date().toISOString();
    const id = safeHistoryId(`live-aesthetic-${run.id}`);
    const rawFileName = `${id}.json`;
    const historyRun = {
      id,
      timestamp: safeHistoryTimestamp(completedAt),
      completedAt,
      status: 'passed',
      historyKind: 'qa-readback',
      providerId: EXACT_PROVIDER.providerId,
      model: EXACT_PROVIDER.model,
      modelProvenance: EXACT_PROVIDER.modelProvenance,
      generationMode: 'direct_provider',
      topic: run.subjectId,
      headline: OPERATION_CODE,
      warnings: safeWarningSummary(run.warnings).warnings,
      warningCount: safeWarningSummary(run.warnings).warningCount,
      imagePath: `/qa-history/youtube-thumbnail-generator/generated/live-aesthetic/${fileName}`,
      rawPath: `./runs/${rawFileName}`,
      releaseCandidate: run.releaseCandidate === true,
      visual: run.visual || null,
      ...(responseJson.response?.retrieval ? {
        retrieval: {
          diagnostics: safeRetrievalDiagnostics(responseJson.response.retrieval.diagnostics),
          evidenceCount: Array.isArray(responseJson.response.retrieval.evidence)
            ? Math.min(responseJson.response.retrieval.evidence.length, 100)
            : boundedCount(responseJson.response.retrieval.evidenceCount, 100),
        },
      } : {}),
    };
    const rawPayload = {
      ...historyRun,
      source: 'thumbnail-live-aesthetic-eval',
      sourceArtifactRoot: relative(repoRoot, artifactRoot),
      sourceImagePath: run.imagePath,
      sourceResponsePath: run.responsePath,
      sha256: run.sha256,
      bytes: run.bytes,
      technicalScore: run.technicalScore,
      visualAestheticScore: run.visualAestheticScore || null,
      visual: run.visual || null,
      releaseCandidate: run.releaseCandidate === true,
      baseImage: {
        ...(responseJson.response?.baseImage ? {
          mime: 'image/png',
          width: TARGET.width,
          height: TARGET.height,
          targetWidth: TARGET.width,
          targetHeight: TARGET.height,
          ...EXACT_PROVIDER,
        } : {}),
        dataUrl: '[stored separately as imagePath]',
      },
      payload: {
        operationCode: 'thumbnail_generation_request',
        subjectId: run.subjectId,
        repeat: boundedCount(run.repeat, 3),
        providerId: EXACT_PROVIDER.providerId,
        generationMode: 'direct_provider',
        target: TARGET,
      },
    };
    await writeJson(join(runsRoot, rawFileName), rawPayload);
    syncedRuns.push(historyRun);
  }

  const syncedIds = new Set(syncedRuns.map((run) => run.id));
  const mergedRuns = [...syncedRuns.reverse(), ...existingRuns.filter((run) => !syncedIds.has(run.id))].slice(0, 20);
  const updatedAt = new Date().toISOString();
  await writeJson(historyPath, { updatedAt, runs: mergedRuns });
  if (mergedRuns[0]) await writeJson(latestPath, mergedRuns[0]);
  return {
    historyPath: relative(repoRoot, historyPath),
    publicImageDir: relative(repoRoot, publicImageDir),
    runsWritten: syncedRuns.length,
    latestRunId: mergedRuns[0]?.id ?? null,
  };
}

async function writeReleaseCandidateManifest(artifactRoot, runs, visualAestheticSummary, comparison) {
  const releaseCandidates = runs
    .filter((run) => run.releaseCandidate === true)
    .map((run) => ({
      id: run.id,
      subjectId: run.subjectId,
      imagePath: run.imagePath,
      responsePath: run.responsePath,
      providerId: run.providerId,
      model: run.model,
      modelProvenance: run.modelProvenance,
      sha256: run.sha256,
      score: run.visual?.score ?? run.visualAestheticScore?.score ?? null,
      issueTags: run.visual?.issueTags || [],
      assignedBy: run.visual?.assignedBy || run.visualAestheticScore?.assignedBy || 'script',
      hostPresence: run.visual?.hostPresence,
    }));
  const manifestPath = join(artifactRoot, 'release-candidates.json');
  const manifest = {
    purpose: 'release-candidate-manifest',
    source: 'thumbnail-live-aesthetic-eval',
    generatedAt: new Date().toISOString(),
    promotionBoundary: 'QA/browser history is readback evidence only; release/default promotion must read this manifest or releaseCandidate===true, never raw history presence.',
    eligibility: {
      providerId: EXACT_PROVIDER.providerId,
      model: EXACT_PROVIDER.model,
      modelProvenance: EXACT_PROVIDER.modelProvenance,
      minVisualScore: V1_VISUAL_GATE.releaseMinScore,
      issueTags: ['none'],
      batchGate: {
        average: V1_VISUAL_GATE.average,
        min: V1_VISUAL_GATE.min,
        passedV1Gate: visualAestheticSummary?.passedV1Gate === true,
      },
    },
    comparison: comparison ? {
      status: comparison.status,
      path: comparison.path || null,
      delta: comparison.delta || null,
    } : null,
    totalRuns: runs.length,
    releaseCandidateCount: releaseCandidates.length,
    releaseCandidates,
  };
  await writeJson(manifestPath, manifest);
  return {
    path: relative(repoRoot, manifestPath),
    count: releaseCandidates.length,
    promotionBoundary: manifest.promotionBoundary,
  };
}

async function makeContactSheet(artifactRoot) {
  const script = String.raw`
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root = Path(__import__('sys').argv[1])
files = sorted((root / 'generated').glob('*.png'))
if not files:
    raise SystemExit('no images for contact sheet')
thumb_w, thumb_h = 320, 180
label_h = 28
cols = 4
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * thumb_w, rows * (thumb_h + label_h)), 'white')
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('DejaVuSans.ttf', 14)
except Exception:
    font = None
for index, path in enumerate(files):
    image = Image.open(path).convert('RGB')
    image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
    x = (index % cols) * thumb_w
    y = (index // cols) * (thumb_h + label_h)
    frame = Image.new('RGB', (thumb_w, thumb_h), '#111111')
    frame.paste(image, ((thumb_w - image.width)//2, (thumb_h - image.height)//2))
    sheet.paste(frame, (x, y))
    draw.rectangle((x, y + thumb_h, x + thumb_w, y + thumb_h + label_h), fill='#f3f4f6')
    draw.text((x + 8, y + thumb_h + 6), path.stem, fill='#111111', font=font)
out = root / 'contact-sheet.png'
sheet.save(out)
print(out)
`;
  try {
    const out = execFileSync('python3', ['-c', script, artifactRoot], { encoding: 'utf8' }).trim();
    return out ? relative(repoRoot, out) : null;
  } catch (error) {
    return null;
  }
}

async function writeJson(path, payload) {
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
}

async function writeReport(artifactRoot, payload) {
  const lines = [
    '# gpt-image-2 live thumbnail aesthetic batch',
    '',
    `- status: ${payload.status}`,
    `- generated: ${payload.summary.passedCount}/${payload.summary.total}`,
    `- technical/aesthetic gate: ${payload.summary.technicalPassed ? 'passed' : 'failed'} / ${payload.summary.aestheticPassed ? 'passed' : 'watch'}`,
    `- exact model: ${EXACT_PROVIDER.model}`,
    `- provenance policy: exact local-codex gpt-image-2 only; no imagegen tool, no OPENAI_API_KEY fallback, no alternate image model fallback`,
    `- operation: ${payload.execution.operationCode}`,
    `- timeoutMs: ${payload.execution.timeoutMs}`,
    `- retryCap: ${payload.execution.retryCap}`,
    `- artifactRoot: ${relative(repoRoot, artifactRoot)}`,
    `- contactSheet: ${payload.artifacts.contactSheet ?? 'not-created'}`,
    `- releaseCandidates: ${payload.artifacts.releaseCandidates?.path ?? 'not-created'} count=${payload.artifacts.releaseCandidates?.count ?? 0}`,
    payload.visualAestheticSummary ? `- visual average/min/pass90: ${payload.visualAestheticSummary.average ?? 'unscored'} / ${payload.visualAestheticSummary.min ?? 'unscored'} / ${payload.visualAestheticSummary.passed90Count}` : null,
    payload.visualAestheticSummary ? `- v1 gate: average>=${V1_VISUAL_GATE.average}, min>=${V1_VISUAL_GATE.min}, releaseCandidate requires issueTags=[none]` : null,
    payload.comparison ? `- comparison: ${payload.comparison.path ?? 'comparison.json'} status=${payload.comparison.status} delta.average=${payload.comparison.delta.average ?? 'n/a'} delta.min=${payload.comparison.delta.min ?? 'n/a'}` : null,
    '',
    '## Runs',
    '',
    '| id | status | technical | visual | issueTags | release | elapsedMs | artifact |',
    '| --- | --- | ---: | ---: | --- | --- | ---: | --- |',
    ...payload.runs.map((run) => `| ${run.id} | ${run.status} | ${run.technicalScore?.score ?? 0} | ${run.visual?.score ?? run.visualAestheticScore?.score ?? ''} | ${(run.visual?.issueTags || []).join(',') || ''} | ${run.releaseCandidate === true ? 'yes' : 'no'} | ${run.elapsedMs ?? ''} | ${run.imagePath ?? run.errorCode ?? 'thumbnail_provider_failed'} |`),
    '',
    '## Next visual adjudication',
    '',
    'This runner records exact-provenance technical scores plus optional human/vision aesthetic scores. A run is release-promotable only when the full candidate batch passes the v1 gate and that run has issueTags exactly [none].',
  ].filter((line) => line !== null);
  await writeFile(join(artifactRoot, 'report.md'), `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  const artifactRoot = args.artifactRoot;
  const dirs = {
    generated: join(artifactRoot, 'generated'),
    responses: join(artifactRoot, 'responses'),
  };
  await mkdir(dirs.generated, { recursive: true });
  await mkdir(dirs.responses, { recursive: true });

  const runList = makeRuns(args.samplesPerSubject);
  const execution = {
    operationCode: OPERATION_CODE,
    startedAt: new Date().toISOString(),
    baseUrlScope: safeBaseUrlScope(args.baseUrl),
    timeoutMs: args.timeoutMs,
    retryCap: args.retryCap,
    samplesPerSubject: args.samplesPerSubject,
    artifactRoot: relative(repoRoot, artifactRoot),
    target: TARGET,
    exactProvider: EXACT_PROVIDER,
    runLabel: args.runLabel,
    baselineLabel: args.baselineLabel,
    baselineRoot: args.baselineRoot ? relative(repoRoot, args.baselineRoot) : null,
    compareOut: args.compareOut ? relative(repoRoot, args.compareOut) : null,
    v1VisualGate: V1_VISUAL_GATE,
  };
  await writeJson(join(artifactRoot, 'execution.json'), execution);
  const runsJsonl = join(artifactRoot, 'runs.jsonl');
  await writeFile(runsJsonl, '', 'utf8');

  let runs = [];
  if (args.syncOnly) {
    const existingScores = await readJson(join(artifactRoot, 'scores.json'));
    runs = Array.isArray(existingScores.runs) ? existingScores.runs : [];
  } else {
    const cookie = await bootstrapSession(args);
    const readiness = await preflight(args, cookie);
    await writeJson(join(artifactRoot, 'readiness.json'), {
      operationCode: 'thumbnail_readiness_check',
      checkedAt: new Date().toISOString(),
      target: readiness.target,
      localCodex: readiness.localCodex,
    });

    runs = [];
    for (const run of runList) {
      console.error(`[thumbnail-live-aesthetic] ${run.id} start`);
      const result = await runOne(args, cookie, dirs, run);
      result.technicalScore = technicalScore(result);
      runs.push(result);
      await appendFile(runsJsonl, `${JSON.stringify(result)}\n`, 'utf8');
      console.error(`[thumbnail-live-aesthetic] ${run.id} ${result.status} score=${result.technicalScore.score}`);
      if (result.status !== 'passed') break;
    }
  }

  const visualPreSummary = summarizeVisualAesthetics(runs);
  runs = decorateVisualMetadata(runs, visualPreSummary.passedV1Gate);
  const visualAestheticSummary = summarizeVisualAesthetics(runs);
  const readbackHistory = await syncReadbackHistory(artifactRoot, runs);
  const contactSheet = await makeContactSheet(artifactRoot);
  const technicalPassed = runs.length === runList.length && runs.every((run) => run.status === 'passed' && run.technicalScore.score >= 90);
  const aestheticPassed = visualAestheticSummary.passedV1Gate === true;
  const finalStatus = technicalPassed && aestheticPassed ? 'passed' : technicalPassed ? 'watch' : 'failed';
  const summary = {
    total: runList.length,
    attempted: runs.length,
    passedCount: runs.filter((run) => run.status === 'passed').length,
    failedCount: runs.filter((run) => run.status !== 'passed').length,
    technicalPassed,
    aestheticPassed,
    passed: finalStatus === 'passed',
    completedAt: new Date().toISOString(),
  };
  const payload = {
    status: finalStatus,
    execution: { ...execution, completedAt: summary.completedAt },
    summary,
    artifacts: {
      runsJsonl: relative(repoRoot, runsJsonl),
      scoresJson: relative(repoRoot, join(artifactRoot, 'scores.json')),
      report: relative(repoRoot, join(artifactRoot, 'report.md')),
      contactSheet,
      readbackHistory,
      generatedDir: relative(repoRoot, dirs.generated),
      responsesDir: relative(repoRoot, dirs.responses),
    },
    runs,
    visualAestheticSummary,
  };
  payload.comparison = await maybeCompareBatches(args, payload);
  payload.artifacts.releaseCandidates = await writeReleaseCandidateManifest(artifactRoot, runs, visualAestheticSummary, payload.comparison);
  await writeJson(join(artifactRoot, 'scores.json'), payload);
  await writeReport(artifactRoot, payload);
  console.log(JSON.stringify({ status: payload.status, summary, visualAestheticSummary, comparison: payload.comparison, artifacts: payload.artifacts }, null, 2));
  if (payload.status !== 'passed') process.exitCode = 1;
}

main().catch(async (error) => {
  const args = parseArgs(process.argv);
  const artifactRoot = args.artifactRoot;
  await mkdir(artifactRoot, { recursive: true });
  const failure = {
    status: 'blocked',
    operationCode: OPERATION_CODE,
    failedAt: new Date().toISOString(),
    errorName: safeCliErrorName(error),
    errorCode: safeOperationErrorCode(error),
    exactProvider: EXACT_PROVIDER,
    policy: 'fail_closed_exact_local_codex_gpt_image_2_provenance_required',
  };
  await writeJson(join(artifactRoot, 'failure.json'), failure).catch(() => {});
  logCliError({ name: failure.errorName, code: failure.errorCode }, (line) => process.stderr.write(`[thumbnail-live-aesthetic] ${line}`));
  process.exit(1);
});

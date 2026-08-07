#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logCliError, safeCliErrorName } from './privacy-safe-cli-log.mjs'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(WEB_ROOT, '../..')
const DEFAULT_OUTPUT = resolve(REPO_ROOT, '.omx/artifacts/thumbnail-release-readback-certification/result.json')
const FORBIDDEN_PATTERNS = ['.omx', 'storage_object_path', 'storagePath', 'storageBucket', 'SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE']
const FORBIDDEN_PATTERN_LABELS = ['local-artifact-paths', 'private-storage-object-metadata', 'service-role-secret']
const OPERATOR_SCORE_WEIGHTS = { tzuyang: 0.35, pd: 0.25, manager: 0.2, editor: 0.2 }
const OPERATOR_ROLE_THRESHOLDS = { minimumPerRole: 85, weightedTotal: 90 }

function parseArgs(argv) {
  const args = new Map()
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const [key, inlineValue] = item.slice(2).split('=', 2)
    const value = inlineValue ?? (argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : '1')
    args.set(key, value)
  }
  return args
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '')
  if (!raw) return ''
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('thumbnail_release_certification_base_url_invalid')
  return url.toString().replace(/\/$/, '')
}

function parseIpv4Address(hostname) {
  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const octets = v4.slice(1).map((part) => Number(part))
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return { invalid: true, octets: [] }
    return { invalid: false, octets }
  }
  return null
}

function isBlockedIpv4Address(octets) {
  const [a, b, c] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function isBlockedHostedIpAddress(hostname) {
  const host = String(hostname || '').trim().replace(/^\[|\]$/g, '')
  const v4 = parseIpv4Address(host)
  if (v4) return v4.invalid || isBlockedIpv4Address(v4.octets)
  const normalized = host.toLowerCase()
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  )
}

function parseAllowedHostedOrigins(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      try {
        return new URL(item).origin
      } catch {
        return `https://${item}`.replace(/\/$/, '')
      }
    })
}

function getHostedBaseUrlBlocker(baseUrl, allowedOrigins = '') {
  if (!baseUrl) return 'hosted_base_url_required'
  const url = new URL(baseUrl)
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'https:') return 'hosted_real_base_url_required'
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.test') ||
    hostname === 'example.com' ||
    hostname.endsWith('.example.com') ||
    isBlockedHostedIpAddress(hostname)
  ) {
    return 'hosted_real_base_url_required'
  }
  const allowed = parseAllowedHostedOrigins(allowedOrigins)
  if (allowed.length && !allowed.includes(url.origin)) return 'hosted_allowed_origin_required'
  return null
}

function redactSupabaseRef(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  try {
    const host = new URL(raw).host
    const [projectRef] = host.split('.')
    return projectRef ? `${projectRef.slice(0, 3)}***` : 'redacted'
  } catch {
    return 'redacted'
  }
}

function redactedCookieFingerprint(cookie) {
  const raw = String(cookie || '').trim()
  if (!raw) return null
  return `sha256:${createHash('sha256').update(raw).digest('hex').slice(0, 12)}`
}

function createRedactedInputSummary({ hostedEnabled, baseUrl, candidateId, cookie, readerCookie }) {
  const adminFingerprint = redactedCookieFingerprint(cookie)
  const readerFingerprint = redactedCookieFingerprint(readerCookie)
  return {
    hosted_enabled: Boolean(hostedEnabled),
    base_url_origin: baseUrl ? new URL(baseUrl).origin : null,
    candidate_id_present: Boolean(candidateId),
    admin_context_provided: Boolean(cookie),
    reader_context_provided: Boolean(readerCookie),
    admin_context_fingerprint: adminFingerprint,
    reader_context_fingerprint: readerFingerprint,
    distinct_contexts: Boolean(adminFingerprint && readerFingerprint && adminFingerprint !== readerFingerprint),
  }
}

function createOperatorAcceptance() {
  return {
    status: 'not_run',
    passed: false,
    blocks_operator_ready: true,
    score_schema: {
      scale: '0-100',
      weights: OPERATOR_SCORE_WEIGHTS,
      thresholds: OPERATOR_ROLE_THRESHOLDS,
      roles: {
        tzuyang: 'brand_identity_upload_risk',
        pd: 'hook_concept_ctr_narrative',
        manager: 'repeatability_blocked_state_cross_device',
        editor: 'canvas_layer_text_png_workflow',
      },
    },
    scores: { tzuyang: null, pd: null, manager: null, editor: null },
    weighted_total: null,
    blocker: 'operator_score_required_for_operator_ready',
  }
}

function createEmptyResult({ outputPath, baseUrl, supabaseUrl }) {
  return {
    schema_version: 1,
    generated_at: nowIso(),
    status: 'blocked',
    certification_level: 'blocked',
    hosted_readback_status: 'not_run',
    local_adapter_smoke_status: 'not_run',
    output_artifact: {
      filename: basename(outputPath),
      local_path_redacted: true,
    },
    environment: {
      kind: 'adapter_only',
      supabase_project_ref_redacted: redactSupabaseRef(supabaseUrl),
      app_base_url: baseUrl || null,
    },
    redacted_input_summary: null,
    release: {
      release_id: null,
      candidate_id: null,
      sha256: null,
      proxy_status: null,
      current_status: 'not_run',
    },
    two_context_evidence: {
      publisher_context: 'not_run',
      reader_context: 'not_run',
      distinct_contexts: false,
      admin_context_fingerprint: null,
      reader_context_fingerprint: null,
      same_release_id: false,
      admin_asset_proxy_status: null,
      reader_asset_proxy_status: null,
      admin_asset_content_type: null,
      reader_asset_content_type: null,
      screenshots: [],
    },
    raw_path_leak_check: {
      passed: false,
      forbidden_patterns: FORBIDDEN_PATTERN_LABELS,
      checked_surfaces: [],
    },
    local_smoke: {
      source_contracts_checked: [],
      passed: false,
    },
    observability: {
      artifact_paths: {
        result_json: basename(outputPath),
        admin_screenshot: null,
        reader_screenshot: null,
        console_network_summary: null,
      },
      final_release_id: null,
      final_candidate_id: null,
      proxy_status: null,
      reader_proxy_status: null,
      no_leak_scan_status: 'not_run',
      redacted_env_input_summary_recorded: false,
    },
    operator_acceptance: createOperatorAcceptance(),
    blockers: [],
    notes: [],
  }
}

function sourcePath(path) {
  return resolve(WEB_ROOT, path)
}

async function readText(path) {
  return await readFile(sourcePath(path), 'utf8')
}

function assertContains(text, needle, path, findings) {
  const ok = text.includes(needle)
  findings.push({ path, needle, passed: ok })
  return ok
}

async function runLocalSmoke(result) {
  const checks = []
  const files = {
    registry: 'lib/admin/youtube-thumbnail-generator/release-registry.ts',
    migration: 'supabase/migrations/20260611091500_create_youtube_thumbnail_releases.sql',
    currentRoute: 'app/api/admin/youtube-thumbnail-generator/releases/current/route.ts',
    publishRoute: 'app/api/admin/youtube-thumbnail-generator/releases/publish/route.ts',
    assetRoute: 'app/api/admin/youtube-thumbnail-generator/releases/assets/[releaseId]/route.ts',
    component: 'components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx',
  }

  for (const path of Object.values(files)) {
    if (!existsSync(sourcePath(path))) checks.push({ path, exists: false, passed: false })
  }

  if (checks.some((check) => check.passed === false)) {
    result.local_smoke.source_contracts_checked = checks
    result.local_adapter_smoke_status = 'failed'
    result.blockers.push('local_source_contract_files_missing')
    return result
  }

  const registry = await readText(files.registry)
  const migration = await readText(files.migration)
  const currentRoute = await readText(files.currentRoute)
  const publishRoute = await readText(files.publishRoute)
  const assetRoute = await readText(files.assetRoute)
  const component = await readText(files.component)
  const certificationScript = await readText('scripts/thumbnail-release-readback-certification.mjs')

  const passed = [
    assertContains(registry, "provider_id: 'local-codex'", files.registry, checks),
    assertContains(registry, "model: 'gpt-image-2'", files.registry, checks),
    assertContains(registry, "modelProvenance: 'exact'", files.registry, checks),
    assertContains(registry, "SAFE_BROWSER_IMAGE_PREFIX = '/api/admin/youtube-thumbnail-generator/releases/assets/'", files.registry, checks),
    assertContains(registry, "PUBLIC_RAW_PATH_PATTERNS", files.registry, checks),
    assertContains(certificationScript, "local_adapter_smoke_status", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(certificationScript, "local_adapter_smoke_must_not_mark_hosted_certification_passed", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(certificationScript, "hosted_certification_pass_requires_two_context_evidence", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(certificationScript, "hosted_reader_cookie_required", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(certificationScript, "hosted_reader_context_must_be_distinct", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(certificationScript, "reader_asset_readback_not_proven", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(certificationScript, "reader_asset_proxy_status", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(certificationScript, "operator_score_required_for_operator_ready", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(certificationScript, "OPERATOR_SCORE_WEIGHTS", 'scripts/thumbnail-release-readback-certification.mjs', checks),
    assertContains(migration, "public = false", files.migration, checks),
    assertContains(migration, "check (model = 'gpt-image-2')", files.migration, checks),
    assertContains(migration, "publish_youtube_thumbnail_release", files.migration, checks),
    assertContains(currentRoute, "payload.status === 'unavailable'", files.currentRoute, checks),
    assertContains(publishRoute, "payload.status === 'unavailable'", files.publishRoute, checks),
    assertContains(assetRoute, "private, no-store", files.assetRoute, checks),
    assertContains(component, 'THUMBNAIL_DURABLE_RELEASE_CURRENT_API_URL', files.component, checks),
    assertContains(component, 'THUMBNAIL_RELEASE_CANDIDATES_API_URL', files.component, checks),
    assertContains(component, 'selectAutomaticReleaseCandidate', files.component, checks),
    assertContains(component, 'type ThumbnailDurableReleaseLoadResult', files.component, checks),
    assertContains(component, 'data-thumbnail-initial-preview-source', files.component, checks),
    assertContains(component, 'return pool[0] ?? null', files.component, checks),
  ].every(Boolean)

  result.local_smoke.source_contracts_checked = checks
  result.local_smoke.passed = passed
  result.local_adapter_smoke_status = passed ? 'passed' : 'failed'
  if (passed) {
    result.raw_path_leak_check.passed = true
    result.raw_path_leak_check.checked_surfaces.push({ name: 'local_source_contracts', status: 'passed' })
  }
  if (!passed) result.blockers.push('local_source_contract_smoke_failed')
  return result
}

function createHeaders(cookie) {
  return {
    accept: 'application/json',
    ...(cookie ? { cookie } : {}),
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.THUMBNAIL_RELEASE_CERTIFICATION_TIMEOUT_MS || 15_000))
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJson(baseUrl, path, options = {}) {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, options)
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, ok: response.ok, body, headers: Object.fromEntries(response.headers.entries()) }
}

function stringifyFetchError(error) {
  return safeCliErrorName(error)
}

async function safeFetchJson(baseUrl, path, options = {}) {
  try {
    return await fetchJson(baseUrl, path, options)
  } catch (error) {
    return { status: 0, ok: false, body: { error: stringifyFetchError(error) }, headers: {} }
  }
}

function createFailedAssetResponse(error) {
  return {
    status: 0,
    ok: false,
    error: stringifyFetchError(error),
    headers: {
      get: () => '',
      entries: function* entries() {},
    },
  }
}

async function safeFetchAsset(url, options = {}) {
  try {
    return await fetchWithTimeout(url, options)
  } catch (error) {
    return createFailedAssetResponse(error)
  }
}

function hasForbiddenLeak(value) {
  const text = JSON.stringify(value)
  return FORBIDDEN_PATTERNS.filter((pattern) => text.includes(pattern))
}

function readOperatorScores(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return null
  if (existsSync(raw)) return JSON.parse(String(readFileSync(raw, 'utf8')))
  return JSON.parse(raw)
}

function normalizeScore(value) {
  const score = Number(value)
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null
}

function applyOperatorScores(result, rawScores) {
  if (!rawScores) return result
  const scores = {
    tzuyang: normalizeScore(rawScores.tzuyang),
    pd: normalizeScore(rawScores.pd),
    manager: normalizeScore(rawScores.manager),
    editor: normalizeScore(rawScores.editor),
  }
  const allPresent = Object.values(scores).every((value) => value !== null)
  const weightedTotal = allPresent
    ? Math.round(Object.entries(OPERATOR_SCORE_WEIGHTS).reduce((sum, [role, weight]) => sum + scores[role] * weight, 0) * 10) / 10
    : null
  const perRolePassed = allPresent && Object.values(scores).every((value) => value >= OPERATOR_ROLE_THRESHOLDS.minimumPerRole)
  const passed = Boolean(perRolePassed && weightedTotal >= OPERATOR_ROLE_THRESHOLDS.weightedTotal)
  result.operator_acceptance = {
    ...result.operator_acceptance,
    status: passed ? 'passed' : 'failed',
    passed,
    blocks_operator_ready: !passed,
    scores,
    weighted_total: weightedTotal,
    blocker: passed ? null : 'operator_score_below_threshold',
  }
  return result
}

function maybeMarkHostedPass(result) {
  const hostedPassed =
    result.certification_level === 'hosted' &&
    result.hosted_readback_status === 'passed' &&
    result.two_context_evidence.publisher_context === 'passed' &&
    result.two_context_evidence.reader_context === 'passed' &&
    result.two_context_evidence.distinct_contexts === true &&
    result.two_context_evidence.same_release_id === true &&
    result.raw_path_leak_check.passed === true &&
    result.release.proxy_status === 200 &&
    result.operator_acceptance.passed === true

  if (hostedPassed) {
    result.status = 'passed'
    return
  }

  if (result.local_adapter_smoke_status === 'passed' && result.certification_level === 'hosted') {
    throw new Error('local_adapter_smoke_must_not_mark_hosted_certification_passed')
  }
  if (result.status === 'passed') throw new Error('hosted_certification_pass_requires_two_context_evidence')
}

async function runHostedReadback(result, { baseUrl, cookie, readerCookie, candidateId }) {
  result.environment.kind = 'hosted_supabase'
  result.environment.app_base_url = baseUrl
  if (!candidateId) {
    result.hosted_readback_status = 'blocked'
    result.certification_level = result.local_adapter_smoke_status === 'passed' ? 'local_only' : 'blocked'
    result.blockers.push('hosted_candidate_id_required')
    return result
  }
  if (!cookie) {
    result.hosted_readback_status = 'blocked'
    result.certification_level = result.local_adapter_smoke_status === 'passed' ? 'local_only' : 'blocked'
    result.blockers.push('hosted_admin_cookie_required')
    return result
  }
  if (!readerCookie) {
    result.hosted_readback_status = 'blocked'
    result.certification_level = result.local_adapter_smoke_status === 'passed' ? 'local_only' : 'blocked'
    result.blockers.push('hosted_reader_cookie_required')
    return result
  }
  if (result.redacted_input_summary && !result.redacted_input_summary.distinct_contexts) {
    result.hosted_readback_status = 'blocked'
    result.certification_level = result.local_adapter_smoke_status === 'passed' ? 'local_only' : 'blocked'
    result.blockers.push('hosted_reader_context_must_be_distinct')
    return result
  }
  result.two_context_evidence.distinct_contexts = true
  result.two_context_evidence.admin_context_fingerprint = result.redacted_input_summary?.admin_context_fingerprint ?? null
  result.two_context_evidence.reader_context_fingerprint = result.redacted_input_summary?.reader_context_fingerprint ?? null

  const publish = await fetchJson(baseUrl, '/api/admin/youtube-thumbnail-generator/releases/publish', {
    method: 'POST',
    headers: { ...createHeaders(cookie), 'content-type': 'application/json' },
    body: JSON.stringify({ candidateId }),
  }).catch((error) => ({ status: 0, ok: false, body: { error: safeCliErrorName(error) }, headers: {} }))
  result.two_context_evidence.publisher_context = publish.ok ? 'passed' : 'failed'
  result.release.candidate_id = candidateId
  result.release.current_status = typeof publish.body?.status === 'string' ? publish.body.status : 'error'

  if (!publish.ok || publish.body?.status === 'unavailable') {
    result.hosted_readback_status = publish.status === 503 ? 'blocked' : 'failed'
    result.blockers.push(publish.status === 503 ? 'hosted_registry_unavailable' : 'hosted_publish_failed')
    result.raw_path_leak_check.checked_surfaces.push({ name: 'publish', status: publish.status })
    result.raw_path_leak_check.passed = hasForbiddenLeak(publish.body).length === 0
    return result
  }

  const release = publish.body?.release
  result.release.release_id = release?.id ?? null
  result.release.sha256 = release?.sha256 ?? null

  const current = await safeFetchJson(baseUrl, '/api/admin/youtube-thumbnail-generator/releases/current', { headers: createHeaders(cookie) })
  const reader = await safeFetchJson(baseUrl, '/api/admin/youtube-thumbnail-generator/releases/current', { headers: createHeaders(readerCookie) })
  const assetPath = release?.browserImagePath
  const adminAsset = assetPath ? await safeFetchAsset(`${baseUrl}${assetPath}`, { headers: createHeaders(cookie) }) : null
  const readerAsset = assetPath ? await safeFetchAsset(`${baseUrl}${assetPath}`, { headers: createHeaders(readerCookie) }) : null
  const adminAssetContentType = adminAsset?.headers.get('content-type') || ''
  const readerAssetContentType = readerAsset?.headers.get('content-type') || ''
  const adminAssetIsPng = adminAsset?.status === 200 && /^image\/png\b/i.test(adminAssetContentType)
  const readerAssetIsPng = readerAsset?.status === 200 && /^image\/png\b/i.test(readerAssetContentType)

  result.raw_path_leak_check.checked_surfaces.push(
    { name: 'publish', status: publish.status },
    { name: 'current', status: current.status },
    { name: 'reader_current', status: reader.status },
    { name: 'admin_asset_proxy', status: adminAsset?.status ?? null },
    { name: 'reader_asset_proxy', status: readerAsset?.status ?? null },
  )
  const leaks = [...hasForbiddenLeak(publish.body), ...hasForbiddenLeak(current.body), ...hasForbiddenLeak(reader.body)]
  result.raw_path_leak_check.passed = leaks.length === 0
  if (leaks.length) result.blockers.push('raw_path_leak:forbidden_browser_visible_metadata')

  result.release.proxy_status = adminAsset?.status ?? null
  result.observability.proxy_status = result.release.proxy_status
  result.observability.reader_proxy_status = readerAsset?.status ?? null
  result.two_context_evidence.admin_asset_proxy_status = adminAsset?.status ?? null
  result.two_context_evidence.reader_asset_proxy_status = readerAsset?.status ?? null
  result.two_context_evidence.admin_asset_content_type = adminAssetContentType ? adminAssetContentType.split(';')[0].toLowerCase() : null
  result.two_context_evidence.reader_asset_content_type = readerAssetContentType ? readerAssetContentType.split(';')[0].toLowerCase() : null
  result.two_context_evidence.reader_context = reader.ok ? 'passed' : 'failed'
  result.two_context_evidence.same_release_id = Boolean(
    release?.id &&
    current.body?.release?.id === release.id &&
    reader.body?.release?.id === release.id,
  )
  if (!adminAssetIsPng) result.blockers.push('admin_asset_readback_not_proven')
  if (!readerAssetIsPng) result.blockers.push('reader_asset_readback_not_proven')

  result.hosted_readback_status = (
    publish.ok &&
    current.ok &&
    reader.ok &&
    adminAssetIsPng &&
    readerAssetIsPng &&
    result.two_context_evidence.same_release_id &&
    result.raw_path_leak_check.passed
  ) ? 'passed' : 'failed'
  result.certification_level = result.hosted_readback_status === 'passed' ? 'hosted' : 'blocked'
  if (result.hosted_readback_status !== 'passed') result.blockers.push('hosted_two_context_readback_failed')
  result.observability.final_release_id = result.release.release_id
  result.observability.final_candidate_id = result.release.candidate_id
  return result
}

async function main() {
  const args = parseArgs(process.argv)
  const outputPath = resolve(args.get('output') || process.env.THUMBNAIL_RELEASE_CERTIFICATION_OUTPUT || DEFAULT_OUTPUT)
  const baseUrl = normalizeBaseUrl(args.get('base-url') || process.env.THUMBNAIL_RELEASE_CERTIFICATION_BASE_URL || '')
  const hostedEnabled = (args.get('hosted') || process.env.THUMBNAIL_RELEASE_CERTIFICATION_ENABLE_HOSTED || '').toLowerCase() === '1'
  const candidateId = args.get('candidate-id') || process.env.THUMBNAIL_RELEASE_CERTIFICATION_CANDIDATE_ID || ''
  const cookie = args.get('cookie') || process.env.THUMBNAIL_RELEASE_CERTIFICATION_COOKIE || ''
  const readerCookie = args.get('reader-cookie') || process.env.THUMBNAIL_RELEASE_CERTIFICATION_READER_COOKIE || ''
  const operatorScores = readOperatorScores(args.get('operator-scores') || process.env.THUMBNAIL_RELEASE_CERTIFICATION_OPERATOR_SCORES || '')

  const result = createEmptyResult({
    outputPath,
    baseUrl,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  })
  result.redacted_input_summary = createRedactedInputSummary({ hostedEnabled, baseUrl, candidateId, cookie, readerCookie })
  result.observability.redacted_env_input_summary_recorded = true

  await runLocalSmoke(result)

  if (!hostedEnabled) {
    result.hosted_readback_status = 'blocked'
    result.certification_level = result.local_adapter_smoke_status === 'passed' ? 'local_only' : 'blocked'
    result.blockers.push('hosted_certification_not_enabled')
    result.notes.push('Set THUMBNAIL_RELEASE_CERTIFICATION_ENABLE_HOSTED=1 with base URL, admin cookie, and candidate id to attempt hosted certification.')
  } else {
    const hostedBaseUrlBlocker = getHostedBaseUrlBlocker(
      baseUrl,
      args.get('allowed-origin') || process.env.THUMBNAIL_RELEASE_CERTIFICATION_ALLOWED_ORIGINS || '',
    )
    if (hostedBaseUrlBlocker) {
      result.hosted_readback_status = 'blocked'
      result.certification_level = result.local_adapter_smoke_status === 'passed' ? 'local_only' : 'blocked'
      result.blockers.push(hostedBaseUrlBlocker)
    } else {
      await runHostedReadback(result, { baseUrl, cookie, readerCookie, candidateId })
    }
  }

  applyOperatorScores(result, operatorScores)
  if (result.hosted_readback_status === 'passed' && !result.operator_acceptance.passed) {
    result.blockers.push(result.operator_acceptance.blocker || 'operator_score_required_for_operator_ready')
    result.certification_level = 'blocked'
  }
  const finalLeaks = hasForbiddenLeak(result)
  result.observability.no_leak_scan_status = finalLeaks.length === 0 ? 'passed' : 'failed'
  if (finalLeaks.length) {
    result.raw_path_leak_check.passed = false
    result.blockers.push('certification_result_leak:forbidden_metadata')
    result.certification_level = 'blocked'
  }
  maybeMarkHostedPass(result)
  if (result.status !== 'passed') result.status = result.blockers.length ? 'blocked' : 'failed'
  if (result.certification_level === 'hosted' && result.status !== 'passed') {
    throw new Error('hosted_certification_level_requires_passed_status')
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  logCliError(error, (line) => process.stderr.write(`[thumbnail-release-readback-certification] ${line}`))
  process.exit(1)
})

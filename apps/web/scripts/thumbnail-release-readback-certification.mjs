#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(WEB_ROOT, '../..')
const DEFAULT_OUTPUT = resolve(REPO_ROOT, '.omx/artifacts/thumbnail-release-readback-certification/result.json')
const FORBIDDEN_PATTERNS = ['.omx', 'storage_object_path', 'SUPABASE_SERVICE_ROLE_KEY']
const FORBIDDEN_PATTERN_LABELS = ['local-artifact-paths', 'raw-storage-object-field', 'service-role-secret']

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
      same_release_id: false,
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
    assertContains(migration, "public = false", files.migration, checks),
    assertContains(migration, "check (model = 'gpt-image-2')", files.migration, checks),
    assertContains(migration, "publish_youtube_thumbnail_release", files.migration, checks),
    assertContains(currentRoute, "payload.status === 'unavailable'", files.currentRoute, checks),
    assertContains(publishRoute, "payload.status === 'unavailable'", files.publishRoute, checks),
    assertContains(assetRoute, "private, no-store", files.assetRoute, checks),
    assertContains(component, 'payload?.status !== "unavailable"', files.component, checks),
    assertContains(component, 'payload?.status === "unavailable"', files.component, checks),
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

function hasForbiddenLeak(value) {
  const text = JSON.stringify(value)
  return FORBIDDEN_PATTERNS.filter((pattern) => text.includes(pattern))
}

function maybeMarkHostedPass(result) {
  const hostedPassed =
    result.certification_level === 'hosted' &&
    result.hosted_readback_status === 'passed' &&
    result.two_context_evidence.publisher_context === 'passed' &&
    result.two_context_evidence.reader_context === 'passed' &&
    result.two_context_evidence.same_release_id === true &&
    result.raw_path_leak_check.passed === true &&
    result.release.proxy_status === 200

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

  const publish = await fetchJson(baseUrl, '/api/admin/youtube-thumbnail-generator/releases/publish', {
    method: 'POST',
    headers: { ...createHeaders(cookie), 'content-type': 'application/json' },
    body: JSON.stringify({ candidateId }),
  }).catch((error) => ({ status: 0, ok: false, body: { error: String(error) }, headers: {} }))
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

  const current = await fetchJson(baseUrl, '/api/admin/youtube-thumbnail-generator/releases/current', { headers: createHeaders(cookie) })
  const reader = await fetchJson(baseUrl, '/api/admin/youtube-thumbnail-generator/releases/current', { headers: createHeaders(readerCookie || cookie) })
  const assetPath = release?.browserImagePath
  const asset = assetPath ? await fetchWithTimeout(`${baseUrl}${assetPath}`, { headers: createHeaders(cookie) }) : null

  result.raw_path_leak_check.checked_surfaces.push(
    { name: 'publish', status: publish.status },
    { name: 'current', status: current.status },
    { name: 'reader_current', status: reader.status },
  )
  const leaks = [...hasForbiddenLeak(publish.body), ...hasForbiddenLeak(current.body), ...hasForbiddenLeak(reader.body)]
  result.raw_path_leak_check.passed = leaks.length === 0
  if (leaks.length) result.blockers.push(`raw_path_leak:${[...new Set(leaks)].join(',')}`)

  result.release.proxy_status = asset?.status ?? null
  result.two_context_evidence.reader_context = reader.ok ? 'passed' : 'failed'
  result.two_context_evidence.same_release_id = Boolean(
    release?.id &&
    current.body?.release?.id === release.id &&
    reader.body?.release?.id === release.id,
  )

  result.hosted_readback_status = (
    publish.ok &&
    current.ok &&
    reader.ok &&
    asset?.status === 200 &&
    /^image\/png\b/i.test(asset.headers.get('content-type') || '') &&
    result.two_context_evidence.same_release_id &&
    result.raw_path_leak_check.passed
  ) ? 'passed' : 'failed'
  result.certification_level = result.hosted_readback_status === 'passed' ? 'hosted' : 'blocked'
  if (result.hosted_readback_status !== 'passed') result.blockers.push('hosted_two_context_readback_failed')
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

  const result = createEmptyResult({
    outputPath,
    baseUrl,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  })

  await runLocalSmoke(result)

  if (!hostedEnabled) {
    result.hosted_readback_status = 'blocked'
    result.certification_level = result.local_adapter_smoke_status === 'passed' ? 'local_only' : 'blocked'
    result.blockers.push('hosted_certification_not_enabled')
    result.notes.push('Set THUMBNAIL_RELEASE_CERTIFICATION_ENABLE_HOSTED=1 with base URL, admin cookie, and candidate id to attempt hosted certification.')
  } else if (!baseUrl) {
    result.hosted_readback_status = 'blocked'
    result.certification_level = result.local_adapter_smoke_status === 'passed' ? 'local_only' : 'blocked'
    result.blockers.push('hosted_base_url_required')
  } else {
    await runHostedReadback(result, { baseUrl, cookie, readerCookie, candidateId })
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
  console.error(error)
  process.exit(1)
})

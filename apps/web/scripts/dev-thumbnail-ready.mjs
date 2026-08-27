#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { safeCliErrorName } from './privacy-safe-cli-log.mjs'

const PORT = process.env.PORT || '3000'
const HOST = process.env.HOST || 'localhost'
const token = process.env.E2E_ADMIN_ROUTE_BYPASS_TOKEN?.trim() || randomBytes(18).toString('base64url')
const bootstrapNext = '/admin?module=youtube-thumbnail-generator'

const env = {
  ...process.env,
  E2E_ADMIN_ROUTE_BYPASS: '1',
  E2E_ADMIN_ROUTE_BYPASS_CONTEXT: 'playwright',
  E2E_ADMIN_ROUTE_BYPASS_RUNTIME: 'local-dev-server',
  E2E_ADMIN_ROUTE_BYPASS_TOKEN: token,
  THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL: process.env.THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL || 'gpt-image-2',
  TZUDONG_DEV_PREWARM: process.env.TZUDONG_DEV_PREWARM || '0',
}

async function fetchJson(url) {
  const response = await fetch(url)
  const text = await response.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: response.status, ok: response.ok, body }
}

if (process.argv.includes('--check')) {
  const health = await fetchJson(`http://${HOST}:${PORT}/api/health`)
    .then(({ ok, status }) => ({ ok, status }))
    .catch((error) => ({ ok: false, status: 0, error: safeCliErrorName(error) }))
  console.log(JSON.stringify({
    port: PORT,
    bootstrapPath: bootstrapNext,
    health,
    realGenerationStatus: 'blocked_provider_unavailable_until_exact_gpt_image_2_provenance',
  }, null, 2))
  process.exit(health.ok ? 0 : 1)
}

console.log('\n유튜브 썸네일 생성기 개발자 모드로 로컬 서버를 시작합니다.')
console.log(`브라우저 부트스트랩 경로: ${bootstrapNext} (일회용 토큰 URL은 로그에 출력하지 않습니다.)`)
console.log('실제 이미지 생성은 exact gpt-image-2 provenance가 증명될 때까지 provider_unavailable로 차단됩니다.\n')

const child = spawn(process.execPath, [
  'scripts/run-local-dev.mjs',
  '--port',
  PORT,
], {
  cwd: new URL('..', import.meta.url),
  env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})

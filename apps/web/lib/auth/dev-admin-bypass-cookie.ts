import {
  getE2EAdminRouteBypassExpectedToken,
  isE2EAdminRouteBypassEnvEnabled,
} from '@/lib/e2e-admin-route-bypass'

export const DEV_ADMIN_BYPASS_COOKIE_NAME = 'tzudong-dev-admin-bypass'
export const DEV_ADMIN_BYPASS_SCOPE = 'thumbnail-dev'
export const DEV_ADMIN_BYPASS_MAX_AGE_SECONDS = 60 * 60

const textEncoder = new TextEncoder()

type DevAdminBypassCookiePayload = {
  scope: typeof DEV_ADMIN_BYPASS_SCOPE
  exp: number
  nonce: string
}

type DevAdminBypassEnv = Partial<Record<string, string | undefined>>

type DevAdminBypassValidationInput = {
  cookieValue?: string | null
  host?: string | null
  env?: DevAdminBypassEnv
  now?: number
}

export type DevAdminBypassValidationResult =
  | { ok: true; payload: DevAdminBypassCookiePayload }
  | { ok: false; reason: string }

function normalizeHostName(value: string) {
  const firstValue = value.split(',')[0]?.trim().toLowerCase() ?? ''

  if (firstValue.startsWith('[')) {
    const closingBracketIndex = firstValue.indexOf(']')
    return closingBracketIndex > 1 ? firstValue.slice(1, closingBracketIndex) : firstValue
  }

  if (firstValue === '::1') return firstValue
  if (firstValue.includes(':') && firstValue.split(':').length > 2) return firstValue

  return firstValue.split(':')[0] ?? ''
}

export function isDevAdminBypassLocalHost(value: string | null | undefined) {
  if (!value) return false
  const normalizedHostName = normalizeHostName(value)
  return normalizedHostName === 'localhost' || normalizedHostName === '127.0.0.1' || normalizedHostName === '::1'
}

function getCrypto() {
  const cryptoImpl = globalThis.crypto
  if (!cryptoImpl?.subtle) {
    throw new Error('Web Crypto API is required for the dev admin bypass cookie.')
  }
  return cryptoImpl
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function encodeJsonBase64Url(value: unknown) {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)))
}

function decodeJsonBase64Url(value: string) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as unknown
}

async function importHmacKey(secret: string, usage: KeyUsage) {
  return await getCrypto().subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  )
}

async function signPayload(payloadPart: string, secret: string) {
  const key = await importHmacKey(secret, 'sign')
  const signature = await getCrypto().subtle.sign('HMAC', key, textEncoder.encode(payloadPart))
  return bytesToBase64Url(new Uint8Array(signature))
}

async function verifySignature(payloadPart: string, signaturePart: string, secret: string) {
  const key = await importHmacKey(secret, 'verify')
  return await getCrypto().subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(signaturePart),
    textEncoder.encode(payloadPart),
  )
}

function createNonce() {
  const bytes = new Uint8Array(16)
  getCrypto().getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

function isPayload(value: unknown): value is DevAdminBypassCookiePayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<DevAdminBypassCookiePayload>
  return payload.scope === DEV_ADMIN_BYPASS_SCOPE && typeof payload.exp === 'number' && typeof payload.nonce === 'string'
}

export function getDevAdminBypassCookieFromHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return null
  const cookies = cookieHeader.split(';')
  for (const entry of cookies) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex < 0) continue
    const name = entry.slice(0, separatorIndex).trim()
    if (name !== DEV_ADMIN_BYPASS_COOKIE_NAME) continue
    return entry.slice(separatorIndex + 1).trim() || null
  }
  return null
}

export async function createDevAdminBypassCookieValue(options: {
  env?: DevAdminBypassEnv
  now?: number
  nonce?: string
} = {}) {
  const env = options.env ?? process.env
  if (!isE2EAdminRouteBypassEnvEnabled(env)) {
    throw new Error('Dev admin bypass env is not enabled.')
  }

  const secret = getE2EAdminRouteBypassExpectedToken(env)
  const now = options.now ?? Date.now()
  const payload: DevAdminBypassCookiePayload = {
    scope: DEV_ADMIN_BYPASS_SCOPE,
    exp: Math.floor((now + DEV_ADMIN_BYPASS_MAX_AGE_SECONDS * 1000) / 1000),
    nonce: options.nonce ?? createNonce(),
  }
  const payloadPart = encodeJsonBase64Url(payload)
  const signaturePart = await signPayload(payloadPart, secret)
  return `${payloadPart}.${signaturePart}`
}

export async function validateDevAdminBypassCookie({
  cookieValue,
  host,
  env = process.env,
  now = Date.now(),
}: DevAdminBypassValidationInput): Promise<DevAdminBypassValidationResult> {
  if (!isE2EAdminRouteBypassEnvEnabled(env)) return { ok: false, reason: 'env_disabled' }
  if (!isDevAdminBypassLocalHost(host)) return { ok: false, reason: 'non_local_host' }
  if (!cookieValue) return { ok: false, reason: 'missing_cookie' }

  const [payloadPart, signaturePart, extraPart] = cookieValue.split('.')
  if (!payloadPart || !signaturePart || extraPart) return { ok: false, reason: 'malformed_cookie' }

  const secret = getE2EAdminRouteBypassExpectedToken(env)
  let signatureOk = false
  try {
    signatureOk = await verifySignature(payloadPart, signaturePart, secret)
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
  if (!signatureOk) return { ok: false, reason: 'bad_signature' }

  let decoded: unknown
  try {
    decoded = decodeJsonBase64Url(payloadPart)
  } catch {
    return { ok: false, reason: 'bad_payload' }
  }
  if (!isPayload(decoded)) return { ok: false, reason: 'bad_scope' }

  if (decoded.exp <= Math.floor(now / 1000)) return { ok: false, reason: 'expired' }

  return { ok: true, payload: decoded }
}

export function isSafeDevAdminBootstrapNext(value: string | null | undefined) {
  if (!value) return true
  if (!value.startsWith('/') || value.startsWith('//')) return false
  if (/[\u0000-\u001f\u007f]/.test(value)) return false

  try {
    const nextUrl = new URL(value, 'http://localhost')
    return nextUrl.origin === 'http://localhost' && nextUrl.pathname === '/admin'
  } catch {
    return false
  }
}

export function resolveDevAdminBootstrapNext(value: string | null | undefined) {
  const fallback = '/admin?module=youtube-thumbnail-generator'
  if (!isSafeDevAdminBootstrapNext(value)) return null
  if (!value) return fallback
  const nextUrl = new URL(value, 'http://localhost')
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
}

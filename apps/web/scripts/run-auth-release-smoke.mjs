import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const CHILD = fileURLToPath(new URL('./run-auth-release-smoke-child.mjs', import.meta.url));
const SUPABASE_ORIGIN = 'https://aqlcofblfxdrjhhdmarw.supabase.co/';
const PROJECT_ID = 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl';
const ORG_ID = 'team_OUj64KeLxJI3PkEbOaFZnorA';
const TEAM_SLUG = 'twoimos-projects';
const AUTH_COOKIE = 'sb-aqlcofblfxdrjhhdmarw-auth-token';
const MAX_SESSION_SECONDS = 2 * 60 * 60;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;
const MAX_STORAGE_STATE_BYTES = 128 * 1024;
const MAX_COOKIE_VALUE_BYTES = 32 * 1024;
const CHILD_TIMEOUT_MS = 75_000;
const CHILD_HANDLE_DRAIN_TIMEOUT_MS = 250;
const MAX_RELEASE_WINDOW_SECONDS = 900;
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_REFRESH_TOKEN_BYTES = 4096;
const ALLOWED_REASON_CODES = new Set(['OK', 'CANARY_INTENTIONAL_FAILURE', 'INVALID_AUTH_STATE', 'CROSS_ORIGIN_REDIRECT', 'EXTERNAL_EGRESS', 'AUTH_PROOF_DENIED', 'AUTH_PROOF_FAILED', 'ADMIN_SHELL_MISSING', 'ADMIN_GEOMETRY_INVALID', 'ADMIN_ACCESSIBILITY_INVALID', 'ADMIN_ERROR_VISIBLE', 'NAVIGATION_FAILED', 'SESSION_REVOCATION_FAILED', 'INTERNAL_FAILURE']);
const METADATA_KEYS = ['ok', 'reasonCode', 'revocationReceipt', 'authProofSha256', 'shellHeight', 'shellWidth', 'headingCount', 'navigationCount', 'status', 'finalUrl', 'capturedAt'];
const AUTH_CELLS = new Set(['preview-admin-auth-smoke-metadata', 'production-admin-auth-smoke-metadata', 'alias-admin-auth-smoke-metadata']);
const CLI_KEYS = new Set(['cell-id', 'origin', 'release-id', 'certification-id', 'challenge', 'issued-at', 'expires-at', 'expected-git-sha', 'expected-deployment-receipt-sha256']);

function invalid(message = 'invalid auth state') { return Object.assign(new Error(message), { code: 'INVALID_AUTH_STATE' }); }
export function safeReason(error) { return ALLOWED_REASON_CODES.has(error?.code) ? error.code : 'INTERNAL_FAILURE'; }

export function canonicalJson(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) throw invalid('non-integer number');
        return String(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw invalid('invalid JSON value');
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256(domain, value) { return createHash('sha256').update(domain, 'utf8').update(canonicalJson(value), 'utf8').digest('hex'); }
function sha256Text(domain, value) { return createHash('sha256').update(domain, 'utf8').update(value, 'utf8').digest('hex'); }

function requiredEnvironment(name) {
    const value = process.env[name];
    if (typeof value !== 'string' || !value) throw invalid('missing required value');
    return value;
}

export function exactHttpsOrigin(value) {
    const url = new URL(value);
    if (url.toString() !== value || url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) throw invalid('invalid origin');
    return url;
}

function exactHost(value) {
    if (typeof value !== 'string') throw invalid('invalid host');
    const url = exactHttpsOrigin(`https://${value}/`);
    if (url.hostname !== value) throw invalid('invalid host');
    return value;
}

export function validateSupabaseDestination(value) {
    if (value !== SUPABASE_ORIGIN || exactHttpsOrigin(value).toString() !== SUPABASE_ORIGIN) throw invalid('unapproved Supabase origin');
    return SUPABASE_ORIGIN;
}

function canonicalBase64(encoded) {
    if (typeof encoded !== 'string' || !encoded || encoded.length > MAX_STORAGE_STATE_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw invalid('invalid base64');
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.toString('base64') !== encoded) throw invalid('invalid base64');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw invalid('invalid base64'); }
}

function canonicalInteger(value, name) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw invalid(`invalid ${name}`);
    const integer = Number(value);
    if (!Number.isSafeInteger(integer)) throw invalid(`invalid ${name}`);
    return integer;
}

function canonicalChallenge(value) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw invalid('invalid challenge');
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== 32 || decoded.toString('base64url') !== value) throw invalid('invalid challenge');
    return value;
}

export function parseReleaseAuthCli(argv = process.argv.slice(2)) {
    if (argv.length !== CLI_KEYS.size * 2) throw invalid('invalid CLI');
    const values = {};
    for (let index = 0; index < argv.length; index += 2) {
        const token = argv[index];
        const value = argv[index + 1];
        if (typeof token !== 'string' || typeof value !== 'string' || !token.startsWith('--')) throw invalid('invalid CLI');
        const key = token.slice(2);
        if (!CLI_KEYS.has(key) || Object.hasOwn(values, key) || !value) throw invalid('invalid CLI');
        values[key] = value;
    }
    if (Object.keys(values).length !== CLI_KEYS.size) throw invalid('invalid CLI');
    const origin = exactHttpsOrigin(values.origin);
    if (!AUTH_CELLS.has(values['cell-id']) || !/^[A-Za-z0-9._-]{1,64}$/.test(values['release-id']) || !/^[0-9a-f]{64}$/.test(values['certification-id']) || !/^[0-9a-f]{40}$/.test(values['expected-git-sha']) || !/^[0-9a-f]{64}$/.test(values['expected-deployment-receipt-sha256'])) throw invalid('invalid CLI');
    const issuedAt = canonicalInteger(values['issued-at'], 'issued-at');
    const expiresAt = canonicalInteger(values['expires-at'], 'expires-at');
    if (expiresAt - issuedAt < 1 || expiresAt - issuedAt > MAX_RELEASE_WINDOW_SECONDS) throw invalid('invalid release window');
    return { cellId: values['cell-id'], origin, releaseId: values['release-id'], certificationId: values['certification-id'], challenge: canonicalChallenge(values.challenge), issuedAt, expiresAt, expectedGitSha: values['expected-git-sha'], expectedDeploymentReceiptSha256: values['expected-deployment-receipt-sha256'] };
}

export function assertFreshWindow(release, now = Math.floor(Date.now() / 1000)) {
    if (!Number.isSafeInteger(now) || Math.abs(now - release.issuedAt) > MAX_CLOCK_SKEW_SECONDS || now > release.expiresAt) throw invalid('stale release window');
}

export function decodeDeploymentReceipt(encoded, release) {
    const text = canonicalBase64(encoded);
    let receipt;
    try { receipt = JSON.parse(text); } catch { throw invalid('invalid receipt JSON'); }
    if (canonicalJson(receipt) !== text) throw invalid('noncanonical receipt');
    const keys = 'aliasHost,certificationId,deploymentId,environment,expiresAt,framework,gitSha,host,observedAt,orgId,project,projectId,releaseId,schemaVersion,teamSlug';
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || Object.keys(receipt).sort().join(',') !== keys || receipt.schemaVersion !== 2 || receipt.releaseId !== release.releaseId || receipt.certificationId !== release.certificationId || receipt.project !== 'tzudong' || receipt.projectId !== PROJECT_ID || receipt.orgId !== ORG_ID || receipt.teamSlug !== TEAM_SLUG || receipt.framework !== 'nextjs' || !['preview', 'production'].includes(receipt.environment) || !/^dpl_[A-Za-z0-9]+$/.test(receipt.deploymentId) || receipt.gitSha !== release.expectedGitSha || !Number.isSafeInteger(receipt.observedAt) || !Number.isSafeInteger(receipt.expiresAt) || receipt.observedAt < release.issuedAt - MAX_CLOCK_SKEW_SECONDS || receipt.observedAt > release.expiresAt || receipt.expiresAt !== release.expiresAt) throw invalid('invalid receipt');
    exactHost(receipt.host); exactHost(receipt.aliasHost);
    if (!/^tzudong-[a-z0-9-]+\.vercel\.app$/.test(receipt.host) || (receipt.environment === 'preview' && receipt.aliasHost !== receipt.host) || (receipt.environment === 'production' && (!new Set(['tzudong.app', 'www.tzudong.app']).has(receipt.aliasHost) || receipt.aliasHost === receipt.host))) throw invalid('invalid receipt host');
    const digest = sha256('tzudong:deployment-receipt:v2\n', receipt);
    if (!timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(release.expectedDeploymentReceiptSha256, 'hex'))) throw invalid('receipt digest mismatch');
    return { receipt, digest };
}

export function authCellId(receipt, id, origin) {
    if (!AUTH_CELLS.has(id)) throw invalid('unknown cell');
    const expectedHost = id === 'alias-admin-auth-smoke-metadata' ? receipt.aliasHost : receipt.host;
    const valid = (id === 'preview-admin-auth-smoke-metadata' && receipt.environment === 'preview' && receipt.host === receipt.aliasHost)
        || (id === 'production-admin-auth-smoke-metadata' && receipt.environment === 'production' && receipt.host !== receipt.aliasHost)
        || (id === 'alias-admin-auth-smoke-metadata' && receipt.environment === 'production' && receipt.host !== receipt.aliasHost);
    if (!valid || !origin || origin.hostname !== expectedHost) throw invalid('cell receipt mismatch');
    return id;
}

export function validateStorageState(encoded, origin) {
    const state = JSON.parse(canonicalBase64(encoded));
    if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).sort().join(',') !== 'cookies,origins' || !Array.isArray(state.cookies) || !Array.isArray(state.origins) || state.origins.length !== 0 || state.cookies.length < 1 || state.cookies.length > 8) throw invalid('invalid storage');
    const now = Math.floor(Date.now() / 1000); const names = new Set();
    for (const cookie of state.cookies) {
        if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie) || Object.keys(cookie).sort().join(',') !== 'domain,expires,httpOnly,name,path,sameSite,secure,value' || typeof cookie.name !== 'string' || !new RegExp(`^${AUTH_COOKIE}(?:\\.\\d+)?$`).test(cookie.name) || names.has(cookie.name) || cookie.domain !== origin.hostname || cookie.path !== '/' || typeof cookie.value !== 'string' || !cookie.value || Buffer.byteLength(cookie.value, 'utf8') > MAX_COOKIE_VALUE_BYTES || !Number.isInteger(cookie.expires) || cookie.expires <= now || cookie.expires > now + MAX_SESSION_SECONDS || typeof cookie.httpOnly !== 'boolean' || cookie.secure !== true || cookie.sameSite !== 'Lax') throw invalid('invalid cookie');
        names.add(cookie.name);
    }
    const chunks = [...names].filter((name) => name !== AUTH_COOKIE).sort((a, b) => Number(a.slice(AUTH_COOKIE.length + 1)) - Number(b.slice(AUTH_COOKIE.length + 1)));
    if ((names.has(AUTH_COOKIE) && chunks.length) || (!names.has(AUTH_COOKIE) && (!chunks.length || !chunks.every((name, index) => name === `${AUTH_COOKIE}.${index}`)))) throw invalid('invalid chunks');
    return state;
}
export function encodeHttpOnlyStorageState(state) {
    if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins) || state.origins.length !== 0) throw invalid('invalid storage');
    return Buffer.from(JSON.stringify({
        cookies: state.cookies.map((cookie) => ({ ...cookie, httpOnly: true })),
        origins: [],
    }), 'utf8').toString('base64');
}

export function collectSecretMarkers(value, markers = new Set(), budget = { nodes: 0, strings: 0 }, depth = 0) {
    if (depth > 8 || ++budget.nodes > 200) throw invalid('marker traversal limit');
    if (typeof value === 'string') {
        if (value.length > 4096) throw invalid('marker string limit');
        budget.strings += value.length; if (budget.strings > 20_000) throw invalid('marker budget limit');
        if (value.length >= 16 && /[A-Za-z0-9]{16}/.test(value)) markers.add(value);
        const encoded = value.startsWith('base64-') ? value.slice(7).replace(/-/g, '+').replace(/_/g, '/') : value;
        try { collectSecretMarkers(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), markers, budget, depth + 1); } catch (error) { if (error?.code) throw error; }
    } else if (Array.isArray(value)) value.forEach((item) => collectSecretMarkers(item, markers, budget, depth + 1));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectSecretMarkers(item, markers, budget, depth + 1));
    return markers;
}

function fakeCanaryState(origin, markers) { return Buffer.from(JSON.stringify({ cookies: [{ name: AUTH_COOKIE, value: markers.join('.'), domain: origin.hostname, path: '/', expires: Math.floor(Date.now() / 1000) + 60, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] })).toString('base64'); }

export function validateMetadata(text, expectedCanary = false, markers = [], release) {
    const lines = text.trim().split('\n'); if (lines.length !== 1) throw Object.assign(new Error('multiple metadata'), { code: 'INTERNAL_FAILURE' });
    const value = JSON.parse(lines[0]);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...METADATA_KEYS].sort().join(',') || typeof value.ok !== 'boolean' || typeof value.reasonCode !== 'string' || !ALLOWED_REASON_CODES.has(value.reasonCode)) throw Object.assign(new Error('invalid metadata'), { code: 'INTERNAL_FAILURE' });
    const numeric = ['shellHeight', 'shellWidth', 'headingCount', 'navigationCount', 'status'];
    const successful = value.ok && value.reasonCode === 'OK' && value.revocationReceipt === 'parent_required' && /^[a-f0-9]{64}$/.test(value.authProofSha256) && numeric.every((key) => Number.isInteger(value[key]) && (key === 'status' ? value[key] >= 200 && value[key] < 300 : value[key] > 0)) && typeof value.finalUrl === 'string' && Number.isSafeInteger(value.capturedAt);
    const failed = !value.ok && value.reasonCode !== 'OK' && value.revocationReceipt === 'parent_required' && value.authProofSha256 === null && numeric.every((key) => value[key] === null) && value.finalUrl === null && value.capturedAt === null;
    if ((!successful && !failed) || (expectedCanary && value.reasonCode !== 'CANARY_INTENTIONAL_FAILURE') || (!expectedCanary && value.reasonCode === 'CANARY_INTENTIONAL_FAILURE') || markers.some((marker) => JSON.stringify(value).includes(marker))) throw Object.assign(new Error('unsafe metadata'), { code: 'INTERNAL_FAILURE' });
    if (successful && release) {
        const finalUrl = new URL(value.finalUrl);
        if (finalUrl.toString() !== value.finalUrl || finalUrl.origin !== release.origin.origin || finalUrl.pathname !== '/admin' || finalUrl.search || finalUrl.hash || value.capturedAt < release.issuedAt || value.capturedAt > release.expiresAt) throw Object.assign(new Error('invalid success metadata'), { code: 'INTERNAL_FAILURE' });
    }
    return value;
}

export async function fetchBounded(url, options) { return fetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS) }); }

async function validatePreflight(release) {
    assertFreshWindow(release);
    const { receipt, digest } = decodeDeploymentReceipt(requiredEnvironment('RELEASE_AUTH_TUPLE_RECEIPT_B64'), release);
    const cellId = authCellId(receipt, release.cellId, release.origin);
    const response = await fetchBounded(release.origin, { method: 'GET', redirect: 'manual', headers: { accept: 'text/html' } });
    if (response.status >= 300 && response.status < 400 || response.status < 200 || response.status >= 400 || response.headers.get('location')) throw Object.assign(new Error('preflight failed'), { code: 'CROSS_ORIGIN_REDIRECT' });
    return { receipt, digest, cellId };
}

async function assertRestrictedEmptyDirectory(directory) { if ((await readdir(directory)).length !== 0) throw Object.assign(new Error('retained output'), { code: 'INTERNAL_FAILURE' }); }
export function scrubBrowserEnvironment() { return { PATH: process.env.PATH || '', HOME: '', TMP: '', TEMP: '', TMPDIR: '' }; }

export function parseBoundAccessCredential(state) {
    const value = [...state.cookies].sort((a, b) => a.name.localeCompare(b.name)).map((cookie) => cookie.value).join('');
    const encoded = value.startsWith('base64-') ? value.slice(7).replace(/-/g, '+').replace(/_/g, '/') : value;
    try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        const session = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!session || typeof session.access_token !== 'string' || !session.access_token) throw invalid('incomplete session');
        return session.access_token;
    } catch (error) { if (error?.code) throw error; throw invalid('invalid session'); }
}

function authCookiePayload(state) {
    const value = [...state.cookies].sort((a, b) => a.name.localeCompare(b.name)).map((cookie) => cookie.value).join('');
    const encoded = value.startsWith('base64-') ? value.slice(7).replace(/-/g, '+').replace(/_/g, '/') : value;
    try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        const session = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!session || typeof session !== 'object' || Array.isArray(session) || typeof session.access_token !== 'string' || !session.access_token) throw invalid('incomplete session');
        return session;
    } catch (error) {
        if (error?.code) throw error;
        throw invalid('invalid session');
    }
}

function duplicateFreeJson(text) {
    let index = 0;
    const whitespace = () => { while (/[ \n\r\t]/.test(text[index])) index += 1; };
    const string = () => {
        const start = index++;
        let escaped = false;
        while (index < text.length) {
            const character = text[index++];
            if (!escaped && character === '"') return JSON.parse(text.slice(start, index));
            if (!escaped && character === '\\') escaped = true;
            else escaped = false;
        }
        throw invalid('invalid jwt json');
    };
    const value = () => {
        whitespace();
        if (text[index] === '{') {
            index += 1;
            const keys = new Set();
            whitespace();
            if (text[index] === '}') { index += 1; return; }
            for (;;) {
                whitespace();
                if (text[index] !== '"') throw invalid('invalid jwt object');
                const key = string();
                if (keys.has(key)) throw invalid('duplicate jwt key');
                keys.add(key);
                whitespace();
                if (text[index++] !== ':') throw invalid('invalid jwt object');
                value();
                whitespace();
                if (text[index] === '}') { index += 1; return; }
                if (text[index++] !== ',') throw invalid('invalid jwt object');
            }
        }
        if (text[index] === '[') {
            index += 1;
            whitespace();
            if (text[index] === ']') { index += 1; return; }
            for (;;) {
                value();
                whitespace();
                if (text[index] === ']') { index += 1; return; }
                if (text[index++] !== ',') throw invalid('invalid jwt array');
            }
        }
        if (text[index] === '"') { string(); return; }
        const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
        if (!match) throw invalid('invalid jwt value');
        index += match[0].length;
    };
    value();
    whitespace();
    if (index !== text.length) throw invalid('invalid jwt trailing data');
}

function decodeJwtSegment(segment) {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw invalid('invalid jwt encoding');
    const bytes = Buffer.from(segment, 'base64url');
    if (!bytes.length || bytes.toString('base64url') !== segment) throw invalid('noncanonical jwt encoding');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw invalid('invalid jwt utf8'); }
    if (text.includes('\r') || text.charCodeAt(0) === 0xfeff) throw invalid('invalid jwt text');
    duplicateFreeJson(text);
    let value;
    try { value = JSON.parse(text); } catch { throw invalid('invalid jwt json'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid('invalid jwt object');
    return value;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPAQUE_REFRESH_TOKEN = /^[A-Za-z0-9._~-]{16,4096}$/;
export function parseBoundSessionIdentity(state, now = Math.floor(Date.now() / 1000)) {
    const session = authCookiePayload(state);
    const accessToken = session.access_token;
    if (typeof session.refresh_token !== 'string' || !OPAQUE_REFRESH_TOKEN.test(session.refresh_token) || Buffer.byteLength(session.refresh_token, 'utf8') > MAX_REFRESH_TOKEN_BYTES) throw invalid('invalid bound refresh credential');
    const parts = accessToken.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) throw invalid('invalid jwt');
    const header = decodeJwtSegment(parts[0]);
    const payload = decodeJwtSegment(parts[1]);
    if (typeof header.alg !== 'string' || !header.alg || header.alg.toLowerCase() === 'none') throw invalid('invalid jwt algorithm');
    if (typeof payload.sub !== 'string' || !CANONICAL_UUID.test(payload.sub) || typeof payload.session_id !== 'string' || !CANONICAL_UUID.test(payload.session_id) || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.iat > now + MAX_CLOCK_SKEW_SECONDS || payload.exp <= now || payload.exp - payload.iat < 1 || payload.exp - payload.iat > MAX_SESSION_SECONDS) throw invalid('invalid bound session identity');
    return { accessToken, userId: payload.sub, sessionId: payload.session_id, issuedAt: payload.iat, expiresAt: payload.exp, refreshSha256: sha256Text('tzudong:release-auth-refresh-binding:v1\n', session.refresh_token) };
}

function revocationFailure(message) { return Object.assign(new Error(message), { code: 'SESSION_REVOCATION_FAILED' }); }
function authHeaders(apiKey, accessToken) { return { apikey: apiKey, authorization: `Bearer ${accessToken}` }; }
function serviceHeaders(serviceKey) { return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' }; }
async function requestBeforeDeadline(fetcher, url, options, deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw revocationFailure('session cleanup deadline exceeded');
    return fetcher(url, { ...options, signal: AbortSignal.timeout(Math.min(remaining, FETCH_TIMEOUT_MS)) });
}

function exactObject(value, keys) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}

async function boundedResponseText(response) {
    const lengthHeader = response.headers?.get?.('content-length');
    if (lengthHeader !== null && lengthHeader !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(lengthHeader) || Number(lengthHeader) > MAX_AUTH_RESPONSE_BYTES)) throw revocationFailure('authoritative response rejected');
    const reader = response.body?.getReader?.();
    if (!reader) {
        if (typeof response.text !== 'function') throw revocationFailure('authoritative response rejected');
        const text = await response.text();
        if (typeof text !== 'string' || !text || Buffer.byteLength(text, 'utf8') > MAX_AUTH_RESPONSE_BYTES) throw revocationFailure('authoritative response rejected');
        return text;
    }
    const chunks = [];
    let bytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!(value instanceof Uint8Array)) throw revocationFailure('authoritative response rejected');
            bytes += value.byteLength;
            if (bytes > MAX_AUTH_RESPONSE_BYTES) {
                await reader.cancel().catch(() => {});
                throw revocationFailure('authoritative response rejected');
            }
            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock?.();
    }
    if (!bytes) throw revocationFailure('authoritative response rejected');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)); } catch { throw revocationFailure('authoritative response rejected'); }
}

async function jsonResponse(response, expectedUrl) {
    if (!response || response.status !== 200 || response.ok !== true || response.headers?.get?.('location') || !/^application\/json(?:;|$)/i.test(response.headers?.get?.('content-type') || '') || (response.url && response.url !== expectedUrl.toString())) throw revocationFailure('authoritative response rejected');
    try {
        const text = await boundedResponseText(response);
        duplicateFreeJson(text);
        return JSON.parse(text);
    } catch {
        throw revocationFailure('authoritative response rejected');
    }
}

function parsePreflightReceipt(value, operationId, expiresAt) {
    const keys = ['schemaVersion', 'status', 'dedicatedIdentity', 'sessionBound', 'refreshBound', 'leaseActive', 'operationId', 'expiresAt'];
    if (!exactObject(value, keys) || value.schemaVersion !== 2 || value.status !== 'compatible_bound' || value.dedicatedIdentity !== true || value.sessionBound !== true || value.refreshBound !== true || value.leaseActive !== true || value.operationId !== operationId || value.expiresAt !== expiresAt) throw revocationFailure('preflight receipt rejected');
    return value;
}

function parseRevocationReceipt(value, operationId, bindingSha256) {
    const keys = ['schemaVersion', 'operationId', 'bindingSha256', 'status', 'refreshTokensDeleted', 'sessionsDeleted', 'sessionAbsent', 'refreshTokensAbsent', 'revokedAt'];
    if (!exactObject(value, keys) || value.schemaVersion !== 1 || value.operationId !== operationId || !CANONICAL_UUID.test(value.operationId) || value.bindingSha256 !== bindingSha256 || !/^[a-f0-9]{64}$/.test(value.bindingSha256) || value.status !== 'revoked_verified' || !Number.isSafeInteger(value.refreshTokensDeleted) || value.refreshTokensDeleted < 0 || value.sessionsDeleted !== 1 || value.sessionAbsent !== true || value.refreshTokensAbsent !== true || typeof value.revokedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.revokedAt) || new Date(value.revokedAt).toISOString() !== value.revokedAt) throw revocationFailure('revocation receipt rejected');
    return value;
}

export async function validateReleaseSessionIdentity(identity, apiKey, dedicatedUserId, fetcher = fetchBounded) {
    if (!identity || typeof apiKey !== 'string' || !apiKey || !CANONICAL_UUID.test(dedicatedUserId) || identity.userId !== dedicatedUserId) throw revocationFailure('dedicated release identity mismatch');
    const url = new URL('/auth/v1/user', SUPABASE_ORIGIN);
    const response = await fetcher(url, { method: 'GET', redirect: 'error', headers: authHeaders(apiKey, identity.accessToken), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = await jsonResponse(response, url);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.id !== identity.userId) throw revocationFailure('session user binding mismatch');
    return true;
}

export async function preflightReleaseSessionFamily(identity, operationId, expiresAt, serviceKey, fetcher = fetchBounded) {
    const now = Math.floor(Date.now() / 1000);
    if (!identity || !CANONICAL_UUID.test(operationId) || !/^[a-f0-9]{64}$/.test(identity.refreshSha256 || '') || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt - now > MAX_RELEASE_WINDOW_SECONDS || typeof serviceKey !== 'string' || !serviceKey) throw revocationFailure('service revocation unavailable');
    const url = new URL('/rest/v1/rpc/preflight_release_auth_session_family', SUPABASE_ORIGIN);
    const body = canonicalJson({ p_expires_at: expiresAt, p_operation_id: operationId, p_refresh_sha256: identity.refreshSha256, p_session_id: identity.sessionId, p_user_id: identity.userId });
    const response = await fetcher(url, { method: 'POST', redirect: 'error', headers: serviceHeaders(serviceKey), body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return parsePreflightReceipt(await jsonResponse(response, url), operationId, expiresAt);
}

export async function revokeReleaseSessionFamily(identity, operationId, bindingSha256, serviceKey, fetcher = fetchBounded, deadline = Date.now() + 12_000) {
    if (!identity || !CANONICAL_UUID.test(operationId) || !/^[a-f0-9]{64}$/.test(bindingSha256) || typeof serviceKey !== 'string' || !serviceKey) throw revocationFailure('service revocation unavailable');
    const revokeBody = canonicalJson({ p_binding_sha256: bindingSha256, p_operation_id: operationId, p_session_id: identity.sessionId, p_user_id: identity.userId });
    const readBody = canonicalJson({ p_operation_id: operationId, p_session_id: identity.sessionId, p_user_id: identity.userId });
    const revokeUrl = new URL('/rest/v1/rpc/revoke_release_auth_session_family', SUPABASE_ORIGIN);
    const readUrl = new URL('/rest/v1/rpc/read_release_auth_revocation', SUPABASE_ORIGIN);
    let revokeReceipt;
    for (let attempt = 0; attempt < 2 && Date.now() < deadline - 2_000; attempt += 1) {
        try {
            const response = await requestBeforeDeadline(fetcher, revokeUrl, { method: 'POST', redirect: 'error', headers: serviceHeaders(serviceKey), body: revokeBody }, deadline - 2_000);
            revokeReceipt = parseRevocationReceipt(await jsonResponse(response, revokeUrl), operationId, bindingSha256);
            break;
        } catch {
            if (attempt === 1) break;
        }
    }
    const readResponse = await requestBeforeDeadline(fetcher, readUrl, { method: 'POST', redirect: 'error', headers: serviceHeaders(serviceKey), body: readBody }, deadline);
    const readReceipt = parseRevocationReceipt(await jsonResponse(readResponse, readUrl), operationId, bindingSha256);
    if (revokeReceipt && canonicalJson(revokeReceipt) !== canonicalJson(readReceipt)) throw revocationFailure('revocation readback disagreement');
    return readReceipt;
}

const HELPER_TIMEOUT_MS = 5_000;
const HELPER_OUTPUT_LIMIT = 16 * 1024;
const WINDOWS_SYSTEM32 = process.platform === 'win32' && process.arch === 'ia32' && process.env.PROCESSOR_ARCHITEW6432 ? 'C:\\Windows\\Sysnative' : 'C:\\Windows\\System32';
const WINDOWS_POWERSHELL = `${WINDOWS_SYSTEM32}\\WindowsPowerShell\\v1.0\\powershell.exe`;
const WINDOWS_TASKKILL = `${WINDOWS_SYSTEM32}\\taskkill.exe`;
const LINUX_NAMESPACE_SUPERVISOR = String.raw`
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [nonce, deadlineText, executable, ...args] = process.argv.slice(1);
const deadline = Number(deadlineText);
let child; let acknowledged = false; let closing = false; let watchdog;
const namespacePids = () => fs.readdirSync('/proc').filter((entry) => /^[1-9]\d*$/.test(entry));
const killNamespace = () => {
  for (const entry of namespacePids()) {
    const pid = Number(entry);
    if (pid !== process.pid) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
};
const abort = () => {
  if (closing) return;
  closing = true;
  clearInterval(watchdog);
  killNamespace();
  process.exit(125);
};
const watchControl = () => {
  const control = fs.createReadStream('/dev/null', { fd: 3, autoClose: false });
  control.on('data', abort);
  control.once('end', abort);
  control.once('close', abort);
  control.once('error', abort);
};
const waitForAck = () => {
  const buffer = Buffer.alloc(512);
  try {
    const count = fs.readSync(3, buffer, 0, buffer.length, null);
    acknowledged = buffer.subarray(0, count).toString('utf8') === 'ACK ' + nonce + ' ' + deadline + '\n';
  } catch {}
  if (!acknowledged || Date.now() > deadline) abort();
  watchControl();
};
const complete = (code) => {
  const finish = () => {
    if (Date.now() > deadline) return abort();
    const remaining = namespacePids().filter((entry) => Number(entry) !== process.pid);
    if (remaining.length) { killNamespace(); return setTimeout(finish, 10); }
    try { fs.writeSync(3, 'COMPLETE ' + nonce + ' ' + deadline + '\n'); } catch { process.exit(125); }
    closing = true;
    clearInterval(watchdog);
    process.exit(code);
  };
  finish();
};
process.once('SIGTERM', abort);
process.once('SIGINT', abort);
try {
  if (!/^[a-f0-9]{64}$/.test(nonce) || !Number.isSafeInteger(deadline) || deadline <= Date.now()) abort();
  watchdog = setInterval(() => { if (Date.now() > deadline) abort(); }, 50);
  child = spawn(executable, args, { shell: false, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  fs.writeSync(3, 'READY ' + nonce + ' ' + deadline + '\n');
  waitForAck();
  child.once('error', abort);
  child.once('close', (code, signal) => { if (signal || !Number.isInteger(code) || code < 0 || code > 255) abort(); else complete(code); });
} catch { abort(); }
`;
let linuxPidNamespaceLauncher;
let linuxSupervisorExecutable;
function probeLinuxPidNamespaceSupervisor() {
    if (linuxPidNamespaceLauncher !== undefined) return linuxPidNamespaceLauncher;
    for (const launcher of ['/usr/bin/unshare', '/bin/unshare']) {
        try {
            const probe = spawnSync(
                launcher,
                ['--user', '--map-root-user', '--pid', '--fork', '--mount-proc', '--kill-child=SIGKILL', '--', '/bin/true'],
                { stdio: 'ignore', timeout: 3_000, shell: false },
            );
            if (probe.status === 0 && !probe.error && !probe.signal) {
                linuxPidNamespaceLauncher = launcher;
                return launcher;
            }
        } catch {}
    }
    linuxPidNamespaceLauncher = null;
    return linuxPidNamespaceLauncher;
}
export function selectLinuxSupervisorExecutable(configured, fallback, versionProbe) {
    for (const candidate of [configured, fallback]) {
        if (typeof candidate !== 'string' || !isAbsolute(candidate)) continue;
        let version;
        try {
            version = versionProbe(candidate);
        } catch {}
        if (typeof version === 'string' && /^v24\./.test(version.trim())) return candidate;
    }
    return null;
}
function resolveLinuxSupervisorExecutable() {
    if (linuxSupervisorExecutable !== undefined) return linuxSupervisorExecutable;
    const probeVersion = (candidate) => {
        const result = spawnSync(candidate, ['--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 3_000,
            shell: false,
        });
        return result.status === 0 && !result.error && !result.signal ? result.stdout : null;
    };
    linuxSupervisorExecutable = selectLinuxSupervisorExecutable(
        process.env.TZUDONG_NODE24_EXECUTABLE?.trim(),
        process.execPath,
        probeVersion,
    );
    return linuxSupervisorExecutable;
}
function linuxPidNamespaceSupervisorSpec(launcher, executable, args, cwd, environment, nonce, deadline) {
    const supervisorExecutable = resolveLinuxSupervisorExecutable();
    if (!supervisorExecutable) {
        throw Object.assign(new Error('Linux Node 24 supervisor unavailable'), { code: 'INTERNAL_FAILURE' });
    }
    return {
        executable: launcher,
        args: ['--user', '--map-root-user', '--pid', '--fork', '--mount-proc', '--kill-child=SIGKILL', supervisorExecutable, '-e', LINUX_NAMESPACE_SUPERVISOR, nonce, String(deadline), executable, ...args],
        environment,
        cwd,
    };
}
const WINDOWS_JOB_SUPERVISOR_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$source=@'
using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
public static class AuthSmokeJob {
 const uint EXTENDED_STARTUPINFO_PRESENT=0x00080000, CREATE_NO_WINDOW=0x08000000, CREATE_SUSPENDED=0x00000004, STARTF_USESTDHANDLES=0x00000100, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE=0x00002000, WAIT_OBJECT_0=0, WAIT_TIMEOUT=258, SYNCHRONIZE=0x00100000;
 static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST=new IntPtr(0x0002000D), PROC_THREAD_ATTRIBUTE_HANDLE_LIST=new IntPtr(0x00020002);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct SI { public int cb; public string r,d,t; public uint x,y,xs,ys,xc,yc,fill,flags; public short show,res; public IntPtr reserved,hin,hout,herr; }
 [StructLayout(LayoutKind.Sequential)] struct SIX { public SI si; public IntPtr attributes; }
 [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct BL { public long pp,pj; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IOC { public ulong ro,wo,oo,rb,wb,ob; }
 [StructLayout(LayoutKind.Sequential)] struct EL { public BL basic; public IOC io; public UIntPtr pml,jml,peakp,peakj; }
 [StructLayout(LayoutKind.Sequential)] struct BA { public long tu,tk,ptu,ptk; public uint faults,total,active,terminated; }
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SIX si,out PI pi);
 [DllImport("kernel32",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int c,IntPtr i,uint l);
 [DllImport("kernel32",SetLastError=true)] static extern bool TerminateJobObject(IntPtr j,uint c);
 [DllImport("kernel32",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr l,int n,int f,ref IntPtr s);
 [DllImport("kernel32",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr l,uint f,IntPtr a,IntPtr v,IntPtr s,IntPtr p,IntPtr r);
 [DllImport("kernel32")] static extern void DeleteProcThreadAttributeList(IntPtr l);
 [DllImport("kernel32",SetLastError=true)] static extern uint ResumeThread(IntPtr h);
 [DllImport("kernel32",SetLastError=true)] static extern uint WaitForMultipleObjects(uint n,IntPtr[] h,bool all,uint ms);
 [DllImport("kernel32",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h,out uint c);
 [DllImport("kernel32")] static extern IntPtr GetStdHandle(int n);
 [DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j,int c,IntPtr i,uint l,IntPtr r);
 static void Check(bool ok,string what) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error(),what); }
 static uint ActiveProcessCount(IntPtr job) { int size=Marshal.SizeOf(typeof(BA)); IntPtr info=Marshal.AllocHGlobal(size); try { Check(QueryInformationJobObject(job,1,info,(uint)size,IntPtr.Zero),"QueryInformationJobObject"); return ((BA)Marshal.PtrToStructure(info,typeof(BA))).active; } finally { Marshal.FreeHGlobal(info); } }
 static int Abort(IntPtr job) { if(job!=IntPtr.Zero) TerminateJobObject(job,125); return 125; }
 public static int Run(string exe,string cmd,string cwd,string pipe,string nonce,long deadline,uint parentPid) {
  IntPtr job=IntPtr.Zero,info=IntPtr.Zero,list=IntPtr.Zero,value=IntPtr.Zero,handles=IntPtr.Zero,parent=IntPtr.Zero; bool initialized=false; int stage=1; PI pi=new PI();
  try {
   if(!System.Text.RegularExpressions.Regex.IsMatch(nonce,"^[a-f0-9]{64}$") || deadline<=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) return 125;
   parent=OpenProcess(SYNCHRONIZE,false,parentPid); if(parent==IntPtr.Zero) return 125;
   stage=2;
   using(var control=new NamedPipeClientStream(".",pipe,PipeDirection.InOut,PipeOptions.None)) {
    int connectMs=(int)Math.Min(5000,Math.Max(1,deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())); control.Connect(connectMs);
    var reader=new StreamReader(control,new UTF8Encoding(false),false,512,true); var writer=new StreamWriter(control,new UTF8Encoding(false),512,true); writer.NewLine="\n"; writer.AutoFlush=true;
    writer.WriteLine("READY "+nonce+" "+deadline);
    int ackMs=(int)Math.Min(1000,Math.Max(1,deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
    var ackTask=reader.ReadLineAsync();
    if(System.Threading.Tasks.Task.WaitAny(ackTask,System.Threading.Tasks.Task.Delay(ackMs))!=0 || ackTask.Result!="ACK "+nonce+" "+deadline || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>deadline) return 125;
    stage=3;
    job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"CreateJobObject");
    stage=4;
    EL limits=new EL(); limits.basic.flags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; int size=Marshal.SizeOf(typeof(EL)); info=Marshal.AllocHGlobal(size); Marshal.StructureToPtr(limits,info,false); Check(SetInformationJobObject(job,9,info,(uint)size),"SetInformationJobObject");
    IntPtr listSize=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref listSize); if(listSize==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"InitializeProcThreadAttributeList");
    list=Marshal.AllocHGlobal(listSize); Check(InitializeProcThreadAttributeList(list,2,0,ref listSize),"InitializeProcThreadAttributeList"); initialized=true;
    value=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(value,job); Check(UpdateProcThreadAttribute(list,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,value,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute");
    IntPtr hin=GetStdHandle(-10),hout=GetStdHandle(-11),herr=GetStdHandle(-12); handles=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.WriteIntPtr(handles,0,hin); Marshal.WriteIntPtr(handles,IntPtr.Size,hout); Marshal.WriteIntPtr(handles,IntPtr.Size*2,herr); Check(UpdateProcThreadAttribute(list,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute");
    SIX startup=new SIX(); startup.si.cb=Marshal.SizeOf(typeof(SIX)); startup.si.flags=STARTF_USESTDHANDLES; startup.si.hin=hin; startup.si.hout=hout; startup.si.herr=herr; startup.attributes=list;
    Check(CreateProcessW(exe,new StringBuilder(cmd),IntPtr.Zero,IntPtr.Zero,true,CREATE_NO_WINDOW|CREATE_SUSPENDED|EXTENDED_STARTUPINFO_PRESENT,IntPtr.Zero,cwd,ref startup,out pi),"CreateProcessW");
    if(ResumeThread(pi.thread)==0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error(),"ResumeThread");
    stage=5;
    writer.WriteLine("STARTED "+nonce+" "+deadline);
    CloseHandle(pi.thread); pi.thread=IntPtr.Zero;
    stage=6;
    for(;;) {
     long remaining=deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); if(remaining<=0) { writer.WriteLine("FAILED "+nonce+" "+deadline+" deadline"); return Abort(job); }
     uint wait=WaitForMultipleObjects(2,new IntPtr[]{parent,pi.process},false,(uint)Math.Min(100,remaining));
     if(wait==WAIT_TIMEOUT) continue;
     if(wait!=WAIT_OBJECT_0+1) { writer.WriteLine("FAILED "+nonce+" "+deadline+" wait:"+wait); return Abort(job); }
     uint code;
     if(!GetExitCodeProcess(pi.process,out code)) { writer.WriteLine("FAILED "+nonce+" "+deadline+" get-exit"); return Abort(job); }
     if(ActiveProcessCount(job)!=0) {
      if(!TerminateJobObject(job,125)) { writer.WriteLine("FAILED "+nonce+" "+deadline+" terminate"); return Abort(job); }
      while(ActiveProcessCount(job)!=0) {
       long drainRemaining=deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
       if(drainRemaining<=0 || WaitForMultipleObjects(1,new IntPtr[]{parent},false,0)==WAIT_OBJECT_0) { writer.WriteLine("FAILED "+nonce+" "+deadline+" drain"); return Abort(job); }
       System.Threading.Thread.Sleep((int)Math.Min(10,drainRemaining));
      }
     }
     writer.WriteLine("COMPLETE "+nonce+" "+deadline);
     return unchecked((int)code);
    }
   }
  } catch { Console.Error.WriteLine("[trusted supervisor: Windows Job Object stage "+stage+" failed]"); return Abort(job); }
  finally { if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread); if(pi.process!=IntPtr.Zero)CloseHandle(pi.process); if(parent!=IntPtr.Zero)CloseHandle(parent); if(initialized)DeleteProcThreadAttributeList(list); if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles); if(value!=IntPtr.Zero)Marshal.FreeHGlobal(value); if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list); if(info!=IntPtr.Zero)Marshal.FreeHGlobal(info); if(job!=IntPtr.Zero)CloseHandle(job); }
 }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TZUDONG_JOB_EXECUTABLE_B64))
$cmd=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TZUDONG_JOB_COMMAND_LINE_B64))
$cwd=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TZUDONG_JOB_CWD_B64))
$pipe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TZUDONG_JOB_CONTROL_PIPE_B64))
$nonce=$env:TZUDONG_JOB_CONTROL_NONCE
$deadline=[Int64]$env:TZUDONG_JOB_CONTROL_DEADLINE
$parentPid=[UInt32]$env:TZUDONG_JOB_PARENT_PID
$childEnvironment=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TZUDONG_JOB_ENV_B64)))
Remove-Item Env:TZUDONG_JOB_EXECUTABLE_B64,Env:TZUDONG_JOB_COMMAND_LINE_B64,Env:TZUDONG_JOB_CWD_B64,Env:TZUDONG_JOB_CONTROL_PIPE_B64,Env:TZUDONG_JOB_CONTROL_NONCE,Env:TZUDONG_JOB_CONTROL_DEADLINE,Env:TZUDONG_JOB_PARENT_PID,Env:TZUDONG_JOB_ENV_B64 -ErrorAction SilentlyContinue
foreach($property in $childEnvironment.PSObject.Properties) { Set-Item -Path ("Env:"+$property.Name) -Value ([string]$property.Value) }
try { exit [AuthSmokeJob]::Run($exe,$cmd,$cwd,$pipe,$nonce,$deadline,$parentPid) } catch { [Console]::Error.WriteLine('[trusted supervisor: Windows Job Object launch failed]'); exit 125 }
`;

const WINDOWS_JOB_SUPERVISOR_BOOTSTRAP = String.raw`
$ErrorActionPreference='Stop'
$encoded=$env:TZUDONG_JOB_SCRIPT_GZIP_B64
Remove-Item Env:TZUDONG_JOB_SCRIPT_GZIP_B64 -ErrorAction SilentlyContinue
if(-not $encoded){exit 125}
$compressed=[Convert]::FromBase64String($encoded)
$inputStream=[IO.MemoryStream]::new($compressed,$false)
$gzip=[IO.Compression.GzipStream]::new($inputStream,[IO.Compression.CompressionMode]::Decompress)
$reader=[IO.StreamReader]::new($gzip,[Text.Encoding]::UTF8,$true)
try{$script=$reader.ReadToEnd()}finally{$reader.Dispose();$gzip.Dispose();$inputStream.Dispose()}
& ([ScriptBlock]::Create($script))
`;

const WINDOWS_POWERSHELL_STARTUP_PROGRESS =
    '#< CLIXML\r\n' +
    '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
    '<Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T>' +
    '<T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record">' +
    '<AV>Preparing modules for first use.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC>' +
    '<T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj></Objs>';
export function stripTrustedWindowsPowerShellStartupProgress(value) {
    return value.startsWith(WINDOWS_POWERSHELL_STARTUP_PROGRESS)
        ? value.slice(WINDOWS_POWERSHELL_STARTUP_PROGRESS.length)
        : value;
}
function quoteWindowsCreateProcessArgument(value) {
    if (typeof value !== 'string') throw new Error('invalid Windows argument');
    if (!value || /[\s"]/.test(value)) {
        let quoted = '"'; let slashes = 0;
        for (const character of value) {
            if (character === '\\') { slashes += 1; continue; }
            if (character === '"') quoted += '\\'.repeat(slashes * 2 + 1) + '"';
            else quoted += '\\'.repeat(slashes) + character;
            slashes = 0;
        }
        return quoted + '\\'.repeat(slashes * 2) + '"';
    }
    return value;
}
function windowsJobSupervisorSpec(executable, args, cwd, environment, pipeName, nonce, deadline) {
    const encode = (value) => Buffer.from(value, 'utf8').toString('base64');
    return {
        executable: WINDOWS_POWERSHELL,
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(WINDOWS_JOB_SUPERVISOR_BOOTSTRAP, 'utf16le').toString('base64')],
        environment: {
            SystemRoot: 'C:\\Windows',
            ComSpec: `${WINDOWS_SYSTEM32}\\cmd.exe`,
            TZUDONG_JOB_SCRIPT_GZIP_B64: gzipSync(Buffer.from(WINDOWS_JOB_SUPERVISOR_SCRIPT, 'utf8')).toString('base64'),
            TZUDONG_JOB_EXECUTABLE_B64: encode(executable),
            TZUDONG_JOB_COMMAND_LINE_B64: encode([quoteWindowsCreateProcessArgument(executable), ...args.map(quoteWindowsCreateProcessArgument)].join(' ')),
            TZUDONG_JOB_CWD_B64: encode(cwd),
            TZUDONG_JOB_CONTROL_PIPE_B64: encode(pipeName),
            TZUDONG_JOB_CONTROL_NONCE: nonce,
            TZUDONG_JOB_CONTROL_DEADLINE: String(deadline),
            TZUDONG_JOB_PARENT_PID: String(process.pid),
            TZUDONG_JOB_ENV_B64: encode(JSON.stringify(environment)),
        },
    };
}
export function runBoundedCommand(command, args, { timeoutMs = HELPER_TIMEOUT_MS, outputLimit = HELPER_OUTPUT_LIMIT, spawnFn = spawn } = {}) {
    return new Promise((resolve, reject) => {
        let child; let stdout = ''; let stderr = ''; let outputBytes = 0; let settled = false; let discarding = false;
        const helperEnv = process.platform === 'win32' ? { SystemRoot: 'C:\\Windows', ComSpec: `${WINDOWS_SYSTEM32}\\cmd.exe` } : { PATH: '/usr/bin:/bin', LANG: 'C' };
        const drain = () => { discarding = true; child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.(); };
        const finish = (error, result) => { if (!settled) { settled = true; clearTimeout(timer); drain(); error ? reject(error) : resolve(result); } };
        try { child = spawnFn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: helperEnv }); } catch { reject(new Error('helper spawn failed')); return; }
        const stop = (message) => { try { child.kill('SIGKILL'); } catch {} finish(new Error(message)); };
        const timer = setTimeout(() => stop('helper timeout'), timeoutMs);
        const retain = (target, chunk) => {
            if (discarding) return;
            const bytes = Buffer.byteLength(chunk);
            if (bytes > outputLimit - outputBytes) return stop('helper output limit');
            outputBytes += bytes;
            if (target === 'stdout') stdout += chunk; else stderr += chunk;
        };
        child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => retain('stdout', chunk)); child.stderr?.on('data', (chunk) => retain('stderr', chunk));
        child.once('error', () => finish(new Error('helper spawn failed')));
        child.once('close', (code) => finish(null, { code, stdout, stderr }));
    });
}
function parsePidLines(output) {
    const pids = output.trim() ? output.trim().split(/\s+/).map(Number) : [];
    if (!pids.every((pid) => Number.isSafeInteger(pid) && pid > 0)) throw new Error('invalid helper output');
    return [...new Set(pids)];
}
export function createProcessTreeController(options = {}) {
    const {
        platform = process.platform,
        runCommand = runBoundedCommand,
        kill = process.kill,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    } = options;
    const windows = platform === 'win32';
    const atomicWindowsJob = options.atomicWindowsJob === true;
    const atomicPidNamespace = options.atomicPidNamespace === true;
    const runBeforeDeadline = async (command, args, deadline) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('process cleanup deadline exceeded');
        return runCommand(command, args, { timeoutMs: Math.max(1, remaining), outputLimit: HELPER_OUTPUT_LIMIT });
    };
    const capture = async (pid) => {
        if (!Number.isInteger(pid) || pid <= 0) throw new Error('invalid child pid');
        return [pid];
    };
    const terminate = async (pids, signal, deadline) => {
        const pid = pids[0];
        if (windows) {
            if (!atomicWindowsJob) return false;
            const result = await runBeforeDeadline(WINDOWS_TASKKILL, ['/PID', String(pid), '/T', '/F'], deadline);
            return result.code === 0 && !result.stderr;
        }
        if (!atomicPidNamespace) return false;
        try { kill(pid, signal); return true; } catch (error) { return error?.code === 'ESRCH'; }
    };
    const gone = async (pids, deadline) => {
        const pid = pids[0];
        if (windows) {
            if (!atomicWindowsJob) return false;
            const result = await runBeforeDeadline(WINDOWS_POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if($p){$p.Id};exit 0`], deadline);
            return result.code === 0 && !result.stderr && parsePidLines(result.stdout).length === 0;
        }
        if (!atomicPidNamespace) return false;
        try { kill(pid, 0); return false; } catch (error) { return error?.code === 'ESRCH'; }
    };
    const verify = async (pids, deadline) => {
        try { if (await gone(pids, deadline)) return true; } catch { return false; }
        while (Date.now() < deadline) {
            await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
            try { if (await gone(pids, deadline)) return true; } catch { return false; }
        }
        return false;
    };
    return {
        atomicWindowsJob,
        atomicPidNamespace,
        async cleanup(pid, signal = 'SIGKILL', timeoutMs = 10_000) {
            const deadline = Date.now() + timeoutMs;
            const reserveMs = Math.min(100, Math.max(1, Math.floor(timeoutMs / 4)));
            const actionDeadline = deadline - reserveMs;
            const pids = await capture(pid);
            try { if (await gone(pids, actionDeadline)) return true; } catch { return false; }
            if ((windows && !atomicWindowsJob) || (!windows && !atomicPidNamespace)) return false;
            if (!await terminate(pids, signal, actionDeadline)) return verify(pids, deadline);
            return verify(pids, deadline);
        },
        capture,
        terminate,
        verify,
    };
}

const CHILD_OUTPUT_LIMIT = 64 * 1024;
export function runChild(environment, markers, directory, origin, timeoutMs = CHILD_TIMEOUT_MS, { childPath = CHILD, executable = process.execPath, processController, platform = process.platform, closeTimeoutMs = CHILD_HANDLE_DRAIN_TIMEOUT_MS, cleanupTimeoutMs = 10_000, outputLimit = CHILD_OUTPUT_LIMIT, spawnChild = spawn, workingDirectory = dirname(childPath), trustedWindowsJobBoundary = platform === 'win32' && !processController, trustedLinuxPidNamespace = platform === 'linux' && !processController } = {}) {
return new Promise((resolve, reject) => {
    const useNativeWindowsJobSupervisor = platform === 'win32' && trustedWindowsJobBoundary === true;
    const useNativeLinuxPidNamespace = platform === 'linux' && trustedLinuxPidNamespace === true;
    const controller = useNativeWindowsJobSupervisor
        ? processController || createProcessTreeController({ platform, atomicWindowsJob: true })
        : useNativeLinuxPidNamespace
            ? createProcessTreeController({ platform, atomicPidNamespace: true })
            : processController || createProcessTreeController({ platform, atomicWindowsJob: false, atomicPidNamespace: false });
    if (platform === 'win32' && !useNativeWindowsJobSupervisor && !processController) {
        reject(Object.assign(new Error('STARTUPINFOEX job-list containment unavailable'), { code: 'INTERNAL_FAILURE' }));
        return;
    }
    const childArgs = [childPath, '--origin', new URL(origin).toString()];
    const containmentNonce = randomBytes(32).toString('hex');
    const containmentDeadline = Date.now() + timeoutMs + cleanupTimeoutMs;
    const windowsControlPipeName = useNativeWindowsJobSupervisor ? `tzudong-auth-smoke-${randomUUID()}` : null;
    const windowsControlPipe = windowsControlPipeName ? `\\\\.\\pipe\\${windowsControlPipeName}` : null;
    const windowsControlServer = windowsControlPipe ? createServer() : null;
    windowsControlServer?.listen(windowsControlPipe);
    const linuxPidNamespaceLauncher = useNativeLinuxPidNamespace
        ? probeLinuxPidNamespaceSupervisor()
        : null;
    if (useNativeLinuxPidNamespace && !linuxPidNamespaceLauncher) {
        reject(Object.assign(new Error('Linux PID namespace containment preflight unavailable'), { code: 'INTERNAL_FAILURE' }));
        return;
    }
    const launch = useNativeWindowsJobSupervisor
        ? windowsJobSupervisorSpec(executable, childArgs, workingDirectory, environment, windowsControlPipeName, containmentNonce, containmentDeadline)
        : useNativeLinuxPidNamespace
            ? linuxPidNamespaceSupervisorSpec(linuxPidNamespaceLauncher, executable, childArgs, workingDirectory, environment, containmentNonce, containmentDeadline)
            : { executable, args: childArgs, environment };
    const child = spawnChild(launch.executable, launch.args, { cwd: workingDirectory, shell: false, stdio: useNativeLinuxPidNamespace ? ['ignore', 'pipe', 'pipe', 'pipe'] : useNativeWindowsJobSupervisor ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], env: launch.environment, detached: false, windowsHide: useNativeWindowsJobSupervisor });
    if (useNativeWindowsJobSupervisor) child.stdin?.end();
        let stdout = ''; let stderr = ''; let outputBytes = 0; let settled = false; let timedOut = false; let overflowed = false; let spawnFailed = false; let protocolAcknowledged = !(useNativeLinuxPidNamespace || useNativeWindowsJobSupervisor); let protocolStarted = !useNativeWindowsJobSupervisor; let protocolComplete = !(useNativeLinuxPidNamespace || useNativeWindowsJobSupervisor); let protocolClosed = !(useNativeLinuxPidNamespace || useNativeWindowsJobSupervisor); let protocolTimer; let timer; let captured; let capturedPids = []; let resolveClose; let resolveProtocolClose; let teardown; let windowsControlSocket;
        const closePromise = new Promise((resolveClosePromise) => { resolveClose = resolveClosePromise; });
        const protocolClosePromise = new Promise((resolveProtocolClosePromise) => { resolveProtocolClose = resolveProtocolClosePromise; });
        const finish = (error, result) => { if (!settled) { settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); } };
        const waitForClose = (deadline) => new Promise((resolveCloseWait) => {
            const closeTimer = setTimeout(() => resolveCloseWait(false), Math.max(0, deadline - Date.now()));
            closePromise.then(() => { clearTimeout(closeTimer); resolveCloseWait(true); });
        });
        const capture = () => {
            if (!child.pid) return Promise.reject(new Error('missing child pid'));
            if (!captured) captured = Promise.resolve(controller.capture ? controller.capture(child.pid) : [child.pid]).then((pids) => { capturedPids = pids; return pids; });
            return captured;
        };
        const cleanup = async (signal, deadline, allowAlreadyGone = false) => {
            try {
                const remaining = deadline - Date.now(); if (remaining <= 0) return false;
                if (controller.cleanup) return await controller.cleanup(child.pid, signal, remaining, capturedPids);
                const pids = await capture();
                if (allowAlreadyGone && await controller.verify(pids, deadline)) return true;
                return Boolean(await controller.terminate(pids, signal, deadline)) && Boolean(await controller.verify(pids, deadline));
            } catch { return false; }
        };
        const drainLocalHandles = () => {
            try { windowsControlSocket?.destroy(); windowsControlServer?.close(); for (const stream of [child.stdin, child.stdout, child.stderr, child.stdio?.[3]]) { stream?.end?.(); stream?.destroy(); } child.unref(); return true; } catch { return false; }
        };
        const teardownChild = (message, failureCode = 'NAVIGATION_FAILED') => {
            if (teardown) return teardown;
            teardown = (async () => {
                const deadline = Date.now() + cleanupTimeoutMs;
                if (protocolTimer) { clearTimeout(protocolTimer); protocolTimer = undefined; }
                const localHandlesClosed = drainLocalHandles();
                const gracefulDeadline = Math.min(
                    deadline,
                    Date.now() + Math.max(1, Math.min(1_000, Math.floor(cleanupTimeoutMs / 4))),
                );
                const gracefulGone = await cleanup('SIGTERM', gracefulDeadline);
                const gone = gracefulGone || await cleanup('SIGKILL', deadline);
                const closeDeadline = Math.min(deadline, Date.now() + closeTimeoutMs);
                const closed = localHandlesClosed || await waitForClose(closeDeadline);
                const complete = gone && closed;
                finish(Object.assign(new Error(complete ? message : 'child cleanup incomplete'), { code: complete ? failureCode : 'INTERNAL_FAILURE' }));
            })();
            return teardown;
        };
        const armChildTimeout = () => {
            if (!protocolAcknowledged || timer) return;
            timer = setTimeout(() => { timedOut = true; void teardownChild('child timeout'); }, timeoutMs);
        };
        if (useNativeLinuxPidNamespace) {
            const control = child.stdio?.[3];
            if (!control || typeof control.write !== 'function') {
                queueMicrotask(() => void teardownChild('namespace control protocol unavailable'));
            } else {
                let controlBytes = '';
                control.setEncoding('utf8');
                control.on('data', (chunk) => {
                    controlBytes += chunk;
                    if (controlBytes.length > 512) return void teardownChild('namespace control protocol overflow');
                    const frames = controlBytes.split('\n');
                    controlBytes = frames.pop();
                    for (const frame of frames) {
                        if (!protocolAcknowledged) {
                            if (frame !== `READY ${containmentNonce} ${containmentDeadline}`) return void teardownChild('namespace control protocol rejected');
                            protocolAcknowledged = true;
                            control.write(`ACK ${containmentNonce} ${containmentDeadline}\n`);
                            clearTimeout(protocolTimer);
                            armChildTimeout();
                        } else if (!protocolComplete) {
                            if (frame !== `COMPLETE ${containmentNonce} ${containmentDeadline}`) return void teardownChild('namespace completion protocol rejected');
                            protocolComplete = true;
                        } else return void teardownChild('namespace duplicate completion frame');
                    }
                });
                protocolTimer = setTimeout(() => void teardownChild('namespace READY acknowledgement timed out'), Math.min(closeTimeoutMs, timeoutMs));
            }
        }
        if (useNativeWindowsJobSupervisor) {
            let controlBytes = '';
            const rejectProtocol = (message) => void teardownChild(`Windows control protocol ${message}`, 'INTERNAL_FAILURE');
            windowsControlServer.on('error', () => rejectProtocol('unavailable'));
            windowsControlServer.on('connection', (socket) => {
                if (windowsControlSocket) { socket.destroy(); return rejectProtocol('duplicate connection'); }
                windowsControlSocket = socket;
                socket.setEncoding('utf8');
                socket.on('data', (chunk) => {
                    controlBytes += chunk;
                    if (controlBytes.length > 512) return rejectProtocol('overflow');
                    const frames = controlBytes.split('\n');
                    controlBytes = frames.pop();
                    for (const frame of frames) {
                        if (!protocolAcknowledged) {
                            if (frame !== `READY ${containmentNonce} ${containmentDeadline}`) return rejectProtocol('rejected');
                            protocolAcknowledged = true;
                            socket.write(`ACK ${containmentNonce} ${containmentDeadline}\n`);
                            clearTimeout(protocolTimer);
                            protocolTimer = setTimeout(() => rejectProtocol('STARTED acknowledgement timed out'), Math.min(cleanupTimeoutMs, Math.max(closeTimeoutMs, HELPER_TIMEOUT_MS)));
                        } else if (!protocolStarted) {
                            if (frame !== `STARTED ${containmentNonce} ${containmentDeadline}`) return rejectProtocol('start rejected');
                            protocolStarted = true;
                            clearTimeout(protocolTimer);
                            armChildTimeout();
                        } else if (!protocolComplete) {
                            const failedPrefix = `FAILED ${containmentNonce} ${containmentDeadline} `;
                            if (frame.startsWith(failedPrefix) && /^(?:get-exit|deadline|drain|terminate|exit:[0-9]+|wait:[0-9]+)$/.test(frame.slice(failedPrefix.length))) return rejectProtocol(`child failed ${frame.slice(failedPrefix.length)}`);
                            if (frame !== `COMPLETE ${containmentNonce} ${containmentDeadline}`) return rejectProtocol('completion rejected');
                            protocolComplete = true;
                        } else return rejectProtocol('duplicate completion frame');
                    }
                });
                socket.once('end', () => {
                    if (controlBytes || !protocolStarted || !protocolComplete) return rejectProtocol('truncated');
                    protocolClosed = true; resolveProtocolClose(true);
                });
                socket.once('error', () => rejectProtocol('closed'));
            });
            protocolTimer = setTimeout(() => rejectProtocol('READY acknowledgement timed out'), Math.min(cleanupTimeoutMs, Math.max(closeTimeoutMs, HELPER_TIMEOUT_MS)));
        }
        child.once('spawn', () => {
            void capture().catch(() => {});
            armChildTimeout();
        });
        const retainOutput = (target, chunk) => {
            if (timedOut || overflowed) return;
            const bytes = Buffer.byteLength(chunk);
            if (bytes > outputLimit - outputBytes) { overflowed = true; stdout = ''; stderr = ''; void teardownChild('child output limit'); return; }
            outputBytes += bytes;
            if (target === 'stdout') stdout += chunk; else stderr += chunk;
        };
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', (chunk) => retainOutput('stdout', chunk)); child.stderr.on('data', (chunk) => retainOutput('stderr', chunk));
        child.once('error', () => {
            spawnFailed = true;
            if (!child.pid) { drainLocalHandles(); return finish(Object.assign(new Error('child spawn failed'), { code: 'INTERNAL_FAILURE' })); }
            void teardownChild('child spawn failed');
        });
        child.once('close', (code) => {
            if (teardown) return;
            clearTimeout(protocolTimer);
            resolveClose();
            const finishAfterProtocol = () => {
                if (!protocolAcknowledged || !protocolStarted || !protocolComplete || (useNativeWindowsJobSupervisor && !protocolClosed)) {
                    const deadline = Date.now() + cleanupTimeoutMs;
                    return void cleanup('SIGKILL', deadline, true).then((gone) => {
                        drainLocalHandles();
                        finish(Object.assign(new Error(gone ? 'containment completion proof unavailable' : 'child cleanup incomplete'), { code: 'INTERNAL_FAILURE' }));
                    });
                }
                if (spawnFailed || timedOut || overflowed) return;
                clearTimeout(timer);
                const deadline = Date.now() + cleanupTimeoutMs;
                void cleanup('SIGKILL', deadline, true).then((gone) => {
                    drainLocalHandles();
                    if (!gone) return finish(Object.assign(new Error('child cleanup incomplete'), { code: 'INTERNAL_FAILURE' }));
                    const verifiedStderr = useNativeWindowsJobSupervisor ? stripTrustedWindowsPowerShellStartupProgress(stderr) : stderr;
                    if (markers.some((marker) => stdout.includes(marker) || verifiedStderr.includes(marker))) return finish(Object.assign(new Error('secret output'), { code: 'INTERNAL_FAILURE' }));
                    return finish(null, { code, stdout, stderr: verifiedStderr });
                });
            };
            if (useNativeWindowsJobSupervisor && !protocolClosed) {
                const closeTimer = setTimeout(() => resolveProtocolClose(false), closeTimeoutMs);
                protocolClosePromise.then(() => { clearTimeout(closeTimer); finishAfterProtocol(); });
            } else finishAfterProtocol();
        });
    });
}

export function buildRevocationBinding(release, deploymentReceiptSha256, metadata, operationId) {
    return sha256('tzudong:release-auth-revocation-binding:v1\n', {
        releaseId: release.releaseId,
        certificationId: release.certificationId,
        gitSha: release.expectedGitSha,
        cellId: release.cellId,
        origin: release.origin.toString(),
        challenge: release.challenge,
        issuedAt: release.issuedAt,
        expiresAt: release.expiresAt,
        deploymentReceiptSha256: /^[a-f0-9]{64}$/.test(deploymentReceiptSha256 || '') ? deploymentReceiptSha256 : null,
        capturedAt: Number.isSafeInteger(metadata?.capturedAt) ? metadata.capturedAt : null,
        authProofSha256: typeof metadata?.authProofSha256 === 'string' ? metadata.authProofSha256 : null,
        revocationOperationId: CANONICAL_UUID.test(operationId || '') ? operationId : null,
        outcome: metadata?.ok === true ? 'certified' : 'cleanup_only',
    });
}

export function buildReceiptPayload(release, receipt, deploymentReceiptSha256, metadata, revocation) {
    if (receipt.observedAt > metadata.capturedAt) throw invalid('deployment observation follows capture');
    if (!exactObject(revocation, ['bindingSha256', 'operationId', 'receiptSha256']) || !CANONICAL_UUID.test(revocation.operationId) || !/^[a-f0-9]{64}$/.test(revocation.bindingSha256) || !/^[a-f0-9]{64}$/.test(revocation.receiptSha256) || revocation.bindingSha256 !== buildRevocationBinding(release, deploymentReceiptSha256, metadata, revocation.operationId)) throw revocationFailure('verified revocation receipt is unavailable');
    const cellEnvironment = release.cellId === 'alias-admin-auth-smoke-metadata'
        ? 'alias'
        : receipt.environment;
    return {
        release: { releaseId: release.releaseId, certificationId: release.certificationId, gitSha: release.expectedGitSha, challenge: release.challenge, issuedAt: release.issuedAt, expiresAt: release.expiresAt },
        cell: { id: release.cellId, environment: cellEnvironment, route: '/admin', origin: release.origin.toString(), finalUrl: metadata.finalUrl },
        deployment: { receiptSha256: deploymentReceiptSha256, deploymentId: receipt.deploymentId, environment: receipt.environment, host: receipt.host, aliasHost: receipt.aliasHost, observedAt: receipt.observedAt },
        result: { ok: metadata.ok, reasonCode: metadata.reasonCode, authProofSha256: metadata.authProofSha256, revocationOperationId: revocation.operationId, revocationBindingSha256: revocation.bindingSha256, revocationReceipt: revocation.receiptSha256, shellHeight: metadata.shellHeight, shellWidth: metadata.shellWidth, headingCount: metadata.headingCount, navigationCount: metadata.navigationCount, status: metadata.status, capturedAt: metadata.capturedAt },
    };
}

export async function main() {
    let directory;
    let release;
    let storageState;
    let identity;
    let serviceKey;
    let operationId;
    let cleanupRequired = false;
    let revocationProof;
    let deploymentReceipt;
    let deploymentReceiptDigest;
    let cellId;
    let metadata;
    try {
        release = parseReleaseAuthCli();
        storageState = requiredEnvironment('RELEASE_AUTH_STORAGE_STATE_B64');
        const decodedState = validateStorageState(storageState, release.origin);
        const hardenedStorageState = encodeHttpOnlyStorageState(decodedState);
        identity = parseBoundSessionIdentity(decodedState);
        const apiKey = requiredEnvironment('RELEASE_AUTH_SUPABASE_ANON_KEY');
        serviceKey = requiredEnvironment('RELEASE_AUTH_SUPABASE_SERVICE_ROLE_KEY');
        const dedicatedUserId = requiredEnvironment('RELEASE_AUTH_DEDICATED_USER_ID');
        validateSupabaseDestination(requiredEnvironment('RELEASE_AUTH_SUPABASE_URL'));
        operationId = randomUUID();
        cleanupRequired = true;
        await validateReleaseSessionIdentity(identity, apiKey, dedicatedUserId);
        await preflightReleaseSessionFamily(identity, operationId, release.expiresAt, serviceKey);
        const preflight = await validatePreflight(release);
        deploymentReceipt = preflight.receipt;
        deploymentReceiptDigest = preflight.digest;
        cellId = preflight.cellId;
        const canaryMarkers = [randomBytes(24).toString('hex'), randomBytes(24).toString('hex'), randomBytes(24).toString('hex')];
        const proofChallenge = randomBytes(32).toString('base64url');
        const proofChallengeSha256 = sha256Text('tzudong:release-auth-proof:challenge:v1\n', proofChallenge);
        const proofIdentitySha256 = sha256Text('tzudong:release-auth-proof:identity:v1\n', `${identity.userId}\n${identity.sessionId}`);
        const secretMarkers = [...collectSecretMarkers(decodedState), storageState, hardenedStorageState, apiKey, serviceKey, identity.accessToken, identity.userId, identity.sessionId, operationId, dedicatedUserId, proofChallenge];
        directory = await mkdtemp(join(tmpdir(), 'tzudong-auth-smoke-'));
        await chmod(directory, 0o700);
        const baseEnv = { PATH: process.env.PATH || '', TMP: directory, TEMP: directory, TMPDIR: directory };
        const canary = await runChild({ ...baseEnv, RELEASE_AUTH_CANARY_MODE: 'intentional_failure', RELEASE_AUTH_STORAGE_STATE_B64: fakeCanaryState(release.origin, canaryMarkers), RELEASE_AUTH_CANARY_FAKE_COOKIE: canaryMarkers[0], RELEASE_AUTH_CANARY_FAKE_TOKEN: canaryMarkers[1], RELEASE_AUTH_CANARY_FAKE_ADMIN_TEXT: canaryMarkers[2] }, [...secretMarkers, ...canaryMarkers], directory, release.origin.toString());
        if (canary.code !== 23 || canary.stderr) throw Object.assign(new Error('canary'), { code: 'INTERNAL_FAILURE' });
        validateMetadata(canary.stdout, true, [...secretMarkers, ...canaryMarkers]);
        await assertRestrictedEmptyDirectory(directory);
        const result = await runChild({ ...baseEnv, RELEASE_AUTH_STORAGE_STATE_B64: hardenedStorageState, RELEASE_AUTH_PROOF_CHALLENGE: proofChallenge, RELEASE_AUTH_PROOF_CHALLENGE_SHA256: proofChallengeSha256, RELEASE_AUTH_PROOF_IDENTITY_SHA256: proofIdentitySha256 }, [...secretMarkers, ...canaryMarkers], directory, release.origin.toString());
        if (result.stderr) throw Object.assign(new Error('child stderr'), { code: 'INTERNAL_FAILURE' });
        metadata = validateMetadata(result.stdout, false, secretMarkers, release);
        if (result.code !== 0 || !metadata.ok) throw Object.assign(new Error('smoke failure'), { code: metadata.reasonCode });
        await assertRestrictedEmptyDirectory(directory);
    } finally {
        let revocationError;
        let directoryError;
        if (cleanupRequired) {
            try {
                const bindingSha256 = buildRevocationBinding(release, deploymentReceiptDigest, metadata, operationId);
                const receipt = await revokeReleaseSessionFamily(identity, operationId, bindingSha256, serviceKey);
                revocationProof = {
                    operationId,
                    bindingSha256,
                    receiptSha256: sha256('tzudong:release-auth-revocation:v1\n', receipt),
                };
            } catch {
                revocationError = revocationFailure('parent session revocation failed');
            }
        }
        if (directory) {
            try { await assertRestrictedEmptyDirectory(directory); } catch { directoryError = new Error('directory cleanup failed'); }
            try { await rm(directory, { recursive: true, force: true }); } catch { directoryError ||= new Error('directory cleanup failed'); }
        }
        if (revocationError) throw revocationError;
        if (directoryError) throw directoryError;
    }
    const payload = buildReceiptPayload(release, deploymentReceipt, deploymentReceiptDigest, metadata, revocationProof);
    const receiptSha256 = sha256('tzudong:release-auth-receipt:v1\n', payload);
    const output = JSON.stringify({ schemaVersion: 2, id: cellId, status: 'required', execution: 'standalone-auth', evidence: 'metadata-only', artifact: 'metadata-only', sha256: 'metadata-only', metadata: { receiptVersion: 1, receiptSha256, payload } });
    process.stdout.write(`${output}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${safeReason(error)}\n`); process.exitCode = 1; });

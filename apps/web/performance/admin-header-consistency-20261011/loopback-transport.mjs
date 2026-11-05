import http from 'node:http'

export const NEXT_PORT = 18820
export const SUPABASE_PORT = 18821
export const GATEWAY_PORT = 18822
export const NEXT_ORIGIN = `http://127.0.0.1:${NEXT_PORT}`
export const SUPABASE_ORIGIN = `http://127.0.0.1:${SUPABASE_PORT}`
export const GATEWAY_ORIGIN = `http://127.0.0.1:${GATEWAY_PORT}`

const allowedAuthorities = new Set([GATEWAY_ORIGIN, SUPABASE_ORIGIN])
const upstreamPorts = new Set([NEXT_PORT])
const nextDevWebSocketPaths = new Set(['/_next/hmr', '/_next/webpack-hmr'])

// Accept HTTP origin-form only. The request's Host never selects an authority.
export function fixtureRequestUrl(raw, authority) {
    if (
        !allowedAuthorities.has(authority) ||
        typeof raw !== 'string' ||
        raw.length > 16_384 ||
        !raw.startsWith('/') ||
        raw.startsWith('//') ||
        /[\\\u0000-\u0020\u007f#]/.test(raw) ||
        /%(?![a-f0-9]{2})/i.test(raw)
    ) {
        throw new Error('FIXTURE_INPUT_INVALID')
    }
    const url = new URL(raw, authority)
    if (url.origin !== authority || url.username || url.password) {
        throw new Error('FIXTURE_INPUT_INVALID')
    }
    return url
}

export function fixtureRequestBoundary(
    req,
    authority,
    { allowedOrigins = new Set([authority]), upgrade = false } = {},
) {
    const url = fixtureRequestUrl(req.url, authority)
    const origin = req.headers.origin
    if (
        req.headers.host !== new URL(authority).host ||
        (origin !== undefined && !allowedOrigins.has(origin))
    ) {
        throw new Error('FIXTURE_INPUT_INVALID')
    }
    if (
        upgrade &&
        (req.method !== 'GET' ||
            !nextDevWebSocketPaths.has(url.pathname) ||
            req.headers.upgrade?.toLowerCase() !== 'websocket')
    ) {
        throw new Error('FIXTURE_INPUT_INVALID')
    }
    return url
}

function safeHeaderValue(value) {
    return typeof value === 'string' && value.length <= 16_384 && !/[\r\n\u0000]/.test(value)
}

function admittedSyntheticSessionCookie(req, syntheticSessionCookie) {
    if (syntheticSessionCookie === undefined) return undefined
    if (
        !safeHeaderValue(syntheticSessionCookie) ||
        syntheticSessionCookie.length > 4_096 ||
        !/^sb-[a-z0-9-]+-auth-token=base64-[a-z0-9_-]+$/i.test(syntheticSessionCookie)
    ) {
        throw new Error('FIXTURE_SESSION_CONTRACT_INVALID')
    }
    const incomingCookie = req.headers.cookie
    if (!safeHeaderValue(incomingCookie)) return undefined
    return incomingCookie
        .split(';')
        .some((part) => part.trim() === syntheticSessionCookie)
        ? syntheticSessionCookie
        : undefined
}

export function buildFixtureUpstreamOptions(
    req,
    authority,
    port,
    bypass,
    upgrade = false,
    syntheticSessionCookie,
) {
    if (!upstreamPorts.has(port) || (!upgrade && !['GET', 'HEAD'].includes(req.method))) {
        throw new Error('FIXTURE_INPUT_INVALID')
    }
    if (!bypass?.header || !bypass?.tokenHeader || !bypass?.token) {
        throw new Error('FIXTURE_BYPASS_CONTRACT_INVALID')
    }
    const url = fixtureRequestBoundary(req, authority, {
        allowedOrigins: new Set([GATEWAY_ORIGIN]),
        upgrade,
    })
    const headers = { host: `127.0.0.1:${port}` }
    const names = upgrade
        ? [
              'upgrade',
              'sec-websocket-key',
              'sec-websocket-version',
              'sec-websocket-protocol',
              'sec-websocket-extensions',
          ]
        : [
              'accept',
              'accept-language',
              'range',
              'if-none-match',
              'if-modified-since',
              'rsc',
              'next-router-prefetch',
              'next-router-state-tree',
              'next-url',
          ]
    for (const name of names) {
        const value = req.headers[name]
        if (safeHeaderValue(value)) headers[name] = value
    }
    if (upgrade) {
        headers.connection = 'Upgrade'
    } else {
        headers['accept-encoding'] = 'identity'
        headers[bypass.header] = '1'
        headers[bypass.tokenHeader] = bypass.token
        const admittedCookie = admittedSyntheticSessionCookie(req, syntheticSessionCookie)
        if (admittedCookie) headers.cookie = admittedCookie
    }
    return {
        hostname: '127.0.0.1',
        port,
        method: upgrade ? 'GET' : req.method,
        path: url.pathname + url.search,
        headers,
        timeout: 15_000,
    }
}

export function fixtureUpstreamRequest(
    req,
    authority,
    port,
    bypass,
    upgrade = false,
    syntheticSessionCookie,
) {
    return http.request(
        buildFixtureUpstreamOptions(
            req,
            authority,
            port,
            bypass,
            upgrade,
            syntheticSessionCookie,
        ),
    )
}

const responseHeaderAllowlist = new Set([
    'accept-ranges',
    'cache-control',
    'content-range',
    'content-security-policy',
    'content-security-policy-report-only',
    'content-type',
    'etag',
    'last-modified',
    'link',
    'location',
    'permissions-policy',
    'referrer-policy',
    'vary',
    'x-content-type-options',
    'x-frame-options',
    'x-middleware-next',
    'x-middleware-rewrite',
    'x-nextjs-cache',
    'x-nextjs-prerender',
    'x-nextjs-redirect',
    'x-nextjs-stale-time',
])

function addFixtureConnectSource(policy) {
    const directives = policy
        .split(';')
        .map((directive) => directive.trim())
        .filter(Boolean)
    const connectIndex = directives.findIndex((directive) => /^connect-src(?:\s|$)/.test(directive))
    if (connectIndex === -1) return policy

    const connectSources = directives[connectIndex].split(/\s+/)
    if (connectSources.includes("'none'") || connectSources.includes(SUPABASE_ORIGIN)) return policy
    directives[connectIndex] = [...connectSources, SUPABASE_ORIGIN].join(' ')
    return directives.join('; ')
}

export function fixtureResponseHeaders(incoming) {
    const headers = {}
    for (const [name, value] of Object.entries(incoming)) {
        if (!responseHeaderAllowlist.has(name) || value === undefined) continue
        const rewriteCsp = name === 'content-security-policy' || name === 'content-security-policy-report-only'
        if (typeof value === 'string' && safeHeaderValue(value)) {
            headers[name] = rewriteCsp ? addFixtureConnectSource(value) : value
        }
        if (Array.isArray(value) && value.every(safeHeaderValue)) {
            headers[name] = rewriteCsp ? value.map(addFixtureConnectSource) : value
        }
    }
    return headers
}

export function forwardFixtureRead(req, res, authority, port, bypass, syntheticSessionCookie) {
    const bridge = fixtureUpstreamRequest(
        req,
        authority,
        port,
        bypass,
        false,
        syntheticSessionCookie,
    )
    bridge.on('response', (reply) => {
        res.writeHead(reply.statusCode ?? 502, fixtureResponseHeaders(reply.headers))
        reply.on('error', () => res.destroy())
        reply.pipe(res)
    })
    bridge.on('timeout', () => bridge.destroy())
    bridge.on('error', () => {
        if (res.headersSent) return res.destroy()
        res.writeHead(502, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        })
        res.end(JSON.stringify({ error: 'FIXTURE_UPSTREAM_UNAVAILABLE' }))
    })
    res.on('close', () => bridge.destroy())
    bridge.end()
}

const upgradeResponseHeaderAllowlist = new Set([
    'connection',
    'sec-websocket-accept',
    'sec-websocket-extensions',
    'sec-websocket-protocol',
    'upgrade',
])

export function writeUpgradeResponse(socket, reply) {
    const status = Number.isInteger(reply.statusCode) ? reply.statusCode : 502
    const message = String(reply.statusMessage ?? 'Bad Gateway').replace(/[\r\n]/g, '')
    const lines = [`HTTP/1.1 ${status} ${message}`]
    for (const [name, value] of Object.entries(reply.headers)) {
        if (!upgradeResponseHeaderAllowlist.has(name) || value === undefined) continue
        const values = Array.isArray(value) ? value : [value]
        for (const item of values) {
            if (safeHeaderValue(item)) lines.push(`${name}: ${item}`)
        }
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
}

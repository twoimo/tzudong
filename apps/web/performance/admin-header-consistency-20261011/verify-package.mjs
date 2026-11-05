import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
    GATEWAY_ORIGIN,
    NEXT_PORT,
    SUPABASE_ORIGIN,
    buildFixtureUpstreamOptions,
    fixtureRequestBoundary,
    fixtureResponseHeaders,
} from './loopback-transport.mjs'
import {
    BYPASS_SOURCE_PATH,
    WEB_ROOT,
    readE2EAdminRouteBypassContract,
} from './source-contract.mjs'
import {
    DEVELOPMENT_DIST_DIR,
    PRODUCTION_BUILD_ID,
    PRODUCTION_DIST_DIR,
    buildFixtureLaunchPlan,
    parseFixtureLaunchMode,
} from './launch.mjs'

if (process.versions.node.split('.')[0] !== '24') {
    throw new Error(`FIXTURE_VERIFIER_REQUIRES_NODE_24:${process.versions.node}`)
}

const packageRoot = fileURLToPath(new URL('./', import.meta.url))
const contract = readE2EAdminRouteBypassContract()
assert.deepEqual(contract, {
    env: {
        enabled: 'E2E_ADMIN_ROUTE_BYPASS',
        context: 'E2E_ADMIN_ROUTE_BYPASS_CONTEXT',
        runtime: 'E2E_ADMIN_ROUTE_BYPASS_RUNTIME',
        token: 'E2E_ADMIN_ROUTE_BYPASS_TOKEN',
    },
    context: 'playwright',
    runtime: 'local-dev-server',
    productionSmoke: {
        runtime: 'local-production-bundle-smoke',
        allowEnv: 'E2E_ADMIN_ROUTE_BYPASS_ALLOW_LOCAL_PRODUCTION_SMOKE',
    },
    header: 'x-e2e-admin-bypass',
    tokenHeader: 'x-e2e-admin-bypass-token',
})

assert.equal(parseFixtureLaunchMode([]), 'development')
assert.equal(parseFixtureLaunchMode(['--production']), 'production')
for (const argv of [
    ['--dev'],
    ['production'],
    ['--production=1'],
    ['--production', 'extra'],
]) {
    assert.throws(() => parseFixtureLaunchMode(argv), /FIXTURE_ARGUMENTS_INVALID/)
}

const syntheticParentEnvironment = {
    HOME: '/tmp/synthetic-fixture-home',
    LANG: 'en_US.UTF-8',
    NODE_ENV: 'staging',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-inherit',
    VERCEL: '1',
}
const developmentPlan = buildFixtureLaunchPlan(
    [],
    contract,
    syntheticParentEnvironment,
    { productionBuildExists: false },
)
assert.equal(developmentPlan.mode, 'development')
assert.equal(developmentPlan.distDir, DEVELOPMENT_DIST_DIR)
assert.deepEqual(developmentPlan.nextArguments.slice(1), [
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    '18820',
])
assert.equal(developmentPlan.nextEnvironment[contract.env.runtime], contract.runtime)
assert.equal(developmentPlan.nextEnvironment[contract.productionSmoke.allowEnv], undefined)
assert.equal(developmentPlan.nextEnvironment.NODE_ENV, undefined)
assert.equal(developmentPlan.nextEnvironment.VERCEL, undefined)
assert.equal(developmentPlan.nextEnvironment.SUPABASE_SERVICE_ROLE_KEY, undefined)
assert.equal(developmentPlan.gatewayEnvironment.VERCEL, undefined)
assert.throws(
    () =>
        buildFixtureLaunchPlan(
            ['--production'],
            contract,
            syntheticParentEnvironment,
            { productionBuildExists: false },
        ),
    /FIXTURE_PRODUCTION_BUILD_MISSING/,
)
const productionPlan = buildFixtureLaunchPlan(
    ['--production'],
    contract,
    syntheticParentEnvironment,
    { productionBuildExists: true },
)
assert.equal(productionPlan.mode, 'production')
assert.equal(productionPlan.distDir, PRODUCTION_DIST_DIR)
assert.equal(PRODUCTION_BUILD_ID, join(WEB_ROOT, PRODUCTION_DIST_DIR, 'BUILD_ID'))
assert.deepEqual(productionPlan.nextArguments.slice(1), [
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    '18820',
])
assert.equal(productionPlan.nextEnvironment.NODE_ENV, 'production')
assert.equal(productionPlan.nextEnvironment.VERCEL, undefined)
assert.equal(productionPlan.nextEnvironment.SUPABASE_SERVICE_ROLE_KEY, undefined)
assert.equal(productionPlan.nextEnvironment.NEXT_PUBLIC_SITE_URL, GATEWAY_ORIGIN)
assert.equal(productionPlan.nextEnvironment.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:18821')
assert.equal(productionPlan.nextEnvironment.TZUDONG_NEXT_DIST_DIR, PRODUCTION_DIST_DIR)
assert.equal(
    productionPlan.nextEnvironment[contract.env.runtime],
    contract.productionSmoke.runtime,
)
assert.equal(productionPlan.nextEnvironment[contract.productionSmoke.allowEnv], '1')
assert.equal(productionPlan.gatewayEnvironment.VERCEL, undefined)

const bypass = {
    header: contract.header,
    tokenHeader: contract.tokenHeader,
    token: 'admin-header-consistency-synthetic-only',
}
const request = (overrides = {}) => ({
    method: 'GET',
    url: '/admin?module=users',
    headers: {
        host: '127.0.0.1:18822',
        origin: GATEWAY_ORIGIN,
        accept: 'text/html',
        authorization: 'Bearer must-not-forward',
        cookie: 'must-not-forward=1',
        'proxy-authorization': 'must-not-forward',
        'x-forwarded-host': 'attacker.test',
        ...(overrides.headers ?? {}),
    },
    ...overrides,
})

const options = buildFixtureUpstreamOptions(request(), GATEWAY_ORIGIN, NEXT_PORT, bypass)
assert.equal(options.hostname, '127.0.0.1')
assert.equal(options.port, 18820)
assert.equal(options.method, 'GET')
assert.equal(options.path, '/admin?module=users')
assert.equal(options.headers.host, '127.0.0.1:18820')
assert.equal(options.headers.accept, 'text/html')
assert.equal(options.headers[contract.header], '1')
assert.equal(options.headers[contract.tokenHeader], bypass.token)
for (const name of [
    'authorization',
    'cookie',
    'proxy-authorization',
    'x-forwarded-host',
]) {
    assert.equal(options.headers[name], undefined)
}

const syntheticSessionCookie = 'sb-127-auth-token=base64-fixture-session'
const sessionOptions = buildFixtureUpstreamOptions(
    request({
        headers: {
            host: '127.0.0.1:18822',
            origin: GATEWAY_ORIGIN,
            cookie: `unrelated=ignored; ${syntheticSessionCookie}`,
        },
    }),
    GATEWAY_ORIGIN,
    NEXT_PORT,
    bypass,
    false,
    syntheticSessionCookie,
)
assert.equal(sessionOptions.headers.cookie, syntheticSessionCookie)
const unmatchedSessionOptions = buildFixtureUpstreamOptions(
    request({
        headers: {
            host: '127.0.0.1:18822',
            origin: GATEWAY_ORIGIN,
            cookie: 'sb-127-auth-token=base64-unmatched-session',
        },
    }),
    GATEWAY_ORIGIN,
    NEXT_PORT,
    bypass,
    false,
    syntheticSessionCookie,
)
assert.equal(unmatchedSessionOptions.headers.cookie, undefined)
assert.throws(
    () =>
        buildFixtureUpstreamOptions(
            request(),
            GATEWAY_ORIGIN,
            NEXT_PORT,
            bypass,
            false,
            'arbitrary-cookie=not-admitted',
        ),
    /FIXTURE_SESSION_CONTRACT_INVALID/,
)

const responseHeaders = fixtureResponseHeaders({
    'content-security-policy': "default-src 'self'; connect-src 'self' https://api.openai.com; object-src 'none'",
    'set-cookie': 'must-not-forward=1',
})
assert.match(responseHeaders['content-security-policy'], new RegExp(`connect-src[^;]*${SUPABASE_ORIGIN.replaceAll('.', '\\.')}`))
assert.doesNotMatch(responseHeaders['content-security-policy'], /attacker\.test/)
assert.equal(responseHeaders['set-cookie'], undefined)
assert.equal(
    fixtureResponseHeaders({ 'content-security-policy': "default-src 'self'; object-src 'none'" })[
        'content-security-policy'
    ],
    "default-src 'self'; object-src 'none'",
)
assert.equal(
    fixtureResponseHeaders({ 'content-security-policy': "default-src 'self'; connect-src 'none'" })[
        'content-security-policy'
    ],
    "default-src 'self'; connect-src 'none'",
)

const headOptions = buildFixtureUpstreamOptions(
    request({ method: 'HEAD' }),
    GATEWAY_ORIGIN,
    NEXT_PORT,
    bypass,
)
assert.equal(headOptions.method, 'HEAD')

for (const badRequest of [
    request({ method: 'POST' }),
    request({ url: 'http://attacker.test/admin' }),
    request({ url: '//attacker.test/admin' }),
    request({ url: '/admin%GG' }),
    request({ headers: { host: 'attacker.test', origin: GATEWAY_ORIGIN } }),
    request({ headers: { host: '127.0.0.1:18822', origin: 'http://attacker.test' } }),
]) {
    assert.throws(
        () => buildFixtureUpstreamOptions(badRequest, GATEWAY_ORIGIN, NEXT_PORT, bypass),
        /FIXTURE_INPUT_INVALID/,
    )
}
assert.throws(
    () => buildFixtureUpstreamOptions(request(), GATEWAY_ORIGIN, 18821, bypass),
    /FIXTURE_INPUT_INVALID/,
)

const upgradeRequest = (url = '/_next/hmr?id=synthetic-request') =>
    request({
        url,
        headers: {
            host: '127.0.0.1:18822',
            origin: GATEWAY_ORIGIN,
            upgrade: 'websocket',
            'sec-websocket-key': 'fixture-key',
            'sec-websocket-version': '13',
            authorization: 'must-not-forward',
            cookie: 'must-not-forward=1',
        },
    })
for (const path of ['/_next/hmr?id=synthetic-request', '/_next/webpack-hmr']) {
    const upgrade = buildFixtureUpstreamOptions(
        upgradeRequest(path),
        GATEWAY_ORIGIN,
        NEXT_PORT,
        bypass,
        true,
    )
    assert.equal(upgrade.method, 'GET')
    assert.equal(upgrade.path, path)
    assert.equal(upgrade.headers.connection, 'Upgrade')
    assert.equal(upgrade.headers['sec-websocket-key'], 'fixture-key')
    assert.equal(upgrade.headers.authorization, undefined)
    assert.equal(upgrade.headers.cookie, undefined)
    assert.equal(upgrade.headers[contract.header], undefined)
    assert.equal(upgrade.headers[contract.tokenHeader], undefined)
}
for (const badUpgradeRequest of [
    upgradeRequest('/admin'),
    upgradeRequest('/_next/hmr/subpath'),
    upgradeRequest('/_next/hmr-not-allowed'),
    { ...upgradeRequest(), method: 'POST' },
    {
        ...upgradeRequest('/_next/hmr'),
        headers: { ...upgradeRequest('/_next/hmr').headers, upgrade: 'not-websocket' },
    },
    {
        ...upgradeRequest('/_next/hmr'),
        headers: { ...upgradeRequest('/_next/hmr').headers, origin: 'http://attacker.test' },
    },
]) {
    assert.throws(
        () =>
            buildFixtureUpstreamOptions(
                badUpgradeRequest,
                GATEWAY_ORIGIN,
                NEXT_PORT,
                bypass,
                true,
            ),
        /FIXTURE_INPUT_INVALID/,
    )
}
assert.equal(
    fixtureRequestBoundary(request(), GATEWAY_ORIGIN, {
        allowedOrigins: new Set([GATEWAY_ORIGIN]),
    }).pathname,
    '/admin',
)

const gatewaySource = readFileSync(join(packageRoot, 'fixture-gateway.mjs'), 'utf8')
const transportSource = readFileSync(join(packageRoot, 'loopback-transport.mjs'), 'utf8')
const launchSource = readFileSync(join(packageRoot, 'launch.mjs'), 'utf8')
for (const [label, pattern] of [
    ['incoming-header-spread', /\.\.\.\s*req\.headers/],
    ['incoming-header-enumeration', /Object\.entries\(req\.headers\)/],
    ['redirect-following-fetch', /\bfetch\s*\(/],
    ['https-client', /\bhttps\.(request|get)\s*\(/],
]) {
    assert.doesNotMatch(gatewaySource, pattern, label)
}
assert.doesNotMatch(launchSource, /\.\.\.\s*process\.env/, 'parent environment spread')
assert.match(transportSource, /const upstreamPorts = new Set\(\[NEXT_PORT\]\)/)
assert.match(transportSource, /hostname: '127\.0\.0\.1'/)
assert.match(gatewaySource, /const rpcNames = new Set\(\[/)
assert.match(gatewaySource, /FIXTURE_ENDPOINT_NOT_FOUND/)
assert.match(launchSource, /\.next-admin-header-consistency-18820/)
assert.match(launchSource, /__NEXT_PROCESSED_ENV: 'true'/)

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const packageFiles = [
    'README.md',
    'fixture-data.mjs',
    'fixture-gateway.mjs',
    'launch.mjs',
    'loopback-transport.mjs',
    'source-contract.mjs',
    'verify-package.mjs',
]
const inputFiles = [
    join(WEB_ROOT, 'scripts/preview-design-fixtures.mjs'),
    join(WEB_ROOT, 'scripts/verify-admin-sidebar-pages-browser.ts'),
    join(WEB_ROOT, 'styles/admin-ui.css'),
    join(WEB_ROOT, 'performance/fixture-transport-security-20261009/loopback-transport.mjs'),
    BYPASS_SOURCE_PATH,
]
const receipt = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    node: process.version,
    evidenceClass: 'source-and-pure-transport-boundary-only',
    checks: {
        fixedDestination: true,
        hostAndOriginBoundary: true,
        getAndHeadForwardingOnly: true,
        incomingCredentialHeadersDroppedExceptExactSyntheticSession: true,
        syntheticSessionCookieReconstructed: true,
        fixtureCspMockOriginOnly: true,
        websocketPathAndHeadersBounded: true,
        e2eConstantsReadFromApplicationSource: true,
        developmentAndProductionLaunchArgumentsBounded: true,
        productionEnvironmentSecretFreeAndLoopbackOnly: true,
        verificationNetworkCalls: 0,
        verificationServersStarted: 0,
    },
    packageSha256: Object.fromEntries(
        packageFiles.map((name) => [name, sha256(join(packageRoot, name))]),
    ),
    inputSha256: Object.fromEntries(inputFiles.map((path) => [basename(path), sha256(path)])),
    renderMatrix: {
        menus: 15,
        widths: 3,
        total: 45,
        completed: 0,
        status: 'incomplete-root-cua-required',
    },
}
writeFileSync(
    join(packageRoot, 'source-verification.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8',
)
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)

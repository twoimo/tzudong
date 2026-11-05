// Loopback-only visual fixture gateway. No request is forwarded to a hosted API.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
    GATEWAY_ORIGIN,
    GATEWAY_PORT,
    NEXT_PORT,
    SUPABASE_ORIGIN,
    SUPABASE_PORT,
    fixtureRequestBoundary,
    fixtureUpstreamRequest,
    forwardFixtureRead,
    writeUpgradeResponse,
} from './loopback-transport.mjs'
import { readE2EAdminRouteBypassContract, WEB_ROOT } from './source-contract.mjs'
import {
    evaluations,
    fixtureAutomation,
    fixtureBanners,
    fixtureProfiles,
    fixtureReviews,
    fixtureSession,
    fixtureSubmissionItems,
    fixtureSubmissions,
    fixtureUser,
    managedUsers,
    pending,
    pendingReviews,
    refreshCandidates,
    restaurants,
    stamp,
    storyboardProjects,
    summary,
    videos,
} from './fixture-data.mjs'

const bypassContract = readE2EAdminRouteBypassContract()
const bypass = Object.freeze({
    header: bypassContract.header,
    tokenHeader: bypassContract.tokenHeader,
    // Deliberately public fixture material, never an application or provider secret.
    token: 'admin-header-consistency-synthetic-only',
})
const browserOrigins = new Set([GATEWAY_ORIGIN])
const logo = readFileSync(join(WEB_ROOT, 'public/logo.webp'))
const knowledgeGraphPath = join(WEB_ROOT, 'data/knowledge-graph/tzudong.json')
const fixtureSessionCookie = `sb-127-auth-token=base64-${Buffer.from(
    JSON.stringify(fixtureSession()),
).toString('base64url')}`

function jsonResponse(req, res, value, status = 200, extraHeaders = {}) {
    const body = Buffer.from(JSON.stringify(value))
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
        ...extraHeaders,
    })
    if (req.method === 'HEAD') return res.end()
    return res.end(body)
}

function fixtureError(req, res, error, status, extraHeaders = {}) {
    return jsonResponse(req, res, { error }, status, extraHeaders)
}

function filteredRows(req, rows) {
    const query = new URL(req.url, SUPABASE_ORIGIN).searchParams
    let selected = rows
    for (const field of ['id', 'restaurant_id', 'user_id', 'is_verified']) {
        const filter = query.get(field)
        if (filter?.startsWith('eq.')) {
            selected = selected.filter((row) => String(row[field]) === filter.slice(3))
        }
        if (filter?.startsWith('in.(') && filter.endsWith(')')) {
            const ids = filter
                .slice(4, -1)
                .split(',')
                .map((value) => value.replaceAll('"', ''))
            selected = selected.filter((row) => ids.includes(String(row[field])))
        }
    }
    const limit = Number(query.get('limit'))
    if (Number.isInteger(limit) && limit > 0) selected = selected.slice(0, Math.min(limit, 200))
    if (String(req.headers.accept).includes('vnd.pgrst.object')) return selected[0] ?? null
    return selected
}

function knowledgeGraph(params) {
    const snapshot = JSON.parse(readFileSync(knowledgeGraphPath, 'utf8'))
    const query = (params.get('q') ?? '').normalize('NFKC').toLowerCase().trim()
    const kind = params.get('kind')
    const filtered = snapshot.nodes.filter(
        (node) =>
            (!kind || node.kind === kind) &&
            (!query ||
                `${node.label} ${node.summary}`.normalize('NFKC').toLowerCase().includes(query)),
    )
    const nodes = filtered.slice(0, 100)
    const ids = new Set(nodes.map((node) => node.id))
    const edges = snapshot.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
    )
    return {
        revision: snapshot.revision,
        generatedAt: snapshot.generatedAt,
        coverage: snapshot.coverage,
        nodes,
        edges,
        selected: snapshot.nodes.find((node) => node.id === params.get('node')) ?? null,
        totalNodes: snapshot.nodes.length,
        totalEdges: snapshot.edges.length,
        filteredTotal: filtered.length,
        omittedEdges: snapshot.edges.length - edges.length,
        nextCursor: null,
    }
}

function apiFixture(pathname, params) {
    if (pathname === '/api/admin/sentry') {
        return {
            state: 'not_configured',
            collection: { browser: false, server: false },
            dashboardUrl: null,
            issues: [],
            nextCursor: null,
            fetchedAt: null,
        }
    }
    if (pathname === '/api/admin/knowledge-graph') return knowledgeGraph(params)
    if (pathname === '/api/admin/evaluations/automation') return fixtureAutomation
    if (pathname === '/api/dashboard/restaurants') {
        return {
            asOf: stamp,
            total: restaurants.length,
            limit: 500,
            offset: 0,
            filters: { onlyWithCoordinates: true },
            items: restaurants.map((row) => ({
                id: row.id,
                name: row.name,
                category: '한식',
                address: row.road_address,
                lat: row.lat,
                lng: row.lng,
                youtubeLink: null,
                videoId: null,
                sourceType: 'crawl',
                status: 'approved',
                geocodingSuccess: true,
                isNotSelected: false,
                createdAt: stamp,
                updatedAt: stamp,
            })),
        }
    }
    if (pathname === '/api/admin/pipeline') {
        return {
            source: 'github_actions',
            hardware: '합성 환경',
            dataEnv: 'fixture',
            targets: [],
            jobs: [
                {
                    id: 'fixture-run-1',
                    target: 'tzuyang',
                    profile: 'lite_gha',
                    status: 'Succeeded',
                    dry_run: true,
                    adapter_index: 6,
                },
            ],
            failures: [],
            failureFrames: [],
            gauges: {},
        }
    }
    if (pathname.startsWith('/api/admin/evaluations/')) {
        return {
            record: evaluations.find((row) => row.id === pathname.split('/').at(-1)) ?? null,
            revision: '1',
        }
    }
    if (pathname === '/api/privacy/consents') {
        return {
            policy: {
                policyVersionId: '00000000-0000-4000-8000-000000000001',
                version: '2026-08-04.1',
                contentSha256:
                    '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b',
            },
            consents: {
                ordinary: { email: false, sms: false, push: false },
                night: { email: false, sms: false, push: false },
            },
        }
    }
    if (pathname === '/api/admin/pending-counts') return pending
    if (pathname === '/api/dashboard/summary') return summary
    if (pathname === '/api/admin/youtube-kpis') {
        return { asOf: stamp, period: '1M', totalVideos: videos.length, videos }
    }
    if (pathname === '/api/admin/youtube-channel') {
        return {
            channelId: 'fixture',
            title: '쯔양',
            subscriberCount: 13_500_000,
            previousSubscriberCount: 13_300_000,
            subscriberDelta: 200_000,
            videoCount: 25,
            previousVideoCount: 20,
            videoDelta: 5,
            deltaSource: 'snapshot-delta',
        }
    }
    if (pathname === '/api/admin/youtube-kpi-collection-logs') {
        return { logs: [], runs: [], total: 0 }
    }
    if (/^\/api\/admin\/preferences\/[^/]+$/.test(pathname)) {
        return { order: null, preferences: null }
    }
    if (pathname === '/api/admin/evaluations') {
        return {
            evaluations,
            data: evaluations,
            records: evaluations,
            stats: {
                total: 25,
                pending: 25,
                approved: 0,
                deleted: 0,
                hold: 0,
                db_conflict: 0,
                ready_for_approval: 0,
                unconfirmed_map: 0,
                missing: 0,
                not_selected: 0,
            },
            revision: '1',
            nextCursor: null,
            hasMore: false,
            filteredTotal: 25,
            totalCount: 25,
            warnings: Object.fromEntries(
                evaluations.map((row) => [
                    row.id,
                    { sameVideo: { count: 0, candidates: [], message: '' }, identity: [] },
                ]),
            ),
        }
    }
    if (pathname === '/api/admin/users') {
        return {
            users: managedUsers,
            summary: { loadedUsers: 3, adminUsers: 1, disabledUsers: 1, unconfirmedUsers: 0 },
            page: 1,
            perPage: 120,
            total: 3,
        }
    }
    if (pathname === '/api/admin/restaurant-refresh-history') {
        return {
            candidates: refreshCandidates,
            summary: {
                approved_restaurants_total: 25,
                needs_review: 3,
                approved: 0,
                rejected: 0,
                applied: 0,
                last_checked_at: stamp,
            },
        }
    }
    if (pathname === '/api/admin/audit-events') {
        return {
            asOf: stamp,
            source: 'admin_audit_events',
            unavailable: null,
            coverage: {
                universal: false,
                mode: 'truthful-partial-domain-specific',
                domains: ['admin_user_management'],
                sources: ['admin_audit_events'],
            },
            events: ['applied', 'intent', 'failed'].map((status, index) => ({
                id: `fixture-audit-${index + 1}`,
                actorUserId: fixtureUser.id,
                targetUserId: fixtureProfiles[index].user_id,
                action: [
                    'admin_user_profile_updated',
                    'admin_user_role_granted',
                    'admin_user_disabled',
                ][index],
                status,
                reasonCode: 'operator-review',
                correlationId: `fixture-correlation-${index + 1}`,
                appliedAt: status === 'applied' ? stamp : null,
                errorCode: status === 'failed' ? 'FIXTURE_REJECTED' : null,
                createdAt: stamp,
                counts: {},
                flags: {},
            })),
        }
    }
    if (pathname === '/api/admin/storyboard/production') {
        return {
            ok: true,
            projects: storyboardProjects.map((project) => ({
                id: project.id,
                revision: project.revision,
                status: project.status,
                title: project.document.title,
                createdAt: stamp,
                updatedAt: stamp,
            })),
            workers: [],
        }
    }
    if (/^\/api\/admin\/storyboard\/production\/[^/]+$/.test(pathname)) {
        const project = storyboardProjects.find(
            (item) => item.id === pathname.split('/').at(-1),
        )
        return project
            ? { ok: true, project, job: null, events: [] }
            : { ok: false, error: 'not_found' }
    }
    if (pathname === '/api/insights/treemap') {
        return {
            asOf: stamp,
            videos,
            totalVideos: videos.length,
            period: 'ALL',
            availablePeriods: ['1M', 'ALL'],
            meta: { dataSource: 'supabase-treemap' },
        }
    }
    if (pathname === '/api/admin/banners' || pathname === '/api/banners') {
        return { banners: fixtureBanners, items: fixtureBanners }
    }
    if (pathname === '/api/admin/restaurants' || pathname === '/api/restaurants') {
        return { restaurants, data: restaurants, totalCount: restaurants.length }
    }
    if (pathname === '/api/leaderboard') return { users: [], leaderboard: [], total: 0 }
    if (pathname === '/api/notifications') return { notifications: [], unreadCount: 0 }
    return undefined
}

const rpcNames = new Set([
    'get_current_privacy_eligibility',
    'is_current_auth_session_active',
    'read_public_profile_summaries',
    'read_public_profile_leaderboard_page',
    'read_public_profile_leaderboard',
])
const tableNames = new Set([
    'user_roles',
    'restaurant_submissions',
    'restaurant_submission_items',
    'user_bookmarks',
    'restaurants',
    'reviews',
    'ad_banners',
    'banners',
])
const preflightRequestHeaders = new Set([
    'accept-profile',
    'apikey',
    'authorization',
    'content-profile',
    'content-type',
    'prefer',
    'range',
    'x-client-info',
    'x-supabase-api-version',
])
const corsHeaders = {
    'Access-Control-Allow-Origin': GATEWAY_ORIGIN,
    'Access-Control-Allow-Headers': [...preflightRequestHeaders].join(', '),
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
}

function validatePreflight(req) {
    const method = String(req.headers['access-control-request-method'] ?? '').toUpperCase()
    if (!['GET', 'HEAD', 'POST'].includes(method)) return false
    const names = String(req.headers['access-control-request-headers'] ?? '')
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
    return names.every((name) => preflightRequestHeaders.has(name))
}

async function readJsonBody(req, limit = 65_536) {
    let body = ''
    for await (const chunk of req) {
        body += chunk.toString()
        if (body.length > limit) throw new Error('FIXTURE_INPUT_LIMIT')
    }
    if (!body) return {}
    try {
        const value = JSON.parse(body)
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error()
        return value
    } catch {
        throw new Error('FIXTURE_INPUT_INVALID')
    }
}

async function handleRpc(req, res, rpcName) {
    if (req.method !== 'POST') {
        return fixtureError(req, res, 'FIXTURE_METHOD_NOT_ALLOWED', 405, corsHeaders)
    }
    let body
    try {
        body = await readJsonBody(req)
    } catch (error) {
        return fixtureError(
            req,
            res,
            error.message === 'FIXTURE_INPUT_LIMIT' ? error.message : 'FIXTURE_INPUT_INVALID',
            error.message === 'FIXTURE_INPUT_LIMIT' ? 413 : 400,
            corsHeaders,
        )
    }
    if (rpcName === 'get_current_privacy_eligibility') {
        return jsonResponse(
            req,
            res,
            {
                schemaVersion: 1,
                eligible: true,
                reasonCode: 'PRIVACY_ELIGIBLE',
                policyVersionId: '00000000-0000-4000-8000-000000000001',
                policyVersion: '2026-08-04.1',
                contentSha256:
                    '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b',
            },
            200,
            corsHeaders,
        )
    }
    if (rpcName === 'is_current_auth_session_active') {
        return jsonResponse(req, res, true, 200, corsHeaders)
    }
    if (rpcName === 'read_public_profile_summaries') {
        const ids = body.p_user_ids ?? []
        if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string')) {
            return fixtureError(req, res, 'FIXTURE_INPUT_INVALID', 400, corsHeaders)
        }
        return jsonResponse(
            req,
            res,
            ids.map((id) => fixtureProfiles.find((profile) => profile.user_id === id)).filter(Boolean),
            200,
            corsHeaders,
        )
    }
    return jsonResponse(
        req,
        res,
        fixtureProfiles.map((profile, index) => ({
            user_id: profile.user_id,
            nickname: profile.nickname,
            review_count: 3,
            verified_review_count: 3,
            total_likes: 6,
            avg_likes_per_review: 2,
            quality_score: 100 - index * 5,
        })),
        200,
        corsHeaders,
    )
}

function tableRows(req, tableName) {
    if (tableName === 'user_roles') return filteredRows(req, [{ user_id: fixtureUser.id, role: 'admin' }])
    if (tableName === 'restaurant_submissions') return filteredRows(req, fixtureSubmissions)
    if (tableName === 'restaurant_submission_items') return filteredRows(req, fixtureSubmissionItems)
    if (tableName === 'user_bookmarks') {
        return filteredRows(
            req,
            restaurants.slice(0, 3).map((restaurant, index) => ({
                id: `00000000-0000-4000-a300-${String(index + 1).padStart(12, '0')}`,
                user_id: fixtureUser.id,
                restaurant_id: restaurant.id,
                created_at: stamp,
            })),
        )
    }
    if (tableName === 'restaurants') return filteredRows(req, restaurants)
    if (tableName === 'reviews') return filteredRows(req, [...fixtureReviews, ...pendingReviews])
    return fixtureBanners
}

const mockSupabase = http.createServer(async (req, res) => {
    let url
    try {
        url = fixtureRequestBoundary(req, SUPABASE_ORIGIN, { allowedOrigins: browserOrigins })
    } catch {
        return fixtureError(req, res, 'FIXTURE_INPUT_INVALID', 400)
    }
    if (req.method === 'OPTIONS') {
        if (!validatePreflight(req)) {
            return fixtureError(req, res, 'FIXTURE_INPUT_INVALID', 400, corsHeaders)
        }
        res.writeHead(204, { ...corsHeaders, 'Cache-Control': 'no-store' })
        return res.end()
    }
    if (url.pathname === '/auth/v1/user') {
        if (!['GET', 'HEAD'].includes(req.method)) {
            return fixtureError(req, res, 'FIXTURE_METHOD_NOT_ALLOWED', 405, corsHeaders)
        }
        return jsonResponse(req, res, fixtureUser, 200, corsHeaders)
    }
    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)
    if (rpcMatch) {
        if (!rpcNames.has(rpcMatch[1])) {
            return fixtureError(req, res, 'FIXTURE_ENDPOINT_NOT_FOUND', 404, corsHeaders)
        }
        return handleRpc(req, res, rpcMatch[1])
    }
    const tableMatch = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/)
    if (tableMatch) {
        if (!tableNames.has(tableMatch[1])) {
            return fixtureError(req, res, 'FIXTURE_ENDPOINT_NOT_FOUND', 404, corsHeaders)
        }
        if (!['GET', 'HEAD'].includes(req.method)) {
            return fixtureError(req, res, 'FIXTURE_METHOD_NOT_ALLOWED', 405, corsHeaders)
        }
        const rows = tableRows(req, tableMatch[1])
        const count = Array.isArray(rows) ? rows.length : rows ? 1 : 0
        return jsonResponse(req, res, rows, 200, {
            ...corsHeaders,
            'Content-Range': count ? `0-${count - 1}/${count}` : '*/0',
        })
    }
    return fixtureError(req, res, 'FIXTURE_ENDPOINT_NOT_FOUND', 404, corsHeaders)
})

mockSupabase.on('clientError', (_error, socket) => socket.destroy())
mockSupabase.listen(SUPABASE_PORT, '127.0.0.1')

const preview = http.createServer((req, res) => {
    let url
    try {
        url = fixtureRequestBoundary(req, GATEWAY_ORIGIN, { allowedOrigins: browserOrigins })
    } catch {
        return fixtureError(req, res, 'FIXTURE_INPUT_INVALID', 400)
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
        return fixtureError(req, res, 'FIXTURE_METHOD_NOT_ALLOWED', 405)
    }
    if (url.pathname === '/__fixture/session') {
        res.writeHead(303, {
            'Set-Cookie': `${fixtureSessionCookie}; Path=/; SameSite=Lax; Max-Age=86400`,
            Location: '/mypage/profile',
            'Cache-Control': 'no-store',
        })
        return res.end()
    }
    if (url.pathname === '/__fixture/anonymous') {
        res.writeHead(303, {
            'Set-Cookie': 'sb-127-auth-token=; Path=/; SameSite=Lax; Max-Age=0',
            Location: '/',
            'Cache-Control': 'no-store',
        })
        return res.end()
    }
    if (url.pathname === '/__fixture/start') {
        const body = Buffer.from(
            `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>관리자 헤더 합성 검증</title>
<style>
body{min-height:100vh;margin:0;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f7f8fa;color:#111827}
main{width:min(28rem,calc(100% - 2rem));padding:2rem;border:1px solid #d7dce3;border-radius:1rem;background:#fff;box-shadow:0 1rem 3rem rgba(15,23,42,.08)}
h1{margin:0 0 1.5rem;font-size:1.25rem}
button{width:100%;min-height:44px;border:0;border-radius:.75rem;background:#be123c;color:#fff;font:inherit;font-weight:700;cursor:pointer}
button:focus-visible{outline:3px solid #38bdf8;outline-offset:3px}
</style>
</head>
<body>
<main>
<h1>관리자 헤더 합성 검증</h1>
<button id="open-admin" type="button">관리자 화면 열기</button>
</main>
<script>
document.getElementById('open-admin').addEventListener('click',function(){
    localStorage.setItem('tzudong:e2e-admin-shell-bypass','1');
    location.assign('/admin');
});
</script>
</body>
</html>`,
        )
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': String(body.length),
            'Cache-Control': 'no-store',
        })
        return req.method === 'HEAD' ? res.end() : res.end(body)
    }
    if (url.pathname.startsWith('/api/')) {
        let value
        try {
            value = apiFixture(url.pathname, url.searchParams)
        } catch {
            return fixtureError(req, res, 'FIXTURE_DATA_UNAVAILABLE', 503)
        }
        if (value === undefined) return fixtureError(req, res, 'FIXTURE_ENDPOINT_NOT_FOUND', 404)
        return jsonResponse(req, res, value)
    }
    if (url.pathname === '/_next/image') {
        res.writeHead(200, {
            'Content-Type': 'image/webp',
            'Content-Length': String(logo.length),
            'Cache-Control': 'no-store',
        })
        return req.method === 'HEAD' ? res.end() : res.end(logo)
    }
    try {
        return forwardFixtureRead(
            req,
            res,
            GATEWAY_ORIGIN,
            NEXT_PORT,
            bypass,
            fixtureSessionCookie,
        )
    } catch {
        return fixtureError(req, res, 'FIXTURE_INPUT_INVALID', 400)
    }
})

preview.on('clientError', (_error, socket) => socket.destroy())
preview.listen(GATEWAY_PORT, '127.0.0.1', () => {
    process.stdout.write(
        `Synthetic admin-header fixture ready at ${GATEWAY_ORIGIN}; hosted providers and databases are disabled.\n`,
    )
})

preview.on('upgrade', (req, socket, head) => {
    let bridge
    try {
        bridge = fixtureUpstreamRequest(req, GATEWAY_ORIGIN, NEXT_PORT, bypass, true)
    } catch {
        socket.destroy()
        return
    }
    bridge.on('upgrade', (reply, remote, remoteHead) => {
        writeUpgradeResponse(socket, reply)
        if (head.length) remote.write(head)
        if (remoteHead.length) socket.write(remoteHead)
        remote.pipe(socket)
        socket.pipe(remote)
        remote.on('error', () => socket.destroy())
        socket.on('error', () => remote.destroy())
    })
    bridge.on('timeout', () => bridge.destroy())
    bridge.on('response', (reply) => {
        reply.resume()
        socket.destroy()
    })
    bridge.on('error', () => socket.destroy())
    bridge.end()
})

let closing = false
function closeFixture() {
    if (closing) return
    closing = true
    const timeout = setTimeout(() => process.exit(1), 3_000)
    timeout.unref()
    let openServers = 2
    const closed = () => {
        openServers -= 1
        if (openServers === 0) process.exit(0)
    }
    preview.close(closed)
    mockSupabase.close(closed)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, closeFixture)

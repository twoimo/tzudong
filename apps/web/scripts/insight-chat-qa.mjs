#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolveAdminSessionCookie } from './admin-session.mjs';

const args = new Set(process.argv.slice(2));
const runLive = args.has('--live');
const runDbAudit = args.has('--db') || args.has('--db-audit');
const runOnlyLive = runLive && !args.has('--mock');

const BASE_URL = process.env.INSIGHT_CHAT_QA_BASE_URL ?? 'http://localhost:8080';
function resolveBaseUrlPort(baseUrl) {
    try {
        const parsed = new URL(baseUrl);
        if (parsed.port) {
            return parsed.port;
        }
        return parsed.protocol === 'https:' ? '443' : '80';
    } catch {
        return '8080';
    }
}
const BASE_URL_PORT = resolveBaseUrlPort(BASE_URL);
function getAdminCookie() {
    return resolveAdminSessionCookie() ?? '';
}

const qaRunSummary = {
    startedAt: new Date().toISOString(),
    mode: {
        runLive,
        runDbAudit,
        runOnlyLive,
    },
    baseUrl: BASE_URL,
    checks: {
        occupancy: { status: 'PENDING' },
        mocked: { status: runOnlyLive ? 'SKIP' : 'PENDING' },
        db: { status: runDbAudit ? 'PENDING' : 'SKIP' },
        live: { status: 'PENDING' },
    },
    skipReasons: [],
};

function nextRequestId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function extractStreamRequestIds(raw) {
    const requestIds = [];

    if (!raw) {
        return requestIds;
    }

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) {
            continue;
        }

        if (trimmed === 'data: [DONE]') {
            continue;
        }

        const payload = trimmed.slice(6).trim();
        if (!payload) {
            continue;
        }

        try {
            const parsed = JSON.parse(payload);
            if (parsed?.requestId) {
                requestIds.push(parsed.requestId);
            }
        } catch {
            // ignore malformed chunks
        }
    }

    return requestIds;
}

function summarizeEvidence(evidence) {
    const passCount = evidence.filter((entry) => entry.ok).length;
    const failCount = evidence.length - passCount;
    const summary = {
        check: 'live',
        baseUrl: BASE_URL,
        totalChecks: evidence.length,
        passCount,
        failCount,
        checks: evidence,
    };

    qaRunSummary.checks.live = {
        ...qaRunSummary.checks.live,
        status: failCount > 0 ? 'FAIL' : 'PASS',
        totalChecks: summary.totalChecks,
        passCount,
        failCount,
        routeCount: evidence.length,
    };

    console.log('[qa] ===== Live evidence summary =====');
    console.log(JSON.stringify(summary, null, 2));
}

function summarizeSkipReasons() {
    if (qaRunSummary.skipReasons.length === 0) {
        return;
    }

    console.log('[qa] ===== Skip reasons =====');
    console.log(JSON.stringify({ skipReasons: qaRunSummary.skipReasons }, null, 2));
}

function recordSkip(checkName, reason, details) {
    const entry = { check: checkName, reason, details };
    qaRunSummary.skipReasons.push(entry);
    return entry;
}

function checkSingleDevServerPolicy() {
    const command = `lsof -i :${BASE_URL_PORT} -nP -sTCP:LISTEN | awk 'NR > 1 {print $2}'`;
    const result = spawnSync('bash', ['-lc', command], {
        stdio: 'pipe',
        encoding: 'utf8',
    });

    if (result.error) {
        return {
            ok: false,
            reason: 'lsof command failed',
            details: String(result.error),
        };
    }

    const output = result.stdout?.toString?.() ?? '';
    const pids = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const uniquePids = new Set(pids);
    if (uniquePids.size === 0) {
        return {
            ok: false,
            reason: `no-listening-process-on-${BASE_URL_PORT}`,
            details: `${BASE_URL_PORT} 포트에 바인딩된 실행 프로세스가 없습니다.`,
        };
    }

    if (uniquePids.size > 1) {
        return {
            ok: false,
            reason: `multiple-processes-on-${BASE_URL_PORT}`,
            details: `동시 실행 감지: ${[...uniquePids].join(', ')} 총 ${uniquePids.size}개`,
        };
    }

    return { ok: true };
}

function checkNoConcurrentPlaywrightSessions() {
    const result = spawnSync('bash', ['-lc', 'ps -ef | grep -i "[Pp]laywright" | grep -v grep | awk \'{print $2}\''], {
        stdio: 'pipe',
        encoding: 'utf8',
    });

    if (result.error) {
        return {
            ok: false,
            reason: 'playwright-process-check-failed',
            details: String(result.error),
        };
    }

    const pids = (result.stdout?.toString?.() ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (pids.length > 0) {
        return {
            ok: false,
            reason: 'concurrent-playwright-processes',
            details: `동일 호스트에서 Playwright 프로세스가 감지됨: ${pids.join(', ')}`,
        };
    }

    return { ok: true };
}

function runOccupancyGuards() {
    const occupancyChecks = [];

    const devServerCheck = checkSingleDevServerPolicy();
    if (!devServerCheck.ok) {
        occupancyChecks.push({
            ok: false,
            check: 'single-dev-server',
            name: 'single-dev-server',
            reason: devServerCheck.reason,
            details: devServerCheck.details,
        });
    }

    const playwrightCheck = checkNoConcurrentPlaywrightSessions();
    if (!playwrightCheck.ok) {
        occupancyChecks.push({
            ok: false,
            check: 'no-concurrent-playwright',
            name: 'no-concurrent-playwright',
            reason: playwrightCheck.reason,
            details: playwrightCheck.details,
        });
    }

    if (occupancyChecks.length > 0) {
        for (const entry of occupancyChecks) {
            console.error(`[qa][FAIL] ${entry.check}: ${entry.reason} - ${entry.details}`);
            qaRunSummary.checks[entry.check] = {
                status: 'FAIL',
                reason: entry.reason,
                details: entry.details,
            };
        }
        qaRunSummary.checks.occupancy = {
            status: 'FAIL',
            checks: occupancyChecks,
        };
        return { ok: false };
    }

    qaRunSummary.checks.occupancy = { status: 'PASS' };
    return { ok: true };
}

function runCommand(label, command, commandArgs, checkName) {
    let result;

    try {
        result = spawnSync(command, commandArgs, {
            cwd: process.cwd(),
            stdio: 'pipe',
            shell: true,
            encoding: 'utf8',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const record = {
            status: 'FAIL',
            exitCode: 1,
            command: `${command} ${commandArgs.join(' ')}`,
            error: message,
        };

        console.error(`[qa][${record.status}] ${label} execution failed: ${message}`);
        qaRunSummary.checks[checkName] = {
            ...(qaRunSummary.checks[checkName] ?? {}),
            ...record,
        };

        return record;
    }

    const exitCode = result.status ?? 1;
    const ok = exitCode === 0;
    const stdout = result.stdout?.toString?.() ?? '';
    const stderr = result.stderr?.toString?.() ?? '';
    if (stdout) {
        process.stdout.write(stdout);
    }
    if (stderr) {
        process.stderr.write(stderr);
    }

    const record = {
        status: ok ? 'PASS' : 'FAIL',
        exitCode,
        command: `${command} ${commandArgs.join(' ')}`,
    };

    qaRunSummary.checks[checkName] = {
        ...(qaRunSummary.checks[checkName] ?? {}),
        ...record,
    };

    console.log(`[qa][${record.status}] ${label}: ${record.command} (exit=${exitCode})`);
    return record;
}

function runMockedChecks() {
    const label = 'mocked insight API routes harness';
    return runCommand(label, 'bun', ['test', 'tests-unit/insight-chat-api-routes.test.ts'], 'mocked');
}

function runDbChecks() {
    const label = 'insight-chat DB audit';
    const result = runCommand(label, 'bun', ['run', 'scripts/insight-chat-db-ops.mjs'], 'db');

    console.log('[qa] ===== DB evidence summary =====');
    console.log(JSON.stringify({
        check: 'db',
        status: result.status,
        exitCode: result.exitCode,
        command: result.command,
    }, null, 2));

    return result;
}

async function decodeStreamText(stream) {
    if (!stream) return '';

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                text += decoder.decode(value);
            }
        }
    } finally {
        reader.releaseLock();
    }

    return text;
}

function addEvidence(evidenceStore, entry) {
    evidenceStore.push(entry);
    const suffix = entry.source !== undefined ? ` | source=${entry.source}` : '';
    const status = entry.status ?? 'n/a';
    const requestId = entry.requestId ?? 'n/a';
    const extra = [];

    if (entry.error) {
        extra.push(`error=${entry.error}`);
    }
    if (entry.fallbackReason) {
        extra.push(`fallback=${entry.fallbackReason}`);
    }

    console.log(`[qa][${entry.ok ? 'PASS' : 'FAIL'}] ${entry.route} status=${status} requestId=${requestId}${suffix}${extra.length > 0 ? ` | ${extra.join(' ')}` : ''}`);
}

async function runLiveChecks() {
    const adminCookie = getAdminCookie();
    if (!adminCookie) {
        const details = {
            env: 'INSIGHTS_CHAT_ADMIN_COOKIE 또는 tests/.auth/admin.json',
            description: 'Admin cookie is required for live endpoint checks.',
            command: 'INSIGHTS_CHAT_ADMIN_COOKIE="sb-xxx=...;" bun run qa:insights-chat -- --live',
        };

        qaRunSummary.checks.live = {
            status: 'SKIP',
            reason: 'missing admin session cookie',
            details,
        };

        recordSkip('live', 'missing admin session cookie', details);

        console.log('[qa][SKIP] live checks: skipping /admin endpoint checks because admin 세션 쿠키를 찾지 못했습니다.');
        console.log('[qa][SKIP] To enable live checks, run: INSIGHTS_CHAT_ADMIN_COOKIE="sb-xxx=...;" bun run qa:insights-chat -- --live');

        return true;
    }

    const headers = {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
    };

    const evidence = [];
    let ok = true;

    try {
        const bootstrapRequestId = nextRequestId('bootstrap');
        const bootstrapRes = await fetch(`${BASE_URL}/api/admin/insight/chat/bootstrap`, { headers, cache: 'no-store' });
        const bootstrapBody = safeJson(await bootstrapRes.text());
        const bootstrapOk = bootstrapRes.ok;
        const bootstrapEntry = {
            route: 'GET /api/admin/insight/chat/bootstrap',
            requestId: bootstrapRequestId,
            status: bootstrapRes.status,
            ok: bootstrapOk,
            asOf: bootstrapBody?.asOf ?? null,
            hasAuthBootstrap: bootstrapOk,
        };
        addEvidence(evidence, bootstrapEntry);
        if (!bootstrapOk) ok = false;

        const emptyRequestId = nextRequestId('chat-empty');
        const emptyResponse = await fetch(`${BASE_URL}/api/admin/insight/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                message: '',
                requestId: emptyRequestId,
            }),
        });
        const emptyBody = safeJson(await emptyResponse.text());
        const emptyFallback = emptyResponse.status === 400 && emptyBody?.meta?.fallbackReason === 'empty_input';
        const emptyEntry = {
            route: 'POST /api/admin/insight/chat (empty_input)',
            requestId: emptyRequestId,
            status: emptyResponse.status,
            ok: emptyFallback,
            source: emptyBody?.meta?.source ?? null,
            fallbackReason: emptyBody?.meta?.fallbackReason ?? null,
        };
        addEvidence(evidence, emptyEntry);
        if (emptyResponse.status !== 400 || emptyBody?.meta?.requestId !== emptyRequestId || !emptyFallback) {
            ok = false;
        }

        const chatRequestId = nextRequestId('chat-treemap');
        const chatResponse = await fetch(`${BASE_URL}/api/admin/insight/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                message: '트리맵으로 조회수 분포 보여줘',
                requestId: chatRequestId,
            }),
        });
        const chatBody = safeJson(await chatResponse.text());
        const chatSource = chatBody?.meta?.source ?? 'unknown';
        const chatEntry = {
            route: 'POST /api/admin/insight/chat',
            requestId: chatRequestId,
            status: chatResponse.status,
            ok: chatResponse.status === 200 && chatBody?.meta?.requestId === chatRequestId,
            source: chatSource,
            fallbackReason: chatBody?.meta?.fallbackReason ?? null,
            visualComponent: chatBody?.visualComponent ?? null,
        };
        addEvidence(evidence, chatEntry);
        if (!chatEntry.ok || typeof chatBody?.content !== 'string' || chatBody.content.trim().length === 0) {
            ok = false;
        }

        const llmConfigRequestId = nextRequestId('llm-config');
        const llmConfigResponse = await fetch(`${BASE_URL}/api/admin/insight/llm-config`, { headers, cache: 'no-store' });
        const llmConfigBody = safeJson(await llmConfigResponse.text());
        const llmConfigEntry = {
            route: 'GET /api/admin/insight/llm-config',
            requestId: llmConfigRequestId,
            status: llmConfigResponse.status,
            ok: llmConfigResponse.ok,
            source: llmConfigBody?.hasGeminiServerKey ? 'hasServerKeyFlag' : 'noServerKeyFlag',
            hasGeminiServerKey: Boolean(llmConfigBody?.hasGeminiServerKey),
        };
        addEvidence(evidence, llmConfigEntry);
        if (!llmConfigResponse.ok) {
            ok = false;
        }

        const streamRequestId = nextRequestId('chat-stream');
        const streamResponse = await fetch(`${BASE_URL}/api/admin/insight/chat/stream`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                message: '트리맵으로 조회수 분포 보여줘',
                requestId: streamRequestId,
            }),
        });

        const contentType = streamResponse.headers.get('content-type') ?? '';
        const isSse = contentType.includes('text/event-stream');
        if (isSse) {
            const raw = await decodeStreamText(streamResponse.body);
            const streamIds = extractStreamRequestIds(raw);
            const hasDone = raw.includes('data: [DONE]');
            const streamEntry = {
                route: 'POST /api/admin/insight/chat/stream (SSE)',
                requestId: streamRequestId,
                status: streamResponse.status,
                ok: streamResponse.ok && hasDone && streamIds.includes(streamRequestId),
                source: 'sse',
                contentType,
                streamRequestIds: streamIds,
                hasDone,
            };
            addEvidence(evidence, streamEntry);
            if (!streamEntry.ok) {
                ok = false;
            }
        } else {
            const streamBody = safeJson(await streamResponse.text());
            const streamEntry = {
                route: 'POST /api/admin/insight/chat/stream (fallback)',
                requestId: streamRequestId,
                status: streamResponse.status,
                ok: streamResponse.ok && streamBody?.meta?.source === 'fallback' && streamBody?.meta?.requestId === streamRequestId,
                source: streamBody?.meta?.source ?? 'n/a',
                fallbackReason: streamBody?.meta?.fallbackReason ?? null,
                contentType,
            };
            addEvidence(evidence, streamEntry);
            if (!streamEntry.ok) {
                ok = false;
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const liveErrorEntry = {
            route: 'live checks transport',
            requestId: null,
            status: null,
            ok: false,
            error: message,
        };

        addEvidence(evidence, liveErrorEntry);
        ok = false;
    }

    summarizeEvidence(evidence);
    summarizeSkipReasons();

    if (!ok) {
        console.error('[qa] Live checks failed.');
        qaRunSummary.checks.live.status = 'FAIL';
        return false;
    }

    console.log('[qa] Live checks passed.');
    return true;
}

(async () => {
    let passed = true;

    if (!runOnlyLive) {
        const mockedResult = runMockedChecks();
        passed = passed && mockedResult.status === 'PASS';
    } else {
        qaRunSummary.checks.mocked = { status: 'SKIP', reason: 'runOnlyLive mode' };
    }

    if (runDbAudit) {
        const dbResult = runDbChecks();
        passed = passed && dbResult.status === 'PASS';
    } else {
        qaRunSummary.checks.db = {
            status: 'SKIP',
            reason: 'not requested',
        };
    }

    if (runOnlyLive || runLive) {
        const adminCookie = getAdminCookie();
        if (!adminCookie) {
            qaRunSummary.checks.occupancy = {
                status: 'SKIP',
                reason: 'missing admin session cookie',
            };
        } else {
            const occupancy = runOccupancyGuards();
            if (!occupancy.ok) {
                qaRunSummary.result = 'FAIL';
                qaRunSummary.endedAt = new Date().toISOString();
                console.error('[qa][FAIL] occupancy guardrails failed before live execution.');
                process.exitCode = 1;
                console.log('[qa] ===== QA run summary =====');
                console.log(JSON.stringify(qaRunSummary, null, 2));
                return;
            }
        }
        const livePassed = await runLiveChecks();
        passed = passed && livePassed;
    } else {
        qaRunSummary.checks.live = {
            status: 'SKIP',
            reason: 'not requested',
        };
        qaRunSummary.checks.occupancy = {
            status: 'SKIP',
            reason: 'live checks not requested',
        };
    }

    qaRunSummary.endedAt = new Date().toISOString();
    qaRunSummary.result = passed ? 'PASS' : 'FAIL';
    console.log('[qa] ===== QA run summary =====');
    console.log(JSON.stringify(qaRunSummary, null, 2));

    if (!passed) {
        process.exitCode = 1;
        return;
    }
})();

#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { resolveAdminSessionCookie } from './admin-session.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..', '..');

function printUsage() {
    console.log(`Usage: node apps/web/scripts/admin-evaluations-smoke.mjs [options]

Options:
  --base-url <url>         Base URL for the app (default: BASE_URL env or fixture default)
  --storage-state <path>   Playwright storage state file (default: fixture default)
  --fixture <path>         Smoke fixture JSON (default: .omx/fixtures/admin-evaluations-smoke.json)
  --report <path>          Report markdown output path
  --case <id>             Run only a specific fixture case (repeatable)
  --cases <id1,id2>       Run only the listed fixture cases
  --operator <name>       Operator name/initials for the report (default: OPERATOR env or USER)
  --admin-user-id <uuid>  Expected updated_by_admin_id for strict checks
  --headless              Launch the browser headlessly
  --validate-only         Validate inputs and fixture shape without opening the browser
  --help                  Show this help
`);
}

function parseArgs(argv) {
    const args = {
        baseUrl: process.env.BASE_URL || null,
        storageState: process.env.STATE_PATH || null,
        fixture: '.omx/fixtures/admin-evaluations-smoke.json',
        report: null,
        selectedCases: [],
        operator: process.env.OPERATOR || process.env.USER || 'unknown-operator',
        adminUserId: process.env.ADMIN_USER_ID || null,
        headless: false,
        validateOnly: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--help') {
            printUsage();
            process.exit(0);
        }

        if (arg === '--headless') {
            args.headless = true;
            continue;
        }

        if (arg === '--validate-only') {
            args.validateOnly = true;
            continue;
        }

        const next = argv[index + 1];
        if (!next) {
            throw new Error(`Missing value for ${arg}`);
        }

        switch (arg) {
            case '--base-url':
                args.baseUrl = next;
                index += 1;
                break;
            case '--storage-state':
                args.storageState = next;
                index += 1;
                break;
            case '--fixture':
                args.fixture = next;
                index += 1;
                break;
            case '--report':
                args.report = next;
                index += 1;
                break;
            case '--case':
                args.selectedCases.push(next);
                index += 1;
                break;
            case '--cases':
                args.selectedCases.push(...next.split(',').map((value) => value.trim()).filter(Boolean));
                index += 1;
                break;
            case '--operator':
                args.operator = next;
                index += 1;
                break;
            case '--admin-user-id':
                args.adminUserId = next;
                index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function resolveFromProjectRoot(candidatePath) {
    if (!candidatePath) {
        return null;
    }

    if (path.isAbsolute(candidatePath)) {
        return candidatePath;
    }

    return path.resolve(projectRoot, candidatePath);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isPlaceholder(value) {
    return typeof value === 'string' && value.startsWith('<') && value.endsWith('>');
}

function isTodoPlaceholder(value) {
    return typeof value === 'string' && value.startsWith('TODO_');
}

function ensureArray(value, fallback = []) {
    return Array.isArray(value) ? value : fallback;
}

function toReportTimestamp(date = new Date()) {
    return date.toISOString().replace(/[:]/g, '-').replace(/\.\d+Z$/, 'Z');
}

function sanitizeFileSegment(value) {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function validateFixture(fixture) {
    const errors = [];

    if (fixture?.schema_version !== 1) {
        errors.push('fixture.schema_version must be 1');
    }

    if (!Array.isArray(fixture?.cases) || fixture.cases.length === 0) {
        errors.push('fixture.cases must contain at least one case');
    }

    for (const smokeCase of fixture?.cases ?? []) {
        if (!smokeCase?.id) {
            errors.push('each case requires an id');
        }
        if (!smokeCase?.action) {
            errors.push(`case ${smokeCase?.id ?? '<unknown>'} is missing action`);
        }
        if (!smokeCase?.source_row?.id) {
            errors.push(`case ${smokeCase?.id ?? '<unknown>'} is missing source_row.id`);
        }
        if (!smokeCase?.expected_after || typeof smokeCase.expected_after !== 'object') {
            errors.push(`case ${smokeCase?.id ?? '<unknown>'} is missing expected_after`);
        }
    }

    return errors;
}

function validateSelectedCases(fixture, selectedCases) {
    if (selectedCases.length === 0) {
        return fixture.cases;
    }

    const available = new Map(fixture.cases.map((smokeCase) => [smokeCase.id, smokeCase]));
    const missing = selectedCases.filter((caseId) => !available.has(caseId));
    if (missing.length > 0) {
        throw new Error(`Unknown fixture case id(s): ${missing.join(', ')}`);
    }

    return selectedCases.map((caseId) => available.get(caseId));
}

function assertNoTodoPlaceholders(smokeCase) {
    const todoEntries = [];

    const collect = (value, keyPath) => {
        if (isTodoPlaceholder(value)) {
            todoEntries.push(`${keyPath}=${value}`);
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((entry, index) => collect(entry, `${keyPath}[${index}]`));
            return;
        }

        if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, nestedValue]) => collect(nestedValue, `${keyPath}.${key}`));
        }
    };

    collect(smokeCase, smokeCase.id);

    if (todoEntries.length > 0) {
        throw new Error(`Fixture case ${smokeCase.id} still contains TODO placeholders: ${todoEntries.join(', ')}`);
    }
}

function ensureDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createSupabaseClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
        throw new Error(
            'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for DB read-backs. Use --validate-only if you only need fixture validation.'
        );
    }

    return createClient(url, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

function getStorageStatePath(explicitStorageState, fixture) {
    if (explicitStorageState) {
        return resolveFromProjectRoot(explicitStorageState);
    }

    const fallback = fixture?.auth?.default_storage_state;
    return fallback ? resolveFromProjectRoot(fallback) : null;
}

function parseCookieHeader(cookieHeader, baseUrl) {
    const origin = new URL(baseUrl).origin;
    return cookieHeader
        .split(';')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map((segment) => {
            const separator = segment.indexOf('=');
            if (separator === -1) {
                return null;
            }

            const name = segment.slice(0, separator).trim();
            const value = segment.slice(separator + 1).trim();
            if (!name || !value) {
                return null;
            }

            return {
                name,
                value,
                url: origin,
                path: '/',
            };
        })
        .filter(Boolean);
}

async function launchAdminContext({ baseUrl, storageStatePath, headless }) {
    const browser = await chromium.launch({ headless });
    const hasStorageState = storageStatePath && fs.existsSync(storageStatePath);
    const context = await browser.newContext(
        hasStorageState
            ? {
                storageState: storageStatePath,
            }
            : {}
    );

    if (!hasStorageState) {
        const cookieHeader = resolveAdminSessionCookie();
        if (!cookieHeader) {
            await browser.close();
            throw new Error(
                'Admin session not found. Provide --storage-state, STATE_PATH, INSIGHTS_CHAT_ADMIN_COOKIE, or apps/web/tests/.auth/admin.json.'
            );
        }

        const cookies = parseCookieHeader(cookieHeader, baseUrl);
        if (cookies.length === 0) {
            await browser.close();
            throw new Error('Admin session cookie could not be parsed into browser cookies.');
        }

        await context.addCookies(cookies);
    }

    return { browser, context };
}

async function hideOverlay(page) {
    await page.addStyleTag({
        content: `
            [data-popup-overlay="true"] { display: none !important; }
            nextjs-portal { display: none !important; }
            [data-nextjs-dev-overlay] { display: none !important; }
        `,
    });
}

async function fetchSnapshots(supabase, fixture, smokeCase) {
    const ids = [smokeCase.source_row?.id, smokeCase.target_row?.id].filter(Boolean);
    const fields = ensureArray(fixture?.defaults?.db_readback_fields, []);

    const { data, error } = await supabase
        .from('restaurants')
        .select(fields.join(','))
        .in('id', ids);

    if (error) {
        throw new Error(`DB read-back failed for case ${smokeCase.id}: ${error.message}`);
    }

    return data ?? [];
}

function snapshotMap(rows) {
    return new Map((rows ?? []).map((row) => [row.id, row]));
}

function compareExpectedValue(expected, actual, adminUserId) {
    if (isPlaceholder(expected)) {
        if (expected === '<current-admin>') {
            if (adminUserId) {
                return {
                    ok: actual === adminUserId,
                    reason: `expected updated_by_admin_id=${adminUserId}, got ${String(actual)}`,
                };
            }

            return {
                ok: actual !== null && actual !== undefined && String(actual).trim() !== '',
                reason: `expected non-empty admin id, got ${String(actual)}`,
            };
        }

        return {
            ok: actual !== null && actual !== undefined && !(typeof actual === 'string' && actual.trim() === ''),
            reason: `expected non-empty value for placeholder ${expected}`,
        };
    }

    return {
        ok: Object.is(actual, expected),
        reason: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    };
}

function evaluateExpectedRow(label, row, expectedRow, adminUserId) {
    if (!row) {
        return {
            ok: false,
            checks: [`${label} row missing from DB read-back`],
        };
    }

    const checks = [];
    let ok = true;

    for (const [field, expectedValue] of Object.entries(expectedRow ?? {})) {
        const comparison = compareExpectedValue(expectedValue, row[field], adminUserId);
        if (!comparison.ok) {
            ok = false;
            checks.push(`${label}.${field}: ${comparison.reason}`);
        }
    }

    if (checks.length === 0) {
        checks.push(`${label}: all strict checks passed`);
    }

    return { ok, checks };
}

function buildMarkdownReport(run) {
    const lines = [
        '# Admin evaluations smoke report',
        '',
        `- Run at: ${run.startedAt}`,
        `- Operator: ${run.operator}`,
        `- Environment: ${run.environment}`,
        `- Base URL: ${run.baseUrl}`,
        `- Storage state: ${run.storageState ?? 'admin cookie fallback'}`,
        `- Fixture: ${run.fixturePath}`,
        `- Admin user id: ${run.adminUserId ?? 'not supplied'}`,
        '',
        '## Summary',
        `- Overall: ${run.overall}`,
        `- Cases passed: ${run.passed}`,
        `- Cases failed: ${run.failed}`,
        '',
        '## Case results',
        '| Case | Source id | Target id | PASS/FAIL | Notes |',
        '| --- | --- | --- | --- | --- |',
    ];

    for (const caseResult of run.caseResults) {
        lines.push(
            `| ${caseResult.id} | ${caseResult.sourceId} | ${caseResult.targetId ?? ''} | ${caseResult.ok ? 'PASS' : 'FAIL'} | ${caseResult.notes.join('<br/>')} |`
        );
    }

    lines.push('', '## Snapshot artifact references');

    for (const caseResult of run.caseResults) {
        lines.push(`### ${caseResult.id}`);
        lines.push(`- Before snapshot: \`${caseResult.beforeSnapshotPath}\``);
        lines.push(`- After snapshot: \`${caseResult.afterSnapshotPath}\``);
        lines.push(`- Before screenshot: \`${caseResult.beforeScreenshotPath}\``);
        lines.push(`- After screenshot: \`${caseResult.afterScreenshotPath}\``);
        lines.push(`- UI note: ${caseResult.uiNote || 'n/a'}`);
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const fixturePath = resolveFromProjectRoot(args.fixture);

    if (!fixturePath || !fs.existsSync(fixturePath)) {
        throw new Error(`Fixture file not found: ${args.fixture}`);
    }

    const fixture = readJson(fixturePath);
    const fixtureErrors = validateFixture(fixture);
    if (fixtureErrors.length > 0) {
        throw new Error(`Fixture validation failed:\n- ${fixtureErrors.join('\n- ')}`);
    }

    const selectedCases = validateSelectedCases(fixture, args.selectedCases);
    const baseUrl = args.baseUrl || fixture?.auth?.base_url_default;
    if (!baseUrl) {
        throw new Error('Base URL is required.');
    }

    const storageStatePath = getStorageStatePath(args.storageState, fixture);
    const reportRoot = resolveFromProjectRoot(fixture?.reporting?.report_root || '.omx/reports/admin-evaluations-smoke');
    const reportPath = resolveFromProjectRoot(
        args.report || path.join(reportRoot, `${toReportTimestamp()}.md`)
    );

    const validateOnlySummary = {
        mode: args.validateOnly ? 'validate-only' : 'run',
        fixturePath,
        baseUrl,
        storageStatePath,
        reportPath,
        selectedCaseIds: selectedCases.map((smokeCase) => smokeCase.id),
    };

    if (args.validateOnly) {
        console.log(JSON.stringify(validateOnlySummary, null, 2));
        return;
    }

    for (const smokeCase of selectedCases) {
        assertNoTodoPlaceholders(smokeCase);
    }

    const supabase = createSupabaseClient();
    const runDir = path.join(reportRoot, sanitizeFileSegment(path.basename(reportPath, path.extname(reportPath))));
    fs.mkdirSync(runDir, { recursive: true });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const { browser, context } = await launchAdminContext({
        baseUrl,
        storageStatePath,
        headless: args.headless,
    });

    const page = await context.newPage();
    await page.goto(new URL('/admin/evaluations', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    await hideOverlay(page);
    if (!page.url().includes('/admin/evaluations')) {
        throw new Error(`Expected to land on /admin/evaluations but got ${page.url()}`);
    }

    const caseResults = [];

    try {
        for (const smokeCase of selectedCases) {
            const beforeSnapshots = await fetchSnapshots(supabase, fixture, smokeCase);
            const beforeMap = snapshotMap(beforeSnapshots);
            const beforeSnapshotPath = path.join(runDir, `${smokeCase.id}-before.json`);
            const afterSnapshotPath = path.join(runDir, `${smokeCase.id}-after.json`);
            const beforeScreenshotPath = path.join(runDir, `${smokeCase.id}-before.png`);
            const afterScreenshotPath = path.join(runDir, `${smokeCase.id}-after.png`);

            fs.writeFileSync(beforeSnapshotPath, JSON.stringify(beforeSnapshots, null, 2));
            await page.screenshot({ path: beforeScreenshotPath, fullPage: true });

            console.log(`\n[admin-evaluations-smoke] Case ${smokeCase.id}`);
            console.log(`- UI surface: ${smokeCase.ui_surface}`);
            console.log(`- Source row id: ${smokeCase.source_row.id}`);
            if (smokeCase.target_row?.id) {
                console.log(`- Target row id: ${smokeCase.target_row.id}`);
            }
            if (Array.isArray(smokeCase.preconditions) && smokeCase.preconditions.length > 0) {
                console.log('- Preconditions:');
                for (const precondition of smokeCase.preconditions) {
                    console.log(`  • ${precondition}`);
                }
            }

            await rl.question('Perform the UI action now, then press Enter to capture the after state...');
            const uiNote = await rl.question('Short UI result note: ');

            const afterSnapshots = await fetchSnapshots(supabase, fixture, smokeCase);
            const afterMap = snapshotMap(afterSnapshots);
            fs.writeFileSync(afterSnapshotPath, JSON.stringify(afterSnapshots, null, 2));
            await page.screenshot({ path: afterScreenshotPath, fullPage: true });

            const sourceEvaluation = evaluateExpectedRow(
                'source',
                afterMap.get(smokeCase.source_row.id),
                smokeCase.expected_after?.source,
                args.adminUserId
            );
            const targetEvaluation = smokeCase.target_row
                ? evaluateExpectedRow(
                    'target',
                    afterMap.get(smokeCase.target_row.id),
                    smokeCase.expected_after?.target,
                    args.adminUserId
                )
                : { ok: true, checks: ['target: not applicable'] };

            const ok = sourceEvaluation.ok && targetEvaluation.ok;
            const notes = [
                ...sourceEvaluation.checks,
                ...targetEvaluation.checks,
            ];

            if (uiNote) {
                notes.push(`ui-note: ${uiNote}`);
            }

            caseResults.push({
                id: smokeCase.id,
                ok,
                sourceId: smokeCase.source_row.id,
                targetId: smokeCase.target_row?.id ?? null,
                uiNote,
                beforeSnapshotPath: path.relative(projectRoot, beforeSnapshotPath),
                afterSnapshotPath: path.relative(projectRoot, afterSnapshotPath),
                beforeScreenshotPath: path.relative(projectRoot, beforeScreenshotPath),
                afterScreenshotPath: path.relative(projectRoot, afterScreenshotPath),
                beforeSnapshot: beforeMap.get(smokeCase.source_row.id),
                afterSnapshot: afterMap.get(smokeCase.source_row.id),
                notes,
            });

            console.log(`[admin-evaluations-smoke] ${smokeCase.id}: ${ok ? 'PASS' : 'FAIL'}`);
            notes.forEach((note) => console.log(`  - ${note}`));
        }
    } finally {
        rl.close();
        await context.close();
        await browser.close();
    }

    const passed = caseResults.filter((entry) => entry.ok).length;
    const failed = caseResults.length - passed;
    const report = {
        startedAt: new Date().toISOString(),
        operator: args.operator,
        environment: process.env.SMOKE_ENVIRONMENT || 'unspecified',
        baseUrl,
        storageState: storageStatePath ? path.relative(projectRoot, storageStatePath) : null,
        fixturePath: path.relative(projectRoot, fixturePath),
        adminUserId: args.adminUserId,
        overall: failed === 0 ? 'PASS' : 'FAIL',
        passed,
        failed,
        caseResults,
    };

    ensureDirectory(reportPath);
    fs.writeFileSync(reportPath, buildMarkdownReport(report));
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2));

    console.log(JSON.stringify({
        ...validateOnlySummary,
        reportPath: path.relative(projectRoot, reportPath),
        runDir: path.relative(projectRoot, runDir),
        overall: report.overall,
        passed,
        failed,
    }, null, 2));

    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(`[admin-evaluations-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});

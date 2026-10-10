#!/usr/bin/env node
/** One provider attempt with a durable once-only receipt; retain counts/hashes, never content or credentials. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { withProjectBudget } from '../utils/provider-budget.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const prompt = 'Respond only with the JSON object {"ok":true}. This is a bounded connectivity probe for the configured Gemini model.';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
const argument = name => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error('PROBE_ARGUMENTS_INVALID');
    return args[index + 1];
};

async function main() {
    const output = argument('--output');
    const credentialEnv = argument('--credential-env');
    if (fs.existsSync(output)) throw new Error('PROBE_OUTPUT_ALREADY_EXISTS');
    const credentials = parse(fs.readFileSync(credentialEnv));
    const credentialSource = ['GEMINI_CREDITS_API_KEY', 'GEMINI_API_KEY', 'GEMINI_API_KEY_BYEON']
        .find(name => typeof credentials[name] === 'string' && credentials[name].trim());
    const apiKey = credentialSource ? credentials[credentialSource].trim() : '';
    if (!apiKey) throw new Error('PROBE_KEY_MISSING');
    // Gemini 3.6+ deprecates sampling overrides. Keep the explicit 3.8 model and all existing caps.
    const config = { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'MEDIUM' } };
    const report = {
        schemaVersion: 1,
        kind: 'real_provider_connectivity_probe',
        measuredAt: new Date().toISOString(),
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        probeSourceSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
        model: 'gemini-3.8-flash',
        responseModelVersion: null,
        responseModelProvenance: 'not_reported',
        credentialSource,
        config,
        configuredMaxAttempts: 1,
        apiCallsStarted: 0,
        configuredBudget: {
            projectScope: process.env.GEMINI_BUDGET_PROJECT || 'configured-project',
            requestsPerMinute: Number(process.env.GEMINI_REQUESTS_PER_MINUTE || 30),
            concurrency: Number(process.env.GEMINI_MAX_INFLIGHT || 1),
        },
        promptSha256: sha256(prompt),
        promptBytes: Buffer.byteLength(prompt),
        status: 'not_started',
        resultUnconfirmed: true,
        usage: null,
        moneySpent: null,
        confidenceInterval95: null,
        sampleCount: 1,
        scope: 'Billing/auth/SDK/model connectivity only; no latency comparison or restaurant accuracy claim.',
        environment: {
            node: process.version,
            sdk: JSON.parse(fs.readFileSync(new URL('../node_modules/@google/genai/package.json', import.meta.url), 'utf8')).version,
            transport: 'real_google_gemini_api',
        },
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    // Reserve before acquiring quota or sending a request. An interrupted/lost-ack
    // attempt leaves this receipt in place and cannot be rerun under the same output.
    const receiptFd = fs.openSync(output, 'wx', 0o600);
    const persist = () => {
        const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
        let written = 0;
        while (written < bytes.length) {
            written += fs.writeSync(receiptFd, bytes, written, bytes.length - written, written);
        }
        fs.ftruncateSync(receiptFd, bytes.length);
        fs.fsyncSync(receiptFd);
    };
    persist();
    const started = performance.now();
    try {
        const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60000, retryOptions: { attempts: 1 } } });
        const response = await withProjectBudget(async () => {
            report.apiCallsStarted += 1;
            report.status = 'running';
            persist();
            const requestStarted = performance.now();
            try {
                return await ai.models.generateContent({ model: report.model, contents: prompt, config });
            } finally {
                report.requestElapsedMs = performance.now() - requestStarted;
            }
        });
        const responseModel = typeof response.modelVersion === 'string'
            ? response.modelVersion.replace(/^models\//, '') : null;
        // Retain the actual supported ID/revision, never synthesize it from the request.
        report.responseModelVersion = /^gemini-3\.8-flash(?:-[0-9]{3})?$/.test(responseModel || '')
            ? responseModel : null;
        report.responseModelProvenance = report.responseModelVersion ? 'sdk_reported_supported_id'
            : response.modelVersion == null ? 'not_reported' : 'unrecognized';
        const responseText = response.text || '';
        report.responseSha256 = sha256(responseText);
        report.responseBytes = Buffer.byteLength(responseText);
        report.usage = Object.fromEntries([
            'promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount',
            'totalTokenCount', 'cachedContentTokenCount',
        ].filter(key => Number.isSafeInteger(response.usageMetadata?.[key]) && response.usageMetadata[key] >= 0)
            .map(key => [key, response.usageMetadata[key]]));
        try {
            report.responseAccepted = JSON.parse(responseText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')).ok === true;
        } catch { report.responseAccepted = false; }
        report.status = report.responseAccepted ? 'ok' : 'response_invalid';
        report.resultUnconfirmed = false;
    } catch (error) {
        const status = error?.status;
        report.httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
        report.status = status === 429 ? 'quota_exhausted' : [401, 403].includes(status) ? 'auth_failed' : 'api_unavailable';
    } finally {
        report.totalElapsedMs = performance.now() - started;
        try { persist(); } finally { fs.closeSync(receiptFd); }
    }
    console.log(JSON.stringify({ status: report.status, apiCallsStarted: report.apiCallsStarted, elapsedMs: report.requestElapsedMs, usage: report.usage }));
    process.exitCode = report.status === 'ok' ? 0 : 1;
}

main().catch(() => { console.error('GEMINI_PROBE_FAILED'); process.exitCode = 1; });

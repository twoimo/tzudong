#!/usr/bin/env node
/** Write a redacted Gemini runtime preflight report before expensive video work. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeErrorName } from '../utils/privacy-log.mjs';

function parseArgs(argv) {
  const args = { output: '', model: process.env.CURRENT_MODEL || process.env.PRIMARY_MODEL || 'gemini-3.7-flash', requireApiAvailable: false, checkedAt: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') args.output = argv[++i] || '';
    else if (arg === '--model') args.model = argv[++i] || args.model;
    else if (arg === '--checked-at') args.checkedAt = argv[++i] || '';
    else if (arg === '--require-api-available') args.requireApiAvailable = true;
  }
  return args;
}

function resolveThinkingLevel(...candidates) {
  const allowed = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);
  for (const candidate of candidates) {
    const value = String(candidate || '').trim().toUpperCase();
    if (allowed.has(value)) return value;
  }
  return 'MEDIUM';
}

function classifyError(error) {
  const code = String(error?.code || error?.status || '');
  const message = typeof error?.message === 'string' ? error.message : '';
  const text = `${code}\n${message}`;
  if (/429|quota|RESOURCE_EXHAUSTED|rate limit/i.test(text)) return 'quota_exhausted';
  if (/401|403|API key|permission|PERMISSION_DENIED|UNAUTHENTICATED/i.test(text)) return 'auth_failed';
  return 'api_error';
}

async function buildReport(args) {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_BYEON || '').trim();
  const thinkingLevel = resolveThinkingLevel(
    process.env.GEMINI_PREFLIGHT_THINKING_LEVEL,
    process.env.GEMINI_THINKING_LEVEL,
    'LOW',
  );
  const report = {
    schemaVersion: 1,
    checkedAt: args.checkedAt || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    model: args.model,
    thinkingLevel,
    hasApiKey: Boolean(apiKey),
    status: 'unknown',
  };

  if (!apiKey) {
    return { ...report, status: 'missing_key', detail: 'GEMINI_API_KEY_not_configured' };
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({
      model: args.model,
      contents: 'Reply with only: ok',
      config: {
        thinkingConfig: { thinkingLevel },
      },
    });
    return { ...report, status: 'ok' };
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      return { ...report, status: 'dependency_missing', detail: '@google/genai_not_installed' };
    }
    const status = classifyError(error);
    return {
      ...report,
      status,
      detail: `${status}_detected`,
      errorName: safeErrorName(error),
    };
  }
}

function exitCodeFor(report, requireApiAvailable) {
  if (!requireApiAvailable) return 0;
  if (report.status === 'ok') return 0;
  if (report.status === 'quota_exhausted') return 42;
  if (report.status === 'auth_failed' || report.status === 'missing_key') return 43;
  return 1;
}

const args = parseArgs(process.argv.slice(2));
const report = await buildReport(args);
const payload = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) {
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, payload, 'utf8');
} else {
  process.stdout.write(payload);
}
process.exit(exitCodeFor(report, args.requireApiAvailable));

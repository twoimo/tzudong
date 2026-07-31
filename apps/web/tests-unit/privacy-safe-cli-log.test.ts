import { describe, expect, test } from 'bun:test';

import {
  logCliError,
  privacySafeCliLog,
  redactCliText,
  safeCliErrorName,
} from '../scripts/privacy-safe-cli-log.mjs';

describe('privacy-safe CLI logging', () => {
  test('redacts operational secrets and keeps safe compiler diagnostics readable', () => {
    const input = [
      'compiler /workspace/src/index.ts:17 TS2304',
      'email=person@example.com',
      'phone=010-1234-5678',
      'rrn=900101-1234567',
      'password=hunter2',
      'SUPABASE_SERVICE_ROLE_KEY=service-key-value',
      'Bearer bearer-secret-value',
      'Authorization: Bearer authorization-bearer-secret',
      'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      'refresh_token=refresh-secret',
      'Cookie=session=browser-secret',
      'session_id=session-secret',
      'https://api.example.test/retain?access_token=url-secret&mode=apply',
      'lat=37.5665 lng=126.9780',
      '{"SUPABASE_SERVICE_ROLE_KEY":"json-service-key","latitude":37.5665}',
      'migration=20260712000100_g010_privacy_foundation.sql',
      'raw_ocr=서울시 비공개 영수증 원문',
    ].join(' | ');

    const output = redactCliText(`${input}\u0000\n`);

    expect(output).toContain('compiler /workspace/src/index.ts:17 TS2304');
    expect(output).toContain('[REDACTED:email]');
    expect(output).toContain('[REDACTED:phone]');
    expect(output).toContain('[REDACTED:rrn]');
    expect(output).toContain('[REDACTED:credential]');
    expect(output).toContain('[REDACTED:token]');
    expect(output).toContain('[REDACTED:cookie]');
    expect(output).toContain('[REDACTED:session]');
    expect(output).toContain('[REDACTED:secret_url]');
    expect(output).toContain('[REDACTED:precise_location]');
    expect(output).toContain('[REDACTED:raw_ocr]');
    expect(output).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    expect(output).toContain('20260712000100_g010_privacy_foundation.sql');

    for (const secret of [
      'person@example.com',
      '010-1234-5678',
      '900101-1234567',
      'hunter2',
      'service-key-value',
      'json-service-key',
      'bearer-secret-value',
      'authorization-bearer-secret',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      'refresh-secret',
      'browser-secret',
      'session-secret',
      'url-secret',
      '37.5665',
      '126.9780',
      '서울시 비공개 영수증 원문',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  test('bounds text without coercing arbitrary values', () => {
    let coercions = 0;
    const malicious = {
      toString() {
        coercions += 1;
        throw new Error('must not stringify');
      },
      valueOf() {
        coercions += 1;
        throw new Error('must not coerce');
      },
    };

    expect(redactCliText(malicious)).toBe('[REDACTED:non_text]');
    expect(coercions).toBe(0);
    expect(redactCliText('x'.repeat(1_025))).toBe('[REDACTED:bounded]');
    expect(redactCliText('a@b.cd '.repeat(100))).toBe('[REDACTED:bounded]');
    expect(redactCliText('safe', 2)).toBe('[R');
  });

  test('logs only a safe error name and code without reading diagnostics', () => {
    let diagnosticReads = 0;
    const error = Object.create(Error.prototype, {
      name: { configurable: true, value: 'CompilerFailure' },
      code: { configurable: true, value: 'TS2304' },
      message: {
        configurable: true,
        get() {
          diagnosticReads += 1;
          return 'person@example.com';
        },
      },
      stack: {
        configurable: true,
        get() {
          diagnosticReads += 1;
          return 'Bearer token';
        },
      },
      cause: {
        configurable: true,
        get() {
          diagnosticReads += 1;
          return { secret: 'must not inspect' };
        },
      },
    });
    const lines: string[] = [];

    expect(safeCliErrorName(error)).toBe('CompilerFailure');
    expect(logCliError(error, (line: string) => lines.push(line))).toBe('error=CompilerFailure code=TS2304\n');
    expect(lines).toEqual(['error=CompilerFailure code=TS2304\n']);
    expect(diagnosticReads).toBe(0);

    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error('must not inspect');
      },
      getPrototypeOf() {
        throw new Error('must not inspect');
      },
    });
    expect(safeCliErrorName(hostile)).toBe('cli_error');
  });

  test('preserves the scheduler logger API and its bounded output', () => {
    const lines: string[] = [];

    privacySafeCliLog({
      classCode: 'privacy_identity_audit',
      status: 'applied',
      eligible: 3,
      held: 1,
      scanned: 4,
    }, (line: string) => lines.push(line));
    privacySafeCliLog({
      classCode: 'person@example.com',
      status: 'unexpected',
      eligible: -1,
      held: 1.5,
      scanned: Number.POSITIVE_INFINITY,
    }, (line: string) => lines.push(line));

    expect(lines).toEqual([
      'classCode=privacy_identity_audit status=applied eligible=3 held=1 scanned=4\n',
      'classCode=scheduler status=failed eligible=0 held=0 scanned=0\n',
    ]);
  });
});

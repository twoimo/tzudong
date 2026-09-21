import { describe, expect, test } from 'bun:test';

import { describeErrorCodeForLog } from '../lib/debug-log';

describe('로그용 오류 코드 추출', () => {
    test('PostgREST/Postgres 코드만 그대로 돌려준다', () => {
        expect(describeErrorCodeForLog({ code: 'PGRST116', message: 'row not found' })).toBe('PGRST116');
        expect(describeErrorCodeForLog({ code: '42P01' })).toBe('42P01');
        expect(describeErrorCodeForLog({ code: 23505 })).toBe('23505');
    });

    test('메시지/상세/힌트/스택은 로그로 내보내지 않는다', () => {
        const error = Object.assign(new Error('relation public.secret_table does not exist'), {
            code: '42P01',
            details: 'Key (email)=(user@example.com) already exists.',
            hint: 'check RLS policy for public.secret_table',
        });

        const description = describeErrorCodeForLog(error);

        expect(description).toBe('42P01');
        expect(description).not.toContain('secret_table');
        expect(description).not.toContain('example.com');
        expect(description).not.toContain('RLS');
    });

    test('코드가 없으면 UNKNOWN으로 대체한다', () => {
        expect(describeErrorCodeForLog(null)).toBe('UNKNOWN');
        expect(describeErrorCodeForLog(undefined)).toBe('UNKNOWN');
        expect(describeErrorCodeForLog('PGRST116')).toBe('UNKNOWN');
        expect(describeErrorCodeForLog(new Error('boom'))).toBe('UNKNOWN');
        expect(describeErrorCodeForLog({ message: 'relation does not exist' })).toBe('UNKNOWN');
    });

    test('위험하거나 형태가 다른 코드는 UNKNOWN으로 막는다', () => {
        expect(describeErrorCodeForLog({ code: 'pgrst116' })).toBe('UNKNOWN');
        expect(describeErrorCodeForLog({ code: 'DROP TABLE users' })).toBe('UNKNOWN');
        expect(describeErrorCodeForLog({ code: 'A'.repeat(64) })).toBe('UNKNOWN');
        expect(describeErrorCodeForLog({ code: { value: 'PGRST116' } })).toBe('UNKNOWN');
        expect(describeErrorCodeForLog({ code: 1234567 })).toBe('UNKNOWN');
        expect(describeErrorCodeForLog({ code: 1.5 })).toBe('UNKNOWN');
        expect(describeErrorCodeForLog({ code: Number.NaN })).toBe('UNKNOWN');
    });
});

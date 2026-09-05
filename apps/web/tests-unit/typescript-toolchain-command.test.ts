import { describe, expect, test } from 'bun:test';
import { checkedCommandOutput } from '../scripts/verify-typescript-toolchain.mjs';

describe('toolchain command protocol and diagnostic boundary', () => {
  test('preserves a date-bearing manifest path and JSON beyond the diagnostic limit', () => {
    const manifest = `/workspace/tzudong-g003-frozen-20260906/${'nested/'.repeat(90)}node_modules/typescript/package.json`;
    const payload = JSON.stringify({ version: '6.0.2', manifest });
    const output = checkedCommandOutput({ status: 0, signal: null, stdout: `${payload}\n`, stderr: '' });
    expect(JSON.parse(output)).toEqual({ version: '6.0.2', manifest });
  });

  for (const signal of [null, 'SIGTERM']) {
    test(`redacts and bounds failed command diagnostics with signal ${signal}`, () => {
      const privateText = `email=fixture@example.com password=fixture-secret ${'x'.repeat(800)}`;
      try {
        checkedCommandOutput({ status: 1, signal, stdout: privateText, stderr: privateText });
        throw new Error('expected command rejection');
      } catch (error) {
        const failure = error as Error & { code: string; diagnostic: string };
        expect(failure.code).toBe(signal ? 'TOOLCHAIN_COMMAND_SIGNAL' : 'TOOLCHAIN_COMMAND_STATUS');
        expect(failure.diagnostic.length).toBeLessThanOrEqual(512);
        expect(failure.diagnostic).not.toContain('fixture@example.com');
        expect(failure.diagnostic).not.toContain('fixture-secret');
      }
    });
  }

  test('does not propagate a launch error body', () => {
    try {
      checkedCommandOutput({ error: new Error('password=fixture-secret'), stdout: '', stderr: '' });
      throw new Error('expected launch rejection');
    } catch (error) {
      const failure = error as Error & { code: string; diagnostic?: string };
      expect(failure.code).toBe('TOOLCHAIN_COMMAND_LAUNCH_FAILED');
      expect(failure.diagnostic).toBeUndefined();
      expect(failure.message).not.toContain('fixture-secret');
    }
  });
});

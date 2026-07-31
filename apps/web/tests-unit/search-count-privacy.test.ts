import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'lib', 'search-count.ts'), 'utf8');

describe('search count privacy boundary', () => {
  test('is a bounded no-op with no browser analytics transport or identifiers', () => {
    expect(source).toContain("reason: 'analytics_disabled'");
    expect(source).toContain('success: true');
    expect(source).not.toContain('restaurant_id');

    for (const forbiddenReference of [
      'supabase',
      'fetch',
      'rpc',
      'storage',
      'cookie',
      'authorization',
      'user-agent',
      'user_agent',
      'useragent',
      'navigator',
      'session',
      'ip_address',
      'persistent',
    ]) {
      expect(source.toLowerCase()).not.toContain(forbiddenReference);
    }
  });
});

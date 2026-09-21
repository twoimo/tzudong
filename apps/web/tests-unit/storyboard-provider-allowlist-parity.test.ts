import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STORYBOARD_OFFICIAL_API_PROVIDER_IDS, STORYBOARD_USER_IMPORT_PROVIDER_IDS,
} from '../lib/admin/storyboard/production-contract';

const appRoot = join(import.meta.dir, '..');
const migration = readFileSync(
  join(appRoot, '../../backend/supabase/migrations/20260920021531_storyboard_historical_restore.sql'), 'utf8',
).replace(/\r\n/g, '\n');

describe('storyboard provider allowlist parity', () => {
  test('the external-AI-off SQL gate admits every loopback provider the client advertises', () => {
    const start = migration.indexOf("providers,externalAI}')::boolean");
    const end = migration.indexOf("'external_ai_disabled'");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const allowed = [...new Set([...migration.slice(start, end).matchAll(/'([a-z-]+)'/g)].map((match) => match[1]))];
    expect(allowed.sort()).toEqual(['local-mlx', ...STORYBOARD_USER_IMPORT_PROVIDER_IDS].sort());
    for (const official of STORYBOARD_OFFICIAL_API_PROVIDER_IDS) expect(allowed).not.toContain(official);
  });
  test('official API providers stay refused before the external-AI gate', () => {
    expect(migration).toContain("x.value->>'id' IN ('openai-api','xai-api')");
    expect(migration.indexOf("'provider_not_configured'"))
      .toBeLessThan(migration.indexOf("'external_ai_disabled'"));
  });
});


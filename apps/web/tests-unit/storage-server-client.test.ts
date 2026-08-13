import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { __storageServerForTests } from '../lib/supabase/storage-server';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('server-only privileged Storage boundary', () => {
  test('uses a distinct strict-local key and preserves hosted behavior', () => {
    const helper = source('lib/supabase/storage-server.ts');
    expect(helper).toContain("const strictLocal = localMarker === '1'");
    expect(helper).toContain('environment.SUPABASE_STORAGE_SERVER_KEY');
    expect(helper).toContain('environment.SUPABASE_SERVICE_ROLE_KEY');
    expect(helper).not.toContain('NEXT_PUBLIC_SUPABASE_STORAGE');
    expect(helper).toContain("typeof window !== 'undefined'");

    const local = __storageServerForTests.resolveStorageServerConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:28000',
      NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
      SUPABASE_STORAGE_SERVER_KEY: 'local-owner-key',
      SUPABASE_SERVICE_ROLE_KEY: 'global-service-key',
    });
    expect(local.strictLocal).toBe(true);
    expect(local.storageServerKey).toBe('local-owner-key');

    const hosted = __storageServerForTests.resolveStorageServerConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'hosted-service-key',
    });
    expect(hosted.strictLocal).toBe(false);
    expect(hosted.storageServerKey).toBe('hosted-service-key');

    expect(() => __storageServerForTests.resolveStorageServerConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:28000',
      NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
      SUPABASE_SERVICE_ROLE_KEY: 'global-service-key',
    })).toThrow('environment is missing');
    expect(() => __storageServerForTests.resolveStorageServerConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
      NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
      SUPABASE_STORAGE_SERVER_KEY: 'local-owner-key',
    })).toThrow('environment is invalid');
    expect(() => __storageServerForTests.resolveStorageServerConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
      NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '0',
      SUPABASE_SERVICE_ROLE_KEY: 'hosted-service-key',
    })).toThrow('environment is invalid');
  });

  test('routes thumbnail Storage only through the dedicated client', () => {
    const ocr = source('app/api/admin/ocr-receipts/process/route.ts');
    const registry = source('lib/admin/youtube-thumbnail-generator/release-registry.ts');
    expect(ocr).toContain('createSupabaseStorageServerClient');
    expect(ocr).toContain("storageAdmin.from('review-photos')");
    expect(ocr).not.toContain('storageAdmin.storage');
    expect(ocr).not.toContain("supabase.storage.from('review-photos')");
    expect(registry).toContain('createSupabaseStorageServerClient()');
    expect(registry).not.toContain('createSupabaseStorageServerClient().storage');
    expect(registry).not.toContain('supabase.storage.from(');
    expect(registry).toContain('createSupabaseServiceRoleClient()');
    expect(source('lib/supabase/storage-server.ts')).toContain("type StorageClient = SupabaseClient<Database>['storage']");
  });

  test('keeps both Storage key names out of browser and Playwright environments', () => {
    const runner = source('scripts/run-nightly-regression.mjs');
    const playwright = source('playwright.config.ts');
    const browserKeys = runner.match(/const browserEnvironmentKeys = \[([\s\S]*?)\n\];/)?.[1] ?? '';
    const localRuntimeBlock = runner.match(/const localRuntimeKeys = new Set\(([\s\S]*?)const hostedRuntimeKeys/)?.[1] ?? '';
    expect(browserKeys).not.toContain('SUPABASE_STORAGE_SERVER_KEY');
    expect(browserKeys).not.toContain('STORAGE_SERVICE_KEY');
    expect(browserKeys).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(playwright).not.toContain('SUPABASE_STORAGE_SERVER_KEY');
    expect(playwright).not.toContain('STORAGE_SERVICE_KEY');
    expect(localRuntimeBlock).not.toContain("localRuntimeKeys.add('SUPABASE_STORAGE_SERVER_KEY')");
    expect(localRuntimeBlock).not.toContain("localRuntimeKeys.add('SUPABASE_SERVICE_ROLE_KEY')");
    expect(runner).toContain('SUPABASE_STORAGE_SERVER_KEY: environment.SUPABASE_STORAGE_SERVER_KEY');
    expect(runner).toContain('SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY');
    expect(runner).toContain("environment.NIGHTLY_MODE === 'local' ? localRuntimeKeys : hostedRuntimeKeys");
    expect(playwright).not.toContain("'SUPABASE_SERVICE_ROLE_KEY'");
  });
});

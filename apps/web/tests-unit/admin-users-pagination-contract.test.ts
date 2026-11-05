import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

const worker = String.raw`
import { mock } from 'bun:test';
import { NextRequest } from 'next/server';

const totalUsers = 1001;
const calls = [];
const id = index => '00000000-0000-4000-9000-' + String(index).padStart(12, '0');
const users = Array.from({ length: totalUsers }, (_, index) => ({
  id: id(index + 1),
  email: 'user-' + String(index + 1).padStart(4, '0') + '@example.test',
  user_metadata: {},
  banned_until: null,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, totalUsers - index)).toISOString(),
  last_sign_in_at: new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString(),
  email_confirmed_at: index % 7 === 0 ? null : '2026-01-01T00:00:00.000Z',
}));

mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => ({ ok: true, userId: id(9999) }) }));
mock.module('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => ({
    auth: { admin: {
      listUsers: async ({ page, perPage }) => {
        calls.push({ page, perPage });
        const start = (page - 1) * perPage;
        return { data: { users: users.slice(start, start + perPage), total: totalUsers }, error: null };
      },
      getUserById: async target => ({ data: { user: users.find(user => user.id === target) ?? null }, error: null }),
    } },
    rpc: async (_name, { p_user_ids }) => ({ data: p_user_ids.map(userId => {
      const index = Number(userId.slice(-12));
      return {
        user_id: userId,
        username: 'handle-' + String(index).padStart(4, '0'),
        nickname: '닉네임-' + String(totalUsers - index).padStart(4, '0'),
        avatar_url: null,
        profile_role: index % 2 === 0 ? 'admin' : 'user',
        profile_created_at: null,
        profile_updated_at: null,
        is_admin: index % 2 === 0,
        account_status: 'active',
      };
    }), error: null }),
  }),
}));

const route = await import('./app/api/admin/users/route.ts');
const request = path => new NextRequest('http://localhost' + path);
const direct = await route.GET(request('/api/admin/users?page=2&perPage=120&filter=all&sort=newest'));
const directPayload = await direct.json();
const filtered = await route.GET(request('/api/admin/users?page=2&perPage=10&filter=admin&sort=name'));
const filteredPayload = await filtered.json();

console.log(JSON.stringify({ direct: directPayload, filtered: filteredPayload, calls }));
`;

test('admin users route connects bounded pages, global scanned filters, sort, and totals', () => {
  const result = Bun.spawnSync([process.execPath, '--eval', worker], {
    cwd: resolve(import.meta.dir, '..'),
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toBe('');
  const report = JSON.parse(new TextDecoder().decode(result.stdout));

  expect(report.direct.page).toBe(2);
  expect(report.direct.perPage).toBe(120);
  expect(report.direct.users).toHaveLength(120);
  expect(report.direct.total).toBe(1001);
  expect(report.direct.sourceTotal).toBe(1001);
  expect(report.direct.hasPreviousPage).toBe(true);
  expect(report.direct.hasNextPage).toBe(true);
  expect(report.direct.isPartial).toBe(false);

  expect(report.filtered.page).toBe(2);
  expect(report.filtered.users).toHaveLength(10);
  expect(report.filtered.total).toBe(500);
  expect(report.filtered.sourceTotal).toBe(1001);
  expect(report.filtered.isPartial).toBe(true);
  expect(report.filtered.hasPreviousPage).toBe(true);
  expect(report.filtered.hasNextPage).toBe(true);
  expect(report.filtered.users.map((user: { nickname: string }) => user.nickname))
    .toEqual([...report.filtered.users.map((user: { nickname: string }) => user.nickname)].sort((a, b) => a.localeCompare(b, 'ko')));
  expect(report.calls).toEqual([
    { page: 2, perPage: 120 },
    { page: 1, perPage: 200 },
    { page: 2, perPage: 200 },
    { page: 3, perPage: 200 },
    { page: 4, perPage: 200 },
    { page: 5, perPage: 200 },
  ]);
});

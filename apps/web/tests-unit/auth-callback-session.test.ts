import { afterEach, describe, expect, mock, test } from 'bun:test';

let instance = 0;

async function loadCallbackSessionModule(createClient: () => Promise<unknown>) {
  instance += 1;
  mock.module('@/lib/supabase/server', () => ({ createClient }));
  try {
    return await import(`../lib/auth/callback-session.ts?test=${instance}`);
  } finally {
    mock.restore();
  }
}

afterEach(() => {
  mock.restore();
});

describe('rejected callback session revocation', () => {
  test('signs out globally first and then locally', async () => {
    const { revokeRejectedCallbackSession } = await loadCallbackSessionModule(async () => ({}));
    const scopes: string[] = [];

    await revokeRejectedCallbackSession({
      auth: {
        async signOut({ scope }) {
          scopes.push(scope);
          return null;
        },
      },
    });

    expect(scopes).toEqual(['global', 'local']);
  });

  test('still attempts the local sign out when the global sign out fails', async () => {
    const { revokeRejectedCallbackSession } = await loadCallbackSessionModule(async () => ({}));
    const scopes: string[] = [];

    await revokeRejectedCallbackSession({
      auth: {
        async signOut({ scope }) {
          scopes.push(scope);
          if (scope === 'global') {
            throw new Error('network failure');
          }
          return null;
        },
      },
    });

    expect(scopes).toEqual(['global', 'local']);
  });

  test('swallows a local sign out failure after a successful global sign out', async () => {
    const { revokeRejectedCallbackSession } = await loadCallbackSessionModule(async () => ({}));

    const result = await revokeRejectedCallbackSession({
      auth: {
        async signOut({ scope }) {
          if (scope === 'local') {
            throw new Error('cookie store is read only');
          }
          return null;
        },
      },
    });

    expect(result).toBeUndefined();
  });

  test('never rejects even when both sign out attempts fail', async () => {
    const { revokeRejectedCallbackSession } = await loadCallbackSessionModule(async () => ({}));
    let attempts = 0;

    await expect(
      revokeRejectedCallbackSession({
        auth: {
          async signOut() {
            attempts += 1;
            throw new Error('auth endpoint unavailable');
          },
        },
      }),
    ).resolves.toBeUndefined();

    expect(attempts).toBe(2);
  });

  test('swallows non-Error rejections without leaking them', async () => {
    const { revokeRejectedCallbackSession } = await loadCallbackSessionModule(async () => ({}));

    await expect(
      revokeRejectedCallbackSession({
        auth: {
          async signOut() {
            throw 'rejected';
          },
        },
      }),
    ).resolves.toBeUndefined();
  });

  test('does not rethrow a synchronous sign out throw', async () => {
    const { revokeRejectedCallbackSession } = await loadCallbackSessionModule(async () => ({}));
    const scopes: string[] = [];

    await expect(
      revokeRejectedCallbackSession({
        auth: {
          signOut({ scope }) {
            scopes.push(scope);
            throw new Error('synchronous throw');
          },
        },
      } as never),
    ).resolves.toBeUndefined();

    expect(scopes).toEqual(['global', 'local']);
  });

  test('createCallbackSupabaseClient delegates to the configured server client factory', async () => {
    const sentinel = { auth: { signOut: async () => null }, marker: 'server-client' };
    const { createCallbackSupabaseClient } = await loadCallbackSessionModule(async () => sentinel);

    await expect(createCallbackSupabaseClient()).resolves.toBe(sentinel);
  });
});


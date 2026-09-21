import { beforeEach, describe, expect, mock, test } from "bun:test";

type NamedRow = Record<string, unknown> | null;

type SupabaseState = {
  user: { id: string } | null;
  authError: { message: string } | null;
  sessionActive: boolean | null;
  sessionError: { message: string } | null;
  role: NamedRow;
  roleError: { message: string } | null;
  accountStatus: NamedRow;
  accountStatusError: { message: string } | null;
};

const state: SupabaseState = {
  user: null,
  authError: null,
  sessionActive: null,
  sessionError: null,
  role: null,
  roleError: null,
  accountStatus: null,
  accountStatusError: null,
};

const queriedTables: string[] = [];
let clientCreations = 0;
let requestHeaders = new Headers();
let devCookieVerdict: { ok: boolean } = { ok: false };

const ADMIN_ID = "00000000-0000-0000-0000-0000000000aa";
const E2E_BYPASS_USER_ID = "e2e-admin-route-bypass";
const DEV_COOKIE_USER_ID = "dev-admin-thumbnail-bypass";
const DEV_COOKIE_HEADER = "tzudong-dev-admin=fixture";

type RequireAdminResult = { ok: true; userId: string } | { ok: false; response: Response };
type RequireAdmin = (options?: { allowDevAdminBypassCookie?: boolean }) => Promise<RequireAdminResult>;

const E2E_ENV_KEYS = [
  "E2E_ADMIN_ROUTE_BYPASS",
  "E2E_ADMIN_ROUTE_BYPASS_CONTEXT",
  "E2E_ADMIN_ROUTE_BYPASS_RUNTIME",
  "E2E_ADMIN_ROUTE_BYPASS_TOKEN",
] as const;

function applyE2eEnv(enabled: boolean) {
  if (!enabled) {
    for (const key of E2E_ENV_KEYS) delete process.env[key];
    return;
  }
  process.env.E2E_ADMIN_ROUTE_BYPASS = "1";
  process.env.E2E_ADMIN_ROUTE_BYPASS_CONTEXT = "playwright";
  process.env.E2E_ADMIN_ROUTE_BYPASS_RUNTIME = "local-dev-server";
  process.env.E2E_ADMIN_ROUTE_BYPASS_TOKEN = "fixture-bypass-token";
}

/**
 * Module mocks are process-wide under `bun test`, so they are installed per test
 * and restored afterwards. A cache-busted import keeps each case on a fresh copy.
 */
async function withRequireAdmin<T>(
  options: { e2e?: boolean },
  run: (requireAdmin: RequireAdmin) => Promise<T>,
): Promise<T> {
  const previousEnv = E2E_ENV_KEYS.map((key) => [key, process.env[key]] as const);
  applyE2eEnv(options.e2e === true);

  mock.module("next/headers", () => ({
    headers: async () => requestHeaders,
  }));
  mock.module("@/lib/supabase/server", () => ({
    createClient: async () => {
      clientCreations += 1;
      return {
        auth: {
          getUser: async () => ({ data: { user: state.user }, error: state.authError }),
        },
        rpc: () => ({
          returns: async () => ({ data: state.sessionActive, error: state.sessionError }),
        }),
        from: (table: string) => {
          queriedTables.push(table);
          const row = table === "user_roles" ? state.role : state.accountStatus;
          const error = table === "user_roles" ? state.roleError : state.accountStatusError;
          const builder: Record<string, unknown> = {};
          builder.select = () => builder;
          builder.eq = () => builder;
          builder.maybeSingle = () => builder;
          builder.returns = async () => ({ data: row, error });
          return builder;
        },
      };
    },
  }));
  mock.module("@/lib/auth/dev-admin-bypass-cookie", () => ({
    getDevAdminBypassCookieFromHeader: (header: string | null) =>
      header && header.includes("tzudong-dev-admin") ? "fixture-dev-cookie" : null,
    validateDevAdminBypassCookie: async () => devCookieVerdict,
  }));

  try {
    const loaded = await import(`../lib/auth/require-admin?cache=${Math.random()}`) as unknown as {
      requireAdmin: RequireAdmin;
    };
    return await run(loaded.requireAdmin);
  } finally {
    mock.restore();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function setHeaders(values: Record<string, string>) {
  requestHeaders = new Headers(values);
}

function grantActiveAdmin() {
  state.user = { id: ADMIN_ID };
  state.authError = null;
  state.sessionActive = true;
  state.sessionError = null;
  state.role = { role: "admin" };
  state.roleError = null;
  state.accountStatus = { account_status: "active" };
  state.accountStatusError = null;
}

beforeEach(() => {
  state.user = null;
  state.authError = null;
  state.sessionActive = null;
  state.sessionError = null;
  state.role = null;
  state.roleError = null;
  state.accountStatus = null;
  state.accountStatusError = null;
  queriedTables.length = 0;
  clientCreations = 0;
  requestHeaders = new Headers();
  devCookieVerdict = { ok: false };
});

describe("requireAdmin fail-closed contract", () => {
  test("denies a request without a session and never reads role tables", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      state.authError = { message: "missing session" };

      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual({ error: "Unauthorized" });
      expect(queriedTables).toEqual([]);
    });
  });

  test("denies a revoked session before any role lookup", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      grantActiveAdmin();
      state.sessionActive = false;

      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(401);
      expect(queriedTables).toEqual([]);
    });
  });

  test("denies when the active-session RPC fails", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      grantActiveAdmin();
      state.sessionActive = null;
      state.sessionError = { message: "rpc unavailable" };

      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(401);
      expect(queriedTables).toEqual([]);
    });
  });

  test("denies a signed-in non-admin without naming internal tables", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      grantActiveAdmin();
      state.role = null;

      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(403);
      const body = await result.response.text();
      expect(JSON.parse(body)).toEqual({ error: "Forbidden" });
      expect(body).not.toContain("user_roles");
      expect(body).not.toContain("user_account_status");
    });
  });

  test("denies when the role lookup itself fails", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      grantActiveAdmin();
      state.role = null;
      state.roleError = { message: "permission denied" };

      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(403);
    });
  });

  test("denies an admin whose account is no longer active", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      grantActiveAdmin();
      state.accountStatus = { account_status: "suspended" };

      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(403);
      expect(queriedTables).toEqual(["user_roles", "user_account_status"]);
    });
  });

  test("denies when the account-status lookup fails", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      grantActiveAdmin();
      state.accountStatus = null;
      state.accountStatusError = { message: "unavailable" };

      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(403);
    });
  });

  test("allows an active admin and returns the session user id", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      grantActiveAdmin();

      const result = await requireAdmin();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.userId).toBe(ADMIN_ID);
      expect(queriedTables).toEqual(["user_roles", "user_account_status"]);
    });
  });

  test("honors the local E2E bypass without creating a Supabase client", async () => {
    await withRequireAdmin({ e2e: true }, async (requireAdmin) => {
      grantActiveAdmin();
      setHeaders({
        host: "localhost:3000",
        "x-e2e-admin-bypass": "1",
        "x-e2e-admin-bypass-token": "fixture-bypass-token",
      });

      const result = await requireAdmin();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.userId).toBe(E2E_BYPASS_USER_ID);
      expect(clientCreations).toBe(0);
    });
  });

  test("ignores the E2E bypass on a non-local host", async () => {
    await withRequireAdmin({ e2e: true }, async (requireAdmin) => {
      grantActiveAdmin();
      setHeaders({
        host: "evil.example.com",
        "x-e2e-admin-bypass": "1",
        "x-e2e-admin-bypass-token": "fixture-bypass-token",
      });

      const result = await requireAdmin();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.userId).toBe(ADMIN_ID);
      expect(result.userId).not.toBe(E2E_BYPASS_USER_ID);
    });
  });

  test("ignores the E2E bypass when the token does not match", async () => {
    await withRequireAdmin({ e2e: true }, async (requireAdmin) => {
      grantActiveAdmin();
      setHeaders({
        host: "127.0.0.1:3000",
        "x-e2e-admin-bypass": "1",
        "x-e2e-admin-bypass-token": "wrong-token",
      });

      const result = await requireAdmin();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.userId).toBe(ADMIN_ID);
    });
  });

  test("ignores an otherwise valid dev cookie while the bypass env is disabled", async () => {
    await withRequireAdmin({}, async (requireAdmin) => {
      devCookieVerdict = { ok: true };
      state.authError = { message: "missing session" };
      setHeaders({ host: "localhost:3000", cookie: DEV_COOKIE_HEADER });

      const result = await requireAdmin({ allowDevAdminBypassCookie: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(401);
      expect(clientCreations).toBe(1);
    });
  });

  test("ignores the dev cookie when the caller did not opt in", async () => {
    await withRequireAdmin({ e2e: true }, async (requireAdmin) => {
      devCookieVerdict = { ok: true };
      state.authError = { message: "missing session" };
      setHeaders({ host: "localhost:3000", cookie: DEV_COOKIE_HEADER });

      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(401);
    });
  });

  test("honors the dev cookie only with the env gate and the explicit option", async () => {
    await withRequireAdmin({ e2e: true }, async (requireAdmin) => {
      devCookieVerdict = { ok: true };
      setHeaders({ host: "localhost:3000", cookie: DEV_COOKIE_HEADER });

      const result = await requireAdmin({ allowDevAdminBypassCookie: true });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.userId).toBe(DEV_COOKIE_USER_ID);
      expect(clientCreations).toBe(0);
    });
  });

  test("rejects a dev cookie that the validator refuses", async () => {
    await withRequireAdmin({ e2e: true }, async (requireAdmin) => {
      devCookieVerdict = { ok: false };
      state.authError = { message: "missing session" };
      setHeaders({ host: "localhost:3000", cookie: DEV_COOKIE_HEADER });

      const result = await requireAdmin({ allowDevAdminBypassCookie: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(401);
    });
  });
});

import { describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

import {
  ADMIN_AUDIT_COVERAGE_MODE,
  ADMIN_AUDIT_PRIMARY_SOURCE,
  RESTAURANT_REQUEST_REVIEW_AUDIT_SOURCE,
  buildMutationAuditReceipt,
  getAdminAuditCoverage,
} from "../lib/admin/audit-contract";

type AuditEventsSupabaseResult = {
  data?: unknown[] | null;
  error?: unknown | null;
};

type AuditEventsQueryState = {
  functionName: string;
  args?: { p_limit?: number };
};

function createAuditEventsSupabaseMock(
  handler: (state: AuditEventsQueryState) => AuditEventsSupabaseResult,
) {
  function resolve(state: AuditEventsQueryState) {
    const result = handler(state);
    return Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
    });
  }

  return {
    rpc(functionName: string, args?: { p_limit?: number }) {
      return resolve({ functionName, args });
    },
  };
}

async function loadAuditEventsRoute(
  handler: (state: AuditEventsQueryState) => AuditEventsSupabaseResult,
) {
  mock.module("@/lib/auth/require-admin", () => ({
    requireAdmin: async () => ({ ok: true, userId: "admin-user" }),
  }));
  mock.module("@/lib/supabase/service-role", () => ({
    createSupabaseServiceRoleClient: () => createAuditEventsSupabaseMock(handler),
  }));

  const route = await import(`../app/api/admin/audit-events/route.ts?cache=${Math.random()}`);
  return route.GET as (request: NextRequest) => Promise<Response>;
}

function auditEventsRequest(path = "/api/admin/audit-events?limit=2") {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe("admin audit coverage contract", () => {
  test("describes partial domain-specific coverage without universal claims", () => {
    const coverage = getAdminAuditCoverage();

    expect(coverage.mode).toBe(ADMIN_AUDIT_COVERAGE_MODE);
    expect(coverage.strategy).toBe("truthful-partial-domain-specific");
    expect(coverage.universal).toBe(false);
    expect(coverage.label.toLowerCase()).toContain("partial");
    expect(coverage.summary.toLowerCase()).toContain("not a universal audit ledger");
    expect(coverage.remediation).toContain("dedicated audit feed");
    expect(coverage.primary).toMatchObject({
      domain: "admin_user_management",
      source: ADMIN_AUDIT_PRIMARY_SOURCE,
    });
    expect(coverage.domainSpecific).toContainEqual(
      expect.objectContaining({
        domain: "restaurant_request_reviews",
        source: RESTAURANT_REQUEST_REVIEW_AUDIT_SOURCE,
      }),
    );
  });

  test("builds stable mutation audit receipts with bounded metadata", () => {
    expect(
      buildMutationAuditReceipt({
        domain: "admin_user_management",
        source: ADMIN_AUDIT_PRIMARY_SOURCE,
        readbackId: "audit-1",
        correlationId: "correlation-1",
        auditIds: ["audit-1", null, undefined, ""],
      }),
    ).toEqual({
      domain: "admin_user_management",
      source: ADMIN_AUDIT_PRIMARY_SOURCE,
      readbackId: "audit-1",
      correlationId: "correlation-1",
      auditIds: ["audit-1"],
    });
  });

  test("returns coverage and privacy-bounded event metadata", async () => {
    try {
      let observedState: AuditEventsQueryState | null = null;
      const GET = await loadAuditEventsRoute((state) => {
        observedState = state;
        return {
          data: [
            {
              id: "audit-1",
              actor_user_id: "actor-1",
              target_user_id: "target-1",
              action: "admin_user_role_granted",
              reason: "ADMIN_USER_ROLE_GRANT_APPLIED",
              status: "applied",
              correlation_id: "correlation-1",
              applied_at: "2026-07-03T00:00:00.000Z",
              error_code: null,
              created_at: "2026-07-03T00:00:00.000Z",
              audit_counts: { updated: 1 },
              audit_flags: { roleAdmin: true },
              before_state: {},
              after_state: {},
            },
          ],
        };
      });

      const response = await GET(auditEventsRequest());
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(observedState).toMatchObject({
        functionName: "read_admin_user_audit_events",
        args: { p_limit: 2 },
      });
      expect(payload.source).toBe("admin_audit_events");
      expect(payload.unavailable).toBeNull();
      expect(payload.coverage.universal).toBe(false);
      expect(payload.coverage.mode).toBe("truthful-partial-domain-specific");
      expect(payload.coverage.primary.source).toBe("admin_audit_events");
      expect(payload.events).toHaveLength(1);
      expect(payload.events[0]).toEqual({
        id: "audit-1",
        actorUserId: "actor-1",
        targetUserId: "target-1",
        action: "admin_user_role_granted",
        status: "applied",
        reasonCode: "ADMIN_USER_ROLE_GRANT_APPLIED",
        errorCode: null,
        correlationId: "correlation-1",
        counts: { updated: 1 },
        flags: { roleAdmin: true },
        appliedAt: "2026-07-03T00:00:00.000Z",
        createdAt: "2026-07-03T00:00:00.000Z",
      });
    } finally {
      mock.restore();
    }
  });

  test("returns unavailable coverage and logs only sanitized database diagnostics", async () => {
    const originalConsoleError = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const GET = await loadAuditEventsRoute(() => ({
        error: {
          code: "42501",
          message: "permission denied for table admin_audit_events secret-token",
          details: { password: "do-not-log" },
        },
      }));

      const response = await GET(auditEventsRequest());
      const payload = await response.json();
      const logged = JSON.stringify(calls);

      expect(response.status).toBe(503);
      expect(payload.source).toBe("admin_audit_events");
      expect(payload.events).toEqual([]);
      expect(payload.unavailable.reason).toBe("admin-audit-events-read-failed");
      expect(payload.coverage.universal).toBe(false);
      expect(payload.coverage.primary.domain).toBe("admin_user_management");
      expect(logged).toContain("ADMIN_AUDIT_EVENTS_READ_FAILED");
      expect(logged).not.toContain("42501");
      expect(logged).not.toContain("secret-token");
      expect(logged).not.toContain("do-not-log");
    } finally {
      console.error = originalConsoleError;
      mock.restore();
    }
  });

  test("fails closed when the bounded audit RPC returns malformed rows", async () => {
    const originalConsoleError = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => calls.push(args);

    try {
      const GET = await loadAuditEventsRoute(() => ({
        data: [{
          id: "audit-secret-provider-body",
          action: "unknown-provider-action",
          reason: "raw-provider-secret-body",
          status: "applied",
        }],
      }));

      const response = await GET(auditEventsRequest());
      const payload = await response.json();
      const serialized = JSON.stringify({ payload, calls });

      expect(response.status).toBe(503);
      expect(payload.events).toEqual([]);
      expect(payload.unavailable.reason).toBe("admin-audit-events-read-failed");
      expect(serialized).not.toContain("audit-secret-provider-body");
      expect(serialized).not.toContain("raw-provider-secret-body");
    } finally {
      console.error = originalConsoleError;
      mock.restore();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const webRoot = path.resolve(import.meta.dir, "..");

function source(relativePath: string) {
  return readFileSync(path.join(webRoot, relativePath), "utf8");
}

describe("admin pending counts source contract", () => {
  test("evaluations submission context consumes canonical pending-counts endpoint", () => {
    const evaluationsSource = source("app/admin/evaluations/admin-evaluation-page.tsx");

    expect(evaluationsSource).toContain("fetch('/api/admin/pending-counts'");
    expect(evaluationsSource).toContain("normalizeAdminPendingCountsResponse");
    expect(evaluationsSource).toContain("canonicalPendingCounts ?? localPendingCounts");
    expect(evaluationsSource).toContain("제보/리뷰 대기: 제보");
    expect(evaluationsSource).toContain("invalidateAdminPendingCounts();");
    expect(evaluationsSource).not.toContain("fetchSupabaseExactCount");
  });

  test("pending-counts route remains the admin-gated authority for queue domains", () => {
    const routeSource = source("app/api/admin/pending-counts/route.ts");

    expect(routeSource).toContain("await requireAdmin()");
    expect(routeSource.indexOf("await requireAdmin()")).toBeLessThan(
      routeSource.indexOf("createSupabaseServiceRoleClient()"),
    );
    expect(routeSource).toContain('from("restaurant_submissions")');
    expect(routeSource).toContain('.in("status", ["pending", "partially_approved"])');
    expect(routeSource).toContain('from("reviews")');
    expect(routeSource).toContain('.eq("is_verified", false)');
    expect(routeSource).toContain('.or("admin_note.is.null,admin_note.not.ilike.%거부%")');
    expect(routeSource).toContain('from("restaurant_requests")');
    expect(routeSource).toContain('.eq("status", "pending")');
  });
});

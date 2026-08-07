import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("admin route candidate and export source contracts", () => {
  test("admin route candidates are service-role reads after requireAdmin with readback metadata", () => {
    const route = source("app/api/admin/routes/candidates/route.ts");
    const helper = source("lib/admin-route-planner.ts");
    const requireAdminIndex = route.indexOf("await requireAdmin()");
    const serviceRoleIndex = route.indexOf("createSupabaseServiceRoleClient()");

    expect(requireAdminIndex).toBeGreaterThanOrEqual(0);
    expect(serviceRoleIndex).toBeGreaterThan(requireAdminIndex);
    expect(route).toContain("ROUTE_CANDIDATE_MAX_LIMIT = 7");
    expect(route).toContain("buildAdminRouteCandidateSet");
    expect(route).toContain("candidateReadback");
    expect(helper).toContain("candidateSource");
    expect(helper).toContain("excludedNoCoordinateCount");
    expect(helper).toContain("selectedAnchorIncluded");
    expect(route).toContain(".eq('status', 'approved')");
    expect(route).toContain("lat, lng");
    expect(route).toContain("rawParts.some((part) => part.length === 0)");
    expect(route).toContain("Cache-Control', 'no-store'");
  });

  test("directions route keeps seven-point cap and durable bounded provider controls", () => {
    const route = source("app/api/admin/routes/directions/route.ts");

    expect(route).toContain("MAX_DIRECTIONS_POINTS = 7");
    expect(route).toContain("MAX_DIRECTIONS_POINT_ID_LENGTH = 96");
    expect(route).toContain("MAX_DIRECTIONS_POINT_NAME_LENGTH = 160");
    expect(route).toContain("MAX_NAVER_DIRECTIONS_RESPONSE_BYTES = 256 * 1024");
    expect(route).toContain("MAX_NAVER_DIRECTIONS_PATH_POINTS = 2_000");
    expect(route).toContain("NAVER_DIRECTIONS_OPTIONS");
    expect(route).toContain("normalizeDirectionsOption");
    expect(route).toContain("AdminDirectionsRequestBody");
    expect(route).toContain('provider: "naver_directions"');
    expect(route).toContain('redirect: "error"');
    expect(route).toContain("AbortSignal.timeout(NAVER_DIRECTIONS_PROVIDER_TIMEOUT_MS)");
    expect(route).not.toContain("adminDirectionsRateLimits");
    expect(route).not.toContain("adminDirectionsProviderCache");
    expect(route).not.toContain("toFixed(5)");
    expect(route.indexOf("await reserveAdminProviderBudget({")).toBeLessThan(
      route.indexOf("await fetch(url"),
    );
    expect(route).toContain("naver-directions-rate-limited");
    expect(route).toContain('providerCache: "miss"');
    expect(route).toContain("headers: { \"Cache-Control\": \"no-store\" }");
  });

  test("admin overview UI debounces directions and exposes Tzudong export package", () => {
    const dashboard = source("components/admin/AdminOverviewDashboard.tsx");

    expect(dashboard).toContain("fetchAdminRouteCandidates");
    expect(dashboard).toContain("/api/admin/routes/candidates");
    expect(dashboard).toContain("onViewportBboxChange");
    expect(dashboard).toContain("bbox.join(\",\")");
    expect(dashboard).toContain("debouncedRouteViewportBbox");
    expect(dashboard).toContain("window.setTimeout");
    expect(dashboard).toContain("}, 500)");
    expect(dashboard).toContain("buildAdminRouteExportPackage");
    expect(dashboard).toContain("buildAdminRoutePlainTextExport");
    expect(dashboard).toContain("data-admin-route-export=\"tzudong-json-v1\"");
    expect(dashboard).toContain("data-admin-route-provider-cache");
    expect(dashboard).toContain("data-admin-route-candidate-source");
    expect(dashboard).toContain("setDirectionsRoute(route)");
    const helper = source("lib/admin-route-planner.ts");
    expect(helper).toContain("Directions:");
    expect(helper).toContain("cache=${packageJson.directionsReadback.providerCache}");
    expect(helper).toContain("candidateReadback.candidateLimit");
    expect(helper).toContain("lines.join(\"\\n\")");
  });
});

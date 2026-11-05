import { describe, expect, test } from "bun:test";
import { fetchCompleteRestaurantRows } from "../hooks/use-restaurants";
import { handleSupabaseRestRoute } from "../tests/mobile-home-map-helpers";

// Mirror the fixture helpers' environment resolution so the requests stay
// inside the nightly allowlist: strict nightly mode admits only the
// configured loopback origins/ports.
const SUPABASE_REST_BASE = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321").origin;
const BROWSER_ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

type Captured = { status?: number; body?: string; aborted?: string };
type FixtureRow = { id: string; approved_name: string };

function makeRoute(url: string) {
  const captured: Captured = {};
  const route = {
    request: () => ({
      url: () => url,
      method: () => "GET",
      headers: () => ({ origin: BROWSER_ORIGIN }),
      postDataBuffer: () => null,
    }),
    fulfill: async (options: { status?: number; body?: string }) => {
      captured.status = options.status;
      captured.body = options.body;
    },
    abort: async (reason: string) => {
      captured.aborted = reason;
    },
  };
  return { route, captured };
}

async function serveRestaurantsRequest(query: Array<[string, string | number]>) {
  const params = new URLSearchParams(query.map(([key, value]) => [key, String(value)]));
  const { route, captured } = makeRoute(`${SUPABASE_REST_BASE}/rest/v1/restaurants?${params.toString()}`);
  await handleSupabaseRestRoute(route as never);
  if (captured.aborted) throw new Error(`fixture route aborted: ${captured.aborted}`);
  return { status: captured.status, body: JSON.parse(captured.body ?? "null") };
}

async function serveRestaurantsRows(query: Array<[string, string | number]>): Promise<FixtureRow[]> {
  const { status, body } = await serveRestaurantsRequest(query);
  if (status !== 200) throw new Error(`fixture answered ${status}`);
  return body as FixtureRow[];
}

describe("mobile home Supabase mock pagination contract", () => {
  test("complete pagination terminates on an empty page and returns every fixture once", async () => {
    let calls = 0;
    const countingFetch = async (query: Array<[string, string | number]>) => {
      calls += 1;
      return serveRestaurantsRows(query);
    };
    const rows = await fetchCompleteRestaurantRows(
      [["order", "approved_name.asc,id.asc"]],
      countingFetch,
    );
    expect(new Set(rows.map((row) => row.id))).toEqual(
      new Set(["restaurant-search", "restaurant-marker-1", "restaurant-marker-2"]),
    );
    // Three fixtures stay under the requested limit, so the second page is
    // empty and terminates the complete-fetch loop.
    expect(calls).toBe(2);
  });

  test("applies limit and offset after the existing filters", async () => {
    // lat >= 37.5664 filters the set to restaurant-search + restaurant-marker-1.
    const secondFiltered = await serveRestaurantsRows([
      ["lat", "gte.37.5664"],
      ["offset", 1],
    ]);
    expect(secondFiltered.map((row) => row.id)).toEqual(["restaurant-marker-1"]);
    // Offset 2 is empty over the two-row filtered set, while the full set has
    // three rows: pagination must see the filtered set, not all fixtures.
    const pastFiltered = await serveRestaurantsRows([
      ["lat", "gte.37.5664"],
      ["offset", 2],
    ]);
    expect(pastFiltered).toEqual([]);
    const limited = await serveRestaurantsRows([["limit", 1]]);
    expect(limited.map((row) => row.id)).toEqual(["restaurant-search"]);
  });

  test("returns an empty page when the offset passes the filtered set", async () => {
    const rows = await serveRestaurantsRows([["offset", 99]]);
    expect(rows).toEqual([]);
  });

  test("keeps returning the full filtered set when no pagination params are present", async () => {
    const rows = await serveRestaurantsRows([]);
    expect(rows).toHaveLength(3);
  });

  test("still trips the production duplicate guard when membership shifts between pages", async () => {
    const pages: FixtureRow[][] = [
      [{ id: "a", approved_name: "a" }, { id: "b", approved_name: "b" }],
      [{ id: "b", approved_name: "b" }, { id: "c", approved_name: "c" }],
    ];
    let index = 0;
    await expect(
      fetchCompleteRestaurantRows([], async () => pages[Math.min(index++, pages.length - 1)]),
    ).rejects.toThrow("restaurant_pagination_changed");
  });

  test("resolves an empty result when the first page is empty", async () => {
    await expect(
      fetchCompleteRestaurantRows([], async () => [] as FixtureRow[]),
    ).resolves.toEqual([]);
  });
});

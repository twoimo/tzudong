import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminRestaurantRefreshHistoryPanel } from "../components/admin/AdminRestaurantRefreshHistoryPanel";

const root = process.cwd();
const repoRoot = join(root, "../..");

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function repoSource(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("admin restaurant refresh history source contracts", () => {
  test("retains legacy refresh routes while mounting refresh inside restaurant management", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const sidebarOrderSource = source("lib/admin/sidebar-order.ts");
    const routeSource = source("lib/admin/admin-module-routing.ts");

    expect(routeSource).toContain('"restaurant-refresh-history"');
    expect(consoleSource).toContain('title: "맛집 최신화"');
    expect(consoleSource).toContain(
      'href: "/admin?module=restaurant-refresh-history"',
    );
    expect(consoleSource).toContain("AdminRestaurantRefreshHistoryModule");
    expect(consoleSource).toContain('case "restaurant-refresh-history"');
    expect(sidebarOrderSource).not.toContain('"restaurant-refresh-history"');
    expect(sidebarOrderSource).toContain(
      '검수: ["restaurants", "submissions", "reviews"]',
    );
  });

  test("panel keeps refresh workflow history-first and operator guarded", () => {
    const panelSource = source(
      "components/admin/AdminRestaurantRefreshHistoryPanel.tsx",
    );

    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-history="true"',
    );
    expect(panelSource).toContain(
      'data-admin-embedded-module-shell="true"',
    );
    expect(panelSource).toContain(
      'data-admin-embedded-module-id="restaurant-refresh-history"',
    );
    expect(panelSource).toContain('data-admin-module-header="compact"');
    expect(panelSource).toContain(
      'data-admin-module-header-module="restaurant-refresh-history"',
    );
    expect(panelSource).toContain('data-admin-module-summary="true"');
    expect(panelSource).toContain('data-admin-module-actions="top-right"');
    expect(panelSource).toContain('data-admin-module-content="bounded"');
    expect(panelSource).not.toContain(
      'data-admin-restaurant-refresh-headerless="true"',
    );
    expect(panelSource).not.toMatch(
      /<h1[\s\S]*?>[\s\S]*?맛집 최신화[\s\S]*?<\/h1>/,
    );
    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-management-structure="header-list-detail"',
    );
    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-list="management-like"',
    );
    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-detail="management-like"',
    );
    expect(panelSource).toContain("왼쪽 목록에서 후보를 선택하세요");
    expect(panelSource).toContain("운영자 결정 기록");
    expect(panelSource).toContain("결정 저장");
    expect(panelSource).toContain("function isClosureCandidate");
    expect(panelSource).toContain(
      "폐업 의심 후보는 네이버 미검색 신호일 뿐 폐업 확정이",
    );
    expect(panelSource).toContain("disabled={!canApplySelectedCandidate}");
    expect(panelSource).toContain("function reviewChecklistForCandidate");
    expect(panelSource).toContain(
      "주소/이전: 도로명·지번·좌표·주변 가게/거리 단서를 영상·지도 리뷰 이미지와 교차 확인",
    );
    expect(panelSource).toContain(
      "readbackLabel(selectedCandidate.readback_state)",
    );
    expect(panelSource).toContain(
      'data-admin-restaurant-refresh-evidence-summary="true"',
    );
    expect(panelSource).toContain("function evidenceText");
    expect(panelSource).toContain("출처 미기록");
    expect(panelSource).toContain("snapshotText(");
    expect(panelSource).toContain('"road_address"');
    expect(panelSource).toContain("selectedCandidate.previous_snapshot,");
    expect(panelSource).toContain('"jibun_address"');
    expect(panelSource).toContain("selectedCandidate.candidate_snapshot,");
  });

  test("panel renders inside the compact embedded module shell without the old h1 title", () => {
    const html = renderToStaticMarkup(
      createElement(AdminRestaurantRefreshHistoryPanel),
    );

    expect(html).toContain('data-admin-embedded-module-shell="true"');
    expect(html).toContain(
      'data-admin-embedded-module-id="restaurant-refresh-history"',
    );
    expect(html).toContain('data-admin-module-header="compact"');
    expect(html).toContain(
      'data-admin-module-header-module="restaurant-refresh-history"',
    );
    expect(html).toContain('data-admin-module-summary="true"');
    expect(html).toContain('data-admin-module-actions="top-right"');
    expect(html).toContain('data-admin-module-content="bounded"');
    expect(html).not.toContain('data-admin-restaurant-refresh-headerless="true"');
    expect(html).toContain('aria-labelledby="admin-restaurant-refresh-history-title"');
    expect(html).not.toMatch(/<h1[\s\S]*?>[\s\S]*?맛집 최신화[\s\S]*?<\/h1>/);
  });

  test("admin API is admin gated, no-store, and separates record from guarded apply", () => {
    const routeSource = source(
      "app/api/admin/restaurant-refresh-history/route.ts",
    );

    expect(routeSource).toContain("import { requireAdmin }");
    expect(routeSource).toContain("createSupabaseServiceRoleClient");
    expect(routeSource).toContain('if (!auth.ok) { auth.response.headers.set("Cache-Control", "no-store"); return auth.response; }');
    expect(routeSource).toContain('action === "record_candidate"');
    expect(routeSource).toContain('action === "decide_candidate"');
    expect(routeSource).toContain("body.apply === true");
    expect(routeSource).toContain("detected_change_types, candidate_snapshot");
    expect(routeSource).toContain("function hasClosureChange");
    expect(routeSource).toContain(
      "폐업 의심 후보는 자동 guarded apply 대상이 아닙니다.",
    );
    expect(routeSource).toContain("function hasMaterialRestaurantPatch");
    expect(routeSource).toContain("type ReadbackRunRow");
    expect(routeSource).toContain("function readbackStateForCandidate");
    expect(routeSource).toContain(
      "fetchReadbackRunMap(supabase, candidateRows)",
    );
    expect(routeSource).toContain("readback_state: readbackStateForCandidate(");
    expect(routeSource).toContain("readbackRunMap.get(candidate.id)");
    expect(routeSource).toContain('.eq("status", "approved")');
    expect(routeSource).toContain('"apply_restaurant_refresh_candidate"');
    expect(routeSource).not.toContain('.update(patch)');
    expect(routeSource).toContain('"Cache-Control": "no-store"');
    expect(routeSource).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE");
  });

  test("migration stores immutable refresh runs/candidates with RLS and explicit grants", () => {
    const migrationSource = repoSource(
      "backend/supabase/migrations/20260531105250_restaurant_refresh_history.sql",
    );

    expect(migrationSource).toContain(
      "CREATE TABLE IF NOT EXISTS public.restaurant_refresh_runs",
    );
    expect(migrationSource).toContain(
      "CREATE TABLE IF NOT EXISTS public.restaurant_refresh_candidates",
    );
    expect(migrationSource).toContain("previous_snapshot jsonb NOT NULL");
    expect(migrationSource).toContain("candidate_snapshot jsonb NOT NULL");
    expect(migrationSource).toContain("candidate_status IN");
    expect(migrationSource).toContain(
      "ALTER TABLE public.restaurant_refresh_runs ENABLE ROW LEVEL SECURITY",
    );
    expect(migrationSource).toContain(
      "ALTER TABLE public.restaurant_refresh_candidates ENABLE ROW LEVEL SECURITY",
    );
    expect(migrationSource).toContain(
      "GRANT SELECT, INSERT, UPDATE ON public.restaurant_refresh_runs TO authenticated",
    );
    expect(migrationSource).toContain(
      "GRANT SELECT, INSERT, UPDATE ON public.restaurant_refresh_candidates TO authenticated",
    );
    expect(migrationSource).toContain("public.is_user_admin(auth.uid())");
    expect(migrationSource).toContain(
      "restaurant_refresh_candidates_change_types_gin_idx",
    );
  });
});

const panelSource = source("components/admin/AdminRestaurantRefreshHistoryPanel.tsx");
const helperSource = panelSource.slice(panelSource.indexOf("function canDecideRefreshCandidate"), panelSource.indexOf("function RefreshCandidateListSkeleton"));
const handlerSource = panelSource.slice(panelSource.indexOf("  const loadHistory"), panelSource.indexOf("  useEffect(() => {\n    void loadHistory();"));

type TestCandidate = {
  id: string; restaurant_id: string; candidate_status: string; detected_change_types: string[];
  decided_at: string | null; applied_at: string | null; readback_state: { status: string };
};
type HarnessOptions = {
  candidate?: TestCandidate; latestStatus?: string; decision?: string; apply?: boolean; notes?: string;
  busy?: boolean; loading?: boolean; error?: string; networkFailure?: boolean;
  response?: { ok: boolean; payload: unknown };
};
const candidate = (status = "needs_review", changes = ["name"]): TestCandidate => ({ id: "synthetic-candidate", restaurant_id: "synthetic-restaurant", candidate_status: status, detected_change_types: changes, decided_at: null, applied_at: null, readback_state: { status: "not_required" } });
const createHarness = new Function(new Bun.Transpiler({ loader: "ts" }).transformSync(`
${helperSource}
function isClosureCandidate(candidate) { return candidate?.detected_change_types.includes("closure"); }
return (options) => {
  let selectedCandidate = options.candidate ?? { id: "synthetic-candidate", restaurant_id: "synthetic-restaurant", candidate_status: "needs_review", detected_change_types: ["name"], decided_at: null, applied_at: null, readback_state: { status: "not_required" } };
  let decision = options.decision ?? "approved";
  let applyApprovedChange = options.apply ?? false;
  let operatorNotes = options.notes ?? "";
  let pendingSelection = null;
  let pendingReadback = null;
  let readbackConflict = false;
  const pendingReadbackRef = { current: null };
  const readGeneration = { current: 0 };
  let decisionMessage = null;
  let isSavingDecision = options.busy ?? false;
  let isLoading = options.loading ?? false;
  let error = options.error ?? null;
  let data = { candidates: [{ ...selectedCandidate, candidate_status: options.latestStatus ?? selectedCandidate.candidate_status }] };
  const rowTriggerRef = { current: null };
  const saveInFlight = { current: isSavingDecision };
  let query = "";
  let statusFilter = "all";
  let reloads = 0;
  let exactRows = null;
  let focusCount = 0;
  let readRows = data.candidates;
  let readError = false;
  let nextReadWait = null;
  const writes = [];
  const readUrls = [];
  const useCallback = callback => callback;
  const requestAnimationFrame = callback => callback();
  const document = { getElementById: () => ({ focus: () => { focusCount += 1; } }) };
  const setSelectedCandidate = value => { selectedCandidate = typeof value === "function" ? value(selectedCandidate) : value; };
  const setData = value => { data = value; };
  const setIsLoading = value => { isLoading = value; };
  const setError = value => { error = value; };
  const setDecision = value => { decision = value; };
  const setApplyApprovedChange = value => { applyApprovedChange = value; };
  const setOperatorNotes = value => { operatorNotes = value; };
  const setPendingSelection = value => { pendingSelection = value; };
  const setPendingReadback = value => { pendingReadback = value; };
  const setReadbackConflict = value => { readbackConflict = value; };
  const setSearchInput = () => {};
  const setQuery = value => { query = value; };
  const setStatusFilter = value => { statusFilter = value; };
  const setDecisionMessage = value => { decisionMessage = value; };
  const setIsSavingDecision = value => { isSavingDecision = value; };
  const fetch = async (url, init) => {
    if (init?.method !== "POST") {
      reloads += 1;
      readUrls.push(url);
      const exact = new URL(url, "http://fixture.test").searchParams.has("candidate_id");
      const payload = JSON.parse(JSON.stringify({ candidates: exact ? exactRows ?? readRows : readRows, summary: {} }));
      const wait = nextReadWait;
      nextReadWait = null;
      if (wait) await wait;
      return { ok: !readError, json: async () => payload };
    }
    writes.push({ url, ...JSON.parse(init.body) });
    if (options.networkFailure) throw new Error("synthetic_response_lost");
    return { ok: options.response?.ok ?? true, json: async () => options.response?.payload ?? { ok: true, candidate_status: decision === "approved" && applyApprovedChange ? "applied" : decision } };
  };
  ${handlerSource}
  return {
    requestSelection, applySelection, submitDecision, loadHistory, canSave,
    setReadRows: rows => { readRows = rows; },
    setExactRows: rows => { exactRows = rows; },
    setReadError: value => { readError = value; },
    setFilters: (status, search) => { statusFilter = status; query = search; },
    deferNextRead: () => { let release; nextReadWait = new Promise(resolve => { release = resolve; }); return release; },
    state: () => ({ selectedCandidate, decision, applyApprovedChange, operatorNotes, pendingSelection, pendingReadback, readbackConflict, decisionMessage, isSavingDecision, writes, reloads, readUrls, focusCount, query, statusFilter })
  };
};`))() as (options: HarnessOptions) => {
  requestSelection: (candidate: TestCandidate | null) => void;
  applySelection: (candidate: TestCandidate | null) => void;
  submitDecision: () => Promise<void>;
  loadHistory: () => Promise<void>;
  setReadRows: (rows: TestCandidate[]) => void;
  setExactRows: (rows: TestCandidate[]) => void;
  setReadError: (value: boolean) => void;
  setFilters: (status: string, query: string) => void;
  deferNextRead: () => () => void;
  canSave: boolean;
  state: () => { selectedCandidate: TestCandidate | null; decision: string; applyApprovedChange: boolean; operatorNotes: string; pendingSelection: { candidate: TestCandidate | null } | null; pendingReadback: { expectedStatus: string } | null; readbackConflict: boolean; decisionMessage: string | null; isSavingDecision: boolean; writes: Record<string, unknown>[]; reloads: number; readUrls: string[]; focusCount: number; query: string; statusFilter: string };
};

describe("refresh history CMS behavior", () => {
  test("completed records remain selectable without a mutation path", async () => {
    for (const status of ["approved", "rejected", "applied", "superseded"]) {
      const historyRow = { ...candidate(status), id: "history-row" };
      const harness = createHarness({ candidate: candidate(status) });
      harness.requestSelection(historyRow);
      expect(harness.state().selectedCandidate).toEqual(historyRow);
      await harness.submitDecision();
      expect(harness.state().writes).toHaveLength(0);
    }
  });

  test("stale, loading, failed-read, busy and closure-apply candidates cannot write", async () => {
    for (const options of [{ latestStatus: "applied" }, { loading: true }, { error: "read_failed" }, { busy: true }, { candidate: candidate("needs_review", ["closure"]), apply: true }]) {
      const harness = createHarness(options);
      await harness.submitDecision();
      expect(harness.state().writes).toHaveLength(0);
    }
  });

  test("notes, decision and apply changes survive selection or close until explicit discard", () => {
    const next = { ...candidate("applied"), id: "synthetic-next" };
    for (const options of [{ notes: "검토 중인 메모" }, { decision: "rejected" }, { apply: true }, { candidate: candidate("applied"), notes: "새로고침 전에 작성한 메모" }]) {
      for (const destination of [next, null]) {
        const harness = createHarness(options);
        const before = harness.state();
        harness.requestSelection(destination);
        expect(harness.state().selectedCandidate).toEqual(before.selectedCandidate);
        expect(harness.state().operatorNotes).toBe(before.operatorNotes);
        expect(harness.state().decision).toBe(before.decision);
        expect(harness.state().applyApprovedChange).toBe(before.applyApprovedChange);
        expect(harness.state().pendingSelection?.candidate).toEqual(destination);
        harness.applySelection(destination);
        expect(harness.state().selectedCandidate).toEqual(destination);
        expect(harness.state().operatorNotes).toBe("");
        expect(harness.state().pendingSelection).toBeNull();
      }
    }
  });

  test("same-row selection preserves draft and saving prevents selection or discard", () => {
    const harness = createHarness({ notes: "보존할 메모" });
    harness.requestSelection(candidate());
    expect(harness.state().operatorNotes).toBe("보존할 메모");
    expect(harness.state().pendingSelection).toBeNull();
    const busy = createHarness({ notes: "저장 중 메모", busy: true });
    busy.requestSelection(null);
    busy.applySelection(null);
    expect(busy.state().selectedCandidate).not.toBeNull();
    expect(busy.state().operatorNotes).toBe("저장 중 메모");
  });

  test("approved apply preserves request body and closes after the expected receipt", async () => {
    const harness = createHarness({ apply: true, notes: "합성 확인 메모" });
    await harness.submitDecision();
    expect(harness.state().writes).toEqual([{ url: "/api/admin/restaurant-refresh-history", action: "decide_candidate", candidate_id: "synthetic-candidate", decision: "approved", apply: true, operator_notes: "합성 확인 메모" }]);
    expect(harness.state().selectedCandidate).toBeNull();
    expect(harness.state().reloads).toBe(1);
    expect(harness.state().focusCount).toBe(1);
  });

  test("unconfirmed receipts retain the draft without automatic retry or false success", async () => {
    for (const response of [{ ok: true, payload: { ok: true, candidate_status: "approved" } }, { ok: false, payload: { error: "provider detail must not surface" } }]) {
      const harness = createHarness({ apply: true, notes: "보존할 메모", response });
      await harness.submitDecision();
      expect(harness.state().writes).toHaveLength(1);
      expect(harness.state().reloads).toBe(0);
      expect(harness.state().selectedCandidate).not.toBeNull();
      expect(harness.state().operatorNotes).toBe("보존할 메모");
      expect(harness.state().decisionMessage).not.toContain("provider detail");
      expect(harness.state().decisionMessage).toContain("확인하지 못했습니다");
    }
  });
});

const decidedCandidate = (status = "approved"): TestCandidate => ({ ...candidate(status), decided_at: "2026-10-05T01:00:00Z", applied_at: status === "applied" ? "2026-10-05T01:00:00Z" : null, readback_state: { status: status === "applied" ? "pending" : "not_required" } });

describe("refresh uncertain mutation readback", () => {
  test("lost response, server failure and malformed success lock retransmission and selection", async () => {
    for (const options of [{ networkFailure: true }, { response: { ok: false, payload: { error: "synthetic_failure" } } }, { response: { ok: true, payload: { ok: true, candidate_status: "rejected" } } }]) {
      const harness = createHarness({ ...options, notes: "보존할 메모" });
      await harness.submitDecision();
      await harness.submitDecision();
      harness.requestSelection({ ...candidate(), id: "other-candidate" });
      harness.applySelection(null);
      expect(harness.state().writes).toHaveLength(1);
      expect(harness.state().pendingReadback?.expectedStatus).toBe("approved");
      expect(harness.state().selectedCandidate?.id).toBe("synthetic-candidate");
      expect(harness.state().operatorNotes).toBe("보존할 메모");
      expect(harness.state().reloads).toBe(0);
    }
  });

  test("missing row, unchanged status, incomplete application and failed GET cannot unlock", async () => {
    const harness = createHarness({ networkFailure: true, apply: true });
    await harness.submitDecision();
    for (const rows of [[], [candidate()], [{ ...decidedCandidate("applied"), id: "different" }], [{ ...decidedCandidate("applied"), applied_at: null }], [{ ...decidedCandidate("applied"), decided_at: null }], [{ ...decidedCandidate("applied"), readback_state: { status: "not_required" } }]]) {
      harness.setReadRows(rows);
      await harness.loadHistory();
      expect(harness.state().pendingReadback).not.toBeNull();
      await harness.submitDecision();
      expect(harness.state().writes).toHaveLength(1);
    }
    harness.setReadRows([decidedCandidate("applied")]);
    harness.setReadError(true);
    await harness.loadHistory();
    expect(harness.state().pendingReadback).not.toBeNull();
  });

  test("a different terminal decision or restaurant identity reports conflict and stays locked", async () => {
    for (const actual of [decidedCandidate("rejected"), { ...decidedCandidate(), restaurant_id: "different-restaurant" }]) {
      const harness = createHarness({ networkFailure: true });
      await harness.submitDecision();
      harness.setReadRows([actual]);
      await harness.loadHistory();
      expect(harness.state().readbackConflict).toBe(true);
      expect(harness.state().pendingReadback).not.toBeNull();
      harness.applySelection(null);
      await harness.submitDecision();
      expect(harness.state().selectedCandidate).not.toBeNull();
      expect(harness.state().writes).toHaveLength(1);
    }
  });

  test("only a GET started after the mutation can confirm the expected state", async () => {
    const harness = createHarness({ networkFailure: true });
    harness.setReadRows([decidedCandidate()]);
    const release = harness.deferNextRead();
    const oldRead = harness.loadHistory();
    await harness.submitDecision();
    release();
    await oldRead;
    expect(harness.state().pendingReadback).not.toBeNull();
    await harness.loadHistory();
    expect(harness.state().pendingReadback).toBeNull();
    expect(harness.state().selectedCandidate?.candidate_status).toBe("approved");
    await harness.submitDecision();
    expect(harness.state().writes).toHaveLength(1);
  });

  test("fresh GET confirms exact decision/apply while preserving recrawl pending or failed semantics", async () => {
    for (const expected of ["approved", "rejected", "superseded", "applied"]) {
      const harness = createHarness({ networkFailure: true, decision: expected === "applied" ? "approved" : expected, apply: expected === "applied" });
      await harness.submitDecision();
      harness.setFilters("needs_review", "old restaurant name");
      const actual = decidedCandidate(expected);
      if (expected === "applied") actual.readback_state.status = "failed";
      harness.setReadRows([actual]);
      await harness.loadHistory();
      expect(harness.state().readUrls).toEqual(["/api/admin/restaurant-refresh-history?status=needs_review&search=old+restaurant+name", "/api/admin/restaurant-refresh-history?candidate_id=synthetic-candidate"]);
      expect(harness.state().pendingReadback).toBeNull();
      expect(harness.state().selectedCandidate?.readback_state.status).toBe(actual.readback_state.status);
      expect(harness.state().writes).toHaveLength(1);
      harness.requestSelection(null);
      expect(harness.state().selectedCandidate).toBeNull();
    }
  });

  test("a previously observed decision/apply timestamp is not accepted as a new outcome", async () => {
    const previous = { ...candidate(), decided_at: "2026-10-04T01:00:00Z", applied_at: "2026-10-04T01:00:00Z" };
    const harness = createHarness({ candidate: previous, networkFailure: true, apply: true });
    await harness.submitDecision();
    harness.setReadRows([{ ...decidedCandidate("applied"), decided_at: previous.decided_at, applied_at: previous.applied_at }]);
    await harness.loadHistory();
    expect(harness.state().pendingReadback).not.toBeNull();
  });
});

test("pending candidate outside newest100 is read exactly without changing the list filter", async () => {
 const harness=createHarness({networkFailure:true});
 await harness.submitDecision();harness.setFilters("needs_review","old name");
 harness.setReadRows(Array.from({length:100},(_,i)=>({...candidate(),id:`newer-${i}`})));
 harness.setExactRows([decidedCandidate("approved")]);
 await harness.loadHistory();
 expect(harness.state().pendingReadback).toBeNull();expect(harness.state().selectedCandidate?.candidate_status).toBe("approved");
 expect(harness.state().readUrls).toEqual(["/api/admin/restaurant-refresh-history?status=needs_review&search=old+name","/api/admin/restaurant-refresh-history?candidate_id=synthetic-candidate"]);
 expect(harness.state().query).toBe("old name");expect(harness.state().statusFilter).toBe("needs_review");expect(harness.state().writes).toHaveLength(1);
});

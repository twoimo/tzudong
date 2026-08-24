import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HOSTED_APPLY_BFF_AVAILABLE,
  OPS_READBACK_MISSING,
  countHumanVideoReviewQueue,
  formatHostedApplyPreviewHash,
  formatPipelineJobPosition,
} from "../lib/admin/ops-readback";
import { isAdminEvaluationRecordReadyForApproval } from "../lib/admin/evaluation-records";

const root = process.cwd();

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const readyRecord = {
  status: "pending" as const,
  is_missing: false,
  is_not_selected: false,
  geocoding_success: true,
  evaluation_results: {
    visit_authenticity: { eval_value: 1 },
    rb_inference_score: { eval_value: 1 },
    rb_grounding_TF: { eval_value: true },
    review_faithfulness_score: { eval_value: 1 },
    category_validity_TF: { eval_value: true },
    category_TF: { eval_value: true },
  },
};

describe("admin restaurants ops readback strip", () => {
  test("job position reuses pipeline GET and missing stays empty", () => {
    expect(formatPipelineJobPosition(undefined)).toBe(OPS_READBACK_MISSING);
    expect(formatPipelineJobPosition({ jobs: [] })).toBe(OPS_READBACK_MISSING);
    expect(
      formatPipelineJobPosition({
        jobs: [{ status: "Fetching", target: "tzuyang", adapter_index: 8 }],
      }),
    ).toBe("tzuyang / Fetching / step 8");
  });

  test("hosted apply hash stays missing without a requireAdmin BFF", () => {
    expect(HOSTED_APPLY_BFF_AVAILABLE).toBe(false);
    expect(formatHostedApplyPreviewHash("a".repeat(64))).toBe(OPS_READBACK_MISSING);
    expect(formatHostedApplyPreviewHash(null)).toBe(OPS_READBACK_MISSING);
  });

  test("human review count uses ready-for-approval, not pending-counts", () => {
    expect(countHumanVideoReviewQueue([readyRecord])).toBe(1);
    expect(
      countHumanVideoReviewQueue([
        readyRecord,
        { ...readyRecord, status: "approved" },
        { ...readyRecord, evaluation_results: null },
      ]),
    ).toBe(1);
    expect(isAdminEvaluationRecordReadyForApproval(readyRecord)).toBe(true);
    const helper = source("lib/admin/ops-readback.ts");
    expect(helper).toContain("isAdminEvaluationRecordReadyForApproval");
    expect(helper).not.toContain("pending-counts");
    expect(helper).not.toContain("getAdminPendingCountsTotal");
  });

  test("restaurants canvas mounts the strip and keeps apply disabled", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const stripSource = source("components/admin/AdminOpsReadbackStrip.tsx");
    expect(consoleSource).toContain("import { AdminOpsReadbackStrip }");
    expect(consoleSource).toContain('case "restaurants":');
    expect(consoleSource).toContain("<AdminOpsReadbackStrip />");
    expect(consoleSource).toContain('key="restaurants"');
    expect(consoleSource).not.toContain("08-chunk");
    expect(consoleSource).not.toContain("03-2-visual");
    expect(consoleSource).not.toContain("11-laaj");
    expect(stripSource).toContain('data-admin-ops-crawl-start="true"');
    expect(stripSource).toContain('data-admin-ops-hosted-apply="true"');
    expect(stripSource).toContain("disabled");
    expect(stripSource).toContain('phase: "preview"');
    expect(stripSource).toContain('phase: "apply"');
    expect(stripSource).toContain('action: "enqueue"');
    expect(stripSource).toContain("/api/admin/pipeline");
    expect(stripSource).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(stripSource).not.toContain("hosted_data_plane");
    expect(stripSource).not.toContain("08-chunk");
  });
});

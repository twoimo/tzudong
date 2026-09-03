import { sha256Hex } from "@/lib/admin/sha256-hex";
import type { AdminConsoleMenuId } from "@/lib/admin/console-menu-registry";

export const RISKY_WORK_STEPS = [
  "미리보기",
  "확인",
  "적용",
  "재확인",
  "감사 기록",
] as const;

export const RISKY_WORK_FORBIDDEN_STEP_NAMES = [
  "사전 검토",
  "승인",
  "반영",
  "검증",
  "로그",
] as const;

export const RISKY_WORK_PREVIEW_TTL_SECONDS = 600;
export const RISKY_WORK_TARGET_LIMIT = 50;
export const RISKY_WORK_MISMATCH_LIMIT = 3;

export const RISKY_WORK_MENU_IDS = [
  "restaurants",
  "submissions",
  "reviews",
  "users",
  "banners",
  "map-overlays",
  "routes",
  "pipeline",
] as const;

export type RiskyWorkMenuId = (typeof RISKY_WORK_MENU_IDS)[number];
export type RiskyWorkStep = (typeof RISKY_WORK_STEPS)[number];

export type RiskyWorkPreview = {
  previewHash: string;
  totalCount: number;
  targets: string[];
  expiresAt: string;
  intent: string;
  targetStateHash: string;
};

export type RiskyWorkReadback = {
  previewHash: string;
  appliedCount: number;
  targets: string[];
  operationId: string;
};

export type RiskyWorkAuditRecord = {
  operationId: string;
  targetId: string;
  status: "applied" | "failed";
  utcAt: string;
  previewHash: string;
  errorCode?: string;
};

export type RiskyWorkApplySuccess = {
  ok: true;
  readback: RiskyWorkReadback;
  duplicate: boolean;
  audits: readonly RiskyWorkAuditRecord[];
};

export type RiskyWorkApplyFailure = {
  ok: false;
  code: "ADMIN_CONFIRMATION_MISMATCH" | "ADMIN_PREVIEW_STALE";
  requireNewPreview: boolean;
};

function sortedTargets(targetIds: readonly string[]): string[] {
  return [...targetIds]
    .filter((id) => id.length > 0)
    .sort()
    .slice(0, RISKY_WORK_TARGET_LIMIT);
}

export function isRiskyWorkMenuId(
  value: string,
): value is RiskyWorkMenuId {
  return (RISKY_WORK_MENU_IDS as readonly string[]).includes(value);
}

export function buildRiskyWorkPreviewHash(input: {
  menuId: AdminConsoleMenuId | RiskyWorkMenuId;
  intent: string;
  targetIds: readonly string[];
}): string {
  return sha256Hex(
    JSON.stringify({
      menuId: input.menuId,
      intent: input.intent,
      targetIds: sortedTargets(input.targetIds),
    }),
  );
}

export function buildRiskyWorkTargetStateHash(
  targetIds: readonly string[],
): string {
  return sha256Hex(JSON.stringify(sortedTargets(targetIds)));
}

export function createEmptyRiskyWorkConfirmation(): string {
  return "";
}

type StoredPreview = {
  preview: RiskyWorkPreview;
  mismatches: number;
  readback: RiskyWorkReadback | null;
  audits: RiskyWorkAuditRecord[];
};

export function createRiskyWorkProcedure(now: () => number = () => Date.now()) {
  const previews = new Map<string, StoredPreview>();

  function createPreview(input: {
    menuId: AdminConsoleMenuId | RiskyWorkMenuId;
    intent: string;
    targetIds: readonly string[];
  }): RiskyWorkPreview {
    const targets = sortedTargets(input.targetIds);
    const previewHash = buildRiskyWorkPreviewHash({
      menuId: input.menuId,
      intent: input.intent,
      targetIds: targets,
    });
    const preview: RiskyWorkPreview = {
      previewHash,
      totalCount: Math.max(0, input.targetIds.length),
      targets,
      expiresAt: new Date(
        now() + RISKY_WORK_PREVIEW_TTL_SECONDS * 1000,
      ).toISOString(),
      intent: input.intent,
      targetStateHash: buildRiskyWorkTargetStateHash(input.targetIds),
    };
    previews.set(previewHash, {
      preview,
      mismatches: 0,
      readback: null,
      audits: [],
    });
    return preview;
  }

  function apply(input: {
    previewHash: string;
    confirmation: string;
    expectedConfirmation: string;
    currentTargetIds: readonly string[];
    applyFn: () => { appliedCount: number; targets: string[] };
  }): RiskyWorkApplySuccess | RiskyWorkApplyFailure {
    const entry = previews.get(input.previewHash);
    if (!entry) {
      return {
        ok: false,
        code: "ADMIN_PREVIEW_STALE",
        requireNewPreview: true,
      };
    }
    if (now() >= Date.parse(entry.preview.expiresAt)) {
      previews.delete(input.previewHash);
      return {
        ok: false,
        code: "ADMIN_PREVIEW_STALE",
        requireNewPreview: true,
      };
    }
    if (entry.readback) {
      return {
        ok: true,
        readback: entry.readback,
        duplicate: true,
        audits: entry.audits,
      };
    }
    if (input.confirmation !== input.expectedConfirmation) {
      entry.mismatches += 1;
      if (entry.mismatches >= RISKY_WORK_MISMATCH_LIMIT) {
        previews.delete(input.previewHash);
      }
      return {
        ok: false,
        code: "ADMIN_CONFIRMATION_MISMATCH",
        requireNewPreview: entry.mismatches >= RISKY_WORK_MISMATCH_LIMIT,
      };
    }
    if (
      buildRiskyWorkTargetStateHash(input.currentTargetIds) !==
      entry.preview.targetStateHash
    ) {
      previews.delete(input.previewHash);
      return {
        ok: false,
        code: "ADMIN_PREVIEW_STALE",
        requireNewPreview: true,
      };
    }

    const applied = input.applyFn();
    const operationId = sha256Hex(
      `${entry.preview.previewHash}:${now()}`,
    ).slice(0, 32);
    const utcAt = new Date(now()).toISOString();
    const readback: RiskyWorkReadback = {
      previewHash: entry.preview.previewHash,
      appliedCount: applied.appliedCount,
      targets: applied.targets.slice(0, RISKY_WORK_TARGET_LIMIT),
      operationId,
    };
    const audits: RiskyWorkAuditRecord[] = applied.targets
      .slice(0, RISKY_WORK_TARGET_LIMIT)
      .map((targetId) => ({
        operationId,
        targetId,
        status: "applied" as const,
        utcAt,
        previewHash: entry.preview.previewHash,
      }));
    entry.readback = readback;
    entry.audits = audits;
    return { ok: true, readback, duplicate: false, audits };
  }

  function recordFailure(input: {
    previewHash: string;
    operationId: string;
    targetId: string;
    errorCode: string;
  }): RiskyWorkAuditRecord | null {
    const entry = previews.get(input.previewHash);
    if (!entry) return null;
    const record: RiskyWorkAuditRecord = {
      operationId: input.operationId,
      targetId: input.targetId,
      status: "failed",
      utcAt: new Date(now()).toISOString(),
      previewHash: input.previewHash,
      errorCode: input.errorCode,
    };
    entry.audits.push(record);
    return record;
  }

  return {
    createPreview,
    apply,
    recordFailure,
  };
}

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONSOLE_FIXED_MESSAGES } from "../lib/admin/console-messages";
import {
  CONSOLE_BAR_END_RADIUS_PX,
  CONSOLE_HAIRLINE_WIDTH_PX,
  CONSOLE_META_ROW_FONT_SIZE_PX,
  CONSOLE_META_ROW_MIN_HEIGHT_PX,
  CONSOLE_RADIUS_SCALE,
  CONSOLE_STATUS_ROLES,
  CONSOLE_STATUS_TOKENS,
  CONSOLE_TONE_STEPS,
  getBarEndRadius,
} from "../lib/admin/console-tone-scale";

const toneSource = readFileSync(
  join(import.meta.dir, "../lib/admin/console-tone-scale.ts"),
  "utf8",
);

describe("admin console tone constants", () => {
  test("exposes six tone steps, three status roles, and three radius steps", () => {
    expect(CONSOLE_TONE_STEPS).toHaveLength(6);
    expect(CONSOLE_STATUS_ROLES).toEqual(["오류", "경고", "성공"]);
    expect(CONSOLE_RADIUS_SCALE.card).toBe(24);
    expect(CONSOLE_RADIUS_SCALE.control).toBe(12);
    expect(CONSOLE_RADIUS_SCALE.pill).toBe("999px");
    expect(CONSOLE_HAIRLINE_WIDTH_PX).toBe(1);
    expect(CONSOLE_BAR_END_RADIUS_PX).toBe(4);
    expect(CONSOLE_META_ROW_FONT_SIZE_PX).toBe(11);
    expect(CONSOLE_META_ROW_MIN_HEIGHT_PX).toBe(16);

    expect(CONSOLE_STATUS_TOKENS.오류.token).toBe("--destructive");
    expect(CONSOLE_STATUS_TOKENS.경고.token).toBeNull();
    expect(CONSOLE_STATUS_TOKENS.성공.token).toBeNull();
    const assignedTokens = Object.values(CONSOLE_STATUS_TOKENS).filter(
      (assignment) => assignment.token !== null,
    );
    expect(assignedTokens).toHaveLength(1);
    expect(
      Object.values(CONSOLE_STATUS_TOKENS).filter(
        (assignment) => assignment.token === null,
      ).length,
    ).toBeLessThanOrEqual(2);

    expect(toneSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(toneSource).not.toMatch(/\brgba?\(/);
    expect(toneSource).not.toMatch(/hsl\(\s*\d/);
  });

  test("shrinks bar end radius when thickness is below twice the default", () => {
    expect(getBarEndRadius(0)).toBe(0);
    expect(getBarEndRadius(7)).toBe(3.5);
    expect(getBarEndRadius(8)).toBe(4);
    expect(getBarEndRadius(9)).toBe(4);
    expect(getBarEndRadius(CONSOLE_BAR_END_RADIUS_PX * 2 - 0.1)).toBeCloseTo(
      (CONSOLE_BAR_END_RADIUS_PX * 2 - 0.1) / 2,
    );
  });

  test("keeps fixed Korean console messages without model-generation certainty words", () => {
    expect(CONSOLE_FIXED_MESSAGES.dataFetchFailed.length).toBeGreaterThan(0);
    expect(CONSOLE_FIXED_MESSAGES.legacyLinkNormalized).toBe(
      "기존 검수 링크를 새 관리자 경로로 정리했습니다.",
    );
    expect(CONSOLE_FIXED_MESSAGES.unknownModule).toBe(
      "알 수 없는 관리자 화면 요청을 대시보드 (KPI)로 되돌렸습니다.",
    );
    for (const [key, message] of Object.entries(CONSOLE_FIXED_MESSAGES)) {
      expect(message.includes("확정"), key).toBe(false);
      expect(message.includes("사실"), key).toBe(false);
      expect(message.includes("완성"), key).toBe(false);
      expect(message.includes("최종"), key).toBe(false);
    }
  });
});

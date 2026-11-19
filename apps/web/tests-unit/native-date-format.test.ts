import { describe, expect, test } from "bun:test";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { formatKoreanDate, formatKoreanDateTime } from "@/lib/date-format";

describe("native Korean submission history dates", () => {
  test("keeps the published labels, local-time conversion and midnight hour", () => {
    const dates = [
      new Date(2026, 0, 2, 0, 5),
      new Date(2026, 10, 14, 12, 0),
      new Date(2026, 11, 31, 23, 59),
      new Date(2024, 1, 29, 1, 1),
      new Date("2026-03-08T06:59:00Z"),
      new Date("2026-03-08T07:01:00Z"),
      new Date("2026-11-01T05:59:00Z"),
      new Date("2026-11-01T06:01:00Z"),
      new Date("2026-11-14T00:02:00+09:00"),
    ];

    for (const date of dates) {
      expect(formatKoreanDate(date)).toBe(format(date, "yyyy년 M월 d일", { locale: ko }));
      expect(formatKoreanDateTime(date)).toBe(format(date, "yyyy년 M월 d일 HH:mm", { locale: ko }));
    }
    expect(formatKoreanDateTime(dates[0])).toBe("2026년 1월 2일 00:05");
  });

  test("does not silently turn invalid timestamps into a displayed date", () => {
    expect(() => formatKoreanDate(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => formatKoreanDateTime(new Date(Number.NaN))).toThrow(RangeError);
  });
});

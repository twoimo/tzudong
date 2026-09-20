import { describe, expect, test } from "bun:test";
import {
  STORYBOARD_MEMORY_RESERVE_FLOOR_BYTES,
  canAdmitStoryboardMemory,
  estimateStoryboardQueueWait,
  nextStoryboardQueueWait,
  storyboardMemoryReserveBytes,
} from "../lib/admin/storyboard/resource-invariants";

const GIB = 1024 ** 3;

describe("storyboard resource invariants", () => {
  test("reserve is max(16 GiB, 12.5% of physical RAM)", () => {
    expect(storyboardMemoryReserveBytes(64 * GIB)).toBe(STORYBOARD_MEMORY_RESERVE_FLOOR_BYTES);
    expect(storyboardMemoryReserveBytes(128 * GIB)).toBe(16 * GIB);
    expect(storyboardMemoryReserveBytes(256 * GIB)).toBe(32 * GIB);
  });

  test("admits only when used + additional peak + reserve fit in physical RAM", () => {
    const physicalBytes = 128 * GIB;
    const reserve = 16 * GIB;
    expect(canAdmitStoryboardMemory({
      usedBytes: 80 * GIB,
      additionalPeakEstimateBytes: 32 * GIB,
      physicalBytes,
    })).toBe(true);
    expect(canAdmitStoryboardMemory({
      usedBytes: 80 * GIB,
      additionalPeakEstimateBytes: 32 * GIB + 1,
      physicalBytes,
    })).toBe(false);
    expect(80 * GIB + 32 * GIB + reserve).toBe(physicalBytes);
  });

  test("queue wait follows W[i+1] = max(0, W[i] + S[i] - A[i])", () => {
    expect(nextStoryboardQueueWait(10, 5, 3)).toBe(12);
    expect(nextStoryboardQueueWait(2, 1, 10)).toBe(0);
  });

  test("estimated wait is unknown without a live worker", () => {
    expect(estimateStoryboardQueueWait({
      liveWorker: false,
      wait: 10,
      service: 5,
      arrivalsServed: 3,
    })).toBeNull();
    expect(estimateStoryboardQueueWait({
      liveWorker: true,
      wait: 10,
      service: 5,
      arrivalsServed: 3,
    })).toBe(12);
  });
});

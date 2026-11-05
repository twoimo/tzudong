import { describe, expect, test } from "bun:test";
import {
  STORYBOARD_MEMORY_RESERVE_FLOOR_BYTES,
  canAdmitStoryboardMemory,
  estimateStoryboardQueueWait,
  nextStoryboardQueueWait,
  storyboardMemoryReserveBytes,
} from "../lib/admin/storyboard/resource-invariants";
import {
  DEFAULT_STORYBOARD_GEMINI_CLIENT_PEAK_BYTES,
  admitStoryboardWorkerMemory,
} from "../lib/admin/storyboard/outbound-worker";

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

  test("worker admission reserves bounded Gemini client and image processing memory before claim", () => {
    const physicalBytes = 128 * GIB;
    expect(admitStoryboardWorkerMemory(
      [],
      { physicalBytes, usedBytes: 80 * GIB },
    )).toBe(true);
    expect(admitStoryboardWorkerMemory(
      [],
      { physicalBytes, usedBytes: 112 * GIB },
    )).toBe(false);
  });

  test("host-wide available memory does not add remote Gemini model residency", () => {
    const physicalBytes = 128 * GIB;

    // Gemini runs remotely; only the local client and image buffers are admitted.
    expect(admitStoryboardWorkerMemory(
      [{ bytes_resident: 10 * GIB }],
      { physicalBytes, availableBytes: 32 * GIB },
    )).toBe(true);

    // 112 GiB used + 16 GiB reserve leaves no room for the image peak.
    expect(admitStoryboardWorkerMemory(
      [{ bytes_resident: 10 * GIB }],
      { physicalBytes, availableBytes: 16 * GIB },
    )).toBe(false);
  });

  test("worker admission uses a fixed Gemini client peak without a provider selector", () => {
    expect(DEFAULT_STORYBOARD_GEMINI_CLIENT_PEAK_BYTES).toBe(128 * 1024 ** 2);
    expect(admitStoryboardWorkerMemory([], {
      physicalBytes: 64 * GIB,
      usedBytes: 47 * GIB,
    })).toBe(true);
    expect(admitStoryboardWorkerMemory([], {
      physicalBytes: 64 * GIB,
      usedBytes: 48 * GIB,
    })).toBe(false);
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

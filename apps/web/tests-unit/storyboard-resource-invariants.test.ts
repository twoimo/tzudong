import { describe, expect, test } from "bun:test";
import {
  STORYBOARD_MEMORY_RESERVE_FLOOR_BYTES,
  canAdmitStoryboardMemory,
  estimateStoryboardQueueWait,
  nextStoryboardQueueWait,
  storyboardMemoryReserveBytes,
} from "../lib/admin/storyboard/resource-invariants";
import {
  DEFAULT_STORYBOARD_MLX_INFERENCE_PEAK_BYTES,
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

  test("worker admission adds resident model bytes before claim", () => {
    const physicalBytes = 128 * GIB;
    expect(admitStoryboardWorkerMemory(
      [{ bytes_resident: 1 * GIB }],
      { physicalBytes, usedBytes: 80 * GIB },
    )).toBe(true);
    expect(admitStoryboardWorkerMemory(
      [{ bytes_resident: 10 * GIB }],
      { physicalBytes, usedBytes: 110 * GIB },
    )).toBe(false);
  });

  test("host-wide available memory includes external model residency once", () => {
    const physicalBytes = 128 * GIB;

    // The model server is a separate process. Its resident bytes are already
    // reflected by the host-wide availability sample and must not be added a
    // second time to the worker RSS.
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

  test("worker admission reserves a configurable MLX inference peak and fails closed on invalid values", () => {
    const envName = "STORYBOARD_MLX_INFERENCE_PEAK_BYTES";
    const previous = process.env[envName];
    try {
      delete process.env[envName];
      expect(DEFAULT_STORYBOARD_MLX_INFERENCE_PEAK_BYTES).toBe(8 * GIB);
      expect(admitStoryboardWorkerMemory([], {
        physicalBytes: 64 * GIB,
        usedBytes: 40 * GIB,
      })).toBe(false);

      process.env[envName] = String(1 * GIB);
      expect(admitStoryboardWorkerMemory([], {
        physicalBytes: 64 * GIB,
        usedBytes: 40 * GIB,
      })).toBe(true);

      process.env[envName] = "unknown";
      expect(() => admitStoryboardWorkerMemory([], {
        physicalBytes: 64 * GIB,
        usedBytes: 40 * GIB,
      })).toThrow(RangeError);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
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

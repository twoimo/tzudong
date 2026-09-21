const GIB = 1024 ** 3;

export const STORYBOARD_MEMORY_RESERVE_FLOOR_BYTES = 16 * GIB;
export const STORYBOARD_MEMORY_RESERVE_FRACTION = 0.125;

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite number >= 0`);
  }
}

export function storyboardMemoryReserveBytes(physicalBytes: number): number {
  assertNonNegativeFinite(physicalBytes, "physicalBytes");
  return Math.max(
    STORYBOARD_MEMORY_RESERVE_FLOOR_BYTES,
    physicalBytes * STORYBOARD_MEMORY_RESERVE_FRACTION,
  );
}

export function canAdmitStoryboardMemory(input: {
  usedBytes: number;
  additionalPeakEstimateBytes: number;
  physicalBytes: number;
}): boolean {
  assertNonNegativeFinite(input.usedBytes, "usedBytes");
  assertNonNegativeFinite(input.additionalPeakEstimateBytes, "additionalPeakEstimateBytes");
  const reserve = storyboardMemoryReserveBytes(input.physicalBytes);
  return input.usedBytes + input.additionalPeakEstimateBytes + reserve <= input.physicalBytes;
}

export function nextStoryboardQueueWait(
  wait: number,
  service: number,
  arrivalsServed: number,
): number {
  assertNonNegativeFinite(wait, "wait");
  assertNonNegativeFinite(service, "service");
  assertNonNegativeFinite(arrivalsServed, "arrivalsServed");
  return Math.max(0, wait + service - arrivalsServed);
}

export function estimateStoryboardQueueWait(input: {
  liveWorker: boolean;
  wait: number;
  service: number;
  arrivalsServed: number;
}): number | null {
  if (!input.liveWorker) return null;
  return nextStoryboardQueueWait(input.wait, input.service, input.arrivalsServed);
}

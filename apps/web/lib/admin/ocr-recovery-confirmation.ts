export type PendingOcrRecoveryOperation = {
  operationId: string;
  expectedGeneration: string;
  inputSnapshotHash: string;
};

/** A cancelled cost confirmation never becomes a reusable recovery operation. */
export function retainConfirmedOcrRecoveryOperation(
  retained: Map<string, PendingOcrRecoveryOperation>,
  reviewId: string,
  operation: PendingOcrRecoveryOperation,
  requiresConfirmation: boolean,
  confirm: () => boolean,
): boolean {
  if (requiresConfirmation && !confirm()) return false;
  retained.set(reviewId, operation);
  return true;
}

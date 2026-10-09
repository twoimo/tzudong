import {
  operationsUnavailable,
  parseOperationsSnapshot,
  type OperationsSnapshot,
  type OperationsSourceId,
} from './operations-view-model';

const ENDPOINTS: Record<OperationsSourceId, string> = {
  pending: '/api/admin/pending-counts',
  pipeline: '/api/admin/pipeline',
  automation: '/api/admin/evaluations/automation',
};

export async function readOperationsSource(
  sourceId: OperationsSourceId,
  signal: AbortSignal,
): Promise<OperationsSnapshot> {
  signal.throwIfAborted();
  try {
    const response = await fetch(ENDPOINTS[sourceId], {
      method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    signal.throwIfAborted();
    if (!response.ok) return operationsUnavailable(sourceId, response.status === 401 || response.status === 403 ? 'forbidden' : 'unavailable');
    const value: unknown = await response.json();
    signal.throwIfAborted();
    return parseOperationsSnapshot(sourceId, value);
  } catch {
    // Query cancellation must remain cancellation, not a cacheable outage.
    signal.throwIfAborted();
    return operationsUnavailable(sourceId, 'unavailable');
  }
}

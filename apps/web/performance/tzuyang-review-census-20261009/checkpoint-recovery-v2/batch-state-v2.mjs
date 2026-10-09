const waiting = new Set(['JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'JOB_STATE_CANCELLING', 'JOB_STATE_UPDATING']);
const terminal = new Set(['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']);

export function batchDisposition(state) {
  if (waiting.has(state)) return {action: 'wait', status: 'pending'};
  if (terminal.has(state)) return {action: 'stop', status: 'terminal_failure', failureCode: 'BATCH_TERMINAL_FAILURE'};
  if (state === 'JOB_STATE_PAUSED') return {action: 'stop', status: 'paused', failureCode: 'BATCH_PAUSED'};
  if (state === 'JOB_STATE_SUCCEEDED' || state === 'JOB_STATE_PARTIALLY_SUCCEEDED') {
    return {action: 'ingest', partial: state === 'JOB_STATE_PARTIALLY_SUCCEEDED'};
  }
  return {action: 'stop', status: 'unconfirmed', failureCode: 'BATCH_STATE_UNCONFIRMED'};
}

/** One read of the existing job; no create/resume/cancel capability is supplied. */
export async function inspectExistingBatch({get, name, ingest}) {
  const job = await get({name});
  if (job.name !== name) throw new Error('BATCH_NAME_DRIFT');
  const disposition = batchDisposition(job.state);
  return disposition.action === 'ingest'
    ? {...disposition, state: job.state, result: await ingest(job)}
    : {...disposition, state: job.state};
}

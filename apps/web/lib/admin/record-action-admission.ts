// Server-only runtime admission for guarded record writes, never a browser RPC fence.
if (typeof window !== 'undefined') throw new Error('RECORD_ACTION_SERVER_ONLY');

export function isRecordMutationAdmitted(env: NodeJS.ProcessEnv = process.env): boolean {
  // Missing, active, malformed and whitespace values remain held. No result is cached.
  return env.ADMIN_RECORD_MUTATIONS_HOLD === 'cleared';
}

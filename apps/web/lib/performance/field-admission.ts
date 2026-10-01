import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

// Per-worker abuse control before parsing/RPC. Keys are RAM-only HMACs using a
// process-random secret, never IPs, database identifiers, logs or user profiles.
export function createFieldAdmissionGate() {
  const secret = randomBytes(32);
  const counts = new Map<string, number>();
  let window = -1;
  let accepted = 0;
  return (platformSource: string | null, now = Date.now()) => {
    const nextWindow = Math.floor(now / 60_000);
    if (nextWindow !== window) { counts.clear(); accepted = 0; window = nextWindow; }
    if (accepted >= 80) return false;
    const source = platformSource?.trim();
    const key = source && isIP(source)
      ? createHmac('sha256', secret).update(source).digest('hex') : 'unknown-platform-source';
    const count = counts.get(key) ?? 0;
    if (count >= 36 || (!counts.has(key) && counts.size >= 512)) return false;
    counts.set(key, count + 1); accepted += 1;
    return true;
  };
}

export const admitFieldRequest = createFieldAdmissionGate();

const RECOVERY_WINDOW_MS = 30_000;
let recovery: { token: number; deadline: number; email: string } | null = null;
let nextRecoveryToken = 0;

export function beginExistingAccountPrivacyRecovery(email: string) {
  const token = ++nextRecoveryToken;
  recovery = {
    token,
    deadline: Date.now() + RECOVERY_WINDOW_MS,
    email: email.trim().toLowerCase(),
  };
  return token;
}

export function endExistingAccountPrivacyRecovery(token: number) {
  if (recovery?.token === token) {
    recovery = null;
  }
}

export function isExistingAccountPrivacyRecoveryActive(userEmail: string | null | undefined) {
  if (recovery && recovery.deadline <= Date.now()) {
    recovery = null;
  }
  return recovery !== null
    && typeof userEmail === 'string'
    && recovery.email === userEmail.trim().toLowerCase();
}

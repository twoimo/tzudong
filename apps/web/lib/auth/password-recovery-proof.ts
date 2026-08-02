const PASSWORD_RECOVERY_PROOF_TTL_MS = 60_000;

let passwordRecoveryProof: { userId: string; observedAt: number } | null = null;

export function recordPasswordRecoveryProof(userId: string) {
  if (!userId) return;
  passwordRecoveryProof = { userId, observedAt: Date.now() };
}

export function consumePasswordRecoveryProof(userId: string) {
  const proof = passwordRecoveryProof;
  passwordRecoveryProof = null;

  return Boolean(
    proof
      && proof.userId === userId
      && Date.now() - proof.observedAt <= PASSWORD_RECOVERY_PROOF_TTL_MS,
  );
}

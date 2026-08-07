import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

const profilePage = () => source("app/mypage/profile/page.tsx");
const profileModal = () => source("components/profile/ProfileModal.tsx");

describe("G028 account deletion reauthentication UI contract", () => {
  test("binds password session, self-only preview, proof, and seven-field apply in order", () => {
    const page = profilePage();
    const signIn = page.indexOf("createAccountDeletionReauthenticationSession");
    const preview = page.indexOf('method: "POST"');
    const issueProof = page.indexOf("issueAccountDeletionReauthenticationProof(user.id)");
    const apply = page.indexOf('method: "DELETE"');

    expect(signIn).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(signIn);
    expect(issueProof).toBeGreaterThan(preview);
    expect(apply).toBeGreaterThan(issueProof);
    expect(page).toContain("body: JSON.stringify({ targetUserId: user.id })");
    expect(page).toContain("Authorization: `Bearer ${freshSession.bearerToken}`");
    expect(page).toContain("bearerToken: freshSession.bearerToken");
    expect(page).toContain("Authorization: `Bearer ${deletionSession.bearerToken}`");
    for (const field of ["userId:", "proofId:", "requestId:", "previewHash:", "confirmationText:", "idempotencyKey,", "sourceManifestHash:"]) {
      expect(page).toContain(field);
    }
  });

  test("waits for durable GET readback before signout and browser cleanup", () => {
    const page = profilePage();
    const poll = page.indexOf("pollAccountDeletionReadback(deletionSession.preview, pollController.signal)");
    const signOut = page.indexOf("supabase.auth.signOut({ scope: \"local\" })");
    const cleanup = page.indexOf("clearAccountDeletionBrowserStores(user.id, receipt)");

    expect(page).toContain("response.status !== 202");
    expect(page).toContain('readback.kind !== "applied"');
    expect(poll).toBeGreaterThan(-1);
    expect(signOut).toBeGreaterThan(poll);
    expect(cleanup).toBeGreaterThan(signOut);
    expect(page).toContain("accountDeletionPollController.current?.abort()");
    expect(page).not.toMatch(/localStorage\.(?:setItem|getItem).*deletionPassword/);
    expect(page).not.toMatch(/sessionStorage\.(?:setItem|getItem).*deletionPassword/);
  });

  test("removes the modal deletion path and redirects to the canonical profile dialog", () => {
    const modal = profileModal();

    expect(modal).toContain("window.location.assign('/mypage/profile#account-deletion')");
    expect(modal).not.toContain("handleAccountDelete");
    expect(modal).not.toMatch(/\.from\(['\"](?:profiles|user_stats)['\"]\)\s*\.delete/);
  });
  test("maps deletion guidance from stable reasonCode values, never localized server copy", () => {
    const page = profilePage();

    expect(page).toContain('const reasonCode = (payload as { reasonCode?: unknown }).reasonCode;');
    expect(page).toContain("accountDeletionFailureMessages[reasonCode]");
    expect(page).toContain("REAUTH_REQUIRED:");
    expect(page).toContain("REAUTH_PROOF_UNAVAILABLE:");
    expect(page).not.toContain('error === "최근 로그인 확인이 필요합니다.');
    expect(page).not.toContain('error === "세션 기반 재인증 보안 확인을 사용할 수 없어');
  });
});

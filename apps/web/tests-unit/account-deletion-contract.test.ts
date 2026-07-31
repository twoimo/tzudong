import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

const matchCount = (haystack: string, pattern: RegExp): number =>
  haystack.match(pattern)?.length ?? 0;

describe("account deletion browser cleanup source contracts", () => {
  test("per-user draft delete helpers are bounded and avoid full IndexedDB wipe", () => {
    const reviewDraftSource = source("lib/reviewDraftDB.ts");
    const submissionDraftSource = source("lib/submissionDraftDB.ts");
    const editRequestDraftSource = source("lib/editRequestDraftDB.ts");

    for (const draftSource of [
      reviewDraftSource,
      submissionDraftSource,
      editRequestDraftSource,
    ]) {
      expect(draftSource).toContain("indexes: {");
      expect(draftSource).toContain("'by-user'");
      expect(draftSource).toContain(
        "export async function getAllDraftsByUser(userId: string)",
      );
      expect(draftSource).toContain(
        "export async function deleteDraftsByUser(userId: string): Promise<number>",
      );
      expect(draftSource).toContain("const tx = db.transaction(STORE_NAME, 'readwrite');");
      expect(draftSource).toContain("const userDraftKeys = await store.index('by-user').getAllKeys(userId);");
      expect(draftSource).toContain("for (const key of userDraftKeys)");
      expect(draftSource).toContain("await store.delete(key);");
      expect(draftSource).toContain("return userDraftKeys.length;");
      expect(draftSource).not.toContain("indexedDB.deleteDatabase");
      expect(draftSource).not.toContain("await db.clear(");
      expect(draftSource).not.toContain("await tx.clear(");
    }
  });

  test("account-deletion helper requires applied receipt + exact user id and returns explicit readback", () => {
    const helperSource = source("lib/privacy/account-deletion.ts");

    expect(helperSource).toContain("export async function clearAccountDeletionBrowserStores(");
    expect(helperSource).toContain("const userId = normalizeUserId(deletedUserId);");
    expect(helperSource).toContain("if (!isUuid(userId)) {");
    expect(helperSource).toContain("if (!isAppliedReceipt(appliedServerReceipt, userId)) {");
    expect(helperSource).toContain("extractReadback");
    expect(helperSource).toContain("extractReceiptUserId");
    expect(helperSource).toContain("return false;");

    expect(helperSource).toContain("deleteSubmissionDraftsByUser(userId)");
    expect(helperSource).toContain("deleteReviewDraftsByUser(userId)");
    expect(helperSource).toContain("deleteEditRequestDraftsByUser(userId)");

    expect(helperSource).toContain("export type AccountDeletionBrowserCleanupReadback = {");
    expect(helperSource).toContain("submission: number;");
    expect(helperSource).toContain("review: number;");
    expect(helperSource).toContain("editRequest: number;");
    expect(helperSource).toContain("draftCleanup");
    expect(helperSource).toContain("authKeysRemoved");

    expect(helperSource).toContain("clearLocalAuthStorageKeys();");
    expect(helperSource).toContain("clearSessionAuthStorageKeys();");
    expect(helperSource).toContain("isSupabaseAuthSessionStorageKey");

    expect(helperSource).toContain("clearAuthCookies();");
    expect(helperSource).toContain("export const ACCOUNT_DELETION_BROWSER_CLEANUP_QUERY_VALUE = 'required';");
    expect(helperSource).toContain("return buildFailed(");
    expect(helperSource).toContain("return createResult(");
    expect(helperSource).toContain("draftCleanup.total =");
    expect(helperSource).toContain("draftCleanup: {");
    expect(helperSource).toContain("if (failureReason)");
    expect(helperSource).toContain("status: 'completed' | 'failed';");
    expect(helperSource).toContain("'completed',");
    expect(helperSource).toContain("'failed',");
    expect(helperSource).toContain("readback:");

    expect(helperSource).not.toContain("localStorage.clear()");
    expect(helperSource).not.toContain("document.cookie = ''");
    expect(helperSource).not.toContain("indexedDB.deleteDatabase");

    expect(helperSource).toContain(
      "deleteDraftsByUser as deleteEditRequestDraftsByUser",
    );
    expect(helperSource).toContain(
      "deleteDraftsByUser as deleteReviewDraftsByUser",
    );
    expect(helperSource).toContain(
      "deleteDraftsByUser as deleteSubmissionDraftsByUser",
    );

    expect(matchCount(helperSource, /delete(?:Submission|Review|EditRequest)DraftsByUser\(userId\)/g)).toBe(3);
  });

  test("G028 keeps preview, proof, and apply bound to one fresh self session", () => {
    const profileSource = source("app/mypage/profile/page.tsx");
    const reauthSource = source("lib/privacy/account-deletion-reauth.ts");
    const routeSource = source("app/api/account/delete/route.ts");
    const modalSource = source("components/profile/ProfileModal.tsx");

    const signInStart = profileSource.indexOf("createAccountDeletionReauthenticationSession(");
    const previewStart = profileSource.indexOf('method: "POST"', signInStart);
    const proofStart = profileSource.indexOf("issueAccountDeletionReauthenticationProof(", previewStart);
    const applyStart = profileSource.indexOf('method: "DELETE"', proofStart);

    expect(reauthSource).toContain("supabase.auth.signInWithPassword");
    expect(reauthSource).toContain("signInData.user?.id !== userId");
    expect(reauthSource).toContain("export function asSingleRow");
    expect(reauthSource).toContain("Array.isArray(value) && value.length === 1");
    expect(reauthSource).toContain("parseAccountDeletionPreview");
    expect(profileSource).toContain("setDeletionSession({");
    expect(profileSource).toContain("bearerToken: reauthentication.bearerToken");
    expect(profileSource).toContain("Authorization: `Bearer ${deletionSession.bearerToken}`");
    expect(profileSource).toContain("proofId: deletionSession.proofId");
    expect(profileSource).toContain("requestId: bindings.requestId");
    expect(profileSource).toContain("previewHash: bindings.previewHash");
    expect(profileSource).toContain("confirmationText: deleteConfirmationEmail");
    expect(profileSource).toContain("idempotencyKey: bindings.idempotencyKey");
    expect(profileSource).toContain("sourceManifestHash: bindings.sourceManifestHash");
    expect(profileSource).toContain("setDeletionSession(null);");
    expect(signInStart).toBeGreaterThan(-1);
    expect(previewStart).toBeGreaterThan(signInStart);
    expect(proofStart).toBeGreaterThan(previewStart);
    expect(applyStart).toBeGreaterThan(proofStart);

    expect(routeSource).toContain("export async function POST");
    expect(routeSource).toContain("hasExactKeys(body, ['targetUserId'])");
    expect(routeSource).toContain("preview_account_deletion");
    expect(routeSource).toContain("p_reauthenticated_at: verifiedUser.last_sign_in_at");
    expect(routeSource).toContain("getUser(bearerToken)");
    expect(routeSource).toContain("getClaims(bearerToken)");
    expect(routeSource).toContain("sub === targetUserId");
    expect(routeSource).toContain("asSingleRow(data)");
    expect(routeSource).toContain("export async function DELETE");
    expect(routeSource).toContain("hasExactKeys(body, ['userId', 'proofId', 'requestId', 'previewHash', 'confirmationText', 'idempotencyKey', 'sourceManifestHash'])");
    expect(routeSource).toContain("begin_account_deletion_apply_with_reauth");
    expect(routeSource).toContain("const supabase = createBearerClient(bearerToken);");
    expect(routeSource).toContain("const { data, error } = await supabase.rpc('begin_account_deletion_apply_with_reauth'");
    expect(routeSource).not.toContain("supabaseAdmin.rpc('begin_account_deletion_apply_with_reauth'");
    expect(routeSource).toContain("if (begin.status !== 'APPLY_STARTED')");
    expect(routeSource).toContain("if (error) return failureResponse(rpcFailureCode(error));");
    expect(routeSource).not.toContain("requireAdmin");
    expect(routeSource).not.toContain("deleteUser(");
    expect(routeSource).not.toContain(".from('profiles')");

    expect(modalSource).toContain('window.location.assign("/mypage/profile#account-deletion")');
    expect(modalSource).not.toContain(".delete()");
    expect(modalSource).not.toContain("handleAccountDelete");
  });
});

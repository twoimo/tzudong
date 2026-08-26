import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");
const docsSource = (relativePath: string) =>
  readFileSync(
    join(import.meta.dir, "..", "..", "..", "docs", relativePath),
    "utf8",
  );

describe("app back navigation state contracts", () => {
  test("draft-backed write flows persist the current form step with field data", () => {
    const reviewDraftSource = source("lib/reviewDraftDB.ts");
    const submissionDraftSource = source("lib/submissionDraftDB.ts");
    const editDraftSource = source("lib/editRequestDraftDB.ts");
    const reviewModalSource = source("components/reviews/ReviewModal.tsx");
    const submissionModalSource = source(
      "components/modals/RestaurantSubmissionModal.tsx",
    );
    const editModalSource = source("components/modals/EditRestaurantModal.tsx");

    for (const draftSource of [
      reviewDraftSource,
      submissionDraftSource,
      editDraftSource,
    ]) {
      expect(draftSource).toContain("currentStep?: 1 | 2 | 3");
    }

    expect(reviewModalSource).toContain("currentStep,");
    expect(reviewModalSource).toContain("setCurrentStep(draft.currentStep)");
    expect(submissionModalSource).toContain("currentStep,");
    expect(submissionModalSource).toContain(
      "setCurrentStep(draft.currentStep)",
    );
    expect(editModalSource).toContain("currentStep,");
    expect(editModalSource).toContain("setCurrentStep(draft.currentStep)");
  });

  test("review edit drafts persist short-lived text state without browser-stored image files", () => {
    const reviewDraftSource = source("lib/reviewDraftDB.ts");
    const reviewEditModalSource = source("components/reviews/ReviewEditModal.tsx");

    expect(reviewDraftSource).toContain("const DB_VERSION = 3");
    expect(reviewDraftSource).toContain("REVIEW_DRAFT_TTL_MS = 24 * 60 * 60 * 1000");
    expect(reviewDraftSource).toContain("keyPath: ['userId', 'restaurantId']");
    expect(reviewDraftSource).toContain("const persistedDraft: PersistedReviewDraft = {");
    expect(reviewDraftSource).toContain("const publicDraft: ReviewDraft = {");
    expect(reviewDraftSource).toContain("expiresAt: now + REVIEW_DRAFT_TTL_MS");
    expect(reviewDraftSource).not.toContain("getAll(");
    expect(reviewDraftSource).not.toContain("getAllKeys(");
    expect(reviewEditModalSource).toContain("foodPhotos: []");
    expect(reviewEditModalSource).not.toContain("foodPhotos: newFoodPhotos");
    expect(reviewEditModalSource).not.toContain("setNewFoodPhotos(draft.foodPhotos)");
    expect(reviewEditModalSource).toContain("텍스트만 임시 저장됨");

    const handleCloseStart = reviewEditModalSource.indexOf("const handleClose = useCallback");
    const handleCloseEnd = reviewEditModalSource.indexOf("// Form validation", handleCloseStart);
    const handleCloseSource = reviewEditModalSource.slice(handleCloseStart, handleCloseEnd);

    expect(handleCloseSource).not.toContain("deleteEditDraft");
  });
  test("sign-out clears every user-scoped browser draft store", () => {
    const authContextSource = source("contexts/AuthContext.tsx");
    const cleanupSource = source("lib/privacy/browser-draft-cleanup.ts");
    const accountDeletionSource = source("lib/privacy/account-deletion.ts");

    expect(authContextSource).toContain("await clearBrowserDraftsForUser(signingOutUserId)");
    expect(authContextSource.match(/await clearPrivateDrafts\(\);/g)).toHaveLength(2);
    expect(cleanupSource).toContain("deleteAllSubmissionDraftsByUser(userId)");
    expect(cleanupSource).toContain("deleteAllReviewDraftsByUser(userId)");
    expect(cleanupSource).toContain("deleteAllEditRequestDraftsByUser(userId)");
    expect(accountDeletionSource).toContain("await clearBrowserDraftsForUser(deletedUserId)");
  });

  test("visible home panels create back-stack entries while close actions canonicalize", () => {
    const desktopPanelSource = source(
      "components/home/home-desktop-control-panel.tsx",
    );
    const homeClientSource = source("app/home-client.tsx");
    const homeClientEffectsSource = source("app/home-client-effects.tsx");

    expect(desktopPanelSource).toContain(
      "router.push(`/?panel=${panel}`, { scroll: false })",
    );
    expect(desktopPanelSource).toContain(
      'router.push("/?panel=bookmarks", { scroll: false })',
    );
    expect(desktopPanelSource).toContain(
      'router.push("/?panel=notifications", { scroll: false })',
    );
    expect(desktopPanelSource).toContain(
      'router.push("/?panel=announcement", { scroll: false })',
    );
    expect(desktopPanelSource).toContain(
      'router.replace("/", { scroll: false })',
    );
    expect(homeClientSource).toContain("function clearAnnouncementPanelUrl()");
    expect(homeClientSource).toContain('currentUrl.searchParams.get("panel") !== "announcement"');
    expect(homeClientEffectsSource).toContain(
      "const isAnnouncementUrlActive = searchParams.get('panel') === 'announcement'",
    );
    expect(homeClientEffectsSource).toContain(
      "wasAnnouncementUrlActiveRef.current",
    );
    expect(homeClientEffectsSource).toContain(
      "openPanelRef.current('announcement');",
    );
    expect(homeClientEffectsSource).not.toContain(
      "router.replace('/', { scroll: false });",
    );
  });

  test("native app lifecycle scenarios are documented until Capacitor is introduced", () => {
    const appBackDoc = docsSource("product/app-back-navigation-state.md");
    const packageSource = source("package.json");

    expect(appBackDoc).toContain("Android hardware back");
    expect(appBackDoc).toContain("iOS swipe back");
    expect(appBackDoc).toContain("background/foreground");
    expect(packageSource).not.toContain("@capacitor/");
  });
});

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

  test("review edit drafts survive ordinary close and retain photo edit state", () => {
    const reviewDraftSource = source("lib/reviewDraftDB.ts");
    const reviewEditModalSource = source("components/reviews/ReviewEditModal.tsx");

    expect(reviewDraftSource).toContain("existingFoodPhotos?: string[]");
    expect(reviewDraftSource).toContain("removedPhotos?: string[]");
    expect(reviewEditModalSource).toContain("foodPhotos: newFoodPhotos");
    expect(reviewEditModalSource).toContain("existingFoodPhotos,");
    expect(reviewEditModalSource).toContain("removedPhotos,");
    expect(reviewEditModalSource).toContain("setNewFoodPhotos(draft.foodPhotos)");
    expect(reviewEditModalSource).toContain("setExistingFoodPhotos(draft.existingFoodPhotos)");
    expect(reviewEditModalSource).toContain("setRemovedPhotos(draft.removedPhotos)");

    const handleCloseStart = reviewEditModalSource.indexOf("const handleClose = useCallback");
    const handleCloseEnd = reviewEditModalSource.indexOf("// Form validation", handleCloseStart);
    const handleCloseSource = reviewEditModalSource.slice(handleCloseStart, handleCloseEnd);

    expect(handleCloseSource).not.toContain("deleteEditDraft");
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
      "searchParams.get('panel') !== 'announcement'",
    );
    expect(homeClientEffectsSource).not.toContain(
      "router.replace('/', { scroll: false });",
    );
  });

  test("native app lifecycle scenarios are documented until Capacitor is introduced", () => {
    const appBackDoc = docsSource("app-back-navigation-state.md");
    const packageSource = source("package.json");

    expect(appBackDoc).toContain("Android hardware back");
    expect(appBackDoc).toContain("iOS swipe back");
    expect(appBackDoc).toContain("background/foreground");
    expect(packageSource).not.toContain("@capacitor/");
  });
});

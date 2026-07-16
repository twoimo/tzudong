import { deleteAllDraftsByUser as deleteAllEditRequestDraftsByUser } from '@/lib/editRequestDraftDB';
import { deleteAllDraftsByUser as deleteAllReviewDraftsByUser } from '@/lib/reviewDraftDB';
import { deleteAllDraftsByUser as deleteAllSubmissionDraftsByUser } from '@/lib/submissionDraftDB';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BrowserDraftCleanupReadback = Readonly<{
  submissionDrafts: boolean;
  reviewDrafts: boolean;
  editRequestDrafts: boolean;
}>;

const failedReadback = (): BrowserDraftCleanupReadback => ({
  submissionDrafts: false,
  reviewDrafts: false,
  editRequestDrafts: false,
});

export async function clearBrowserDraftsForUser(userId: string): Promise<BrowserDraftCleanupReadback> {
  if (typeof window === 'undefined' || !UUID_PATTERN.test(userId)) return failedReadback();
  try {
    const [submissionDrafts, reviewDrafts, editRequestDrafts] = await Promise.all([
      deleteAllSubmissionDraftsByUser(userId),
      deleteAllReviewDraftsByUser(userId),
      deleteAllEditRequestDraftsByUser(userId),
    ]);
    return { submissionDrafts, reviewDrafts, editRequestDrafts };
  } catch {
    return failedReadback();
  }
}

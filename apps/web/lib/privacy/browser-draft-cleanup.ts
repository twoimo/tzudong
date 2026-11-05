import { beginBrowserDraftCleanup, isBrowserDraftEpochCurrent, type BrowserDraftEpoch } from './browser-draft-lifecycle';
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

export async function clearBrowserDraftsForUser(userId: string, cleanupEpoch?: BrowserDraftEpoch): Promise<BrowserDraftCleanupReadback> {
  if (typeof window === 'undefined' || !UUID_PATTERN.test(userId)) return failedReadback();
  const epoch = cleanupEpoch ?? beginBrowserDraftCleanup(userId);
  if (!isBrowserDraftEpochCurrent(userId, epoch)) return failedReadback();
  try {
    const [submissionDrafts, reviewDrafts, editRequestDrafts] = await Promise.all([
      deleteAllSubmissionDraftsByUser(userId, epoch),
      deleteAllReviewDraftsByUser(userId, epoch),
      deleteAllEditRequestDraftsByUser(userId, epoch),
    ]);
    return { submissionDrafts, reviewDrafts, editRequestDrafts };
  } catch {
    return failedReadback();
  }
}

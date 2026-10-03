import { findSameVideoDuplicateWarningCandidates, formatSameVideoDuplicateWarning, type SameVideoDuplicateWarningCandidate, type SameVideoDuplicateWarningRow } from '@/lib/admin-same-video-duplicate-warning';
import { findRestaurantIdentityWarnings, isSameVideoSameOriginDeleted, deletedRestaurantIdentityWarning, type RestaurantIdentityWarningRow } from '@/lib/admin-restaurant-identity-warning';

type WarningRow = SameVideoDuplicateWarningRow & RestaurantIdentityWarningRow;

/** Feed globally ordered related rows in bounded batches; keep only counts/top 3. */
export class EvaluationWarningStream {
  private duplicateCount = 0;
  private candidates: SameVideoDuplicateWarningCandidate[] = [];
  private deletedCount = 0;
  private deleted: RestaurantIdentityWarningRow[] = [];
  constructor(private readonly target: WarningRow) {}

  add(rows: WarningRow[]) {
    const batch = findSameVideoDuplicateWarningCandidates(this.target, rows);
    this.duplicateCount += batch.length;
    this.candidates = [...this.candidates,...batch]
      .sort((left,right) => right.confidence-left.confidence || left.name.localeCompare(right.name)).slice(0,3);
    if (this.target.status === 'deleted') return;
    for (const row of rows) if (isSameVideoSameOriginDeleted(this.target,row)) {
      this.deletedCount++;
      if (this.deleted.length<3) this.deleted.push(row);
    }
  }

  result() {
    const identity=findRestaurantIdentityWarnings(this.target,[]);
    if (this.deletedCount) identity.push(deletedRestaurantIdentityWarning(this.deleted,this.deletedCount));
    identity.sort((left,right) => left.severity===right.severity ? 0 : left.severity==='block' ? -1 : 1);
    return { sameVideo: { count:this.duplicateCount,candidates:this.candidates,
      message:formatSameVideoDuplicateWarning(this.candidates,this.duplicateCount) },identity };
  }
}

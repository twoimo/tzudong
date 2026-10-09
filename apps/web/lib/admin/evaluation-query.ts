import type { EvaluationRecord, CategoryStats } from '@/types/evaluation';
import { matchesAdminEvaluationSearch } from '@/lib/admin-evaluation-name';
import { getAddressConsistencyStatus } from '@/lib/admin-address-consistency';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import { getLocationMatchFalseMessage, hasRuleMetrics, hasLaajMetrics, toNotSelectionReason } from '@/lib/dashboard/classifiers';
import { compareAdminEvaluationsByLatestDesc, isAdminEvaluationRecordMissing, isAdminEvaluationRecordNotSelected, isAdminEvaluationRecordReadyForApproval, isAdminEvaluationRecordUnconfirmedMapLocation } from '@/lib/admin/evaluation-records';

export type EvaluationFilters = Partial<Record<'status' | 'visit_authenticity' | 'rb_inference_score' | 'rb_grounding_TF' | 'review_faithfulness_score' | 'geocoding_success' | 'category_validity_TF' | 'category_TF', string>>;
export type EvaluationDeepLink = { videoId?: string; issue?: string; reason?: string } | null;
export interface EvaluationQuery { searchQuery: string; evalFilters: EvaluationFilters; deepLinkFilter: EvaluationDeepLink }

export function filterEvaluationRecords(allRecords: EvaluationRecord[], { searchQuery, evalFilters, deepLinkFilter }: EvaluationQuery, alreadySorted = false): EvaluationRecord[] {
    let filtered = allRecords;

    if (searchQuery.trim()) {
      filtered = filtered.filter((record) => matchesAdminEvaluationSearch(record, searchQuery));
    }

    // 상태 필터링 (evalFilters.status)
    if (evalFilters.status) {
      // 'deleted' 필터 선택 시 이미 검색된 결과에서 deleted만 추출
      if (evalFilters.status === 'deleted') {
        filtered = filtered.filter(r => r.status === 'deleted');
      } else {
        filtered = filtered.filter(r => {
          let match = false;

          switch (evalFilters.status) {
            case 'missing':
              match = isAdminEvaluationRecordMissing(r);
              break;
            case 'not_selected':
              match = isAdminEvaluationRecordNotSelected(r);
              break;
            case 'unconfirmed_map':
              match = isAdminEvaluationRecordUnconfirmedMapLocation(r);
              break;
            case 'ready_for_approval':
              match = isAdminEvaluationRecordReadyForApproval(r);
              break;
            default:
              // 일반 상태: status 필드와 일치하는 레코드
              match = r.status === evalFilters.status;
              break;
          }

          return match;
        });
      }
    }

    // 1. Visit Authenticity 필터 (0-3점)
    if (evalFilters.visit_authenticity) {
      const targetScore = parseInt(evalFilters.visit_authenticity);
      filtered = filtered.filter(r =>
        r.evaluation_results?.visit_authenticity?.eval_value === targetScore
      );
    }

    // 2. RB Inference Score 필터 (0-2점)
    if (evalFilters.rb_inference_score) {
      const targetScore = parseInt(evalFilters.rb_inference_score);
      filtered = filtered.filter(r =>
        r.evaluation_results?.rb_inference_score?.eval_value === targetScore
      );
    }

    // 3. RB Grounding TF 필터 (T/F)
    if (evalFilters.rb_grounding_TF) {
      const targetValue = evalFilters.rb_grounding_TF === 'True';
      filtered = filtered.filter(r =>
        r.evaluation_results?.rb_grounding_TF?.eval_value === targetValue
      );
    }

    // 4. Review Faithfulness Score 필터 (0-1점)
    if (evalFilters.review_faithfulness_score) {
      const targetScore = parseFloat(evalFilters.review_faithfulness_score);
      filtered = filtered.filter(r =>
        r.evaluation_results?.review_faithfulness_score?.eval_value === targetScore
      );
    }

    // 5. 주소 정합 필터 (True/False/Failed) - 상세/테이블 표시와 같은 helper 사용
    if (evalFilters.geocoding_success) {
      const targetStatusByFilter: Record<string, ReturnType<typeof getAddressConsistencyStatus>[]> = {
        true: ['true'],
        false_match: ['false'],
        false_geocode: ['failed'],
        review: ['review', 'candidate'],
      };
      const targetStatuses = targetStatusByFilter[evalFilters.geocoding_success];
      if (targetStatuses) {
        filtered = filtered.filter(r => targetStatuses.includes(getAddressConsistencyStatus(r)));
      }
    }

    // 6. Category Validity TF 필터 (T/F)
    if (evalFilters.category_validity_TF) {
      const targetValue = evalFilters.category_validity_TF === 'True';
      filtered = filtered.filter(r =>
        r.evaluation_results?.category_validity_TF?.eval_value === targetValue
      );
    }

    // 7. Category TF 필터 (T/F)
    if (evalFilters.category_TF) {
      const targetValue = evalFilters.category_TF === 'True';
      filtered = filtered.filter(r =>
        r.evaluation_results?.category_TF?.eval_value === targetValue
      );
    }

    // 8. Status 필터는 위에서 이미 처리됨

    // Deep-link 필터 (video_id/issue/reason)
    if (deepLinkFilter?.videoId) {
      filtered = filtered.filter((record) => (
        extractVideoIdFromYoutubeLink(record.youtube_link) === deepLinkFilter.videoId
      ));
    }

    if (deepLinkFilter?.issue === 'notSelection') {
      filtered = filtered.filter((record) => record.is_not_selected === true);

      if (deepLinkFilter.reason) {
        filtered = filtered.filter((record) => (
          toNotSelectionReason({
            is_not_selected: record.is_not_selected,
            is_missing: record.is_missing,
            geocoding_false_stage: record.geocoding_false_stage,
            geocoding_success: record.geocoding_success,
          }) === deepLinkFilter.reason
        ));
      }
    } else if (deepLinkFilter?.issue === 'ruleFalse') {
      filtered = filtered.filter((record) => {
        const message = getLocationMatchFalseMessage(record.evaluation_results);
        if (!message) return false;
        return deepLinkFilter.reason ? message === deepLinkFilter.reason : true;
      });
    } else if (deepLinkFilter?.issue === 'laajGap') {
      filtered = filtered.filter((record) => (
        hasRuleMetrics(record.evaluation_results) && !hasLaajMetrics(record.evaluation_results)
      ));
    }

    return alreadySorted ? filtered : [...filtered].sort(compareAdminEvaluationsByLatestDesc);

}

export function evaluationStats(records: EvaluationRecord[]): CategoryStats {
 const stats: CategoryStats = {total: records.length, pending:0, approved:0, hold:0, db_conflict:0, ready_for_approval:0, unconfirmed_map:0, missing:0, not_selected:0, deleted:0};
 for (const record of records) {
  if (record.status === 'pending') stats.pending++;
  if (record.status === 'approved') stats.approved++;
  if (record.status === 'hold') stats.hold++;
  if (record.status === 'db_conflict') stats.db_conflict++;
  if (record.status === 'deleted') stats.deleted++;
  if (isAdminEvaluationRecordMissing(record)) stats.missing++;
  if (isAdminEvaluationRecordNotSelected(record)) stats.not_selected++;
  if (isAdminEvaluationRecordReadyForApproval(record)) stats.ready_for_approval = (stats.ready_for_approval ?? 0) + 1;
  if (isAdminEvaluationRecordUnconfirmedMapLocation(record)) stats.unconfirmed_map = (stats.unconfirmed_map ?? 0) + 1;
 }
 return stats;
}

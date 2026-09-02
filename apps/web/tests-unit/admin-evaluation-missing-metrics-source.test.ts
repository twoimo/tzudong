import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin evaluation missing metric UI contracts', () => {
  test('keeps missing metric approval guard without exposing rerun status labels', () => {
    const pageSource = source('app/admin/evaluations/admin-evaluation-page.tsx');
    const tableSource = source('components/admin/EvaluationTableNew.tsx');
    const detailSource = source('components/admin/EvaluationDetailView.tsx');
    const slideSource = source('components/admin/EvaluationSlideView.tsx');

    expect(tableSource).not.toContain('renderEvaluationRerunBadge');
    expect(tableSource).not.toContain('evaluation_incomplete');
    expect(tableSource).toContain('disabled={loading || needsEvaluationRerun(record) || !canApproveAddressConsistencyRecord(record)}');
    expect(tableSource).not.toContain('평가 재실행' + ' 필요');
    expect(slideSource).toContain('const canApproveCurrent = !needsMetricRerun && canApproveAddressConsistencyRecord(currentRecord);');
    expect(slideSource).not.toContain('평가 재실행' + ' 필요');
    expect(pageSource).toContain('if (needsEvaluationRerun(record))');
    expect(detailSource).not.toContain('GitHub Actions 평가 단계 재실행' + ' 후보');
    expect(detailSource).toContain('getEvaluationBasisOrRerunText');
    expect(detailSource).not.toContain('평가 재실행' + ' 필요');
    expect(detailSource).not.toContain("'근거 내용 없음'");
  });

  test('does not expose unsafe bulk evaluator rerun actions in admin UI', () => {
    const pageSource = source('app/admin/evaluations/admin-evaluation-page.tsx');
    const tableSource = source('components/admin/EvaluationTableNew.tsx');
    const combined = `${pageSource}\n${tableSource}`;

    expect(combined).not.toContain('전체 재평가');
    expect(combined).not.toContain('일괄 재평가');
    expect(combined).not.toMatch(/rerunAll|resetAll|bulkRerun|bulkEvaluation/i);
    expect(pageSource).not.toContain('검수삭제');
    expect(pageSource).not.toContain('EVALUATION_DELETE_CONFIRMATION');
    expect(pageSource).toContain('검수복원');
    expect(pageSource).toContain('shouldAutoDeleteMissingEvaluationRecord');
  });
});

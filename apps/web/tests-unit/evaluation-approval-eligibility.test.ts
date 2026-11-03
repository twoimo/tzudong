import { describe, expect, test } from 'bun:test';

import { RESTAURANT_CATEGORIES } from '@/constants/categories';
import {
  evaluateApprovalEligibility,
  type ApprovalEligibility,
  type ApprovalEligibilityReason,
} from '@/lib/admin/evaluation-approval-eligibility';

// Synthetic raw DB JSON only; no provider responses or real restaurant data.
const numericMetrics = ['visit_authenticity', 'rb_inference_score', 'review_faithfulness_score'] as const;
const booleanMetrics = ['rb_grounding_TF', 'category_validity_TF', 'category_TF'] as const;
const basisMetrics = ['visit_authenticity', 'rb_inference_score', 'rb_grounding_TF', 'review_faithfulness_score'] as const;
function goodRaw() {
  return {
    status: 'pending', approved_name: null as string | null, origin_name: 'Fixture 강남점',
    naver_name: 'Fixture 강남점', google_name: null as string | null,
    updated_by_admin_id: null as string | null, created_by: null as string | null, source_type: 'crawler',
    is_missing: false, is_not_selected: false,
    db_error_message: null as unknown, db_error_details: null as unknown,
    lat: 37, lng: 127, geocoding_success: true, jibun_address: 'Fixture 지번',
    categories: ['한식'], tzuyang_review: 'Fixture review', trace_id: 'fixture-trace',
    youtube_link: 'https://www.youtube.com/watch?v=abcdefgh_-1',
    evaluation_results: {
      location_match_TF: {
        eval_value: true, match_status: 'matched', origin_name: 'Fixture 강남점',
        matched_name: 'Fixture 강남점', pending_reason: null as unknown, falseMessage: null as unknown,
        evidence_families: ['provider_candidate', 'source_geo'],
      },
      visit_authenticity: { eval_value: 1, eval_basis: 'Fixture visit basis' },
      rb_inference_score: { eval_value: 1, eval_basis: 'Fixture inference basis' },
      rb_grounding_TF: { eval_value: true, eval_basis: 'Fixture grounding basis' },
      review_faithfulness_score: { eval_value: 1, eval_basis: 'Fixture review basis' },
      category_validity_TF: { eval_value: true }, category_TF: { eval_value: true },
    },
  };
}
type Raw = ReturnType<typeof goodRaw>;
const passed: ApprovalEligibility = { state: 'local_checks_passed', reasons: [], requiresFinalServerValidation: true };
function blocked(raw: unknown, ...reasons: ApprovalEligibilityReason[]) {
  expect(evaluateApprovalEligibility(raw)).toEqual({ state: 'blocked', reasons, requiresFinalServerValidation: true });
}
function unknown(raw: unknown, reason: ApprovalEligibilityReason) {
  expect(evaluateApprovalEligibility(raw)).toEqual({ state: 'unknown', reasons: [reason], requiresFinalServerValidation: true });
}

describe('manual approval raw-row preflight', () => {
  test('pending/hold and administrator/user ownership do not prevent explicit human approval', () => {
    for (const status of ['pending', 'hold']) {
      for (const owner of [null, 'fixture-owner']) {
        const raw = { ...goodRaw(), status, updated_by_admin_id: owner, created_by: owner, source_type: 'user' };
        const before = structuredClone(raw);
        expect(evaluateApprovalEligibility(raw)).toEqual(passed);
        expect(raw).toEqual(before); // Classification copy/NULL markers must not mutate the source.
      }
    }
  });

  test('known nonmanual states block; unknown states never default to pending', () => {
    for (const status of ['approved', 'rejected', 'deleted', 'missing', 'not_selected', 'db_conflict', 'geocoding_failed', 'address_review_geocode_recovered']) {
      blocked({ ...goodRaw(), status }, 'STATUS_NOT_APPROVABLE');
    }
    for (const status of [undefined, null, '', 'PENDING', 'future-state', 0, {}, ' pending ']) {
      unknown({ ...goodRaw(), status }, 'STATUS_UNKNOWN');
    }
  });

  test('summary/projected rows require detail instead of fabricating missing basis', () => {
    const summary = goodRaw() as Record<string, unknown>;
    delete summary.tzuyang_review;
    delete summary.db_error_details;
    unknown({ ...summary, read_summary: { evaluation_issues: [] } }, 'DETAIL_REQUIRED');
    unknown(summary, 'DETAIL_REQUIRED');
    for (const key of ['evaluation_results', 'tzuyang_review', 'trace_id', 'db_error_details']) {
      const projection = goodRaw() as Record<string, unknown>;
      delete projection[key];
      unknown(projection, 'DETAIL_REQUIRED');
    }
    unknown({ ...goodRaw(), read_summary: null }, 'DETAIL_REQUIRED');
  });

  test('malformed containers and non-DB field types fail closed without throwing', () => {
    for (const raw of [undefined, null, [], 'provider secret', 4, true, new Date(), new Map()]) unknown(raw, 'INVALID_RAW_RECORD');
    for (const evaluation_results of ['provider secret', [], 1, false]) unknown({ ...goodRaw(), evaluation_results }, 'INVALID_RAW_RECORD');
    for (const key of ['origin_name', 'approved_name', 'naver_name', 'google_name', 'jibun_address', 'trace_id', 'tzuyang_review', 'youtube_link']) {
      unknown({ ...goodRaw(), [key]: {} }, 'INVALID_RAW_RECORD');
    }
    for (const key of ['is_missing', 'is_not_selected']) unknown({ ...goodRaw(), [key]: 'false' }, 'INVALID_RAW_RECORD');
    const raw = goodRaw();
    Object.defineProperty(raw, 'status', { get() { throw new Error('PRIVATE provider diagnostic'); } });
    unknown(raw, 'INVALID_RAW_RECORD');
  });

  test('raw DB nulls remain checkable missing evidence, not malformed detail', () => {
    const outcome = evaluateApprovalEligibility({ ...goodRaw(), evaluation_results: null });
    expect(outcome.state).toBe('blocked');
    expect(outcome.reasons).toContain('MISSING_EVALUATION');
    expect(outcome.reasons).toContain('MISSING_BASIS');
    expect(outcome.reasons).not.toContain('DETAIL_REQUIRED');
    blocked({ ...goodRaw(), tzuyang_review: null }, 'SOURCE_INCOMPLETE');
  });

  test('missing/not-selected flags block independently and false/null do not', () => {
    for (const key of ['is_missing', 'is_not_selected']) {
      blocked({ ...goodRaw(), [key]: true }, 'NOT_A_TARGET');
      for (const value of [false, null]) expect(evaluateApprovalEligibility({ ...goodRaw(), [key]: value })).toEqual(passed);
    }
  });

  test('all nonempty conflict shapes block, including false/zero/empty-array details', () => {
    for (const db_error_details of [{ code: 'PRIVATE' }, [], '', false, 0, 'PRIVATE', [{}]]) {
      blocked({ ...goodRaw(), db_error_details }, 'DATABASE_OR_IDENTITY_CONFLICT');
    }
    for (const db_error_details of [null, {}]) expect(evaluateApprovalEligibility({ ...goodRaw(), db_error_details })).toEqual(passed);
    for (const db_error_message of ['PRIVATE', ' ', false, 0, {}]) {
      blocked({ ...goodRaw(), db_error_message }, 'DATABASE_OR_IDENTITY_CONFLICT');
    }
    expect(evaluateApprovalEligibility({ ...goodRaw(), db_error_message: '' })).toEqual(passed);
  });

  test('bounded budgets return unknown, never a truncated success', () => {
    unknown({ ...goodRaw(), tzuyang_review: 'x'.repeat(65_537) }, 'INPUT_LIMIT_EXCEEDED');
    const raw = goodRaw();
    raw.evaluation_results.location_match_TF.evidence_families = Array(257).fill('source_geo');
    unknown(raw, 'INPUT_LIMIT_EXCEEDED');
    const basis = goodRaw();
    basis.evaluation_results.visit_authenticity.eval_basis = 'x'.repeat(65_537);
    unknown(basis, 'INPUT_LIMIT_EXCEEDED');
  });
});

describe('strict SQL identity and coordinates', () => {
  test('blank approval resolves origin first, then provider, unlike display-name selection', () => {
    for (const approved_name of [undefined, null, '', '   ']) {
      expect(evaluateApprovalEligibility({ ...goodRaw(), approved_name })).toEqual(passed);
      blocked({ ...goodRaw(), approved_name, naver_name: 'Fixture 부산점' }, 'NAME_REQUIRES_REVIEW');
    }
    // Falling back to provider cannot replace required source identity.
    blocked({ ...goodRaw(), origin_name: null }, 'NAME_REQUIRES_REVIEW', 'LOCATION_IDENTITY_MISMATCH');
    blocked({ ...goodRaw(), approved_name: 'Different 강남점' }, 'NAME_REQUIRES_REVIEW');
  });

  test('provider/matched branch identities must each agree; no fuzzy/NFKC normalization', () => {
    for (const key of ['naver_name', 'google_name']) {
      for (const name of ['Fixture 부산점', 'Fixture', 'Fixture강남점', 'Ｆixture 강남점']) {
        blocked({ ...goodRaw(), [key]: name }, 'NAME_REQUIRES_REVIEW');
      }
    }
    const raw = goodRaw();
    raw.evaluation_results.location_match_TF.matched_name = 'Fixture 부산점';
    blocked(raw, 'NAME_REQUIRES_REVIEW');
    const sourceMismatch = goodRaw();
    sourceMismatch.evaluation_results.location_match_TF.origin_name = 'Fixture 부산점';
    blocked(sourceMismatch, 'LOCATION_IDENTITY_MISMATCH');
  });

  test('case and ASCII spaces match; tabs/NBSP/newlines must not be JS-trimmed away', () => {
    expect(evaluateApprovalEligibility({ ...goodRaw(), approved_name: '  fixture 강남점  ', naver_name: ' FIXTURE 강남점 ' })).toEqual(passed);
    for (const whitespace of ['\t', '\n', '\u00a0', '\u3000']) {
      blocked({ ...goodRaw(), approved_name: `${whitespace}Fixture 강남점${whitespace}` }, 'NAME_REQUIRES_REVIEW');
      const raw = goodRaw();
      raw.evaluation_results.location_match_TF.origin_name = `${whitespace}Fixture 강남점`;
      blocked(raw, 'LOCATION_IDENTITY_MISMATCH');
    }
    const raw = goodRaw();
    raw.origin_name = 'Fixture 강남점 \n';
    raw.approved_name = 'Fixture 강남점 \n';
    raw.naver_name = 'Fixture 강남점 \n';
    raw.evaluation_results.location_match_TF.origin_name = 'Fixture 강남점\n';
    raw.evaluation_results.location_match_TF.matched_name = 'Fixture 강남점 \n';
    blocked(raw, 'LOCATION_IDENTITY_MISMATCH'); // Spaces before a final newline are not boundary spaces.
  });

  test('160-character approved name bound counts Unicode code points and original spaces', () => {
    const setName = (name: string): Raw => {
      const raw = goodRaw();
      raw.approved_name = name; raw.origin_name = name; raw.naver_name = name;
      raw.evaluation_results.location_match_TF.origin_name = name;
      raw.evaluation_results.location_match_TF.matched_name = name;
      return raw;
    };
    for (const name of ['가'.repeat(160), '😀'.repeat(160)]) expect(evaluateApprovalEligibility(setName(name))).toEqual(passed);
    blocked(setName('가'.repeat(161)), 'NAME_TOO_LONG');
    blocked(setName('😀'.repeat(161)), 'NAME_TOO_LONG');
    blocked(setName(` ${'가'.repeat(160)} `), 'NAME_TOO_LONG');
    const fallback = setName(` ${'가'.repeat(160)} `);
    fallback.approved_name = null;
    expect(evaluateApprovalEligibility(fallback)).toEqual(passed); // SQL resolver trims fallback.
  });

  test('geocoding true, typed finite inclusive ranges and jibun are independently required', () => {
    for (const patch of [
      { geocoding_success: false }, { geocoding_success: 'true' }, { lat: '37' }, { lng: '127' },
      { lat: null }, { lng: null }, { lat: NaN }, { lng: Infinity },
      { lat: -90.001 }, { lat: 90.001 }, { lng: -180.001 }, { lng: 180.001 },
      { jibun_address: null }, { jibun_address: '' }, { jibun_address: '   ', road_address: 'Fixture road' },
    ]) blocked({ ...goodRaw(), ...patch }, 'LOCATION_REQUIRES_REVIEW');
    for (const lat of [-90, 0, 90]) for (const lng of [-180, 0, 180]) {
      expect(evaluateApprovalEligibility({ ...goodRaw(), lat, lng })).toEqual(passed);
    }
  });
});

describe('location evidence and metric predicates', () => {
  test('location value and status are exact typed predicates', () => {
    for (const patch of [{ eval_value: false }, { eval_value: 1 }, { eval_value: 'true' }, { match_status: 'pending' }, { match_status: 'MATCHED' }, { match_status: null }]) {
      const raw = goodRaw();
      Object.assign(raw.evaluation_results.location_match_TF, patch);
      blocked(raw, 'LOCATION_EVIDENCE_INCOMPLETE');
    }
    const raw = goodRaw() as Record<string, unknown>;
    raw.evaluation_results = { ...goodRaw().evaluation_results, location_match_TF: [] };
    unknown(raw, 'INVALID_RAW_RECORD');
  });

  test('unknown pending reasons and false messages are blockers even if whitespace/false/zero', () => {
    for (const key of ['pending_reason', 'falseMessage'] as const) {
      for (const value of ['future_reason', ' ', false, 0, {}, [], 'timeout']) {
        const raw = goodRaw(); raw.evaluation_results.location_match_TF[key] = value;
        blocked(raw, 'LOCATION_EVIDENCE_INCOMPLETE');
      }
      for (const value of [null, undefined, '']) {
        const raw = goodRaw(); raw.evaluation_results.location_match_TF[key] = value;
        expect(evaluateApprovalEligibility(raw)).toEqual(passed);
      }
    }
  });

  test('at least two distinct allowed families; aliases, LLM and repeats do not count', () => {
    for (const families of [[], ['source_geo'], ['source_geo', 'source_geo'], ['source_geo', 'llm_verification'], ['LLM', 'future_family'], [' source_geo', 'provider_candidate']]) {
      const raw = goodRaw(); raw.evaluation_results.location_match_TF.evidence_families = families;
      blocked(raw, 'INDEPENDENT_LOCATION_EVIDENCE_REQUIRED');
    }
    const allowed = ['provider_candidate', 'source_geo', 'cross_provider', 'browser_verification', 'geocode_provider'];
    for (let i = 0; i < allowed.length; i++) for (let j = i + 1; j < allowed.length; j++) {
      const raw = goodRaw(); raw.evaluation_results.location_match_TF.evidence_families = [allowed[i], allowed[j], allowed[i], 'llm_verification'];
      expect(evaluateApprovalEligibility(raw)).toEqual(passed);
    }
    const raw = goodRaw();
    Object.assign(raw.evaluation_results.location_match_TF, { evidence_families: 'source_geo,provider_candidate' });
    blocked(raw, 'LOCATION_EVIDENCE_INCOMPLETE', 'INDEPENDENT_LOCATION_EVIDENCE_REQUIRED');
  });

  test('all six metrics reject mistyped/missing values without coercion', () => {
    for (const key of [...numericMetrics, ...booleanMetrics]) {
      const wrong = numericMetrics.includes(key as typeof numericMetrics[number]) ? [null, undefined, '1', true, {}, NaN, Infinity] : [null, undefined, 'true', 1, {}];
      for (const value of wrong) {
        const raw = goodRaw(); Object.assign(raw.evaluation_results[key], { eval_value: value });
        blocked(raw, 'MISSING_EVALUATION');
      }
    }
  });

  test('absent/null/malformed metric objects cannot masquerade as typed passes', () => {
    for (const key of [...numericMetrics, ...booleanMetrics]) for (const value of [null, undefined, [], 'PRIVATE', 1, true]) {
      const raw = goodRaw(); Object.assign(raw.evaluation_results, { [key]: value });
      const outcome = evaluateApprovalEligibility(raw);
      expect(outcome.state).toBe('blocked');
      expect(outcome.reasons).toContain('MISSING_EVALUATION');
      if (basisMetrics.includes(key as typeof basisMetrics[number])) expect(outcome.reasons).toContain('MISSING_BASIS');
      else expect(outcome.reasons).not.toContain('MISSING_BASIS');
    }
  });

  test('valid zero/false and other numeric scores are failures, never missing evaluation', () => {
    for (const key of numericMetrics) for (const value of [0, -1, 0.999, 2]) {
      const raw = goodRaw(); raw.evaluation_results[key].eval_value = value;
      blocked(raw, 'EVALUATION_FAILED');
    }
    for (const key of booleanMetrics) {
      const raw = goodRaw(); raw.evaluation_results[key].eval_value = false;
      blocked(raw, 'EVALUATION_FAILED');
    }
  });

  test('first four bases require strings and reject every sentinel independently', () => {
    for (const key of basisMetrics) for (const eval_basis of [null, undefined, 1, false, {}, [], '', ' ', '-', '근거 내용 없음', '평가 근거 없음', '평가근거없음', '  평가 근거 없음  ']) {
      const raw = goodRaw(); Object.assign(raw.evaluation_results[key], { eval_basis });
      blocked(raw, 'MISSING_BASIS');
    }
    for (const key of basisMetrics) {
      const raw = goodRaw(); raw.evaluation_results[key].eval_basis = '\t평가 근거 없음\t';
      expect(evaluateApprovalEligibility(raw)).toEqual(passed); // btrim != JS trim.
    }
    const raw = goodRaw();
    Object.assign(raw.evaluation_results.category_TF, { eval_basis: null });
    Object.assign(raw.evaluation_results.category_validity_TF, { eval_basis: '-' });
    expect(evaluateApprovalEligibility(raw)).toEqual(passed);
  });
});

describe('source/category validation and privacy', () => {
  test('categories must be canonical, unique, and length 1..15 without normalization', () => {
    for (const categories of [null, {}, '한식', [], ['한식', '한식'], ['한식 '], ['unknown'], [1], Array(16).fill('한식')]) {
      blocked({ ...goodRaw(), categories }, 'CATEGORIES_INVALID');
    }
    expect(evaluateApprovalEligibility({ ...goodRaw(), categories: [...RESTAURANT_CATEGORIES] })).toEqual(passed);
    for (const category of RESTAURANT_CATEGORIES) expect(evaluateApprovalEligibility({ ...goodRaw(), categories: [category] })).toEqual(passed);
  });

  test('raw review/trace must be nonblank; title/reasoning do not substitute', () => {
    for (const key of ['tzuyang_review', 'trace_id']) for (const value of [null, '', '   ']) {
      blocked({ ...goodRaw(), [key]: value, youtube_meta: { title: 'Fixture title' }, reasoning_basis: 'Fixture' }, 'SOURCE_INCOMPLETE');
    }
  });

  test('requires the exact SQL canonical watch URL, optional www, 11-character ID', () => {
    expect(evaluateApprovalEligibility({ ...goodRaw(), youtube_link: 'https://youtube.com/watch?v=abcdefgh_-1' })).toEqual(passed);
    for (const youtube_link of [null, '', 'abcdefgh_-1', 'https://youtu.be/abcdefgh_-1', 'https://www.youtube.com/shorts/abcdefgh_-1',
      'https://www.youtube.com/watch?v=abcdefgh_-1&t=1', 'https://www.youtube.com/watch?v=abcdefgh_-1#x',
      'http://www.youtube.com/watch?v=abcdefgh_-1', 'https://youtube.com.evil/watch?v=abcdefgh_-1',
      'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch?v=abcdefgh_-12',
      ' https://www.youtube.com/watch?v=abcdefgh_-1', 'https://www.youtube.com/watch?v=abcdefgh_-1\n']) {
      blocked({ ...goodRaw(), youtube_link }, 'CANONICAL_YOUTUBE_URL_REQUIRED');
    }
  });

  test('returns only unique fixed codes and always requires final server validation', () => {
    const privateText = 'PRIVATE_PROVIDER_NAME_ADDRESS_BASIS_REVIEW_ERROR';
    const raw = goodRaw(); raw.approved_name = privateText; raw.tzuyang_review = privateText;
    raw.db_error_message = privateText; raw.db_error_details = { provider: privateText };
    raw.evaluation_results.location_match_TF.pending_reason = privateText;
    for (const key of numericMetrics) raw.evaluation_results[key].eval_value = 0;
    const outcome = evaluateApprovalEligibility(raw);
    expect(outcome).toEqual({ state: 'blocked', reasons: ['DATABASE_OR_IDENTITY_CONFLICT', 'NAME_REQUIRES_REVIEW', 'LOCATION_EVIDENCE_INCOMPLETE', 'EVALUATION_FAILED'], requiresFinalServerValidation: true });
    expect(JSON.stringify(outcome)).not.toContain(privateText);
    expect(new Set(outcome.reasons).size).toBe(outcome.reasons.length);
    expect(Object.keys(outcome).sort()).toEqual(['reasons', 'requiresFinalServerValidation', 'state']);
    const first = evaluateApprovalEligibility(goodRaw());
    const second = evaluateApprovalEligibility(goodRaw());
    expect(first).toEqual(second); expect(first.reasons).not.toBe(second.reasons);
  });
});

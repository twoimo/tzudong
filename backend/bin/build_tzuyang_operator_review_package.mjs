#!/usr/bin/env node
/**
 * Build an operator review package from a Tzuyang case-review evidence pack.
 *
 * This script is read-only. It never writes Supabase.  It turns the Scrapling
 * case-review pack into:
 * - confirmed candidates for human review,
 * - priority review rows for supported-but-unconfirmed cases,
 * - Google/blog fallback queries,
 * - an empty approval template,
 * - fail-closed strict apply candidates generated only from explicit operator
 *   approvals.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_REPORT_ROOT = 'backend/restaurant-evaluation/reports';
const SCHEMA_VERSION = 1;

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseArgs(argv) {
  const args = {
    caseReviewDir: '',
    ledgerDir: '',
    out: '',
    operatorApprovalJson: '',
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--case-review-dir') args.caseReviewDir = argv[++i] || '';
    else if (arg === '--ledger-dir') args.ledgerDir = argv[++i] || '';
    else if (arg === '--out') args.out = argv[++i] || '';
    else if (arg === '--operator-approval-json') args.operatorApprovalJson = argv[++i] || '';
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node backend/bin/build_tzuyang_operator_review_package.mjs [--case-review-dir DIR] [--ledger-dir DIR] [--operator-approval-json FILE] [--out DIR] [--json]\n\nBuilds a read-only operator review package and approval-gated strict apply candidates.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.out) args.out = path.join(DEFAULT_REPORT_ROOT, `tzuyang-operator-review-package-${timestampSlug()}`);
  return args;
}

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function uniq(items) {
  return [...new Set(items.map((item) => norm(item)).filter(Boolean))];
}

function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function phoneHints(row) {
  const text = [
    row.origin_name,
    row.origin_address_text,
    ...(row.local_evidence || []).map((item) => item.summary),
    JSON.stringify(row.selected_place_candidate || {}),
  ].join(' ');
  return uniq([...text.matchAll(/(?:0\d{1,2}[-.\s]?)?\d{3,4}[-.\s]?\d{4}/g)].map((match) => match[0].replace(/\s+/g, '-'))).slice(0, 5);
}

function regionHints(row) {
  return uniq([
    ...(row.matched_evidence?.regions || []),
    row.origin_address_text,
    row.selected_place_candidate?.address,
  ]).slice(0, 8);
}

function quote(value) {
  const v = norm(value);
  return v ? `"${v}"` : '';
}

function buildFallbackQueries(row) {
  const name = norm(row.origin_name || row.selected_place_candidate?.name);
  const placeName = norm(row.selected_place_candidate?.name);
  const regions = regionHints(row);
  const region = regions[0] || norm(row.origin_address_text).split(/\s+/).slice(0, 2).join(' ');
  const phones = phoneHints(row);
  const placeId = row.selected_place_candidate?.place_id || '';
  const querySpecs = [
    ['google_name_region_tzuyang', `${quote(name)} ${region} 쯔양`],
    ['google_name_phone', phones[0] ? `${quote(name)} ${phones[0]}` : ''],
    ['google_name_region_phone', phones[0] ? `${quote(name)} ${region} ${phones[0]}` : ''],
    ['google_blog_review', `${quote(name)} ${region} 블로그 리뷰`],
    ['google_business_state', `${quote(name)} ${region} 상호변경 폐업 이전`],
    ['google_same_place_id', placeId ? `${quote(name || placeName)} ${placeId} 네이버지도` : ''],
    ['naver_blog_site_search', `site:blog.naver.com ${name} ${region}`],
    ['tistory_blog_site_search', `site:tistory.com ${name} ${region}`],
  ].filter(([, query]) => norm(query).length >= 3);
  return querySpecs.map(([purpose, query]) => ({
    id: row.id,
    video_id: row.video_id,
    origin_name: row.origin_name,
    purpose,
    query: norm(query),
    google_search_url: `https://www.google.com/search?q=${encodeURIComponent(norm(query))}`,
    manual_review_required: true,
  }));
}

function candidateRiskFlags(row) {
  const flags = [];
  const selected = row.selected_place_candidate || {};
  if (!isPresent(selected.place_id)) flags.push('missing_place_id');
  if (!isPresent(selected.lat) || !isPresent(selected.lng)) flags.push('missing_coordinates');
  if (!isPresent(selected.address)) flags.push('candidate_address_missing_or_not_precise');
  if (!(row.matched_evidence?.phones || []).length) flags.push('no_phone_match');
  if ((row.matched_evidence?.agreed_place_ids || []).length !== 1) flags.push('place_id_agreement_not_singleton');
  if ((row.matched_evidence?.high_confidence_local_video_evidence_count || 0) < 1) flags.push('insufficient_high_confidence_local_video_evidence');
  if ((row.matched_evidence?.local_video_family_count || 0) < 1) flags.push('insufficient_local_video_families');
  return flags;
}

function confirmedReviewRow(row) {
  return {
    schema_version: SCHEMA_VERSION,
    id: row.id,
    video_id: row.video_id,
    youtube_link: row.youtube_link,
    origin_name: row.origin_name,
    origin_address_text: row.origin_address_text,
    case_decision: row.case_decision,
    confidence: row.confidence,
    selected_place_candidate: row.selected_place_candidate,
    matched_evidence: row.matched_evidence,
    local_evidence: row.local_evidence,
    search_queries_attempted: row.search_queries_attempted,
    decision_reasons: row.decision_reasons,
    operator_checklist: [
      '영상/자막/간판에서 지역 및 상호가 selected_place_candidate와 충돌하지 않는지 확인',
      '네이버 지도 place_id, 좌표, 상호, 주소/상세주소를 브라우저에서 재확인',
      '전화번호가 있으면 전화번호 단독 검색 결과와 place가 일치하는지 확인',
      '폐업/이전/상호변경 블로그 리뷰가 있으면 동일 주소인지 확인',
      '승인 시 operator-approval-template.json을 채워 strict apply 후보 생성',
    ],
    risk_flags: candidateRiskFlags(row),
    recommended_operator_decision: candidateRiskFlags(row).length ? 'review_before_approval' : 'approval_candidate',
    db_write_performed: false,
    apply_candidate_generated: false,
  };
}

function reviewPriority(row) {
  const matched = row.matched_evidence || {};
  const blockers = row.decision_blockers || [];
  const placeCount = matched.map_place_candidate_count || 0;
  const highLocal = matched.high_confidence_local_video_evidence_count || 0;
  if (blockers.includes('no_cross_checked_precise_map_candidate') && placeCount > 0 && highLocal >= 1) return 'high';
  if ((matched.external_source_count || 0) > 0 && (matched.names || []).length && (matched.regions || []).length) return 'medium';
  return 'low';
}

function supportedReviewRow(row) {
  return {
    schema_version: SCHEMA_VERSION,
    id: row.id,
    video_id: row.video_id,
    youtube_link: row.youtube_link,
    origin_name: row.origin_name,
    origin_address_text: row.origin_address_text,
    priority: reviewPriority(row),
    case_decision: row.case_decision,
    confidence: row.confidence,
    decision_blockers: row.decision_blockers,
    matched_evidence: row.matched_evidence,
    selected_place_candidate: row.selected_place_candidate,
    next_manual_steps: [
      'fallback-queries.jsonl의 Google/블로그 쿼리를 우선순위대로 확인',
      '동일 place_id가 최소 2개 독립 쿼리에서 반복되는지 확인',
      '주소/전화번호/상호변경/폐업 근거가 영상 단서와 충돌하지 않는지 확인',
    ],
    db_write_performed: false,
  };
}

function normalizeApprovals(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.approvals)) return payload.approvals;
  if (payload.approval) return [payload.approval];
  return [];
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readJsonl(file, missingOk = false) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (missingOk && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(file, rows) {
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

async function latestDir(reportRoot, pattern, requiredFile) {
  const entries = await fs.readdir(reportRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => path.join(reportRoot, entry.name))
    .sort()
    .reverse();
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, requiredFile));
      return candidate;
    } catch {
      // Keep scanning.
    }
  }
  throw new Error(`No ${pattern} report with ${requiredFile} found under ${reportRoot}`);
}

function approvalFailures(approval, row) {
  const failures = [];
  const selected = row?.selected_place_candidate || {};
  if (!row) failures.push('id_not_in_confirmed_external_place');
  if (approval.approved !== true) failures.push('approval_not_true');
  if (!isPresent(approval.approved_by)) failures.push('approved_by_required');
  if (!isPresent(approval.approved_at)) failures.push('approved_at_required');
  if (!isPresent(approval.operator_notes)) failures.push('operator_notes_required');
  if (!isPresent(approval.road_address) && !isPresent(approval.jibun_address)) failures.push('approved_precise_address_required');
  if (!Number.isFinite(Number(approval.lat ?? selected.lat))) failures.push('lat_required');
  if (!Number.isFinite(Number(approval.lng ?? selected.lng))) failures.push('lng_required');
  if (row && isPresent(approval.place_id) && String(approval.place_id) !== String(selected.place_id)) failures.push('place_id_mismatch');
  return failures;
}

function buildApplyCandidate(approval, row, sourceManualRow, generatedAt) {
  const selected = row.selected_place_candidate || {};
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    id: row.id,
    video_id: row.video_id,
    youtube_link: row.youtube_link,
    scope_status: 'target',
    decision: 'apply_candidate',
    confidence: 'operator_approved',
    db_snapshot: sourceManualRow?.db_snapshot || {
      origin_name: row.origin_name,
      origin_address_text: row.origin_address_text,
    },
    evidence_families: row.local_evidence_families || [],
    strict_predicate_result: {
      pass: true,
      source: 'operator_approval_json',
      required_checks: [
        'confirmed_external_place_source_row',
        'operator_approved_true',
        'operator_identity_and_timestamp_present',
        'operator_notes_present',
        'precise_address_present',
        'coordinates_present',
        'place_id_not_mismatched',
      ],
    },
    risk_flags: [],
    candidate_places: [
      {
        name: approval.confirmed_name || selected.name || row.origin_name,
        road_address: approval.road_address || null,
        jibun_address: approval.jibun_address || null,
        lat: Number(approval.lat ?? selected.lat),
        lng: Number(approval.lng ?? selected.lng),
        naver_place_id: String(approval.place_id || selected.place_id || ''),
        source_url: selected.url || null,
        derived_from_current_evidence: true,
      },
    ],
    source_artifacts: {
      case_review_row: row.id,
      selected_place_candidate: selected,
      approval_source: 'operator-approval-json',
    },
    operator_approval: {
      approved_by: approval.approved_by,
      approved_at: approval.approved_at,
      operator_notes: approval.operator_notes,
      evidence_urls: approval.evidence_urls || [],
    },
  };
}

function approvalTemplate(confirmedRows) {
  return {
    schema_version: SCHEMA_VERSION,
    instructions_ko: '승인할 row만 approvals에 넣으세요. approved=true, approved_by, approved_at, operator_notes, place_id, road_address 또는 jibun_address, lat/lng가 필요합니다. 이 파일이 비어 있으면 apply-candidates.jsonl은 0건입니다.',
    approvals: confirmedRows.map((row) => ({
      id: row.id,
      approved: false,
      approved_by: '',
      approved_at: '',
      place_id: row.selected_place_candidate?.place_id || '',
      confirmed_name: row.origin_name || row.selected_place_candidate?.name || '',
      road_address: '',
      jibun_address: '',
      lat: row.selected_place_candidate?.lat ?? null,
      lng: row.selected_place_candidate?.lng ?? null,
      operator_notes: '',
      evidence_urls: [
        row.selected_place_candidate?.url,
        ...(row.search_attempts || []).flatMap((attempt) => (attempt.top_results || []).map((result) => result.url)).filter(Boolean).slice(0, 4),
      ].filter(Boolean),
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.caseReviewDir ||= await latestDir(DEFAULT_REPORT_ROOT, /^tzuyang-address-case-review-scrapling-\d{8}T\d{6}Z$/, 'case-review.jsonl');
  args.ledgerDir ||= await latestDir(DEFAULT_REPORT_ROOT, /^tzuyang-address-evidence-ledger-\d{8}T\d{6}Z$/, 'manual-review-queue.jsonl');
  await fs.mkdir(args.out, { recursive: true });
  const generatedAt = new Date().toISOString();
  const rows = await readJsonl(path.join(args.caseReviewDir, 'case-review.jsonl'));
  const manualRows = await readJsonl(path.join(args.ledgerDir, 'manual-review-queue.jsonl'), true);
  const manualById = new Map(manualRows.map((row) => [row.id, row]));
  const confirmedRows = rows.filter((row) => row.case_decision === 'confirmed_external_place');
  const supportedRows = rows.filter((row) => row.case_decision === 'externally_supported_needs_operator_review');
  const reviewRows = rows.filter((row) => row.case_decision !== 'confirmed_external_place');
  const confirmedOperatorRows = confirmedRows.map(confirmedReviewRow);
  const supportedPriorityRows = supportedRows.map(supportedReviewRow)
    .sort((a, b) => ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority));
  const fallbackRows = reviewRows.flatMap(buildFallbackQueries);
  const approvals = args.operatorApprovalJson
    ? normalizeApprovals(await readJson(args.operatorApprovalJson))
    : [];
  const confirmedById = new Map(confirmedRows.map((row) => [row.id, row]));
  const applyCandidates = [];
  const approvalRejections = [];
  for (const approval of approvals) {
    const row = confirmedById.get(approval.id);
    const failures = approvalFailures(approval, row);
    if (row && !manualById.has(row.id)) failures.push('source_manual_review_row_missing');
    if (failures.length) {
      approvalRejections.push({ id: approval.id || null, failures, approval });
      continue;
    }
    applyCandidates.push(buildApplyCandidate(approval, row, manualById.get(row.id), generatedAt));
  }
  const decisionCounts = rows.reduce((acc, row) => {
    acc[row.case_decision] = (acc[row.case_decision] || 0) + 1;
    return acc;
  }, {});
  const priorityCounts = supportedPriorityRows.reduce((acc, row) => {
    acc[row.priority] = (acc[row.priority] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    mode: 'read_only_operator_review_package',
    db_write_performed: false,
    output_dir: args.out,
    source_case_review_dir: args.caseReviewDir,
    source_ledger_dir: args.ledgerDir,
    total_case_rows: rows.length,
    source_decision_counts: Object.fromEntries(Object.entries(decisionCounts).sort(([a], [b]) => a.localeCompare(b))),
    confirmed_operator_review_rows: confirmedOperatorRows.length,
    supported_operator_review_rows: supportedPriorityRows.length,
    supported_priority_counts: Object.fromEntries(Object.entries(priorityCounts).sort(([a], [b]) => a.localeCompare(b))),
    fallback_query_rows: fallbackRows.length,
    operator_approvals_supplied: approvals.length,
    strict_apply_candidates: applyCandidates.length,
    approval_rejections: approvalRejections.length,
    destructive_apply_allowed_by_this_script: false,
    ui_api_connection_excluded: true,
  };
  await writeJson(path.join(args.out, 'summary.json'), summary);
  await writeJsonl(path.join(args.out, 'confirmed-operator-review.jsonl'), confirmedOperatorRows);
  await writeJsonl(path.join(args.out, 'supported-review-priority.jsonl'), supportedPriorityRows);
  await writeJsonl(path.join(args.out, 'fallback-queries.jsonl'), fallbackRows);
  await writeJson(path.join(args.out, 'operator-approval-template.json'), approvalTemplate(confirmedRows));
  await writeJsonl(path.join(args.out, 'approval-rejections.jsonl'), approvalRejections);
  await writeJsonl(path.join(args.out, 'apply-candidates.jsonl'), applyCandidates);
  await fs.writeFile(path.join(args.out, 'README.md'), `# 쯔양 operator review package\n\n- 생성시각: ${summary.generated_at}\n- 모드: 읽기 전용 / DB 쓰기 없음\n- UI/API 연결: 이번 범위에서 제외\n- Source case review: ${summary.source_case_review_dir}\n- confirmed operator review rows: ${summary.confirmed_operator_review_rows}\n- supported review rows: ${summary.supported_operator_review_rows}\n- fallback queries: ${summary.fallback_query_rows}\n- strict apply candidates: ${summary.strict_apply_candidates}\n\n## 파일\n\n- confirmed-operator-review.jsonl: 8건 확정 후보의 운영자 체크리스트/리스크\n- supported-review-priority.jsonl: externally_supported_needs_operator_review 우선순위 검토 목록\n- fallback-queries.jsonl: Google/블로그 보강 검색 URL/쿼리\n- operator-approval-template.json: 운영자 승인 입력 템플릿\n- apply-candidates.jsonl: 승인 JSON이 통과한 경우만 생성되는 strict 후보; 승인 없으면 0건\n- approval-rejections.jsonl: 승인 JSON 거절 사유\n\n주의: 이 스크립트는 Supabase를 갱신하지 않습니다. apply-candidates도 기존 guarded dry-run/readback 이후에만 사용할 수 있습니다.\n`, 'utf8');
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(`Wrote ${args.out} (confirmed=${summary.confirmed_operator_review_rows}, supported=${summary.supported_operator_review_rows}, fallback=${summary.fallback_query_rows}, apply=${summary.strict_apply_candidates})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

export {
  buildFallbackQueries,
  candidateRiskFlags,
  approvalFailures,
  buildApplyCandidate,
  confirmedReviewRow,
  supportedReviewRow,
};

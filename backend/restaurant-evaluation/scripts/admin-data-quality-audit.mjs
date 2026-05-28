#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SELECT_COLUMNS = [
  'id',
  'approved_name',
  'origin_name',
  'naver_name',
  'google_name',
  'phone',
  'categories',
  'status',
  'updated_by_admin_id',
  'road_address',
  'jibun_address',
  'origin_address',
  'lat',
  'lng',
  'youtube_link',
  'evaluation_results',
  'updated_at',
  'created_at',
].join(',');

export function extractVideoId(url = '') {
  const value = String(url || '');
  return value.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1]
    || value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)?.[1]
    || value.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/)?.[1]
    || value.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/)?.[1]
    || '';
}

export function normalizeIdentityText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\[[^\]]+\]|\([^)]*추정[^)]*\)|\([^)]*또는[^)]*\)/g, ' ')
    .replace(/[\s·・ㆍ._\-–—,，()（）\[\]{}<>《》"'`´’‘“”]/g, '')
    .replace(/본점$|점$|입구$/g, '')
    .trim();
}

function resolveIdentityName(row) {
  return row.approved_name || row.origin_name || row.naver_name || row.google_name || '';
}

function displayName(row) {
  return row.approved_name || row.origin_name || row.naver_name || row.google_name || '(이름 없음)';
}

function addressText(row) {
  const originAddress = row.origin_address && typeof row.origin_address === 'object'
    ? row.origin_address.address
    : null;
  return row.jibun_address || row.road_address || originAddress || '';
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function nameTokens(row) {
  return [...new Set([row.approved_name, row.origin_name, row.naver_name, row.google_name]
    .map(normalizeIdentityText)
    .filter(Boolean))];
}

function rawNameTokens(value) {
  return [...new Set(String(value || '')
    .normalize('NFKC')
    .replace(/\(([^)]*)\)|（([^）]*)）/g, ' $1 $2 ')
    .replace(/[·・ㆍ._\-–—,，\[\]{}<>《》"'`´’‘“”:：]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !['구', '현', '전', '내', '본점'].includes(token)))];
}

function stripBranchSuffix(token) {
  return token.replace(/점$/, '').trim();
}

function resolveCandidateName(row) {
  return row.approved_name || row.naver_name || row.google_name || row.restaurant_name || row.name || '';
}

function hasNameCompatibility(originName, candidateName) {
  const origin = normalizeIdentityText(originName);
  const candidate = normalizeIdentityText(candidateName);
  if (!origin || !candidate) return true;
  if (origin === candidate) return true;
  if (origin.length >= 3 && candidate.includes(origin)) return true;
  if (candidate.length >= 3 && origin.includes(candidate)) return true;

  const originTokens = rawNameTokens(originName).map(stripBranchSuffix).map(normalizeIdentityText).filter(Boolean);
  const candidateTokens = rawNameTokens(candidateName).map(stripBranchSuffix).map(normalizeIdentityText).filter(Boolean);
  return originTokens.some((originToken) => candidateTokens.some((candidateToken) => (
    originToken === candidateToken
      || (originToken.length >= 3 && candidateToken.includes(originToken))
      || (candidateToken.length >= 3 && originToken.includes(candidateToken))
  )));
}

function missingBranchTokens(originName, candidateName) {
  const candidate = normalizeIdentityText(candidateName);
  return rawNameTokens(originName)
    .filter((token) => /점$/.test(token) || /파크|몰|백화점|시장|역|센터|지하|본점/.test(token))
    .filter((token) => {
      const normalizedToken = normalizeIdentityText(stripBranchSuffix(token));
      return normalizedToken.length >= 2 && !candidate.includes(normalizedToken);
    });
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function similarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if ((left.length >= 4 && right.includes(left)) || (right.length >= 4 && left.includes(right))) return 0.96;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
}

function bestNameSimilarity(left, right) {
  let best = 0;
  let pair = null;
  for (const a of nameTokens(left)) {
    for (const b of nameTokens(right)) {
      const score = similarity(a, b);
      if (score > best) {
        best = score;
        pair = [a, b];
      }
    }
  }
  return { best, pair };
}

function coordDistanceMeters(left, right) {
  if (typeof left.lat !== 'number' || typeof left.lng !== 'number' || typeof right.lat !== 'number' || typeof right.lng !== 'number') {
    return Infinity;
  }
  const radius = 6371000;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(right.lat - left.lat);
  const dLng = toRad(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function pairEvidence(left, right) {
  const leftIdentity = normalizeIdentityText(resolveIdentityName(left));
  const rightIdentity = normalizeIdentityText(resolveIdentityName(right));
  const sameIdentity = Boolean(leftIdentity && leftIdentity === rightIdentity);
  const leftAddress = normalizeIdentityText(addressText(left));
  const rightAddress = normalizeIdentityText(addressText(right));
  const sameAddress = Boolean(leftAddress && leftAddress === rightAddress);
  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  const samePhone = Boolean(leftPhone && rightPhone && leftPhone.length >= 7 && leftPhone === rightPhone);
  const distance = coordDistanceMeters(left, right);
  const { best, pair } = bestNameSimilarity(left, right);
  const sharedName = nameTokens(left).some((token) => nameTokens(right).includes(token));

  if (sameIdentity) {
    return { rule: 'same_video_exact_identity', confidence: 1, failLevel: 'fail' };
  }
  if (samePhone && best >= 0.72) {
    return { rule: 'same_video_same_phone_similar_name', confidence: 0.98, failLevel: 'warn' };
  }
  if (sameAddress && best >= 0.82) {
    return { rule: 'same_video_same_address_similar_name', confidence: 0.97, failLevel: 'warn' };
  }
  if (Number.isFinite(distance) && distance <= 20 && best >= 0.86) {
    return { rule: 'same_video_near_coordinate_similar_name', confidence: 0.96, failLevel: 'warn' };
  }
  if (sameAddress && sharedName) {
    return { rule: 'same_video_same_address_shared_name_token', confidence: 0.95, failLevel: 'warn' };
  }

  return null;
}

function getEvalFlagFalse(row, key) {
  const value = row?.evaluation_results?.[key];
  if (Array.isArray(value)) return value.some((item) => item?.eval_value === false);
  if (value && typeof value === 'object') return value.eval_value === false;
  return value === false;
}

function getNumericEvalValue(row, key) {
  const value = row?.evaluation_results?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.eval_value === 'number' && Number.isFinite(value.eval_value) ? value.eval_value : null;
}

function getBooleanEvalValue(row, key) {
  const value = row?.evaluation_results?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.eval_value === 'boolean' ? value.eval_value : null;
}

function isSameVideoSameOriginDeleted(target, related) {
  if (related.id === target.id || related.status !== 'deleted') return false;
  const targetVideoId = extractVideoId(target.youtube_link);
  const relatedVideoId = extractVideoId(related.youtube_link);
  if (!targetVideoId || targetVideoId !== relatedVideoId) return false;
  const targetOrigin = normalizeIdentityText(target.origin_name || '');
  const relatedOrigin = normalizeIdentityText(related.origin_name || '');
  if (targetOrigin && relatedOrigin && targetOrigin === relatedOrigin) return true;
  const targetCandidate = normalizeIdentityText(resolveCandidateName(target));
  const relatedCandidate = normalizeIdentityText(resolveCandidateName(related));
  return Boolean(targetCandidate && relatedCandidate && targetCandidate === relatedCandidate);
}

function identityWarningsForRow(row, rows) {
  if (row.status === 'deleted') return [];
  const warnings = [];
  const originName = row.origin_name || '';
  const candidateName = resolveCandidateName(row);
  const compatible = originName && candidateName ? hasNameCompatibility(originName, candidateName) : true;

  if (originName && candidateName && !compatible) {
    const severity = getBooleanEvalValue(row, 'location_match_TF') === true ? 'block' : 'warn';
    warnings.push({ rule: 'provider_name_mismatch', severity, message: `origin=${originName}, candidate=${candidateName}` });
  }

  if (originName && candidateName && compatible) {
    const missing = missingBranchTokens(originName, candidateName);
    if (missing.length > 0) {
      warnings.push({ rule: 'missing_branch_context', severity: 'warn', message: `missing=${missing.join(',')}` });
    }
  }

  if (getBooleanEvalValue(row, 'location_match_TF') === true && !compatible && (getNumericEvalValue(row, 'visit_authenticity') === 0 || getNumericEvalValue(row, 'rb_inference_score') === 0)) {
    warnings.push({ rule: 'contradictory_visit_evidence', severity: 'block', message: 'location_match=true but visit/inference rejects candidate' });
  }

  const deletedMatches = rows.filter((candidate) => isSameVideoSameOriginDeleted(row, candidate));
  if (deletedMatches.length > 0) {
    warnings.push({ rule: 'deleted_same_video_identity', severity: 'warn', message: `${deletedMatches.length} deleted tombstone(s)` });
  }

  return warnings;
}

function summarizeRow(row) {
  return {
    id: row.id,
    name: displayName(row),
    status: row.status,
    adminTouched: Boolean(row.updated_by_admin_id),
    address: addressText(row) || null,
    youtubeVideoId: extractVideoId(row.youtube_link),
    updatedAt: row.updated_at || null,
  };
}

export function auditRestaurantRows(rows, { sampleLimit = 20 } = {}) {
  const activeRows = rows.filter((row) => row.status !== 'deleted' && extractVideoId(row.youtube_link));
  const byVideo = new Map();
  const exactGroups = new Map();
  const pairEdges = [];

  for (const row of activeRows) {
    const videoId = extractVideoId(row.youtube_link);
    if (!byVideo.has(videoId)) byVideo.set(videoId, []);
    byVideo.get(videoId).push(row);

    const identity = normalizeIdentityText(resolveIdentityName(row));
    if (identity) {
      const key = `${videoId}\u0000${identity}`;
      if (!exactGroups.has(key)) exactGroups.set(key, { videoId, identity, rows: [] });
      exactGroups.get(key).rows.push(row);
    }
  }

  for (const [videoId, group] of byVideo) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const evidence = pairEvidence(group[i], group[j]);
        if (evidence) {
          pairEdges.push({
            videoId,
            leftId: group[i].id,
            rightId: group[j].id,
            leftName: displayName(group[i]),
            rightName: displayName(group[j]),
            evidence: {
              ...evidence,
              nameSimilarity: Number(bestNameSimilarity(group[i], group[j]).best.toFixed(3)),
            },
          });
        }
      }
    }
  }

  const exactDuplicateGroups = [...exactGroups.values()]
    .filter((group) => group.rows.length > 1)
    .map((group) => ({
      videoId: group.videoId,
      identity: group.identity,
      rows: group.rows.map(summarizeRow),
    }))
    .sort((left, right) => right.rows.length - left.rows.length || left.videoId.localeCompare(right.videoId));

  const fuzzyPairEdges = pairEdges
    .filter((edge) => edge.evidence.rule !== 'same_video_exact_identity')
    .sort((left, right) => right.evidence.confidence - left.evidence.confidence || left.videoId.localeCompare(right.videoId));

  const categoryTFRows = rows.filter((row) => row.status !== 'deleted' && getEvalFlagFalse(row, 'category_TF')).map(summarizeRow);
  const categoryValidityRows = rows.filter((row) => row.status !== 'deleted' && getEvalFlagFalse(row, 'category_validity_TF')).map(summarizeRow);
  const identityWarningRows = activeRows
    .map((row) => ({ row, warnings: identityWarningsForRow(row, rows) }))
    .filter((entry) => entry.warnings.length > 0)
    .map((entry) => ({ ...summarizeRow(entry.row), warnings: entry.warnings }));
  const identityBlockingRows = identityWarningRows.filter((entry) => entry.warnings.some((warning) => warning.severity === 'block'));

  return {
    ok: exactDuplicateGroups.length === 0 && identityBlockingRows.length === 0,
    generatedAt: new Date().toISOString(),
    counts: {
      totalRows: rows.length,
      activeRows: activeRows.length,
      videos: byVideo.size,
      exactDuplicateGroups: exactDuplicateGroups.length,
      exactDuplicateRows: exactDuplicateGroups.reduce((sum, group) => sum + group.rows.length, 0),
      fuzzyCandidatePairs: fuzzyPairEdges.length,
      categoryTFFalseRows: categoryTFRows.length,
      categoryValidityFalseRows: categoryValidityRows.length,
      identityWarningRows: identityWarningRows.length,
      identityBlockingRows: identityBlockingRows.length,
    },
    samples: {
      exactDuplicateGroups: exactDuplicateGroups.slice(0, sampleLimit),
      fuzzyCandidatePairs: fuzzyPairEdges.slice(0, sampleLimit),
      categoryTFFalseRows: categoryTFRows.slice(0, sampleLimit),
      categoryValidityFalseRows: categoryValidityRows.slice(0, sampleLimit),
      identityWarningRows: identityWarningRows.slice(0, sampleLimit),
    },
  };
}

export function renderAuditMarkdown(report) {
  const status = report.ok ? 'PASS' : 'FAIL';
  const lines = [
    '### Admin data quality gate',
    '',
    `- Status: **${status}**`,
    `- Active rows: ${report.counts.activeRows}`,
    `- Same-video exact duplicate groups: ${report.counts.exactDuplicateGroups}`,
    `- Same-video fuzzy candidate pairs: ${report.counts.fuzzyCandidatePairs}`,
    `- category_TF=false active rows: ${report.counts.categoryTFFalseRows}`,
    `- category_validity_TF=false active rows: ${report.counts.categoryValidityFalseRows}`,
    `- identity warning rows: ${report.counts.identityWarningRows}`,
    `- identity blocking rows: ${report.counts.identityBlockingRows}`,
    '',
  ];

  if (report.samples.exactDuplicateGroups.length > 0) {
    lines.push('#### Exact duplicate groups requiring action', '');
    for (const group of report.samples.exactDuplicateGroups) {
      lines.push(`- video=${group.videoId}, identity=${group.identity}, rows=${group.rows.map((row) => `${row.name}(${row.id})`).join(', ')}`);
    }
    lines.push('');
  }

  if (report.samples.fuzzyCandidatePairs.length > 0) {
    lines.push('#### Fuzzy duplicate candidates for operator review', '');
    for (const edge of report.samples.fuzzyCandidatePairs) {
      lines.push(`- video=${edge.videoId}, rule=${edge.evidence.rule}, confidence=${edge.evidence.confidence}: ${edge.leftName}(${edge.leftId}) ↔ ${edge.rightName}(${edge.rightId})`);
    }
    lines.push('');
  }

  if (report.samples.identityWarningRows.length > 0) {
    lines.push('#### Identity and provider-name warnings', '');
    for (const row of report.samples.identityWarningRows) {
      lines.push(`- video=${row.youtubeVideoId}, row=${row.name}(${row.id}), rules=${row.warnings.map((warning) => `${warning.severity}:${warning.rule}`).join(', ')}`);
    }
    lines.push('');
  }

  if (report.samples.categoryTFFalseRows.length > 0 || report.samples.categoryValidityFalseRows.length > 0) {
    lines.push('#### Category consistency rows to review', '');
    for (const row of report.samples.categoryTFFalseRows) {
      lines.push(`- category_TF=false: ${row.name}(${row.id}) video=${row.youtubeVideoId}`);
    }
    for (const row of report.samples.categoryValidityFalseRows) {
      lines.push(`- category_validity_TF=false: ${row.name}(${row.id}) video=${row.youtubeVideoId}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = { failOnExact: false, sampleLimit: 20, output: null, markdown: null, input: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fail-on-exact') args.failOnExact = true;
    else if (arg === '--output') args.output = argv[++index];
    else if (arg === '--markdown') args.markdown = argv[++index];
    else if (arg === '--input') args.input = argv[++index];
    else if (arg === '--sample-limit') args.sampleLimit = Number(argv[++index] || 20);
    else if (arg === '--help') {
      console.log('Usage: node admin-data-quality-audit.mjs [--input rows.json] [--output report.json] [--markdown report.md] [--fail-on-exact]');
      process.exit(0);
    }
  }
  return args;
}

async function fetchRowsFromSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for live audit');
  }

  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const endpoint = new URL('/rest/v1/restaurants', supabaseUrl);
    endpoint.searchParams.set('select', DEFAULT_SELECT_COLUMNS);
    endpoint.searchParams.set('offset', String(offset));
    endpoint.searchParams.set('limit', String(pageSize));
    endpoint.searchParams.set('order', 'created_at.desc,id.asc');

    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase REST restaurants audit failed: ${response.status} ${body}`.trim());
    }

    const data = await response.json();
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = args.input
    ? JSON.parse(fs.readFileSync(args.input, 'utf8'))
    : await fetchRowsFromSupabase();
  const report = auditRestaurantRows(rows, { sampleLimit: args.sampleLimit });
  const markdown = renderAuditMarkdown(report);

  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.markdown) {
    fs.mkdirSync(path.dirname(args.markdown), { recursive: true });
    fs.writeFileSync(args.markdown, markdown);
  }

  console.log(JSON.stringify(report, null, 2));
  if (args.failOnExact && (report.counts.exactDuplicateGroups > 0 || report.counts.identityBlockingRows > 0)) {
    console.error(`Admin data quality gate failed: ${report.counts.exactDuplicateGroups} exact duplicate group(s), ${report.counts.identityBlockingRows} identity blocking row(s).`);
    process.exit(2);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

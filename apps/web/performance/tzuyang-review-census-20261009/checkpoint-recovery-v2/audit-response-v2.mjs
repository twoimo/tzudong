const issues = new Set(['INTERNAL_MARKER','RAW_FORMATTING','DUPLICATE_WITHIN_REVIEW','BROKEN_PROSE','EDITORIAL_FIRST_PERSON','PROMOTIONAL_VOICE','CONTRADICTION','RECORD_MISMATCH','EMPTY_REVIEW','NEEDS_VIDEO_EVIDENCE']);

export function validateAuditRows(rows, binding) {
  return Array.isArray(rows) && rows.length === binding.rows && rows.every((row, index) =>
    row !== null && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).sort().join(',') === 'issues,key,revisedReview,status'
    && row.key === 'r'+String(binding.offset+index).padStart(4,'0')
    && ['ok','fix','needs_source'].includes(row.status)
    && Array.isArray(row.issues) && row.issues.every(issue => issues.has(issue))
    && typeof row.revisedReview === 'string'
    && (row.status === 'fix' ? !!row.revisedReview.trim() : !row.revisedReview));
}

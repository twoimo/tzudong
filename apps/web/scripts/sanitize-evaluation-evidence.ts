import { assertPrivacySafe, sanitizePrivacyValue } from '../lib/privacy/sanitize';
import { readFileSync } from 'node:fs';

// A pipe boundary: raw provider rows never go to disk or the command log.
const rows: unknown = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(rows) || rows.length > 2000) throw new Error('EVIDENCE_SHAPE_INVALID');
const context = { locationClass: 'business' as const, maxEntries: 1000, maxDepth: 16 };
function discardProviderDiagnostics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(discardProviderDiagnostics);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['falseMessage', 'evidence_summary', 'second_pass'].includes(key))
    .map(([key, child]) => [key, discardProviderDiagnostics(child)]));
}
const result = rows.map(row => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('EVIDENCE_SHAPE_INVALID');
  const record = row as Record<string, unknown>;
  // Validated database identities are not prose. Phone-pattern matching inside
  // UUIDs can collapse unrelated records into the same redaction marker.
  const identifiers: Record<string, unknown> = {};
  const prose = { ...record };
  for (const key of ['id', 'row_sha256', 'trace_id'] as const) {
    if (!(key in record)) continue;
    const value = record[key];
    if (key === 'trace_id' && value === null) {
      identifiers[key] = null;
      delete prose[key];
      continue;
    }
    const pattern = key === 'id'
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      : /^[0-9a-f]{64}$/;
    if (typeof value !== 'string' || !pattern.test(value)) throw new Error('EVIDENCE_IDENTITY_INVALID');
    identifiers[key] = value;
    delete prose[key];
  }
  const sanitized = sanitizePrivacyValue(discardProviderDiagnostics(prose), context);
  assertPrivacySafe(sanitized.value, context);
  return { row: { ...sanitized.value as Record<string, unknown>, ...identifiers },
    redactions: sanitized.findings.map(f => ({ kind: f.kind, count: f.count })) };
});
process.stdout.write(JSON.stringify(result));

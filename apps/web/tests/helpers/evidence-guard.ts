import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const FORBIDDEN_EVIDENCE_KINDS = [
  "cookie",
  "request-header",
  "local-storage",
  "admin-response-body",
  "table-content",
  "database-response",
] as const;

export type ForbiddenEvidenceKind = (typeof FORBIDDEN_EVIDENCE_KINDS)[number];

const FORBIDDEN_EVIDENCE_KEY_PATTERNS: ReadonlyArray<{
  kind: ForbiddenEvidenceKind;
  pattern: RegExp;
}> = [
  { kind: "cookie", pattern: /^(cookie|cookies|set-cookie|setCookie)$/i },
  {
    kind: "request-header",
    pattern: /^(request-header|request-headers|requestHeader|requestHeaders)$/i,
  },
  { kind: "local-storage", pattern: /^(local-storage|localStorage)$/i },
  {
    kind: "admin-response-body",
    pattern: /^(admin-response-body|adminResponseBody)$/i,
  },
  { kind: "table-content", pattern: /^(table-content|tableContent)$/i },
  {
    kind: "database-response",
    pattern: /^(database-response|databaseResponse|supabasePayload)$/i,
  },
];

export class EvidenceGuardError extends Error {
  readonly kinds: ForbiddenEvidenceKind[];

  constructor(kinds: ForbiddenEvidenceKind[]) {
    super(`evidence-guard: forbidden kinds present: ${kinds.join(", ")}`);
    this.name = "EvidenceGuardError";
    this.kinds = kinds;
  }
}

function classifyForbiddenKey(key: string): ForbiddenEvidenceKind | null {
  for (const { kind, pattern } of FORBIDDEN_EVIDENCE_KEY_PATTERNS) {
    if (pattern.test(key)) return kind;
  }
  return null;
}

function walkForbiddenKinds(
  value: unknown,
  found: Set<ForbiddenEvidenceKind>,
): void {
  if (value == null) return;

  if (Array.isArray(value)) {
    for (const entry of value) walkForbiddenKinds(entry, found);
    return;
  }

  if (typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const kind = classifyForbiddenKey(key);
    if (kind) found.add(kind);
    walkForbiddenKinds(nested, found);
  }
}

export function collectForbiddenEvidenceKinds(
  evidence: unknown,
): ForbiddenEvidenceKind[] {
  const found = new Set<ForbiddenEvidenceKind>();
  walkForbiddenKinds(evidence, found);
  return FORBIDDEN_EVIDENCE_KINDS.filter((kind) => found.has(kind));
}

export function assertEvidenceSafe(evidence: unknown): void {
  const kinds = collectForbiddenEvidenceKinds(evidence);
  if (kinds.length > 0) {
    throw new EvidenceGuardError(kinds);
  }
}

export function writeEvidenceIfSafe(
  filePath: string,
  evidence: unknown,
): void {
  assertEvidenceSafe(evidence);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

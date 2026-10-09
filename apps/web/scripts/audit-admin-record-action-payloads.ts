/** Independent audit adapter: execute current UI payload builders with synthetic I/O only. */
import { readFileSync } from 'node:fs';
import { parseRecordActionRequest } from '../lib/admin/record-action-contract';
import { submissionApprovalInput } from '../lib/admin/evaluation-record-actions';
import { normalizeCanonicalYouTubeWatchUrl } from '../lib/youtube-url';

const Bun = (globalThis as unknown as {
  Bun?: {
    stdin: { text(): Promise<string> };
    Transpiler: new (options: { loader: 'tsx' }) => { transformSync(code: string): string };
  };
}).Bun;
if (!Bun) throw new Error('AUDIT_BUN_RUNTIME_REQUIRED');

const input = JSON.parse(await Bun.stdin.text());
const uuid = '00000000-0000-4000-8000-000000000001';
const parse = (value: unknown) => {
  const parsed = parseRecordActionRequest({ ...(value as object), phase: 'preview', operationId: uuid });
  if (!parsed) throw Error('AUDIT_UI_REQUEST_INVALID');
  return parsed;
};
if (input.mode === 'submission') {
  process.stdout.write(JSON.stringify(parse(submissionApprovalInput(input.value))));
} else if (input.mode === 'modal') {
  const source = readFileSync(new URL('../components/admin/AdminRestaurantModal.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('    const handleSubmit = async (e: React.FormEvent) => {');
  const end = source.indexOf('\n    const handleDelete', start);
  if (start < 0 || end < 0) throw Error('AUDIT_UI_BUILDER_NOT_FOUND');
  const requests: unknown[] = [];
  const notices: unknown[] = [];
  const deps = {
    e: { preventDefault() {} }, isSubmitting: false, isGeocodingNaver: false,
    formData: input.value.formData, restaurant: input.value.restaurant ?? null,
    initialFormRef: { current: JSON.stringify(input.value.initialForm ?? {}) },
    isGeocoded: input.value.isGeocoded ?? true,
    deletedReviewIds: input.value.deletedReviewIds ?? [], normalizeCanonicalYouTubeWatchUrl,
    setIsSubmitting() {}, fetchYouTubeMeta: async () => input.value.meta ?? null,
    toast: { error: (v: unknown) => notices.push(v), warning: (v: unknown) => notices.push(v) },
    recordActions: { run: async (value: unknown) => { requests.push(parse(value)); return {}; } },
    refreshAfterAction: async () => {}, isRecordActionCancelled: () => false,
    recordActionErrorMessage: () => 'AUDIT_UI_BUILDER_REJECTED',
  };
  const body = new Bun.Transpiler({ loader: 'tsx' }).transformSync(
    `const {${Object.keys(deps).join(',')}} = deps; ${source.slice(start, end)}; return handleSubmit(e);`,
  );
  await new Function('deps', body)(deps);
  if (requests.length !== 1) throw Error(`AUDIT_UI_REQUEST_COUNT_${requests.length}:${JSON.stringify(notices)}`);
  process.stdout.write(JSON.stringify(requests[0]));
} else if (input.mode === 'edit') {
  const source = readFileSync(new URL('../components/admin/EditRestaurantModal.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const buildChanges = (forApproval = false): RestaurantRecordChanges => {');
  const end = source.indexOf('\n  const performApproval =', start);
  if (start < 0 || end < 0) throw Error('AUDIT_EDIT_BUILDER_NOT_FOUND');
  const deps = { ...input.value, initialFormRef: { current: JSON.stringify(input.value.initialForm) }, normalizeCanonicalYouTubeWatchUrl };
  const body = new Bun.Transpiler({ loader: 'tsx' }).transformSync(
    `const {${Object.keys(deps).join(',')}} = deps; ${source.slice(start, end)}; return buildChanges(forApproval);`,
  );
  const changes = new Function('deps', body)(deps);
  process.stdout.write(JSON.stringify(parse({ action: input.value.forApproval ? 'restaurant.approve' : 'restaurant.edit', targetIds: [input.value.id], payload: { changes } })));
} else if (input.mode === 'parse') {
  process.stdout.write(JSON.stringify(parse(input.value)));
} else {
  throw Error('AUDIT_UNKNOWN_MODE');
}

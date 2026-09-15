import { z } from 'zod';

export const catalogEditFields = ['approved_name', 'categories', 'lat', 'lng', 'road_address',
  'jibun_address', 'english_address', 'youtube_link', 'tzuyang_review'] as const;
const field = z.enum(catalogEditFields);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(1000).nullable();
const valuesSchema = z.object({
  approved_name: text, categories: z.array(z.string().max(64)).max(30).nullable(),
  lat: z.number().finite().min(-90).max(90).nullable(),
  lng: z.number().finite().min(-180).max(180).nullable(),
  road_address: text, jibun_address: text, english_address: text,
  youtube_link: text, tzuyang_review: z.string().max(20000).nullable(),
}).partial().strict();
const patchSchema = valuesSchema.extend({
  approved_name: z.string().trim().min(1).max(300).optional(),
  categories: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
}).refine(value => Object.keys(value).length > 0)
  .refine(value => ('lat' in value) === ('lng' in value))
  .refine(value => !['road_address', 'jibun_address', 'english_address'].some(key => key in value) || 'lat' in value);
const previewSchema = z.object({
  ok: z.literal(true), operationId: uuid,
  preview: z.object({ before: valuesSchema, after: valuesSchema, before_sha256: hash, preview_sha256: hash }).strict(),
}).strict();
const readbackSchema = z.object({
  ok: z.literal(true), operationId: uuid,
  readback: z.object({
    operation_id: uuid, restaurant_id: uuid, after_sha256: hash, current_sha256: hash,
    matches: z.literal(true), changed_fields: z.array(field).min(1).max(catalogEditFields.length),
    values: valuesSchema,
  }).strict(),
}).strict();

export type CatalogEditValues = z.infer<typeof valuesSchema>;
export type CatalogEditPatch = z.infer<typeof patchSchema>;
type Fetcher = typeof fetch;
type OperationStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type CatalogEditOutcome =
  | { kind: 'verified'; values: CatalogEditValues }
  | { kind: 'rejected' | 'pending'; code: string };

const messages: Record<string, string> = {
  LOCAL_WORKSPACE_REQUIRED: '로컬 작업 공간에서만 정보를 저장할 수 있습니다.',
  CATALOG_EDIT_FORBIDDEN: '관리자 권한을 확인한 후 다시 시도해주세요.',
  CATALOG_EDIT_CONFLICT: '정보가 변경되었거나 다른 항목과 충돌합니다. 최신 정보로 미리보기를 다시 확인해주세요.',
  CATALOG_EDIT_INVALID: '변경할 내용과 입력 범위를 확인해주세요. 변경 사항이 없을 수도 있습니다.',
  CATALOG_EDIT_LOCATION_INVALID: '선택한 주소의 좌표를 확인할 수 없습니다. 재지오코딩 후 올바른 주소를 선택해주세요.',
  CATALOG_EDIT_NOT_FOUND: '변경 결과를 찾지 못했습니다. 같은 작업의 결과 확인만 다시 할 수 있습니다.',
  CATALOG_EDIT_READBACK_CHANGED: '적용 후 정보가 다시 변경되었습니다. 저장 완료로 표시하지 않습니다. 결과를 다시 확인해주세요.',
  CATALOG_EDIT_RECOVERY_UNAVAILABLE: '작업 번호를 안전하게 보관할 수 없어 적용하지 않았습니다. 브라우저 저장소 설정을 확인해주세요.',
  CATALOG_EDIT_READBACK_ONLY: '이미 적용을 요청한 작업입니다. 결과 확인만 가능합니다.',
  CATALOG_EDIT_UNAVAILABLE: '정보를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.',
};
export function catalogEditMessage(code: string): string {
  return messages[code] ?? '적용 여부를 아직 확인하지 못했습니다. 다시 적용하지 말고 같은 작업의 결과를 확인해주세요.';
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
const keyFor = (restaurantId: string) => `local-catalog-edit:${uuid.parse(restaurantId)}`;
const browserStore = () => window.sessionStorage;

// Only operation IDs are retained. Form values, phone numbers and previews stay in memory.
export function pendingCatalogEdit(restaurantId: string, store: OperationStore = browserStore()): string | null {
  const value = store.getItem(keyFor(restaurantId));
  if (value === null) return null;
  if (!uuid.safeParse(value).success) throw new Error('CATALOG_EDIT_RECOVERY_UNAVAILABLE');
  return value;
}

export class LocalCatalogEditSession {
  readonly restaurantId: string;
  readonly operationId: string;
  readonly preview: z.infer<typeof previewSchema>['preview'] | null;
  private readonly patch: CatalogEditPatch | null;
  private attempted: boolean;
  private constructor(restaurantId: string, operationId: string,
    patch: CatalogEditPatch | null, preview: LocalCatalogEditSession['preview'],
    private readonly fetcher: Fetcher, private readonly store: () => OperationStore) {
    this.restaurantId = uuid.parse(restaurantId);
    this.operationId = uuid.parse(operationId);
    this.patch = patch;
    this.preview = preview;
    this.attempted = preview === null;
  }
  get readbackOnly(): boolean { return this.attempted; }

  static restore(restaurantId: string, operationId: string, fetcher: Fetcher = fetch,
    store: () => OperationStore = browserStore) {
    return new LocalCatalogEditSession(restaurantId, operationId, null, null, fetcher, store);
  }

  static async prepare(restaurantId: string, input: CatalogEditPatch, fetcher: Fetcher = fetch,
    store: () => OperationStore = browserStore): Promise<LocalCatalogEditSession> {
    const patch = patchSchema.safeParse(input);
    if (!uuid.safeParse(restaurantId).success || !patch.success) throw new Error('CATALOG_EDIT_INVALID');
    // Clone and freeze before awaiting the network: later form changes cannot alter this request.
    const snapshot = freeze(patch.data);
    const session = new LocalCatalogEditSession(restaurantId, '00000000-0000-4000-8000-000000000000', snapshot, null, fetcher, store);
    const { status, body } = await session.post({ phase: 'preview', patch: snapshot });
    const parsed = previewSchema.safeParse(body);
    if (status !== 200 || !parsed.success) throw new Error(session.errorCode(body, 'CATALOG_EDIT_UNAVAILABLE'));
    const { before, after } = parsed.data.preview;
    const keys = Object.keys(after) as (keyof CatalogEditValues)[];
    if (!keys.length || !same(Object.keys(before).sort(), [...keys].sort())
      || keys.some(key => !Object.hasOwn(snapshot, key) || !same(after[key], snapshot[key]))) {
      throw new Error('CATALOG_EDIT_UNAVAILABLE');
    }
    return new LocalCatalogEditSession(restaurantId, parsed.data.operationId, snapshot, freeze(parsed.data.preview), fetcher, store);
  }

  private async post(body: unknown): Promise<{ status: number; body: unknown }> {
    try {
      // Native browser fetch requires its global receiver, not this session.
      const fetcher = this.fetcher;
      const response = await fetcher(`/api/admin/restaurants/${this.restaurantId}/local-edit`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      return { status: response.status, body: await response.json() };
    } catch {
      return { status: 0, body: null };
    }
  }

  private errorCode(body: unknown, fallback: string): string {
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      && Object.hasOwn(messages, body.error)) return body.error;
    return fallback;
  }

  private finish(status: number, body: unknown): CatalogEditOutcome {
    const parsed = readbackSchema.safeParse(body);
    if (status === 200 && parsed.success) {
      const { operationId, readback } = parsed.data;
      if (operationId === this.operationId && readback.operation_id === this.operationId
        && readback.restaurant_id === this.restaurantId && readback.current_sha256 === readback.after_sha256
        && same([...readback.changed_fields].sort(), Object.keys(readback.values).sort())
        && (!this.preview || (same([...readback.changed_fields].sort(), Object.keys(this.preview.after).sort())
          && readback.changed_fields.every(key => same(readback.values[key], this.preview?.after[key]))))) {
        try { this.store().removeItem(keyFor(this.restaurantId)); } catch { /* Keep readback-only recovery available. */ }
        return { kind: 'verified', values: readback.values };
      }
    }
    return { kind: 'pending', code: this.errorCode(body, 'CATALOG_EDIT_OUTCOME_UNKNOWN') };
  }

  async apply(confirmation: string): Promise<CatalogEditOutcome> {
    if (this.attempted || !this.preview || !this.patch) return { kind: 'pending', code: 'CATALOG_EDIT_READBACK_ONLY' };
    if (confirmation !== '변경 적용') return { kind: 'rejected', code: 'CATALOG_EDIT_INVALID' };
    try {
      const store = this.store();
      const pending = pendingCatalogEdit(this.restaurantId, store);
      if (pending && pending !== this.operationId) return { kind: 'pending', code: 'CATALOG_EDIT_READBACK_ONLY' };
      store.setItem(keyFor(this.restaurantId), this.operationId);
      if (pendingCatalogEdit(this.restaurantId, store) !== this.operationId) throw new Error();
    } catch {
      return { kind: 'rejected', code: 'CATALOG_EDIT_RECOVERY_UNAVAILABLE' };
    }
    this.attempted = true;
    const { status, body } = await this.post({ phase: 'apply', patch: this.patch,
      operationId: this.operationId, previewSha256: this.preview.preview_sha256, confirmation });
    const code = this.errorCode(body, 'CATALOG_EDIT_OUTCOME_UNKNOWN');
    const definite = { CATALOG_EDIT_INVALID: 400, CATALOG_EDIT_FORBIDDEN: 403,
      LOCAL_WORKSPACE_REQUIRED: 403, CATALOG_EDIT_NOT_FOUND: 404, CATALOG_EDIT_CONFLICT: 409 };
    if (Object.hasOwn(definite, code) && status === definite[code as keyof typeof definite]) {
      try { this.store().removeItem(keyFor(this.restaurantId)); } catch { /* Retain the ID if cleanup is unavailable. */ }
      return { kind: 'rejected', code };
    }
    return this.finish(status, body);
  }

  async readback(): Promise<CatalogEditOutcome> {
    const { status, body } = await this.post({ phase: 'readback', operationId: this.operationId });
    return this.finish(status, body);
  }
}

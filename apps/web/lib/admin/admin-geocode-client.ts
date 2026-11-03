// Browser-side adapters for the bounded, admin-only same-origin provider routes.
export type AdminGeocodeFailureCode =
  | 'authentication' | 'access_denied' | 'rate_limit' | 'unavailable'
  | 'provider' | 'payload' | 'network';

const FAILURE_MESSAGES: Record<AdminGeocodeFailureCode, string> = {
  authentication: '관리자 로그인을 다시 확인해주세요.',
  access_denied: '관리자 권한 또는 동일 출처 요청이 확인되지 않았습니다.',
  rate_limit: '조회 한도에 도달했습니다. 잠시 후 다시 시도해주세요.',
  unavailable: '주소 조회 서비스를 사용할 수 없습니다. 서비스 설정과 조회 예산 확인이 필요합니다.',
  provider: '주소 제공 서비스의 응답을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.',
  payload: '주소 조회 요청 또는 응답 형식이 올바르지 않습니다.',
  network: '주소 조회 서버에 연결할 수 없습니다. 연결 상태를 확인해주세요.',
};

export class AdminGeocodeError extends Error {
  constructor(readonly code: AdminGeocodeFailureCode) {
    super(FAILURE_MESSAGES[code]);
    this.name = 'AdminGeocodeError';
  }
}

export function adminGeocodeErrorMessage(error: unknown): string {
  return error instanceof AdminGeocodeError ? FAILURE_MESSAGES[error.code] : FAILURE_MESSAGES.unavailable;
}

type Transport = (input: string, init: RequestInit) => Promise<Response>;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function hasValidGeocodeCoordinates(x: unknown, y: unknown): boolean {
  const coordinate = (value: unknown, maximum: number) =>
    typeof value === 'string' && /^-?\d{1,3}(?:\.\d{1,15})?$/.test(value)
    && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= maximum;
  return coordinate(x, 180) && coordinate(y, 90);
}

async function postProvider(path: string, body: { query: string; display?: number }, maximum: number, transport: Transport): Promise<Record<string, unknown>> {
  const query = body.query.trim();
  if (!query || query.length > maximum || /[\u0000-\u001f\u007f]/.test(query)) throw new AdminGeocodeError('payload');
  let response: Response;
  try {
    response = await transport(path, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, query }),
    });
  } catch {
    throw new AdminGeocodeError('network');
  }
  if (!response.ok) {
    // Never echo provider/database diagnostics. Auth and origin both use 403.
    const code: AdminGeocodeFailureCode = response.status === 401 ? 'authentication'
      : response.status === 403 ? 'access_denied'
      : response.status === 429 ? 'rate_limit'
      : response.status === 503 ? 'unavailable'
      : response.status === 502 ? 'provider'
      : response.status === 400 || response.status === 413 ? 'payload' : 'unavailable';
    throw new AdminGeocodeError(code);
  }
  let value: unknown;
  try { value = await response.json(); } catch { throw new AdminGeocodeError('payload'); }
  if (!record(value)) throw new AdminGeocodeError('payload');
  return value;
}

export interface AdminGeocodeAddress {
  roadAddress: string;
  jibunAddress: string;
  englishAddress: string;
  addressElements: unknown[];
  x: string;
  y: string;
}

export async function fetchAdminGeocode(query: string, transport: Transport = fetch): Promise<AdminGeocodeAddress[]> {
  const data = await postProvider('/api/naver-geocode', { query }, 200, transport);
  if (!Array.isArray(data.addresses)) throw new AdminGeocodeError('payload');
  return data.addresses.slice(0, 3).map((value: unknown) => {
    if (!record(value) || typeof value.roadAddress !== 'string' || typeof value.jibunAddress !== 'string'
      || !(value.roadAddress.trim() || value.jibunAddress.trim()) || typeof value.englishAddress !== 'string'
      || !Array.isArray(value.addressElements) || !hasValidGeocodeCoordinates(value.x, value.y)) {
      throw new AdminGeocodeError('payload');
    }
    return { roadAddress: value.roadAddress, jibunAddress: value.jibunAddress, englishAddress: value.englishAddress,
      addressElements: value.addressElements, x: value.x as string, y: value.y as string };
  });
}

export interface AdminPlaceItem { title: string; address: string; roadAddress: string; telephone: string }

export async function fetchAdminPlaceItems(query: string, transport: Transport = fetch): Promise<AdminPlaceItem[]> {
  const data = await postProvider('/api/naver-search', { query, display: 5 }, 100, transport);
  if (!Array.isArray(data.items)) throw new AdminGeocodeError('payload');
  return data.items.slice(0, 5).map((value: unknown) => {
    if (!record(value) || typeof value.title !== 'string' || typeof value.address !== 'string'
      || typeof value.roadAddress !== 'string' || typeof value.telephone !== 'string') throw new AdminGeocodeError('payload');
    return { title: value.title, address: value.address, roadAddress: value.roadAddress, telephone: value.telephone };
  });
}

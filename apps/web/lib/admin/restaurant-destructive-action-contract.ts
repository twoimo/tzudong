export const RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS = {
  soft_delete_restaurant: 'DELETE RESTAURANT',
} as const;

export type RestaurantDestructiveAction = keyof typeof RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS;

export type RestaurantDestructiveActionRequest = {
  action?: unknown;
  targetRestaurantIds?: unknown;
  reason?: unknown;
  confirmation?: unknown;
  expectedRestaurantName?: unknown;
};

export type ValidRestaurantDestructiveActionRequest = {
  action: RestaurantDestructiveAction;
  targetRestaurantIds: string[];
  reason: string;
  confirmation: string;
  expectedRestaurantName: string;
};

export type RestaurantDestructiveActionValidationResult =
  | { ok: true; value: ValidRestaurantDestructiveActionRequest }
  | { ok: false; error: string };

const ALLOWED_RESTAURANT_DESTRUCTIVE_ACTIONS = new Set<RestaurantDestructiveAction>([
  'soft_delete_restaurant',
]);

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTargetIds(value: unknown) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(normalizeString).filter(Boolean)));
  }

  const singleValue = normalizeString(value);
  return singleValue ? [singleValue] : [];
}

export function validateRestaurantDestructiveActionRequest(
  input: RestaurantDestructiveActionRequest,
  options: { routeRestaurantId?: string; actualRestaurantName?: string | null } = {},
): RestaurantDestructiveActionValidationResult {
  const action = normalizeString(input.action) as RestaurantDestructiveAction;
  if (!ALLOWED_RESTAURANT_DESTRUCTIVE_ACTIONS.has(action)) {
    return { ok: false, error: '지원하지 않는 맛집 삭제 작업입니다.' };
  }

  const targetRestaurantIds = normalizeTargetIds(input.targetRestaurantIds);
  if (targetRestaurantIds.length === 0) {
    return { ok: false, error: '삭제 대상 맛집 ID가 필요합니다.' };
  }

  if (targetRestaurantIds.length > 25) {
    return { ok: false, error: '한 번에 삭제할 수 있는 맛집 대상 수를 초과했습니다.' };
  }

  const routeRestaurantId = normalizeString(options.routeRestaurantId);
  if (routeRestaurantId && !targetRestaurantIds.includes(routeRestaurantId)) {
    return { ok: false, error: '요청 경로의 맛집 ID가 삭제 대상에 포함되어야 합니다.' };
  }

  const reason = normalizeString(input.reason);
  if (!reason) {
    return { ok: false, error: '삭제 사유를 입력해 주세요.' };
  }

  if (reason.length > 500) {
    return { ok: false, error: '삭제 사유는 500자 이하로 입력해 주세요.' };
  }

  const confirmation = normalizeString(input.confirmation);
  if (confirmation !== RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS[action]) {
    return { ok: false, error: `확인 문구를 정확히 입력해 주세요: ${RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS[action]}` };
  }

  const expectedRestaurantName = normalizeString(input.expectedRestaurantName);
  if (!expectedRestaurantName) {
    return { ok: false, error: '삭제할 맛집 이름 확인값이 필요합니다.' };
  }

  const actualRestaurantName = normalizeString(options.actualRestaurantName);
  if (actualRestaurantName && expectedRestaurantName !== actualRestaurantName) {
    return { ok: false, error: '삭제할 맛집 이름이 현재 데이터와 일치하지 않습니다.' };
  }

  return {
    ok: true,
    value: {
      action,
      targetRestaurantIds,
      reason,
      confirmation,
      expectedRestaurantName,
    },
  };
}

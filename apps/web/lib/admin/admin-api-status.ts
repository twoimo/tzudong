export const ADMIN_API_STATUS_CODES = [
  200, 400, 401, 403, 413, 415, 500, 504,
] as const;

export type AdminApiStatusCode = (typeof ADMIN_API_STATUS_CODES)[number];

export const ADMIN_UPSTREAM_TIMEOUT = 10_000;


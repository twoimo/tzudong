import { NextResponse } from "next/server";

import {
  ADMIN_API_STATUS_CODES,
  ADMIN_UPSTREAM_TIMEOUT,
  type AdminApiStatusCode,
} from "@/lib/admin/admin-api-status";

export { ADMIN_UPSTREAM_TIMEOUT };
export const ADMIN_LIST_MAX = 50;

export function adminJson(
  body: unknown,
  status: AdminApiStatusCode = 200,
): NextResponse {
  const nextStatus = (ADMIN_API_STATUS_CODES as readonly number[]).includes(
    status,
  )
    ? status
    : 500;
  return NextResponse.json(body, {
    status: nextStatus,
    headers: { "Cache-Control": "no-store" },
  });
}

export function logAdminFixedError(input: {
  menu: string;
  action: string;
  code: string;
}): void {
  console.error(
    JSON.stringify({
      menu: input.menu,
      action: input.action,
      code: input.code,
      at: new Date().toISOString(),
    }),
  );
}

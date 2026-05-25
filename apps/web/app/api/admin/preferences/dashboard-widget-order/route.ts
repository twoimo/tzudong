import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';

const DASHBOARD_WIDGET_ORDER_KEY = 'admin_dashboard_widget_order';
const ADMIN_DASHBOARD_WIDGET_IDS = [
  'subscribers',
  'views',
  'likes',
  'comments',
  'videos',
  'impact',
  'trend',
  'ops',
  'topContent',
  'engagementRate',
] as const;

type AdminDashboardWidgetId = typeof ADMIN_DASHBOARD_WIDGET_IDS[number];

type PreferenceRow = {
  value: unknown;
};

const widgetSet = new Set<string>(ADMIN_DASHBOARD_WIDGET_IDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeAdminDashboardWidgetOrder(value: unknown): AdminDashboardWidgetId[] {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.order)
      ? value.order
      : [];
  const seen = new Set<string>();
  const preferredOrder = source.filter((item): item is AdminDashboardWidgetId => {
    if (typeof item !== 'string' || !widgetSet.has(item) || seen.has(item)) return false;
    seen.add(item);
    return true;
  });

  return [
    ...preferredOrder,
    ...ADMIN_DASHBOARD_WIDGET_IDS.filter((item) => !seen.has(item)),
  ];
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('admin_user_preferences')
      .select('value')
      .eq('user_id', auth.userId)
      .eq('preference_key', DASHBOARD_WIDGET_ORDER_KEY)
      .maybeSingle()
      .returns<PreferenceRow>();

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminDashboardWidgetOrder(data?.value) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[admin/preferences/dashboard-widget-order] failed to read widget order:', error);
    return NextResponse.json({ error: 'KPI 카드 순서를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const order = normalizeAdminDashboardWidgetOrder(isRecord(body) ? body.order : null);
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('admin_user_preferences')
      .upsert(
        {
          user_id: auth.userId,
          preference_key: DASHBOARD_WIDGET_ORDER_KEY,
          value: order,
        },
        { onConflict: 'user_id,preference_key' },
      )
      .select('value')
      .single()
      .returns<PreferenceRow>();

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminDashboardWidgetOrder(data.value) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[admin/preferences/dashboard-widget-order] failed to save widget order:', error);
    return NextResponse.json({ error: 'KPI 카드 순서를 저장하지 못했습니다.' }, { status: 500 });
  }
}

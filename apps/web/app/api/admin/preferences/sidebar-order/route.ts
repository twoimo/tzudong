import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';

const SIDEBAR_ORDER_KEY = 'admin_sidebar_order';
const ADMIN_SIDEBAR_SECTIONS = ['홈', '검수', '운영', '보조'] as const;
const ADMIN_SIDEBAR_ITEM_IDS = [
  'overview',
  'restaurants',
  'submissions',
  'reviews',
  'storyboard',
  'banners',
  'users',
  'insights',
  'audit',
  'llm',
] as const;

type AdminSidebarSectionLabel = typeof ADMIN_SIDEBAR_SECTIONS[number];
type AdminSidebarItemId = typeof ADMIN_SIDEBAR_ITEM_IDS[number];

type AdminSidebarOrderPreference = {
  sections: AdminSidebarSectionLabel[];
  items: Record<AdminSidebarSectionLabel, AdminSidebarItemId[]>;
};

type PreferenceRow = {
  value: unknown;
};

const DEFAULT_ADMIN_SIDEBAR_ORDER: AdminSidebarOrderPreference = {
  sections: ['홈', '검수', '운영', '보조'],
  items: {
    홈: ['overview'],
    검수: ['restaurants', 'submissions', 'reviews'],
    운영: ['storyboard', 'banners', 'users', 'insights', 'audit'],
    보조: ['llm'],
  },
};

const sectionSet = new Set<string>(ADMIN_SIDEBAR_SECTIONS);
const itemSet = new Set<string>(ADMIN_SIDEBAR_ITEM_IDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function uniqueKnownSections(value: unknown): AdminSidebarSectionLabel[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.filter((section): section is AdminSidebarSectionLabel => {
    if (typeof section !== 'string' || !sectionSet.has(section) || seen.has(section)) return false;
    seen.add(section);
    return true;
  });
}

function uniqueKnownItems(value: unknown, usedItemIds: Set<string>): AdminSidebarItemId[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is AdminSidebarItemId => {
    if (typeof item !== 'string' || !itemSet.has(item) || usedItemIds.has(item)) return false;
    usedItemIds.add(item);
    return true;
  });
}

function normalizeAdminSidebarOrder(value: unknown): AdminSidebarOrderPreference {
  const record = isRecord(value) ? value : {};
  const itemRecord = isRecord(record.items) ? record.items : {};
  const sections = uniqueKnownSections(record.sections);
  const normalizedSections = [
    ...sections,
    ...DEFAULT_ADMIN_SIDEBAR_ORDER.sections.filter((section) => !sections.includes(section)),
  ];
  const usedItemIds = new Set<string>();
  const items = Object.fromEntries(
    DEFAULT_ADMIN_SIDEBAR_ORDER.sections.map((section) => {
      const preferredItems = uniqueKnownItems(itemRecord[section], usedItemIds);
      const defaultItems = DEFAULT_ADMIN_SIDEBAR_ORDER.items[section].filter((itemId) => !usedItemIds.has(itemId));
      defaultItems.forEach((itemId) => usedItemIds.add(itemId));
      return [section, [...preferredItems, ...defaultItems]];
    }),
  ) as Record<AdminSidebarSectionLabel, AdminSidebarItemId[]>;

  return { sections: normalizedSections, items };
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
      .eq('preference_key', SIDEBAR_ORDER_KEY)
      .maybeSingle()
      .returns<PreferenceRow>();

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminSidebarOrder(data?.value) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[admin/preferences/sidebar-order] failed to read sidebar order:', error);
    return NextResponse.json({ error: '사이드바 순서를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const order = normalizeAdminSidebarOrder(isRecord(body) ? body.order : null);
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('admin_user_preferences')
      .upsert(
        {
          user_id: auth.userId,
          preference_key: SIDEBAR_ORDER_KEY,
          value: order,
        },
        { onConflict: 'user_id,preference_key' },
      )
      .select('value')
      .single()
      .returns<PreferenceRow>();

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminSidebarOrder(data.value) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[admin/preferences/sidebar-order] failed to save sidebar order:', error);
    return NextResponse.json({ error: '사이드바 순서를 저장하지 못했습니다.' }, { status: 500 });
  }
}

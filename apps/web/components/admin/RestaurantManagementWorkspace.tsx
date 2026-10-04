'use client';

import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buildCanonicalAdminHrefFromSearchParams, getRestaurantManagementView } from '@/lib/admin/admin-module-routing';

export function RestaurantManagementWorkspace({ review, refresh }: { review: ReactNode; refresh: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const view = getRestaurantManagementView(params);
  function select(value: string) {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.set('module', 'restaurants');
    if (value === 'refresh') next.set('restaurantView', 'refresh');
    else next.delete('restaurantView');
    router.replace(buildCanonicalAdminHrefFromSearchParams(next), { scroll: false });
  }
  return <section className="flex h-full min-h-0 flex-col" aria-label="맛집 관리">
    <Tabs value={view} onValueChange={select} className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 py-2">
      <h1 className="text-base font-semibold">맛집 관리</h1>
      <TabsList aria-label="맛집 관리 작업 선택" className="h-auto"><TabsTrigger value="review" className="min-h-11 px-4 sm:min-h-7">검수</TabsTrigger><TabsTrigger value="refresh" className="min-h-11 px-4 sm:min-h-7">최신화·이력</TabsTrigger></TabsList>
    </div>
    <TabsContent value="review" className="mt-0 min-h-0 flex-1">{review}</TabsContent>
    <TabsContent value="refresh" className="mt-0 min-h-0 flex-1">{refresh}</TabsContent>
    </Tabs>
  </section>;
}

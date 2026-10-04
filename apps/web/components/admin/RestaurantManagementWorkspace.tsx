'use client';

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Store } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buildCanonicalAdminHrefFromSearchParams, getRestaurantManagementView } from '@/lib/admin/admin-module-routing';

type RestaurantManagementHeaderTargets = {
  count: HTMLDivElement | null;
  views: HTMLDivElement | null;
  automation: HTMLDivElement | null;
};

const RestaurantManagementHeaderContext = createContext<RestaurantManagementHeaderTargets | null>(null);

export function useRestaurantManagementHeader() {
  return useContext(RestaurantManagementHeaderContext);
}

export function RestaurantManagementWorkspace({ review, refresh }: { review: ReactNode; refresh: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const view = getRestaurantManagementView(params);
  const [count, setCount] = useState<HTMLDivElement | null>(null);
  const [views, setViews] = useState<HTMLDivElement | null>(null);
  const [automation, setAutomation] = useState<HTMLDivElement | null>(null);
  const headerTargets = useMemo(() => ({ count, views, automation }), [count, views, automation]);

  function select(value: string) {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.set('module', 'restaurants');
    if (value === 'refresh') next.set('restaurantView', 'refresh');
    else next.delete('restaurantView');
    router.replace(buildCanonicalAdminHrefFromSearchParams(next), { scroll: false });
  }

  return <section className="flex h-full min-h-0 flex-col" aria-label="맛집 관리">
    <RestaurantManagementHeaderContext.Provider value={headerTargets}>
      <Tabs value={view} onValueChange={select} className="flex h-full min-h-0 flex-col">
        <AdminPageHeader title="맛집 관리" icon={Store} className="admin-restaurant-primary-header" data-admin-restaurant-primary-header="true"
          summary={<div ref={setCount} className="admin-restaurant-header-count whitespace-nowrap text-xs tabular-nums text-muted-foreground" />}
          actions={<div ref={setAutomation} className="admin-restaurant-header-automation min-w-0" />}
        >
          <TabsList aria-label="맛집 관리 작업 선택" className="h-auto shrink-0">
            <TabsTrigger value="review" className="min-h-11 px-3 sm:min-h-7">검수</TabsTrigger>
            <TabsTrigger value="refresh" className="min-h-11 px-3 sm:min-h-7">최신화·이력</TabsTrigger>
          </TabsList>
          <div ref={setViews} className="admin-restaurant-header-views flex items-center" />
        </AdminPageHeader>
        <TabsContent value="review" className="mt-0 min-h-0 flex-1">{review}</TabsContent>
        <TabsContent value="refresh" className="mt-0 min-h-0 flex-1">{refresh}</TabsContent>
      </Tabs>
    </RestaurantManagementHeaderContext.Provider>
  </section>;
}

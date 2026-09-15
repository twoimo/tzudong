"use client";

import { usePathname } from 'next/navigation';
import { MyPageSectionFrame } from '@/components/mypage/MyPageSectionFrame';
import { DataPending } from '@/components/ui/data-pending';
import { resolveMobileRouteHeader } from './route-presentation';

export default function MyPageLoading() {
  const header = resolveMobileRouteHeader(usePathname());
  return <MyPageSectionFrame icon={header.icon} eyebrow="마이페이지" title={header.title} description={header.description}>
    <DataPending label="페이지 내용을 불러오는 중입니다." variant="list" className="min-h-48" />
  </MyPageSectionFrame>;
}

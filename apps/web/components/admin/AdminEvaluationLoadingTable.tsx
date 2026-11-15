"use client";

import type { Ref } from "react";
import { LoadingSurface } from "@/components/ui/loading-surface";

const columns = ["선택", "검수 항목", "평가", "분류", "상태", "주소", "영상", "기록", "작업"];
const gridClass = "grid grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px] gap-2 p-2 text-xs";

/** Share the same measurable columns and scroll owner during both admin fallbacks. */
export function AdminEvaluationLoadingTable({ rowCount, frameRef }: {
  rowCount: number;
  frameRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={frameRef}
      className="hidden min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-lg border bg-background lg:flex"
      data-allow-horizontal-scroll="true"
      data-horizontal-scroll-owner="admin-evaluation-table"
      role="region"
      aria-label="검수 로딩 목록"
      tabIndex={0}
    >
      <LoadingSurface label="검수 목록 로딩 중" className="min-w-[880px]">
        <div className={`${gridClass} bg-muted/35`}>
          {columns.map(label => <span key={label}>{label}</span>)}
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rowCount }, (_, index) => (
            <div key={index} className={`${gridClass} min-h-16 items-center`}>
              <span>선택</span>
              <div>
                <p className="text-sm font-semibold">맛집 검수 항목</p>
                <p className="mt-1">영상과 맛집 정보</p>
              </div>
              {columns.slice(2, -1).map(label => <span key={label}>{label}</span>)}
              <span>상세 보기</span>
            </div>
          ))}
        </div>
      </LoadingSurface>
    </div>
  );
}

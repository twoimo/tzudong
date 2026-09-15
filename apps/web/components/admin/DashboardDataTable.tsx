"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DASHBOARD_TABLE_PAGE_SIZE = 50;

export type DashboardTableColumn<Row> = {
  key: string;
  header: string;
  cell: (row: Row, index: number) => ReactNode;
  align?: "left" | "right";
  className?: string;
};

export function DashboardDataTable<Row>({ rows, columns, getRowKey, emptyText }: {
  rows: Row[];
  columns: DashboardTableColumn<Row>[];
  getRowKey: (row: Row, index: number) => string;
  emptyText: string;
}) {
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageCount = Math.max(1, Math.ceil(rows.length / DASHBOARD_TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * DASHBOARD_TABLE_PAGE_SIZE;
  const visibleRows = rows.slice(start, start + DASHBOARD_TABLE_PAGE_SIZE);

  useEffect(() => { setPage(0); }, [rows]);
  const selectPage = (next: number) => {
    setPage(next);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  if (!rows.length) return <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border/80 bg-background text-xs text-muted-foreground" data-admin-dashboard-table-view="true">{emptyText}</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-background" data-admin-dashboard-table-view="true" data-admin-dashboard-table-pagination="bounded">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-xs" aria-label="대시보드 데이터 표" aria-rowcount={rows.length + 1}>
          <thead className="sticky top-0 z-10 bg-background"><tr>{columns.map(column => (
            <th key={column.key} scope="col" className={cn("min-w-0 border-b border-border/70 px-2.5 py-2 text-left text-[11px] font-semibold text-muted-foreground", column.align === "right" && "text-right", column.className)}>{column.header}</th>
          ))}</tr></thead>
          <tbody>{visibleRows.map((row, index) => (
            <tr key={getRowKey(row, start + index)} aria-rowindex={start + index + 2} className="odd:bg-muted/20">
              {columns.map(column => <td key={column.key} className={cn("min-w-0 border-b border-border/45 px-2.5 py-2 align-middle text-foreground", column.align === "right" && "text-right tabular-nums", column.className)}>{column.cell(row, start + index)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground" aria-live="polite">
        <span>{start + 1}–{start + visibleRows.length} / {rows.length.toLocaleString("ko-KR")}개</span>
        {pageCount > 1 ? <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="admin-dashboard-control h-7 px-2" aria-label="표 이전 페이지" disabled={currentPage === 0} onClick={() => selectPage(currentPage - 1)}>이전</Button>
          <span className="tabular-nums">{currentPage + 1}/{pageCount}</span>
          <Button type="button" variant="ghost" size="sm" className="admin-dashboard-control h-7 px-2" aria-label="표 다음 페이지" disabled={currentPage + 1 === pageCount} onClick={() => selectPage(currentPage + 1)}>다음</Button>
        </div> : null}
      </div>
    </div>
  );
}

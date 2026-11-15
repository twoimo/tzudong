import {
  getAdminDashboardStatusItems,
  type AdminDashboardStatusSummaryInput,
} from '@/lib/admin/dashboard-status-summary';

export type AdminDashboardStatusSummaryProps = AdminDashboardStatusSummaryInput;

export function AdminDashboardStatusSummary(props: AdminDashboardStatusSummaryProps) {
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="현재 운영 상태"
      data-admin-operations-overview="true"
      data-admin-dashboard-status-summary="true"
    >
      {getAdminDashboardStatusItems(props).map((item) => (
        <span
          key={item.id}
          className="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap"
          title={item.detail}
          data-admin-dashboard-status={item.id}
          data-admin-dashboard-status-attention={item.needsAttention || undefined}
        >
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-medium tabular-nums text-foreground">{item.value}</span>
        </span>
      ))}
    </span>
  );
}

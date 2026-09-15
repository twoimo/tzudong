import { DataPending, type DataPendingProps } from '@/components/ui/data-pending';

/** A localized skeleton for data, never a replacement administrator page. */
export function AdminDataPending(props: DataPendingProps) {
  return <div data-admin-data-pending="true" className="contents"><DataPending {...props} /></div>;
}

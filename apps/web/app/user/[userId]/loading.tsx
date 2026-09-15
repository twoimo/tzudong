import { DataPending } from '@/components/ui/data-pending';

export default function UserProfileLoading() {
  return <section className="mx-auto w-full max-w-4xl space-y-4 p-4">
    <h1 className="text-xl font-bold">사용자 프로필</h1>
    <DataPending label="프로필 정보를 불러오는 중입니다." variant="list" className="min-h-48" />
  </section>;
}

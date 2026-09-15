import { ResetPasswordProgressiveSkeleton } from '@/components/auth/ResetPasswordProgressiveSkeleton';

/** Real empty form remains visible until the recovery page can validate the link. */
export default function ResetPasswordLoading() {
    return <ResetPasswordProgressiveSkeleton />;
}

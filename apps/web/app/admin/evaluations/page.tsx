import { redirect } from 'next/navigation';

import { buildCanonicalAdminEvaluationsHref } from '@/lib/admin/admin-module-routing';

export const dynamic = 'force-dynamic';

type AdminEvaluationsSearchParams = Record<string, string | string[] | undefined>;

type AdminEvaluationsPageProps = {
    searchParams: Promise<AdminEvaluationsSearchParams>;
};

function firstSearchParamValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
}

export default async function AdminEvaluationsRedirect({
    searchParams,
}: AdminEvaluationsPageProps) {
    const params = await searchParams;
    redirect(buildCanonicalAdminEvaluationsHref({
        get: (key) => firstSearchParamValue(params[key]),
    }));
}

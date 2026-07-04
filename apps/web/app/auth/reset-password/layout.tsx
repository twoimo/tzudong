import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { buildNoIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = buildNoIndexMetadata({
    title: '비밀번호 재설정 - 쯔동여지도',
});

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
    return children;
}

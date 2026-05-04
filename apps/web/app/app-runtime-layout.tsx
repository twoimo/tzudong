import type { ReactNode } from 'react';
import { AppRuntimeShell } from './app-runtime-shell';

export function AppRuntimeLayout({ children }: { children: ReactNode }) {
    return <AppRuntimeShell>{children}</AppRuntimeShell>;
}

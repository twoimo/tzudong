import { HOME_AUTH_SESSION_UPDATED_EVENT, type HomeAuthSessionUpdatedDetail } from '@/lib/home-auth-events';
import { hasSupabaseAuthSessionHint } from '@/lib/supabase-auth-session-hints';

export const AUTH_UI_REQUEST_EVENT = 'tzudong:auth-request';
const AUTH_UI_SESSION_HINT_GRACE_MS = 1200;

export type AuthUiRequestDetail = {
    source?: string;
    route?: string;
    reason?: string;
    ts?: number;
};

export function createAuthUiRequestDetail(detail: AuthUiRequestDetail = {}): AuthUiRequestDetail {
    return {
        ...detail,
        ts: detail.ts ?? Date.now(),
    };
}

export function requestAuthUi(detail: AuthUiRequestDetail = {}) {
    if (typeof window === 'undefined') return;

    const requestDetail = createAuthUiRequestDetail(detail);
    const dispatchRequest = () => {
        window.dispatchEvent(new CustomEvent(AUTH_UI_REQUEST_EVENT, {
            detail: requestDetail,
        }));
    };

    if (!hasSupabaseAuthSessionHint()) {
        dispatchRequest();
        return;
    }

    let isResolved = false;
    let timer: number | undefined;
    const finish = (shouldDispatch: boolean) => {
        if (isResolved) return;
        isResolved = true;
        if (timer) window.clearTimeout(timer);
        window.removeEventListener(HOME_AUTH_SESSION_UPDATED_EVENT, handleSessionUpdated);
        if (shouldDispatch) dispatchRequest();
    };
    const handleSessionUpdated = (event: Event) => {
        const sessionDetail = (event as CustomEvent<HomeAuthSessionUpdatedDetail> | undefined)?.detail;
        if (sessionDetail?.hasSession === true) {
            finish(false);
            return;
        }
        if (sessionDetail?.hasSession === false) {
            finish(true);
        }
    };

    window.addEventListener(HOME_AUTH_SESSION_UPDATED_EVENT, handleSessionUpdated);
    timer = window.setTimeout(() => finish(true), AUTH_UI_SESSION_HINT_GRACE_MS);
}

export const AUTH_UI_REQUEST_EVENT = 'tzudong:auth-request';

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

    window.dispatchEvent(new CustomEvent(AUTH_UI_REQUEST_EVENT, {
        detail: createAuthUiRequestDetail(detail),
    }));
}

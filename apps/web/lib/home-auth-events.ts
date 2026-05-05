export const HOME_AUTH_SESSION_UPDATED_EVENT = 'home:auth-session-updated';

export type HomeAuthSessionUpdatedDetail = {
  hasSession?: boolean;
  source?: string;
};

export function dispatchHomeAuthSessionUpdated(detail: HomeAuthSessionUpdatedDetail = {}) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent<HomeAuthSessionUpdatedDetail>(
    HOME_AUTH_SESSION_UPDATED_EVENT,
    { detail },
  ));
}

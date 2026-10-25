export class AuthLogoutSupersededError extends Error {
  readonly code = 'AUTH_LOGOUT_SUPERSEDED';

  constructor() {
    super('AUTH_LOGOUT_SUPERSEDED');
    this.name = 'AuthLogoutSupersededError';
  }
}

export function isSupersededLogout(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'AUTH_LOGOUT_SUPERSEDED';
}

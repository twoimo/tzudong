export const E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS = {
    enabled: 'E2E_ADMIN_ROUTE_BYPASS',
    context: 'E2E_ADMIN_ROUTE_BYPASS_CONTEXT',
    runtime: 'E2E_ADMIN_ROUTE_BYPASS_RUNTIME',
    token: 'E2E_ADMIN_ROUTE_BYPASS_TOKEN',
} as const

export const E2E_ADMIN_ROUTE_BYPASS_CONTEXT = 'playwright'
export const E2E_ADMIN_ROUTE_BYPASS_RUNTIME = 'local-dev-server'
export const E2E_ADMIN_ROUTE_BYPASS_HEADER = 'x-e2e-admin-bypass'
export const E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER = 'x-e2e-admin-bypass-token'

type E2EAdminRouteBypassEnv = Partial<Record<string, string | undefined>>

export function getE2EAdminRouteBypassExpectedToken(
    env: E2EAdminRouteBypassEnv = process.env,
) {
    return env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token]?.trim() ?? ''
}

export function isE2EAdminRouteBypassEnvEnabled(
    env: E2EAdminRouteBypassEnv = process.env,
) {
    return (
        env.NODE_ENV !== 'production' &&
        env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled] === '1' &&
        env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context] === E2E_ADMIN_ROUTE_BYPASS_CONTEXT &&
        env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime] === E2E_ADMIN_ROUTE_BYPASS_RUNTIME &&
        Boolean(getE2EAdminRouteBypassExpectedToken(env))
    )
}

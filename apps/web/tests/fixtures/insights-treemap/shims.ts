export function useAuth() {
    return { isLoading: false, user: { id: 'synthetic-insights-fixture' } };
}

export function useRouter() {
    return { replace: () => { throw new Error('Fixture navigation is disabled'); } };
}

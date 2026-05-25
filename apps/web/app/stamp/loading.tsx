/**
 * Route fallback intentionally stays empty so direct /stamp loads do not show
 * a second full-page skeleton before the client page renders its static shell.
 * The page itself keeps the header visible and scopes skeleton UI to dynamic cards.
 */
export default function StampLoading() {
    return null;
}

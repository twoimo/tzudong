type LocalAdminRscRead = Readonly<{
    url: URL;
    method: string;
    appOrigin: string | undefined;
    rscHeader: string | undefined;
}>;

// A framework RSC cache key is the only query allowed on the local admin
// document. This does not admit query parameters on privileged API routes.
export function isAllowedLocalAdminRscRead({ url, method, appOrigin, rscHeader }: LocalAdminRscRead): boolean {
    if (!appOrigin || method !== 'GET' || rscHeader !== '1') return false;
    let origin: URL;
    try { origin = new URL(appOrigin); } catch { return false; }
    return origin.protocol === 'http:'
        && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
        && origin.origin === appOrigin
        && origin.pathname === '/'
        && !origin.search && !origin.hash && !origin.username && !origin.password
        && url.origin === appOrigin
        && !url.username && !url.password && !url.hash
        && url.pathname === '/admin'
        && /^\?_rsc(?:=[A-Za-z0-9_-]{1,128})?$/.test(url.search);
}

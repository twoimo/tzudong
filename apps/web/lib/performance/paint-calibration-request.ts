/** Internal request marker: the proxy must remove incoming values before deriving it. */
export const PAINT_CALIBRATION_REQUEST_HEADER = 'x-tzudong-paint-calibration';

export function isPaintCalibrationRequest(pathname: string, searchParams: URLSearchParams, method = 'GET'): boolean {
    return (method === 'GET' || method === 'HEAD') && pathname === '/'
        && searchParams.size === 1 && searchParams.get('__perf') === 'paint-calibration';
}

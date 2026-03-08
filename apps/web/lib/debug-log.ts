export const isDevelopment = process.env.NODE_ENV === 'development';

export function debugLog(...args: unknown[]): void {
    if (isDevelopment) {
        console.log(...args);
    }
}

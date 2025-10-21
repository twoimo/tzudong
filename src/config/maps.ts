// Google Maps Configuration (글로벌 버전)
export const GOOGLE_MAPS_CONFIG = {
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
};

// Naver Maps Configuration (한국 버전)
export const NAVER_MAPS_CONFIG = {
    clientId: import.meta.env.VITE_NAVER_CLIENT_ID || 'asta9mer4x',
    clientSecret: import.meta.env.VITE_NAVER_CLIENT_SECRET || 'ihPIhd3xHq7Wz3m2rmbGfR4KmsOQEjrCaLOULnp6',
};


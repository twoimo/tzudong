// Google Maps Configuration (글로벌 버전)
export const GOOGLE_MAPS_CONFIG = {
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
};

// Naver Maps Configuration (한국 버전)
export const NAVER_MAPS_CONFIG = {
    clientId: import.meta.env.VITE_NAVER_CLIENT_ID || '92i97y0j18',
    clientSecret: import.meta.env.VITE_NAVER_CLIENT_SECRET || '0L6nyuqBObPJ5qpNCVx2GaTMpReFmfrEeXKWiCZy',
};


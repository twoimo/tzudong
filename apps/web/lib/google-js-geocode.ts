export interface GoogleJsGeocodeCandidate {
  road_address: string;
  jibun_address: string;
  english_address: string;
  address_elements: Record<string, unknown>;
  x: string; // lng
  y: string; // lat
}

let googleMapsLoadPromise: Promise<void> | null = null;

type GoogleMapsGeocoderResult = {
  formatted_address?: string;
  geometry: {
    location: {
      lat(): number;
      lng(): number;
    };
  };
  address_components?: unknown;
};

export async function ensureGoogleMapsLoaded(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Google Maps는 브라우저에서만 로드할 수 있습니다');
  }

  if (window.google?.maps?.Geocoder) {
    return;
  }

  if (!apiKey) {
    throw new Error('Google Maps API key not found');
  }

  if (googleMapsLoadPromise) {
    return googleMapsLoadPromise;
  }

  googleMapsLoadPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('Google Maps 로딩 실패')));
      return;
    }

    const callbackName = '__tzudongGoogleMapsInit';
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Google Maps 로딩 시간 초과'));
    }, 10000);

    const callbackContainer = window as unknown as Record<string, unknown>;
    callbackContainer[callbackName] = () => {
      window.clearTimeout(timeoutId);
      if (window.google?.maps?.Geocoder) {
        resolve();
        return;
      }
      reject(new Error('Google Maps 로드 실패 (Geocoder 미사용 가능 상태)'));
    };

    const script = document.createElement('script');
    script.async = true;
    // NOTE: 다른 화면(MapView 등)에서 places/marker 라이브러리를 기대하므로,
    //       admin 지오코딩이 먼저 실행되어도 기능이 깨지지 않게 동일 라이브러리 포함.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,marker&language=ko&loading=async&v=weekly&callback=${callbackName}`;
    script.addEventListener('error', () => {
      window.clearTimeout(timeoutId);
      reject(new Error('Google Maps 스크립트 로딩 실패'));
    });

    document.head.appendChild(script);
  });

  return googleMapsLoadPromise;
}

export async function geocodeWithGoogleMapsJs(address: string, apiKey: string, limit = 3): Promise<GoogleJsGeocodeCandidate[]> {
  await ensureGoogleMapsLoaded(apiKey);

  if (!window.google?.maps?.Geocoder) {
    throw new Error('Google Maps가 로드되지 않았습니다');
  }

  const geocoder = new window.google.maps.Geocoder();

  const results = await new Promise<GoogleMapsGeocoderResult[]>((resolve, reject) => {
    geocoder.geocode({ address }, (res: GoogleMapsGeocoderResult[] | null, status: string) => {
      if (status === 'OK') {
        resolve(res || []);
        return;
      }
      if (status === 'ZERO_RESULTS') {
        resolve([]);
        return;
      }
      reject(new Error(`Google API 오류: ${status}`));
    });
  });

  return results.slice(0, limit).map((result) => {
    const loc = result.geometry.location;
    const formatted = result.formatted_address || address;
    return {
      road_address: formatted,
      jibun_address: formatted,
      english_address: formatted,
      address_elements: (result.address_components || []) as unknown as Record<string, unknown>,
      x: String(loc.lng()),
      y: String(loc.lat()),
    };
  });
}

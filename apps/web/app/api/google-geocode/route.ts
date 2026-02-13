import { NextResponse } from 'next/server';

const GOOGLE_GEOCODING_API_KEY =
  process.env.GOOGLE_GEOCODING_API_KEY ||
  process.env.GOOGLE_MAPS_SERVER_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

function mapGoogleStatusToHttp(status?: string): number {
  switch (status) {
    case 'INVALID_REQUEST':
      return 400;
    case 'REQUEST_DENIED':
      return 403;
    case 'OVER_QUERY_LIMIT':
      return 429;
    case 'UNKNOWN_ERROR':
      return 503;
    default:
      return 502;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');
  const language = searchParams.get('language') || 'ko';
  const region = searchParams.get('region');

  if (!address) {
    return NextResponse.json({ error: 'address parameter is required' }, { status: 400 });
  }

  if (!GOOGLE_GEOCODING_API_KEY) {
    return NextResponse.json({ error: 'Google Geocoding API key not configured' }, { status: 500 });
  }

  const params = new URLSearchParams({
    address,
    key: GOOGLE_GEOCODING_API_KEY,
    language,
  });

  if (region) {
    params.set('region', region);
  }

  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`, {
      cache: 'no-store',
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: 'Google Geocoding HTTP error',
          status: data?.status || null,
          error_message: data?.error_message || `HTTP ${response.status}`,
        },
        { status: response.status }
      );
    }

    if (data?.status !== 'OK' && data?.status !== 'ZERO_RESULTS') {
      return NextResponse.json(
        {
          error: 'Google API error',
          status: data?.status || null,
          error_message: data?.error_message || null,
        },
        { status: mapGoogleStatusToHttp(data?.status) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Google Geocoding route error:', error);
    return NextResponse.json({ error: 'Failed to geocode address' }, { status: 500 });
  }
}

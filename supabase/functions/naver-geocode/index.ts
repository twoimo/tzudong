import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NaverGeocodingAddress {
    roadAddress: string;
    jibunAddress: string;
    englishAddress: string;
    addressElements: unknown;
    x: string;
    y: string;
}

interface NaverGeocodingResponse {
    status: string;
    errorMessage?: string;
    addresses?: NaverGeocodingAddress[];
}

serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { query, count = 3 } = await req.json();

        console.log('🔍 Geocoding request:', { query, count });

        if (!query) {
            return new Response(
                JSON.stringify({ error: 'Query parameter is required' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        // Get NCP Maps API credentials from environment variables
        const apiKeyId = Deno.env.get('NAVER_MAPS_CLIENT_ID');
        const apiKey = Deno.env.get('NAVER_MAPS_CLIENT_SECRET');

        console.log('🔑 API Keys:', {
            hasApiKeyId: !!apiKeyId,
            hasApiKey: !!apiKey,
            apiKeyIdLength: apiKeyId?.length,
            apiKeyLength: apiKey?.length
        });

        if (!apiKeyId || !apiKey) {
            return new Response(
                JSON.stringify({ error: 'NCP Maps API credentials not configured' }),
                {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        // Call NCP Maps Geocoding API (공식 문서 기준)
        const url = `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}&count=${count}`;

        console.log('📡 Calling NCP Maps API:', url);

        const response = await fetch(url, {
            headers: {
                'x-ncp-apigw-api-key-id': apiKeyId,
                'x-ncp-apigw-api-key': apiKey,
            },
        });

        console.log('📥 NCP Maps API response status:', response.status);

        const data: NaverGeocodingResponse = await response.json();

        console.log('📦 NCP Maps API data:', JSON.stringify(data, null, 2));

        if (data.errorMessage) {
            console.error('❌ NCP Maps API error:', data.errorMessage);
            return new Response(
                JSON.stringify({ error: data.errorMessage }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        if (!data.addresses || data.addresses.length === 0) {
            console.warn('⚠️ No addresses found');
            return new Response(
                JSON.stringify({ addresses: [] }),
                {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        console.log('✅ Returning addresses:', data.addresses.length);

        // Return the geocoding results
        return new Response(
            JSON.stringify({ addresses: data.addresses }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        );
    } catch (error) {
        console.error('💥 Geocoding error:', error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        );
    }
});

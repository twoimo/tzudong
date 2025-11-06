import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NaverGeocodingResponse {
  addresses?: Array<{
    roadAddress: string;
    jibunAddress: string;
    englishAddress: string;
    addressElements: any[];
    x: string;
    y: string;
  }>;
  errorMessage?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { address } = await req.json()

    if (!address) {
      return new Response(
        JSON.stringify({ success: false, error: '주소가 제공되지 않았습니다.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Naver Cloud Platform 지오코딩 API 키
    const clientId = Deno.env.get('NAVER_NCP_MAPS_KEY_ID')
    const clientSecret = Deno.env.get('NAVER_NCP_MAPS_KEY')

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ success: false, error: 'Naver API 키가 설정되지 않았습니다.' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const url = `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`

    const response = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
      },
    })

    const data: NaverGeocodingResponse = await response.json()

    if (data.errorMessage) {
      return new Response(
        JSON.stringify({ success: false, error: data.errorMessage }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    if (!data.addresses || data.addresses.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: '주소를 찾을 수 없습니다.' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const addressData = data.addresses[0]

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          road_address: addressData.roadAddress,
          jibun_address: addressData.jibunAddress,
          english_address: addressData.englishAddress,
          address_elements: addressData.addressElements,
          x: addressData.x,
          y: addressData.y,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})

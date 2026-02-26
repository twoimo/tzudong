import { NextResponse } from 'next/server';

const NAVER_CLIENT_ID = process.env.NEXT_NAVER_CLIENT_ID_BYEON || process.env.NEXT_PUBLIC_NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NEXT_NAVER_CLIENT_SECRET_BYEON || process.env.NEXT_PUBLIC_NAVER_CLIENT_SECRET;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const display = searchParams.get('display') || '5';

    console.log(`[API] Naver Search Request: query=${query}, display=${display}`);

    if (!query) {
        return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
    }

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        console.error('[API] Naver API credentials missing');
        return NextResponse.json({ error: 'Naver API credentials not configured' }, { status: 500 });
    }

    try {
        const apiUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=${display}`;
        console.log(`[API] Calling Naver API: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
            },
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[API] Naver API Error Response:', errorData);
            return NextResponse.json(errorData, { status: response.status });
        }

        const data = await response.json();
        console.log(`[API] Naver API Success: ${data.items?.length || 0} items found`);
        return NextResponse.json(data);
    } catch (error) {
        console.error('[API] Internal Server Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

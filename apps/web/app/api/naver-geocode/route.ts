import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');

    if (!query) {
        return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        return NextResponse.json({ error: 'Supabase credentials not configured' }, { status: 500 });
    }

    try {
        const response = await fetch(`${supabaseUrl}/functions/v1/naver-geocode`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${supabaseAnonKey}`,
                apikey: supabaseAnonKey,
            },
            body: JSON.stringify({ query, count: 3 }),
        });

        if (!response.ok) {
            throw new Error(`Naver geocode proxy error: ${response.status}`);
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Naver Geocoding error:', error);
        return NextResponse.json(
            { error: 'Failed to geocode address' },
            { status: 500 }
        );
    }
}

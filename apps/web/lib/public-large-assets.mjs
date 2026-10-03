// Content-addressed public objects verified against their repository source.
// Keep legacy paths working while removing large bytes from the web deployment.
export const PUBLIC_LARGE_ASSET_ORIGIN = 'https://assets.tzudong.app';

export const publicLargeAssetRedirects = [
    {
        source: '/fonts/ChosunCentennial_otf.otf',
        destination: `${PUBLIC_LARGE_ASSET_ORIGIN}/sha256-8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7--ChosunCentennial_otf.otf`,
        permanent: false,
    },
];

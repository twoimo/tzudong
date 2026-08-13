import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
    {
        ignores: [
            'node_modules/**',
            '.next/**',
            '.next-stale-*',
            '.next-stale-*/**',
            '**/.next-stale-*',
            '**/.next-stale-*/**',
            '.next-local-*',
            '.next-local-*/**',
            '.next-nightly-*',
            '.next-nightly-*/**',
            'out/**',
            'build/**',
            'coverage/**',
            'playwright-report/**',
            'test-results/**',
        ],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    ...nextCoreWebVitals,
    {
        files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
        rules: {
            'react-hooks/set-state-in-effect': 'off',
            'react-hooks/static-components': 'off',
            'react-hooks/preserve-manual-memoization': 'off',
            'react-hooks/purity': 'off',
        },
    },
];

export default eslintConfig;

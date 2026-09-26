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
            // Frozen generated bundles are validated by their artifact-map pins.
            'performance/**/browser-bundle.mjs',
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
    {
        files: ['performance/home-provider-transition-20260925/browser-entry.jsx'],
        rules: {
            // Laboratory render counters/controls intentionally observe each render.
            // Keep the measured harness unchanged and enforce this rule in app code.
            'react-hooks/immutability': 'off',
        },
    },
    {
        files: [
            'performance/swipe-render-cache-20260925/measure.mjs',
            'performance/swipe-render-cache-20260925/rejected-timer-resolution/measure.mjs',
        ],
        rules: {
            // These frozen Node measurement runners bind a local variable named module.
            '@next/next/no-assign-module-variable': 'off',
        },
    },
];

export default eslintConfig;

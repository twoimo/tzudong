/* global Bun */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Expected the bundle output path');

const result = await Bun.build({
    entrypoints: [join(root, 'entry.tsx')],
    target: 'browser',
    define: {
        'process.env.NODE_ENV': '"development"',
        'process.env.NEXT_PUBLIC_SITE_URL': 'undefined',
        'process.env.NEXT_PUBLIC_SUPPORT_EMAIL': 'undefined',
        'process.env.NEXT_PUBLIC_OPERATOR_COMPANY_NAME': 'undefined',
        'process.env.NEXT_PUBLIC_OPERATOR_REPRESENTATIVE': 'undefined',
        'process.env.NEXT_PUBLIC_OPERATOR_BUSINESS_REGISTRATION_NUMBER': 'undefined',
        'process.env.NEXT_PUBLIC_COPYRIGHT_LABEL': 'undefined',
        'process.env.NEXT_PUBLIC_PUBLIC_DEMO_MODE': 'undefined',
        'process.env.NEXT_PUBLIC_LIMITED_PUBLIC_MODE': 'undefined',
        'process.env.NEXT_PUBLIC_LIMITED_PUBLIC_MODE_ALLOW_AUTH': 'undefined',
    },
    plugins: [{
        name: 'insights-browser-boundaries',
        setup(build) {
            build.onResolve({ filter: /^(next\/navigation|@\/contexts\/AuthContext)$/ }, () => ({
                path: join(root, 'shims.ts'),
            }));
        },
    }],
});

if (!result.success) throw new AggregateError(result.logs, 'Insights UI bundle failed');
if (result.outputs.length !== 1) throw new Error('Expected one browser bundle');
await Bun.write(output, result.outputs[0]);

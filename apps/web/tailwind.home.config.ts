import baseConfig from './tailwind.config';
import type { Config } from 'tailwindcss';

const homeConfig: Config = {
  ...baseConfig,
  content: [
    './app/page.tsx',
    './app/home-runtime-shell.tsx',
    './app/home-client.tsx',
    './app/home-client-effects.tsx',
    './app/app-providers.tsx',
    './app/providers.tsx',
    './app/hooks/**/*.{js,ts,jsx,tsx,mdx}',
    './contexts/**/*.{js,ts,jsx,tsx,mdx}',
    './components/home/**/*.{js,ts,jsx,tsx,mdx}',
    './components/layout/**/*.{js,ts,jsx,tsx,mdx}',
    './components/map/**/*.{js,ts,jsx,tsx,mdx}',
    './components/search/**/*.{js,ts,jsx,tsx,mdx}',
    './components/filters/**/*.{js,ts,jsx,tsx,mdx}',
    './components/region/**/*.{js,ts,jsx,tsx,mdx}',
    './components/skeletons/**/*.{js,ts,jsx,tsx,mdx}',
    './components/ui/**/*.{js,ts,jsx,tsx,mdx}',
  ],
};

export default homeConfig;

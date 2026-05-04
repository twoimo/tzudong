import baseConfig from './tailwind.config';
import type { Config } from 'tailwindcss';

const homeDetailConfig: Config = {
  ...baseConfig,
  content: [
    './components/restaurant/**/*.{js,ts,jsx,tsx,mdx}',
    './components/reviews/**/*.{js,ts,jsx,tsx,mdx}',
    './components/auth/**/*.{js,ts,jsx,tsx,mdx}',
    './components/ui/**/*.{js,ts,jsx,tsx,mdx}',
  ],
};

export default homeDetailConfig;

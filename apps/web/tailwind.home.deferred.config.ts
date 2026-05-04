import baseConfig from './tailwind.config';
import type { Config } from 'tailwindcss';

const homeDeferredConfig: Config = {
  ...baseConfig,
  content: [
    './app/home-client-sidepanels.tsx',
    './components/admin/AdminRestaurantModal.tsx',
    './components/admin/AdminReviewPanel.tsx',
    './components/admin/RestaurantErrorAlert.tsx',
    './components/announcement/**/*.{js,ts,jsx,tsx,mdx}',
    './components/modals/**/*.{js,ts,jsx,tsx,mdx}',
    './components/ui/**/*.{js,ts,jsx,tsx,mdx}',
  ],
};

export default homeDeferredConfig;

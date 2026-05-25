import type { Config } from "tailwindcss";

const ADMIN_EVALUATION_RESPONSIVE_DISPLAY_CLASSES = [
  // Admin evaluation table desktop mode depends on these display overrides.
  // Keep them safelisted so stale/incomplete dev CSS generation cannot leave
  // `hidden lg:block` / `hidden lg:table-cell` elements permanently hidden.
  "lg:block",
  "lg:flex",
  "lg:hidden",
  "lg:inline-flex",
  "lg:table-cell",
] as const;

const ADMIN_CONSOLE_RESPONSIVE_LAYOUT_CLASSES = [
  // The unified admin console is desktop-shell heavy. Safelist the shell
  // utilities that make the sidebar collapsible and keep icon-only mode
  // centered even when dev CSS is regenerated incrementally.
  "lg:border-r",
  "lg:border-y-0",
  "lg:grid",
  "lg:gap-0",
  "lg:h-11",
  "lg:h-[calc(100dvh_-_var(--app-header-height,0px))]",
  "lg:inline-flex",
  "lg:m-0",
  "lg:min-h-11",
  "lg:overflow-y-auto",
  "lg:px-0",
  "lg:px-1.5",
  "lg:place-items-center",
  "lg:sticky",
  "lg:top-0",
  "lg:w-0",
  "lg:w-11",
  "lg:w-14",
  "lg:w-60",
] as const;
const MOBILE_BOTTOM_NAV_CLASSES = [
  // Direct mobile routes render MobileBottomNav without the home CSS chunk.
  // Keep the reference bottom-nav typography and active-state utilities present on every route.
  "-z-10",
  "text-red-800",
  "fill-red-800/20",
  "scale-110",
  "text-foreground/65",
  "active:text-foreground",
  "text-[12px]",
  "font-medium",
  "font-semibold",
  "leading-none",
  "tracking-tight",
] as const;
const LEADERBOARD_RANK_ICON_CLASSES = [
  // Rank icons are created from a helper, so direct mobile route chunks must keep their color utilities.
  "text-yellow-500",
  "text-muted-foreground",
  "text-amber-600",
] as const;



const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    ...ADMIN_EVALUATION_RESPONSIVE_DISPLAY_CLASSES,
    ...ADMIN_CONSOLE_RESPONSIVE_LAYOUT_CLASSES,
    ...MOBILE_BOTTOM_NAV_CLASSES,
    ...LEADERBOARD_RANK_ICON_CLASSES,
    // MyPage profile desktop matrix depends on display: contents + equal row tracks.
    // Keep these emitted when dev CSS is regenerated incrementally.
    "md:contents",
    "md:grid-cols-2",
    "md:grid-rows-2",
    "md:content-stretch",
  ],
  theme: {
    extend: {
      screens: {
        xs: "375px",
      },
      fontFamily: {
        sans: [
          "var(--font-noto-serif-kr)",
          '"Noto Serif KR"',
          '"Apple SD Gothic Neo"',
          '"Malgun Gothic"',
          "ui-serif",
          "Georgia",
          "serif",
        ],
        serif: [
          "var(--font-noto-serif-kr)",
          '"Noto Serif KR"',
          '"Apple SD Gothic Neo"',
          '"Malgun Gothic"',
          "ui-serif",
          "Georgia",
          "serif",
        ],
        display: [
          '"ChosunCentennial"',
          "var(--font-noto-serif-kr)",
          '"Noto Serif KR"',
          '"Apple SD Gothic Neo"',
          '"Malgun Gothic"',
          "cursive",
        ],
        stylish: ['"Stylish"', "sans-serif"],
        gugi: ['"Gugi"', "cursive"],
        brush: ['"Nanum Brush Script"', "cursive"],
        yeon: ['"Yeon Sung"', "cursive"],
        chosun: ['"ChosunCentennial"', "serif"],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        "gradient-primary": "var(--gradient-primary)",
        "gradient-secondary": "var(--gradient-secondary)",
      },
      boxShadow: {
        primary: "var(--shadow-primary)",
        glow: "var(--shadow-glow)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(-10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.6s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;

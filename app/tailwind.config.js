/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F3F8EE',
          100: '#E3EFD6',
          200: '#C6DFAE',
          300: '#A3CB80',
          400: '#7FB356',
          500: '#548C2F',
          600: '#467527',
          700: '#385D20',
          800: '#2B4719',
          900: '#1E3211',
        },
        ink: { DEFAULT: '#2c3e50', soft: '#5B6B7B', muted: '#8A98A6' },
        sand: { DEFAULT: '#F5F5F0', deep: '#ECEBE3' },
        cocoa: { DEFAULT: '#6E2818', soft: '#8C4A3A' },
        clay: '#C9713F',
        sky: '#3B82C4',
        rose: '#D95A6A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      borderRadius: { xl: '1rem', '2xl': '1.5rem', '3xl': '2rem' },
      boxShadow: {
        card: '0 1px 2px rgba(44,62,80,0.04), 0 8px 24px -12px rgba(44,62,80,0.18)',
        lift: '0 12px 32px -12px rgba(84,140,47,0.35)',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidad: gris antracita (brand) + beige. Sin verde.
        brand: {
          50: '#F4F2EF',
          100: '#E8E5E1',
          200: '#CFCBC6',
          300: '#A9A5A0',
          400: '#6E6E6E',
          500: '#3A3A3A',
          600: '#2F2F2F',
          700: '#262626',
          800: '#1E1E1E',
          900: '#151515',
        },
        beige: {
          50: '#F7F3EE',
          100: '#EDE4DB',
          200: '#E1D5C8',
          300: '#CFC0B0',
          400: '#B9A795',
          500: '#A08D79',
          600: '#86735F',
        },
        ink: { DEFAULT: '#2F2F2F', soft: '#5C5C5C', muted: '#8A8A8A' },
        sand: { DEFAULT: '#F7F3EE', deep: '#EDE4DB' },
        cocoa: { DEFAULT: '#86735F', soft: '#A08D79' },
        clay: '#C9713F',
        sky: '#3B82C4',
        rose: '#D95A6A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      letterSpacing: { lema: '0.22em' },
      borderRadius: { xl: '1rem', '2xl': '1.5rem', '3xl': '2rem' },
      boxShadow: {
        card: '0 1px 2px rgba(58,58,58,0.04), 0 8px 24px -12px rgba(58,58,58,0.16)',
        lift: '0 12px 32px -12px rgba(58,58,58,0.45)',
      },
    },
  },
  plugins: [],
};

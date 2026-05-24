/** @type {import('tailwindcss').Config} */
// Single source of truth: Colors.ts drives both JS runtime (useTheme) and Tailwind classes.
// NativeWind v4 natively resolves { DEFAULT, dark } keys via its dark: variant system.
// DO NOT use CSS variables here — var(--x) is web-only and breaks on React Native.
const { colors } = require('./src/constants/colors');

module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: colors.primary.DEFAULT,
          dark: colors.primary.dark,
        },
        secondary: {
          DEFAULT: colors.secondary.DEFAULT,
          dark: colors.secondary.dark,
        },
        background: colors.background,
        foreground: colors.foreground,
        card: colors.card,
        muted: colors.muted,
        border: colors.border,
        success: colors.success,
        warning: colors.warning,
        error: colors.error,
        info: colors.info,
      },
      fontFamily: {
        display: ['DMSerifDisplay-Regular', 'serif'],
        body: ['Outfit-Regular', 'sans-serif'],
        bodyMed: ['Outfit-Medium', 'sans-serif'],
        mono: ['SpaceMono-Regular', 'monospace'],
      },
      boxShadow: {
        'soft': '0 4px 20px 0 rgba(0, 0, 0, 0.05)',
        'soft-lg': '0 10px 30px 0 rgba(0, 0, 0, 0.08)',
        'dark-ring': 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
      },
    },
  },
  plugins: [],
};

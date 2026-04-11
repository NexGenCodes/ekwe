/** @type {import('tailwindcss').Config} */
const { colors } = require('./src/constants/colors');

module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors,
      fontFamily: {
        display: ['DMSerifDisplay-Regular', 'serif'],
        body: ['Outfit-Regular', 'sans-serif'],
        bodyMed: ['Outfit-Medium', 'sans-serif'],
        mono: ['SpaceMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};

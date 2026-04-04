/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#FFFFFF',
          dark: '#09090B',
        },
        card: {
          DEFAULT: '#F4F4F5',
          dark: '#18181B',
        },
        primary: {
          DEFAULT: '#1D4ED8',
          // dark: '#38BDF8',
        },
        accent: {
          DEFAULT: '#D97706',
          dark: '#FBBF24',
        },
      },
      fontFamily: {
        display: ['DMSerifDisplay-Regular', 'serif'],
        body: ['Inter-Regular', 'sans-serif'],
        bodyMed: ['Inter-Medium', 'sans-serif'],
      },
    },
  },
  plugins: [],
}


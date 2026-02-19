/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // macOS-style system colors
        mac: {
          bg: '#1e1e1e',
          'bg-secondary': '#2a2a2a',
          'bg-tertiary': '#323232',
          sidebar: '#1c1c1e',
          'sidebar-hover': '#2c2c2e',
          border: '#3a3a3c',
          'border-subtle': '#2c2c2e',
          text: '#ffffff',
          'text-secondary': '#ebebf5',
          'text-tertiary': '#636366',
          accent: '#0a84ff',
          'accent-hover': '#0070e0',
          separator: '#38383a',
        },
      },
      fontFamily: {
        system: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      fontSize: {
        '2xs': '10px',
        xs: '11px',
        sm: '12px',
        base: '13px',
      },
    },
  },
  plugins: [],
};

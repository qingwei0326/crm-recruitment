/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Light-mode page canvas behind admin surfaces (dark mode uses gray-950).
        surface: { page: '#f5f7fb' },
      },
      fontSize: {
        // Dense CRM metadata sizes; no line-height so they match the old text-[Npx] output.
        '3xs': '10px',
        '2xs': '11px',
      },
      boxShadow: {
        panel: '0 2px 10px rgba(15, 23, 42, 0.04)',
        'panel-dark': '0 2px 10px rgba(0, 0, 0, 0.18)',
      },
    },
  },
  plugins: [],
};

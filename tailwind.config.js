/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        revu: {
          dark: '#1e1e1e',
          panel: '#252526',
          header: '#333333',
          border: '#3c3c3c',
          accent: '#0e639c',
          hover: '#2a2d2e',
          text: '#cccccc',
          bright: '#ffffff',
          bluebeam: '#0078d4',
        },
      },
    },
  },
  plugins: [],
};

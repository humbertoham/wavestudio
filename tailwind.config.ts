/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',              // ⬅️ clave: usa la clase .dark en <html>
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: { extend: {} },
  plugins: [],
}

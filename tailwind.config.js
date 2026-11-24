/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Pipe Dreams Studio metals. `cyan` is re-pointed at the brass/copper ramp so the
        // My Character editor (written with cyan accents) picks up the studio look unchanged.
        cyan: { 100: '#ffeac2', 200: '#f6d39a', 300: '#f0c27a', 400: '#d68c50', 500: '#bb6f3a' },
        fuchsia: { 200: '#f8c39a', 300: '#d68c50' },
        pd: {
          bg: '#070504', ink: '#f6eadb', muted: '#b7a28d', faint: '#7a6757',
          gold: '#f0c27a', copper: '#d68c50', ember: '#ff704d', verdigris: '#80cab4', metal: '#1b0f08',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'Trajan Pro', 'Times New Roman', 'serif'],
        body: ['Spectral', 'Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

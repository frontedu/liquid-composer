import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

// Vite plugin: treat .glsl files as raw strings (importable with ?raw)
const glslRaw = {
  name: 'glsl-raw',
  transform(src: string, id: string) {
    if (/\.(glsl|vert|frag)$/.test(id)) {
      return { code: `export default ${JSON.stringify(src)};`, map: null };
    }
  },
};

export default defineConfig({
  plugins: [react(), glslRaw],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// Vite plugin: treat .glsl files as raw strings (importable with ?raw)
const glslRaw = {
  name: 'glsl-raw',
  transform(src, id) {
    if (/\.(glsl|vert|frag)$/.test(id)) {
      return { code: `export default ${JSON.stringify(src)};`, map: null };
    }
  },
};

export default defineConfig({
  integrations: [
    react(),
    tailwind({
      applyBaseStyles: false,
    }),
  ],
  vite: {
    plugins: [glslRaw],
  },
});

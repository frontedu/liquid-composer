<p align="center">
  <img src="public/icon-512.png" width="110" alt="Liquid Composer icon" />
</p>

<h1 align="center">Liquid Composer</h1>

<p align="center">Design Liquid Glass app icons in the browser.</p>

<p align="center"><a href="https://liquid-composer.vercel.app"><b>liquid-composer.vercel.app</b></a></p>

Liquid Composer is a web recreation of Apple's Icon Composer, the tool behind the Liquid Glass icons of iOS 26 and macOS Tahoe. Drop in your artwork, stack it in layers, and the engine renders the glass material in real time: frosted background blur, translucency, edge refraction, specular highlights and background-aware shadows, composited inside the iOS squircle at 1024×1024.

Rendering runs on a WebGL2 pipeline. Two separable Gaussian blur passes feed a glass composite shader that refracts the background through a beveled edge, with Fresnel rim lighting and chromatic dispersion, all in linear light. WebGL2 is required; without it, layers still get their shadow and bevel, but no refraction.

## Features

- Layer-based editing with groups, drag-and-drop reordering and inline rename
- SVG, PNG and JPEG import. SVGs are re-rasterized at high resolution so edges stay crisp
- Per-layer glass controls: translucency, specular, shadow, blend mode, solid or gradient fill, plus an Advanced panel with the technical parameters (depth, refraction, dispersion, rim, inner shadow, border)
- The three appearance modes from Icon Composer: Default, Dark and Clear
- Adjustable light angle, with glass-on-glass compositing between stacked layers
- Background editor driven by hue, tint and brightness, or custom gradient stops
- Safe-area overlay on the Apple HIG 70% guide, snap guides, alpha-aware layer picking on canvas
- Supersampled export: PNG from 256 to 4096 px, JPEG and WebP at 1024. Work is autosaved locally to localStorage and IndexedDB

## Getting started

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## How it works

The editor is Vite, React 19, Tailwind and Nanostores. The engine lives in `src/engine/`:

- `IconRenderer.ts` orchestrates compositing: per-layer caching, drop shadows and bevels composited over the WebGL2 output
- `LiquidGlass.ts` is the WebGL2 renderer: RGBA16F ping-pong framebuffers for the blur, then the glass composite pass
- `shaders/` holds the GLSL ES 3.00 sources for the blur and glass composite passes

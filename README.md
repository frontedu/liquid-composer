<p align="center">
  <img src="public/icon-512.png" width="110" alt="Liquid Composer icon" />
</p>

<h1 align="center">Liquid Composer</h1>

<p align="center">Design Liquid Glass app icons in the browser.</p>

<p align="center"><a href="https://liquid-composer.vercel.app"><b>liquid-composer.vercel.app</b></a></p>

<p align="center">
  <a href="https://github.com/frontedu/liquid-composer/stargazers"><img src="https://img.shields.io/github/stars/frontedu/liquid-composer?style=flat&logo=github" alt="GitHub stars" /></a>
  <a href="https://github.com/frontedu/liquid-composer/forks"><img src="https://img.shields.io/github/forks/frontedu/liquid-composer?style=flat&logo=github" alt="GitHub forks" /></a>
  <a href="https://www.npmjs.com/package/liquid-composer"><img src="https://img.shields.io/npm/dt/liquid-composer?style=flat&logo=npm" alt="npm downloads" /></a>
</p>

Liquid Composer is a web recreation of Apple's Icon Composer that reproduces the Liquid Glass icon material of iOS 27 and Icon Composer 2. Drop in your artwork, stack it in layers, and the engine renders the glass in real time: light from above, highlights and dark edges that define each shape, refraction between layers, background blur, translucency and layer shadows, composited inside the iOS squircle.

Rendering runs on a WebGL2 pipeline. A distance field of each layer's silhouette drives refraction and edge lighting; when Blur is on, two separable Gaussian passes blur everything beneath the layer, and the glass composite shader works in gamma-encoded sRGB, like Icon Composer. Without WebGL2 the app falls back to Canvas 2D: layers keep their shadow, translucency and edge lighting, but lose refraction and blur.

## What's new for iOS 27

- Light comes straight from above. The toolbar light-angle control remains as a preview tool and is not saved with the document
- Highlights along the top and bottom edges, and dark edges that define the shape
- Specular placement: Off, Automatic, Inside or Outside. Automatic picks Inside on bright icon backgrounds and Outside on dark ones and in the Clear appearances
- Refraction with Strength and Height; a negative Strength bends the image the other way (inverse refraction)

Highlights, refraction, translucency, blur and shadows follow the formulas and values of Icon Composer 27. The Advanced panel scales the highlights and adds dispersion and frostiness on top.

## Features

- Layer-based editing with one level of groups, drag-and-drop reordering, inline rename, duplicate and undo/redo
- SVG, PNG and JPEG import at the artwork's natural size on the 1024 pt canvas, as in Icon Composer; an SVG smaller than 256 pt is scaled up to the grid's outer circle, and artwork larger than the icon is scaled down to fit it. SVGs are re-rasterized at render resolution so edges stay crisp
- Glass controls per layer, or applied to all layers at once: Specular placement, Refraction (Strength, Height), Blur, Translucency and Shadow
- Advanced panel with Lens (Dispersion), Highlights (Light intensity, Top, Bottom, Edge definition) and Surface (Frostiness), with a reset
- Per-layer opacity, blend mode, and solid or two-stop gradient fill
- Default, Dark, Clear Light and Clear Dark appearances. The Tinted variants of iOS 27 are not implemented
- Glass-on-glass compositing: each glass layer refracts the background and every layer painted beneath it
- Background editor driven by hue, tint and brightness, or custom gradient stops
- Apple icon grid overlay in light or dark lines, center snap guides, alpha-aware layer picking on canvas
- Export as PNG at 4096, 2048, 1024, 512 or 256 px, or JPEG at 1024; sizes up to 1024 are supersampled. PNG · No Chiclet leaves out the background plate. Copy a 1024 PNG to the clipboard, or download all appearances as a ZIP with `Default/`, `Dark/`, `ClearLight/` and `ClearDark/` folders, each holding PNGs from 4096 to 256 px
- Icon Composer documents: Export .icon and Open .icon in the export menu, as a zipped `.icon` package that opens in Icon Composer and Xcode. A document with refraction on or specular set to Inside or Outside needs Xcode 27, as Icon Composer 2 writes it; otherwise it also opens in Xcode 26
- Work is autosaved in your browser (localStorage and IndexedDB). See the [privacy policy](https://liquid-composer.vercel.app/privacy)
- Installable as an app from Chrome or Edge on Windows, Linux and macOS (Install in the address bar), with its own window, and it opens offline after the first visit

## Shortcuts

On a Mac, use `⌘` in place of `Ctrl`.

- `Ctrl+Z` undo, `Ctrl+Shift+Z` or `Ctrl+Y` redo
- `Ctrl+D` duplicate, `Delete` remove, `F2` rename the focused layer
- `Ctrl+C` / `Ctrl+X` / `Ctrl+V` copy, cut and paste layers (or paste an image)
- Arrow keys move the selected layer by 1 pt, 10 pt with `Shift`; `Ctrl+↑` selects its group
- `Ctrl+]` / `Ctrl+[` bring forward or send backward; `Ctrl+Alt+Shift+F` / `Ctrl+Alt+Shift+B` bring to front or send to back
- `Ctrl+Alt+C` / `Ctrl+Alt+V` copy and paste style: glass, fill, opacity and blend mode
- `Ctrl+Alt+G` toggle the icon grid

## Getting started

Requires Node 22.12+.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Use with AI agents

Agents drive the same app and engine as the editor. An icon is a JSON recipe: background, layers top to bottom, glass settings and outputs. Applying a recipe replaces the document, and renders come from the WebGL2 engine in headless Chrome.

```sh
npx liquid-composer apply icon.json --out out/       # PNG, all-appearances zip or .icon, as the recipe asks
npx liquid-composer render icon.json --size 512 --mode dark
npx liquid-composer import App.icon --render 512
npx liquid-composer validate icon.json
npx liquid-composer schema
```

Each command prints one JSON object with the written files, the document state and any warnings. Rendering uses your installed Google Chrome through playwright-core, on SwiftShader by default; pass `--gpu` to use the GPU. In a checkout, run `npm run build` once and use `npm run -s agent --` in place of `npx liquid-composer`.

- **MCP server, local.** `npx -y liquid-composer mcp` provides `liquid_apply`, `liquid_update`, `liquid_render`, `liquid_export`, `liquid_import_icon`, `liquid_state` and `liquid_schema`, and returns previews as images. With Claude Code: `claude mcp add liquid-composer -- npx -y liquid-composer mcp`
- **MCP server, remote.** `https://liquid-composer.vercel.app/mcp` checks recipes and returns a link that opens the icon in your browser. The link carries the recipe in its URL fragment, so opening it does not send the recipe to the server; the MCP call itself keeps nothing. This server does not render. In Claude, add it under Customize → Connectors → Add custom connector, with no sign-in
- **Skill.** `npx skills add frontedu/liquid-composer` teaches agents the recipe format and the workflow
- **In the browser.** Every build exposes `window.liquidComposer` (`apply`, `update`, `render`, `export`, `state`, `schema`). Add `?agent` to the URL to turn off autosave, analytics and the offline cache

## How it works

The editor is Vite, React 19, Tailwind and Nanostores. The engine lives in `src/engine/`:

- `IconRenderer.ts` orchestrates compositing. It rasterizes each layer, draws its shadow, resolves the specular placement and hands each glass layer everything already painted below it
- `LiquidGlass.ts` is the WebGL2 renderer: a jump-flood distance field of the layer's silhouette, ping-pong framebuffers for the blur (RGBA16F when supported, skipped when Blur is off), then the glass composite pass
- `shaders/` holds the GLSL ES 3.00 sources. The composite pass computes refraction, dispersion, translucency and the edge highlights and dark edges
- `glassContract.ts` holds the material constants: highlight table, refraction and blur limits, layer shadow
- `IconDocument.ts` reads and writes Icon Composer `.icon` documents

The agent API lives in `src/agent/`, the CLI and local MCP server in `scripts/agent/`, and the remote MCP endpoint in `api/mcp.ts`.

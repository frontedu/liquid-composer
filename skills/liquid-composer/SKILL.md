---
name: liquid-composer
description: Design Liquid Glass app icons (iOS 27, Icon Composer 2) with Liquid Composer. Builds layered icons from SVG, PNG or JPEG artwork, tunes the glass (specular, refraction, blur, translucency, shadow), renders previews to check the result and exports PNG or JPEG, an all-appearances zip or an Icon Composer .icon document. Use when the user wants an app icon, a Liquid Glass icon, an .icon file or icon exports.
---

# Liquid Composer

Liquid Composer is a web recreation of Apple's Icon Composer. Agents drive the same app people use: an icon is described by a **recipe** (JSON), applying a recipe replaces the document, and the engine renders it with WebGL2 exactly as the editor does.

## Pick a route

| You have | Use |
| --- | --- |
| Node 22.12+ and Google Chrome | CLI: `npx -y liquid-composer apply icon.json --out out/` |
| The local MCP server (`npx -y liquid-composer mcp`) | `liquid_schema`, `liquid_apply`, `liquid_update`, `liquid_render`, `liquid_export`, `liquid_import_icon` |
| Only the remote MCP server `https://liquid-composer.vercel.app/mcp` | `liquid_validate`, then `liquid_open`, and give the user the link |
| A browser tab on the app | `await window.liquidComposer.apply(recipe)` and the other methods below |

The remote server cannot render. Its link carries the recipe in the URL fragment and opens the icon in the user's browser, where they export it.

## Workflow

1. Prepare the artwork. SVG is best: it is re-rasterized at every size. Use one file per element that should be its own glass piece (glyph, badge, background shape), drawn on a transparent background.
2. Write the recipe: background first, then the layers top to bottom.
3. Apply it and look at the preview. Check that the artwork sits inside the outer circle of the Apple icon grid (80% of the icon), that the glass edge reads on the background and that nothing is clipped by the squircle.
4. Adjust with small changes (`liquid_update` or a new recipe) and look again.
5. Export: PNG at the sizes needed, `{ "zip": true }` for every appearance, `{ "icon": true }` for Icon Composer.

## Recipe

```json
{
  "name": "Weather",
  "appearance": "default",
  "background": { "hue": 205, "tint": 15, "brightness": 100 },
  "layers": [
    { "name": "Sun", "src": "sun.svg", "layout": { "x": 12, "y": -10, "scale": 45 },
      "fill": { "type": "solid", "color": "#ffd60a" } },
    { "name": "Cloud", "src": "cloud.svg", "layout": { "y": 8, "scale": 70 },
      "liquidGlass": { "blur": { "enabled": true, "value": 40 }, "shadow": { "value": 40 } } }
  ],
  "outputs": [{ "sizes": [1024, 512] }, { "modes": ["dark", "clear"], "sizes": [1024] }, { "icon": true }]
}
```

- `layers` go top to bottom: the first one is in front. A group is `{ "type": "group", "name": "...", "layers": [...] }`, one level deep.
- `src` is a file path (CLI and local MCP, relative to the recipe or `baseDir`), inline SVG markup, or a `data:` URL (svg, png, jpeg). A layer without `src` is a full squircle painted with its `fill`.
- Names must be unique: they are how `update` and `remove` find a layer. Missing names become `Layer N` and `Group N`.
- Everything is optional. Omitted values take the editor defaults; `liquidGlass`, `layout` and `effects` merge into them key by key.

## Parameters

| Field | Values | Notes |
| --- | --- | --- |
| `background` | `{ hue 0..360, tint 0..100, brightness 0..100 }` or `{ colors: ["#top", "#bottom"] }` | Repeat a color for a solid background |
| `appearance` | `default`, `dark`, `clear`, `clearDark` | Default appearance for renders. `clear` and `clearDark` are Icon Composer's exported Clear Light and Clear Dark: a flat gray plate that each layer lightens by the luminance of its artwork |
| `layout.x`, `layout.y` | −512..512 | % of the icon size from the center; +x right, +y down |
| `layout.scale` | 1..400 | % of the icon size (100 = the longer side spans the icon). Images start at their natural size on the 1024 pt canvas, as in Icon Composer: 1024 is 100, 512 is 50, 2048 is 200 (SVG width/height or viewBox, PNG and JPEG pixels); if the size cannot be read, SVG starts at 80 and PNG and JPEG at 100 |
| `opacity` | 0..100 | |
| `blendMode` | `normal`, `multiply`, `screen`, `overlay`, `soft-light`, `plus-lighter`, ... | All CSS blend modes |
| `fill` | `{ type: "none" }`, `{ type: "solid", color }`, `{ type: "gradient", stops: [{ offset, color }, ...] }` | Recolors the artwork; gradients run top to bottom |
| `liquidGlass.enabled` | boolean | On by default for SVG, PNG and JPEG |
| `liquidGlass.specular` | `false` (Off), `true` (Automatic), `"inside"`, `"outside"` | Automatic picks Inside on a white icon background (luma ≥ 0.99) and Outside otherwise, including the Clear modes |
| `liquidGlass.refraction` | `{ enabled }` | Off by default. Strength is `effects.refraction` (−100..100, negative bends the other way); Height is `effects.bevel` in % of the icon size, 1.25 at Height 0 % and 25 at Height 100 % |
| `liquidGlass.blur` | `{ enabled, value 0..100 }` | Blurs everything beneath the layer; off by default |
| `liquidGlass.translucency` | `{ enabled, value 0..100 }` | How much shows through the glass; on at 50 by default |
| `liquidGlass.shadow` | `{ enabled, value 0..200 }` | Soft black halo cast below the edges of the artwork, 50 by default. Translucent glass lets part of it show through the layer |
| `liquidGlass.aberration` | 0..100 | Dispersion at the refracting edge |
| `liquidGlass.effects` | Advanced panel keys | Call `schema()` or `liquid_schema` for the keys and defaults |

Outputs: `{ format: "png" | "jpeg", sizes: [16..4096], modes: [...], bare }` writes `icon-<size>.png` (plus `-<mode>` outside the default appearance; `bare` drops the squircle), `{ "zip": true }` writes `icon.zip` with every appearance from 4096 to 256 px, and `{ "icon": true }` writes an `.icon` folder for Icon Composer. Without `outputs` the CLI writes one 1024 px PNG.

## Look checks

- Keep the meaningful artwork inside the outer circle of the Apple icon grid (80% of the icon); full-bleed backgrounds belong in `background`, not in a layer.
- Light comes from above. A glyph that should read as glass needs enough contrast with the background; if the edge disappears, raise the contrast or set `specular` to `"inside"` or `"outside"` explicitly.
- Prefer few layers with clear depth: background shape at the bottom, glyph on top. Blur only matters when something sits beneath the layer.
- Render `dark` and `clear` before exporting the zip: those appearances recolor the artwork.

## CLI

```sh
npx -y liquid-composer apply icon.json --out out/     # writes the recipe outputs
npx -y liquid-composer render icon.json --size 512 --mode dark --out out/
npx -y liquid-composer import App.icon --render 512 --out out/
npx -y liquid-composer validate icon.json             # no browser
npx -y liquid-composer schema
```

Every command prints one JSON object: `{ "ok": true, "files": [...], "state": {...}, "warnings": [...], "renderer": {...} }`, or `{ "ok": false, "error": { "code", "message", "issues": [{ "path", "message" }] } }` with exit code 1. Fix the reported `path` and run again. In a checkout of the repo, run `npm run build` once (and after pulling) and use `npm run -s agent --` in place of `npx -y liquid-composer`; keep `-s`, without it npm prints its own banner on stdout.

Options: `--out <dir>`, `--target dist | dev | <url>` (default `dist`), `--gpu` (GPU instead of SwiftShader), `--allow-fallback` (accept the Canvas 2D fallback; without it the command fails when WebGL2 is unavailable).

## Browser API

`window.liquidComposer` exists in every build of the app. Open it with `?agent` to skip autosave, analytics and the offline cache. All methods return the new state or the rendered data and throw an error with `code`, `message` and `issues`.

| Method | Does |
| --- | --- |
| `ready` | Promise resolved when the API can be used |
| `apply(recipe)` | Replace the document; `src` must be inline SVG or a `data:` URL |
| `addLayer(layer, parent?)` | Add a layer or group on top, or inside the group `parent` |
| `update(ref, patch)` / `remove(ref)` | Change or delete a layer by name or id |
| `setBackground(background)` / `setAppearance(mode)` | |
| `render({ size, mode, format, bare })` | Base64 image |
| `export(output)` | `[{ path, base64 }]` for one output entry |
| `exportIcon()` / `load({ icon })` | `.icon` as base64 zip, out and in |
| `state()` / `schema()` | Current document; JSON Schema, defaults and guide |

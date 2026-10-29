import { z } from 'zod';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { AppearanceMode, BlendMode, LayerLayout, LiquidGlassConfig } from '../types/index';

export const API_VERSION = 1;
export const MAX_LAYERS = 64;
export const APPEARANCES = ['default', 'dark', 'clear', 'clearDark'] as const satisfies readonly AppearanceMode[];
export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light',
  'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter',
] as const satisfies readonly BlendMode[];
export const IMAGE_TYPES: Record<string, string> = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg' };

export const GUIDE = `A recipe is a JSON document that fully describes one icon; applying it replaces the current document.
- layers are listed top to bottom (first = frontmost), as in the layer panel. A group is { "type": "group", "layers": [...] }, one level deep.
- src is inline SVG markup or a data: URL (svg, png, jpeg). The local CLI and MCP also accept a file path. A layer without src is a full squircle painted with its fill.
- layout.x and layout.y move the layer in % of the icon size from the center (+x right, +y down); layout.scale is % of the icon size (100 = the longer side spans the icon). An image starts at its natural size on the 1024 pt canvas, as in Icon Composer: 1024 (SVG width/height or viewBox, PNG or JPEG pixels) is 100, 512 is 50, 2048 is 200; when the size cannot be read, SVG starts at 80 and PNG or JPEG at 100. New layers start with glass on for every image type, refraction off, translucency 50 and blur off.
- liquidGlass: specular false = Off, true = Automatic, or "inside" / "outside"; refraction.enabled, with Strength in effects.refraction (-100..100) and Height in effects.bevel (% of the icon size: 1.25 at Height 0 %, 25 at Height 100 %); blur and translucency { enabled, value 0..100 }; translucencyGradient { enabled, angle 0..360, start/end 0..100, startOpacity/endOpacity 0..100 } enables directional artwork opacity; shadow { enabled, value 0..200 } is a soft black halo cast below the edges of the artwork and shows through translucent glass; aberration is Dispersion. Other effects keys are the Advanced panel.
- fill recolors the artwork: none, solid { color } or gradient { stops } (top to bottom, #rrggbb).
- background is { hue 0..360, tint 0..100, brightness 0..100 } or { colors: [top, bottom] }.
- appearance is default, dark, clear or clearDark. clear and clearDark are Icon Composer's exported Clear Light and Clear Dark: a flat gray plate that each layer lightens by the luminance of its artwork. Light always comes from above.`;

// ── Schema ──

const percent = () => z.number().min(0).max(100);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb color');
const Size = z.int().min(16).max(4096);
const Appearance = z.enum(APPEARANCES);
const Toggle = z.strictObject({ enabled: z.boolean(), value: percent() }).partial();

export const GlassSchema = z.strictObject({
  enabled: z.boolean().describe('Liquid Glass on or off'),
  specular: z.union([z.boolean(), z.enum(['inside', 'outside'])]).describe('false = Off, true = Automatic'),
  specularIntensity: percent(),
  refraction: z.strictObject({ enabled: z.boolean() }).describe('Strength is effects.refraction, Height is effects.bevel'),
  blur: Toggle.describe('Blur of everything beneath the layer'),
  translucency: Toggle,
  translucencyGradient: z.strictObject({
    enabled: z.boolean(),
    angle: z.number().min(0).max(360),
    start: z.number().min(0).max(99),
    end: z.number().min(1).max(100),
    startOpacity: percent(),
    endOpacity: percent(),
  }).describe('Optional directional opacity gradient for the artwork'),
  shadow: z.strictObject({ enabled: z.boolean(), value: z.number().min(0).max(200) }).partial()
    .describe('Soft black halo below the edges of the artwork'),
  aberration: percent().describe('Dispersion'),
  effects: z.record(z.string(), z.number()).describe('Advanced parameters by key, merged key by key; keys and defaults in the schema defaults'),
} satisfies { [K in keyof LiquidGlassConfig]?: z.ZodType }).partial();

const Layout = z.strictObject({
  x: z.number().min(-512).max(512).describe('% of the icon size from the center, + = right'),
  y: z.number().min(-512).max(512).describe('% of the icon size from the center, + = down'),
  scale: z.number().min(1).max(400).describe('% of the icon size'),
} satisfies Record<keyof LayerLayout, z.ZodType>).partial();

const Fill = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({ type: z.literal('solid'), color: Hex }),
  z.strictObject({
    type: z.literal('gradient'),
    stops: z.array(z.strictObject({ offset: z.number().min(0).max(1), color: Hex })).min(2).max(8),
    angle: z.number().default(90),
  }),
]).describe('Recolors the artwork; none keeps the image colors');

const layerFields = {
  name: z.string().trim().min(1).max(100).describe('Unique; used as the layer reference'),
  visible: z.boolean(),
  opacity: percent(),
  blendMode: z.enum(BLEND_MODES),
};

export const LayerPatchSchema = z.strictObject({
  ...layerFields,
  src: z.string().min(1).describe('Inline SVG markup or a data: URL (svg, png, jpeg); the local CLI and MCP also accept a file path'),
  layout: Layout,
  fill: Fill,
  liquidGlass: GlassSchema,
}).partial();

const ImageLayer = LayerPatchSchema.extend({ type: z.literal('layer').optional() });
const GroupLayer = z.strictObject({ ...layerFields, layers: z.array(ImageLayer).max(MAX_LAYERS) }).partial()
  .extend({ type: z.literal('group') });

export const LayerSchema = z.union([ImageLayer, GroupLayer]);

export const BackgroundSchema = z.union([
  z.strictObject({ hue: z.number().min(0).max(360), tint: percent().optional(), brightness: percent().optional() }),
  z.strictObject({ colors: z.tuple([Hex, Hex]).describe('Top and bottom; repeat a color for a solid background') }),
]);

export const RenderSchema = z.strictObject({
  size: Size,
  mode: Appearance,
  format: z.enum(['png', 'jpeg']),
  bare: z.boolean().describe('Artwork only, without the squircle'),
}).partial();

export const OutputSchema = z.union([
  z.strictObject({
    format: z.enum(['png', 'jpeg']),
    sizes: z.array(Size).min(1).max(10),
    modes: z.array(Appearance).min(1).max(APPEARANCES.length),
    bare: z.boolean(),
  }).partial(),
  z.strictObject({ zip: z.literal(true).describe('Every appearance at 4096, 2048, 1024, 512 and 256 px') }),
  z.strictObject({ icon: z.literal(true).describe('Icon Composer document (.icon)') }),
]);

export const RecipeSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  appearance: Appearance,
  background: BackgroundSchema,
  layers: z.array(LayerSchema).max(MAX_LAYERS).describe('Top to bottom, as in the layer panel'),
  outputs: z.array(OutputSchema).max(16).describe('Files the CLI writes; defaults to one 1024 px PNG'),
}).partial().superRefine((recipe, ctx) => {
  const seen = new Set<string>();
  const entries = recipeLayers(recipe);
  for (const { path, layer } of entries) {
    if (layer.name && seen.has(layer.name)) ctx.addIssue({ code: 'custom', path: [...path, 'name'], message: `Duplicate layer name "${layer.name}"` });
    if (layer.name) seen.add(layer.name);
    if (layer.type !== 'group' && layer.src && sourceType(layer.src) === 'data' && !IMAGE_TYPES[dataType(layer.src)]) {
      ctx.addIssue({ code: 'custom', path: [...path, 'src'], message: 'Only svg, png and jpeg data: URLs are supported' });
    }
  }
  if (entries.length > MAX_LAYERS) ctx.addIssue({ code: 'custom', path: ['layers'], message: `At most ${MAX_LAYERS} layers and groups` });
});

export type Recipe = z.output<typeof RecipeSchema>;
export type LayerSpec = z.output<typeof LayerSchema>;
export type LayerPatch = z.output<typeof LayerPatchSchema>;
export type GlassPatch = z.output<typeof GlassSchema>;
export type BackgroundSpec = z.output<typeof BackgroundSchema>;
export type RenderOptions = z.output<typeof RenderSchema>;
export type Output = z.output<typeof OutputSchema>;
export type Issue = { path: string; message: string };

// ── Helpers ──

export function sourceType(src: string): 'data' | 'svg' | 'path' {
  if (/^data:/i.test(src)) return 'data';
  return src.trimStart().startsWith('<') ? 'svg' : 'path';
}

function dataType(src: string): string {
  return /^data:([^;,]*)/i.exec(src)?.[1].toLowerCase() ?? '';
}

export function recipeLayers(recipe: { layers?: LayerSpec[] }) {
  return (recipe.layers ?? []).flatMap((layer, i) => [
    { path: ['layers', i] as (string | number)[], layer },
    ...(layer.type === 'group' ? layer.layers ?? [] : []).map((child, j) => ({ path: ['layers', i, 'layers', j], layer: child as LayerSpec })),
  ]);
}

export function formatIssues(issues: readonly z.core.$ZodIssue[], prefix: PropertyKey[] = []): Issue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === 'invalid_union' && issue.errors.length) {
      return formatIssues(issue.errors.reduce((a, b) => (b.length < a.length ? b : a)), path);
    }
    return [{ path: path.map(String).join('.') || '(root)', message: issue.message }];
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export function encodeRecipe(recipe: unknown): string {
  return bytesToBase64(deflateSync(strToU8(JSON.stringify(recipe)), { level: 9 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRecipe(encoded: string): unknown {
  return JSON.parse(strFromU8(inflateSync(base64ToBytes(encoded.replace(/-/g, '+').replace(/_/g, '/')))));
}

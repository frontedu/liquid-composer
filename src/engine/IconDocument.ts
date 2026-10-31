import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Layer, BackgroundConfig, BlendMode, ColorStop, FillConfig, IconDocument, LayerEffects, LayerLayout, LiquidGlassConfig } from '../types/index';
import { createLayer, createGroup, bgColorsFromHueTint, automaticGradient, defaultBackground } from '../store/iconStore';
import { DEFAULT_EFFECTS } from './IconRenderer';

type Json = Record<string, unknown>;
type Point = [number, number];
type IconDocumentData = Pick<IconDocument, 'name' | 'layers' | 'background'>;

const CANVAS_POINTS = 1024;
const KNOWN_FEATURES = ['refractivity', 'specular-location'];
const ICON_BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light', 'plus-lighter'];
const VERTICAL = { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } };
const IDENTITY = { scale: 1, 'translation-in-points': [0, 0] };
const SYSTEM_LIGHT: [string, string] = ['#ffffff', '#f5f5f5'];
const SYSTEM_DARK: [string, string] = ['#1f1f1f', '#0f0f0f'];
const REFRACTION_HEIGHT_MIN = 12.8;    // pt
const REFRACTION_HEIGHT_RANGE = 243.2; // pt
const MAX_BEVEL = 25;                  // % of size, Height 100 %
const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, digits = 5) => Number(v.toFixed(digits));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const pct = (v: number) => round(clamp(v, 0, 1) * 100, 2);
const shadowPct = (v: number) => round(clamp(v, 0, 2) * 100, 2);
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';

function point(v: unknown): Point | null {
  if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') return [v[0], v[1]];
  if (isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number') return [v.x, v.y];
  return null;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isRecord(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
}

function warnAll(prefix: string, warnings: Set<string>) {
  if (warnings.size) console.warn(`${prefix}: ${[...warnings].join('; ')}`);
}

// ── Colors ──

function cssToRgba(css: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(css.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    const at = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [at(0), at(2), at(4), h.length === 8 ? at(6) : 1];
  }
  const hsl = /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i.exec(css);
  if (hsl) {
    const h = Number(hsl[1]), s = Number(hsl[2]) / 100, l = Number(hsl[3]) / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4), 1];
  }
  return [0, 0, 0, 1];
}

function toIconColor(css: string): string {
  return `srgb:${cssToRgba(css).map((c) => clamp(c, 0, 1).toFixed(5)).join(',')}`;
}

function fromIconColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const [space, list = ''] = value.split(':');
  const c = list.split(',').map(Number);
  const rgb = space.endsWith('gray') ? [c[0], c[0], c[0]] : c.slice(0, 3);
  if (rgb.length < 3 || rgb.some((n) => !Number.isFinite(n))) return null;
  return `#${rgb.map((n) => Math.round(clamp(n, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// ── Fill ──

const sortedColors = (stops: ColorStop[]) => [...stops].sort((a, b) => a.offset - b.offset).map((s) => s.color);

function gradientToIcon(colors: string[]) {
  return { 'linear-gradient': [toIconColor(colors[0]), toIconColor(colors[colors.length - 1])], orientation: VERTICAL };
}

function fillToIcon(fill: FillConfig): unknown {
  if (fill.type === 'solid') return { solid: toIconColor(fill.color) };
  if (fill.type === 'gradient' && fill.stops.length > 0) return gradientToIcon(sortedColors(fill.stops));
  return 'automatic';
}

function backgroundToIcon(bg: BackgroundConfig): unknown {
  if (bg.type === 'solid' && bg.color) return { solid: toIconColor(bg.color) };
  if (bg.bgType === 'custom' && bg.stops?.length) return gradientToIcon(sortedColors(bg.stops));
  return gradientToIcon(bg.colors ?? bgColorsFromHueTint(bg.hue ?? 220, bg.tint ?? 20, bg.brightness ?? 100));
}

function iconFillColors(fill: unknown, background: boolean): [string, string] | null {
  if (fill === 'system-dark') return SYSTEM_DARK;
  if (fill === 'system-light' || (background && fill === 'automatic')) return SYSTEM_LIGHT;
  if (!isRecord(fill)) return null;
  const solid = fromIconColor(fill.solid);
  if (solid) return [solid, solid];
  const auto = fromIconColor(fill['automatic-gradient']);
  if (auto) return automaticGradient(auto);
  const linear = fill['linear-gradient'];
  const a = Array.isArray(linear) ? fromIconColor(linear[0]) : null;
  const b = Array.isArray(linear) ? fromIconColor(linear[1]) : null;
  return a && b ? [a, b] : null;
}

function gradientAngle(fill: unknown): number {
  const orientation = isRecord(fill) && isRecord(fill.orientation) ? fill.orientation : null;
  const start = orientation && point(orientation.start);
  const stop = orientation && point(orientation.stop);
  if (!start || !stop || (start[0] === stop[0] && start[1] === stop[1])) return 90;
  return Math.round((Math.atan2(stop[1] - start[1], stop[0] - start[0]) * 180) / Math.PI);
}

function fillFromIcon(fill: unknown): FillConfig {
  const colors = iconFillColors(fill, false);
  if (!colors) return { type: 'none' };
  if (isRecord(fill) && 'solid' in fill) return { type: 'solid', color: colors[0] };
  const [top, bottom] = Math.sin((gradientAngle(fill) * Math.PI) / 180) < 0 ? [colors[1], colors[0]] : colors;
  return { type: 'gradient', stops: [{ offset: 0, color: top }, { offset: 1, color: bottom }], angle: 90 };
}

function backgroundFromIcon(fill: unknown): BackgroundConfig {
  const colors = iconFillColors(fill ?? { solid: 'extended-gray:1,1' }, true);
  if (!colors) return defaultBackground();
  return { type: 'gradient', bgType: 'custom', stops: [{ offset: 0, color: colors[0] }, { offset: 1, color: colors[1] }], angle: gradientAngle(fill) };
}

// ── Blend ──

function blendToIcon(mode: BlendMode, warnings: Set<string>): BlendMode {
  if (ICON_BLEND_MODES.includes(mode)) return mode;
  warnings.add(`blend mode "${mode}" has no Icon Composer equivalent, exported as normal`);
  return 'normal';
}

function blendFromIcon(mode: unknown, warnings: Set<string>): BlendMode {
  if (mode === 'plus-darker') {
    warnings.add('plus-darker is not available in Canvas 2D, mapped to multiply');
    return 'multiply';
  }
  return ICON_BLEND_MODES.find((m) => m === mode) ?? 'normal';
}

// ── Glass ──

function glassToIcon(lg: LiquidGlassConfig): Json {
  const fx = { ...DEFAULT_EFFECTS, ...lg.effects };
  return {
    'blur-material': lg.blur.enabled ? round(lg.blur.value / 100) : null,
    refractivity: {
      enabled: lg.refraction?.enabled !== false,
      strength: round(clamp(fx.refraction / 100, -1, 1)),
      depth: round(clamp(((fx.bevel / 100) * CANVAS_POINTS - REFRACTION_HEIGHT_MIN) / REFRACTION_HEIGHT_RANGE, 0, 1)),
    },
    shadow: {
      kind: lg.shadow.enabled ? 'neutral' : 'none',
      opacity: round(lg.shadow.value / 100),
    },
    translucency: { enabled: lg.translucency.enabled, value: round(lg.translucency.value / 100) },
    specular: lg.specular,
    lighting: 'individual',
  };
}

function glassFromIcon(base: LiquidGlassConfig, group: Json, enabled: boolean, warnings: Set<string>): LiquidGlassConfig {
  const lg: LiquidGlassConfig = { ...base, enabled };
  const { specular, translucency = { enabled: true, value: 0.3 }, shadow, refractivity } = group;
  if (typeof specular === 'boolean' || specular === 'inside' || specular === 'outside') lg.specular = specular;
  const placement = group['specular-highlight-placement'];
  if (specular === true && (placement === 'inside' || placement === 'outside')) lg.specular = placement;
  if ('blur-material' in group) {
    const blur = group['blur-material'];
    lg.blur = typeof blur === 'number' ? { enabled: true, value: pct(blur) } : { enabled: false, value: 50 };
  }
  if (isRecord(translucency)) {
    lg.translucency = { enabled: translucency.enabled !== false, value: pct(num(translucency.value, base.translucency.value / 100)) };
  }
  if (isRecord(shadow)) {
    lg.shadow = {
      enabled: shadow.kind !== 'none',
      value: shadowPct(num(shadow.opacity, base.shadow.value / 100)),
      type: 'neutral',
    };
  }
  if (typeof refractivity === 'boolean' || isRecord(refractivity)) {
    const r: Json = isRecord(refractivity) ? refractivity : { enabled: refractivity, strength: 0.5, depth: 0 };
    const fx: Partial<LayerEffects> = { ...lg.effects };
    if (typeof r.strength === 'number') fx.refraction = round(clamp(r.strength, -1, 1) * 100, 2);
    if (typeof r.depth === 'number') {
      fx.bevel = round(clamp(((REFRACTION_HEIGHT_MIN + REFRACTION_HEIGHT_RANGE * clamp(r.depth, 0, 1)) / CANVAS_POINTS) * 100, 0, MAX_BEVEL), 2);
    }
    lg.refraction = { enabled: r.enabled === true };
    lg.effects = fx;
  } else {
    lg.refraction = { enabled: false };
  }
  if (group.lighting === 'combined') warnings.add('combined lighting imported as individual');
  return lg;
}

// ── Asset size ──

const SVG_UNITS: Record<string, number> = { '': 1, px: 1, pt: 1, pc: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 };

function svgSize(svg: string): Point | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const length = (attr: string) => {
    const m = new RegExp(`\\s${attr}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px|pt|pc|in|cm|mm)?\\s*["']`, 'i').exec(tag);
    return m ? Number(m[1]) * SVG_UNITS[(m[2] ?? '').toLowerCase()] : 0;
  };
  const w = length('width'), h = length('height');
  if (w > 0 && h > 0) return [w, h];
  const viewBox = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  return viewBox ? [Number(viewBox[1]), Number(viewBox[2])] : null;
}

async function assetSize(data: Blob, svg: boolean): Promise<Point | null> {
  let size = svg ? svgSize(await data.text()) : null;
  if (!svg) {
    const bitmap = await createImageBitmap(data).catch(() => null);
    size = bitmap && [bitmap.width, bitmap.height];
    bitmap?.close();
  }
  return size && size[0] > 0 && size[1] > 0 ? size : null;
}

async function assetFit(data: Blob, svg: boolean): Promise<number> {
  const size = await assetSize(data, svg);
  return size ? Math.min(CANVAS_POINTS / size[0], CANVAS_POINTS / size[1]) : 1;
}

export async function naturalScale(data: Blob, svg: boolean): Promise<number | undefined> {
  const size = await assetSize(data, svg);
  return size ? round((Math.max(size[0], size[1]) / CANVAS_POINTS) * 100, 3) : undefined;
}

// ── Position ──

function positionToIcon({ x, y, scale }: LayerLayout, fit: number) {
  return {
    scale: round((scale / 100) * fit),
    'translation-in-points': [round((x / 100) * CANVAS_POINTS), round((y / 100) * CANVAS_POINTS)],
  };
}

function positionFromIcon(p: unknown): { scale: number; t: Point } {
  if (!isRecord(p)) return { scale: 1, t: [0, 0] };
  const relative = point(p['relative-translation']);
  return {
    scale: num(p.scale, 1),
    t: point(p['translation-in-points'])
      ?? (relative && [relative[0] * CANVAS_POINTS, relative[1] * CANVAS_POINTS])
      ?? point(p.translation)
      ?? [0, 0],
  };
}

// ── Export ──

export async function exportIconDocument(name: string, layers: Layer[], background: BackgroundConfig): Promise<Blob> {
  const folder = `${safeName(name)}.icon`;
  const files: Record<string, Uint8Array> = {};
  const assets = new Map<string, { file: string; fit: number }>();
  const warnings = new Set<string>();

  const addAsset = async (layer: Layer): Promise<{ file: string; fit: number } | undefined> => {
    if (!layer.blobUrl) return undefined;
    const known = assets.get(layer.blobUrl);
    if (known) return known;
    const blob = await (await fetch(layer.blobUrl)).blob();
    const base = safeName(layer.sourceFile ?? layer.name);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : `.${Object.keys(MIME).find((k) => MIME[k] === blob.type) ?? 'png'}`;
    const taken = new Set([...assets.values()].map((a) => a.file));
    let file = `${stem}${ext}`;
    for (let i = 2; taken.has(file); i++) file = `${stem} ${i}${ext}`;
    const asset = { file, fit: await assetFit(blob, /^\.svg$/i.test(ext)) };
    assets.set(layer.blobUrl, asset);
    files[`${folder}/Assets/${file}`] = new Uint8Array(await blob.arrayBuffer());
    return asset;
  };

  const layerToIcon = async (layer: Layer, wrapped: boolean): Promise<Json> => {
    const asset = await addAsset(layer);
    return {
      name: layer.name,
      'image-name': asset?.file,
      fill: fillToIcon(layer.fill),
      glass: layer.liquidGlass.enabled,
      hidden: wrapped ? false : !layer.visible,
      opacity: wrapped ? 1 : round(layer.opacity / 100),
      'blend-mode': wrapped ? 'normal' : blendToIcon(layer.blendMode, warnings),
      position: positionToIcon(layer.layout, asset?.fit ?? 1),
    };
  };

  const groupToIcon = async (owner: Layer, members: Layer[], glass: LiquidGlassConfig, groupName?: string): Promise<Json> => {
    const items: Json[] = [];
    for (const member of members) items.push(await layerToIcon(member, member === owner));
    return {
      name: groupName,
      hidden: !owner.visible,
      opacity: round(owner.opacity / 100),
      'blend-mode': blendToIcon(owner.blendMode, warnings),
      position: IDENTITY,
      ...glassToIcon(glass),
      layers: items,
    };
  };

  const childrenOf = (parentId: string | null) => layers.filter((l) => l.parentId === parentId).sort((a, b) => b.order - a.order);
  const groups: Json[] = [];
  for (const root of childrenOf(null)) {
    if (root.type === 'layer') {
      if (root.blobUrl) groups.push(await groupToIcon(root, [root], root.liquidGlass));
      else warnings.add('layers without an image were skipped');
      continue;
    }
    const all = childrenOf(root.id);
    const members = all.filter((l) => l.type === 'layer' && l.blobUrl);
    if (all.some((l) => l.type === 'group')) warnings.add('nested groups are not supported and were skipped');
    if (all.some((l) => l.type === 'layer' && !l.blobUrl)) warnings.add('layers without an image were skipped');
    if (!members.length) continue;
    const source = members.find((l) => l.liquidGlass.enabled) ?? members[0] ?? root;
    groups.push(await groupToIcon(root, members, source.liquidGlass, root.name));
  }

  const features = groups.some((g) => isRecord(g.refractivity) && g.refractivity.enabled) ? ['refractivity'] : [];
  if (groups.some((g) => typeof g.specular === 'string')) features.push('specular-location');

  const icon = {
    fill: backgroundToIcon(background),
    groups,
    features: features.length ? features : undefined,
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  };
  files[`${folder}/icon.json`] = strToU8(JSON.stringify(sortKeys(icon), null, 2).replace(/^(\s*"[^"\n]*"): /gm, '$1 : '));
  warnAll('Export .icon', warnings);
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

export async function downloadIconDocument(name: string, layers: Layer[], background: BackgroundConfig) {
  const url = URL.createObjectURL(await exportIconDocument(name, layers, background));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(name)}.icon.zip`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Import ──

export async function importIconDocument(file: Blob, fileName: string): Promise<IconDocumentData> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => !f.name.startsWith('__MACOSX/') && !/(^|\/)\._/.test(f.name),
  });
  const jsonPath = Object.keys(entries)
    .filter((p) => /(^|\/)icon\.json$/.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!jsonPath) throw new Error('No icon.json found in the archive.');

  const doc: unknown = JSON.parse(strFromU8(entries[jsonPath]));
  if (!isRecord(doc)) throw new Error('icon.json is not a valid Icon Composer document.');
  const features = Array.isArray(doc.features) ? doc.features : [];
  if (features.some((f) => !KNOWN_FEATURES.includes(f))) {
    throw new Error('This document uses features from a newer version of Icon Composer');
  }

  const root = jsonPath.slice(0, -'icon.json'.length);
  const name = /([^/]+)\.icon\/$/i.exec(root)?.[1] ?? fileName.replace(/\.zip$/i, '').replace(/\.icon$/i, '');
  const warnings = new Set<string>();
  const specializations = new Set<string>();
  const scan = (o: Json) => Object.keys(o).filter((k) => k.endsWith('-specializations')).forEach((k) => {
    specializations.add(k);
    const key = k.slice(0, -'-specializations'.length);
    const base = (Array.isArray(o[k]) ? o[k] : []).filter(isRecord)
      .filter((s) => (s.appearance ?? 'light') === 'light' && [undefined, 'square', 'iOS'].includes(s.idiom as string | undefined))
      .pop();
    if (base && !(key in o)) o[key] = base.value;
  });
  scan(doc);

  const fits = new Map<string, number>();
  for (const path of Object.keys(entries).filter((p) => p.startsWith(`${root}Assets/`))) {
    fits.set(path.slice(`${root}Assets/`.length), await assetFit(new Blob([entries[path] as Uint8Array<ArrayBuffer>]), /\.svg$/i.test(path)));
  }

  const groups = (Array.isArray(doc.groups) ? doc.groups : []).filter(isRecord);
  const layers: Layer[] = [];
  groups.forEach((g, gi) => {
    scan(g);
    const items = (Array.isArray(g.layers) ? g.layers : []).filter(isRecord);
    const order = groups.length - 1 - gi;
    const unwrap = items.length === 1 && typeof g.name !== 'string';
    const groupPos = positionFromIcon(g.position);
    const groupBlend = blendFromIcon(g['blend-mode'], warnings);
    let parentId: string | null = null;

    if (!unwrap) {
      const group = createGroup(typeof g.name === 'string' ? g.name : `Group ${gi + 1}`);
      group.order = order;
      group.visible = g.hidden !== true;
      group.opacity = pct(num(g.opacity, 1));
      group.blendMode = groupBlend;
      layers.push(group);
      parentId = group.id;
    }

    items.forEach((l, li) => {
      scan(l);
      const imageName = typeof l['image-name'] === 'string' ? l['image-name'] : undefined;
      const layer = createLayer(typeof l.name === 'string' ? l.name : imageName ?? `Layer ${layers.length + 1}`, parentId);
      const data = imageName ? entries[`${root}Assets/${imageName}`] : undefined;
      if (imageName && data) {
        const ext = imageName.split('.').pop()!.toLowerCase();
        layer.blobUrl = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: MIME[ext] ?? '' }));
        layer.sourceFile = imageName;
      } else if (imageName) {
        warnings.add(`missing asset ${imageName}`);
      }

      const pos = positionFromIcon(l.position);
      const layerBlend = blendFromIcon(l['blend-mode'], warnings);
      layer.order = unwrap ? order : items.length - 1 - li;
      layer.visible = l.hidden !== true && !(unwrap && g.hidden === true);
      layer.opacity = pct(num(l.opacity, 1) * (unwrap ? num(g.opacity, 1) : 1));
      layer.blendMode = unwrap && layerBlend === 'normal' ? groupBlend : layerBlend;
      layer.fill = fillFromIcon(l.fill);
      layer.liquidGlass = glassFromIcon(layer.liquidGlass, g, l.glass !== false, warnings);
      layer.layout = {
        x: round(((groupPos.t[0] + groupPos.scale * pos.t[0]) / CANVAS_POINTS) * 100, 3),
        y: round(((groupPos.t[1] + groupPos.scale * pos.t[1]) / CANVAS_POINTS) * 100, 3),
        scale: round((groupPos.scale * pos.scale * 100) / (fits.get(imageName ?? '') ?? 1), 3),
      };
      layers.push(layer);
    });
  });

  if (specializations.size) warnings.add(`specializations ignored (${[...specializations].join(', ')})`);
  warnAll('Open .icon', warnings);
  return { name, layers, background: backgroundFromIcon(doc.fill) };
}

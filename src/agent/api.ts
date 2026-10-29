import { batch } from 'nanostores';
import { z } from 'zod';
import {
  $background, $iconName, $layers, addGroup, addLayer, bgColorsFromHueTint, clearHistory, createLayer,
  loadDocument, removeLayer, resetDocument, setIconName, updateBackground, updateLayer,
} from '../store/iconStore';
import { $appearanceMode, $lightAngle, $persistenceEnabled, $webgl2Status, selectLayer, setAppearanceMode } from '../store/uiStore';
import { DEFAULT_EFFECTS, exportIcon, exportZip } from '../engine/IconRenderer';
import { exportIconDocument, importIconDocument, naturalScale } from '../engine/IconDocument';
import {
  API_VERSION, APPEARANCES, BLEND_MODES, GUIDE, IMAGE_TYPES,
  BackgroundSchema, GlassSchema, LayerPatchSchema, LayerSchema, OutputSchema, RecipeSchema, RenderSchema,
  base64ToBytes, bytesToBase64, decodeRecipe, formatIssues, recipeLayers, sourceType,
  type BackgroundSpec, type GlassPatch, type Issue, type LayerPatch, type LayerSpec,
} from './recipe';
import type { BackgroundConfig, Layer, LayerEffects, LiquidGlassConfig } from '../types/index';

type Source = { url: string; ext: string; scale?: number };
type Entry = { path: (string | number)[]; layer: LayerSpec };

const GROUP_FIELDS = ['name', 'visible', 'opacity', 'blendMode'];
const GLASS_KEYS = Object.keys(GlassSchema.shape) as (keyof LiquidGlassConfig)[];

export class AgentError extends Error {
  code: string;
  issues?: Issue[];

  constructor(code: string, message: string, issues?: Issue[]) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

function parse<T extends z.ZodType>(schema: T, input: unknown, what: string): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = formatIssues(result.error.issues);
  throw new AgentError('invalid_input', `Invalid ${what}: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`, issues);
}

function find(ref: unknown): Layer {
  if (typeof ref !== 'string') throw new AgentError('invalid_input', 'A layer reference is its name or id');
  const layers = $layers.get();
  const named = layers.filter((l) => l.name === ref);
  const layer = layers.find((l) => l.id === ref) ?? (named.length === 1 ? named[0] : undefined);
  if (layer) return layer;
  if (named.length > 1) throw new AgentError('ambiguous_ref', `Several layers are named "${ref}"; use the id from state()`);
  throw new AgentError('not_found', `No layer "${ref}". Layers: ${layers.map((l) => l.name).join(', ') || 'none'}`);
}

// ── Sources ──

async function loadSource(src: string, path: string): Promise<Source> {
  const fail = (message: string) => new AgentError('invalid_image', `${path}: ${message}`, [{ path, message }]);
  const kind = sourceType(src);
  if (kind === 'path') throw fail('file paths are read by the CLI and the MCP server; here pass inline SVG markup or a data: URL');
  const blob = kind === 'svg' ? new Blob([src], { type: 'image/svg+xml' }) : await fetch(src).then((r) => r.blob()).catch(() => null);
  if (!blob) throw fail('invalid data: URL');
  const ext = IMAGE_TYPES[blob.type.split(';')[0]];
  if (!ext) throw fail('only svg, png and jpeg images are supported');
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw fail('the image could not be decoded');
  }
  return { url, ext, scale: await naturalScale(blob, ext === 'svg') };
}

async function prepare(entries: Entry[], taken: Set<string>) {
  for (const { path, layer } of entries) {
    if (layer.name && taken.has(layer.name)) throw new AgentError('invalid_input', `Duplicate layer name "${layer.name}"`, [{ path: [...path, 'name'].join('.'), message: 'Duplicate layer name' }]);
    if (layer.name) taken.add(layer.name);
    const unknown = layer.type === 'group' ? [] : Object.keys(layer.liquidGlass?.effects ?? {}).filter((k) => !(k in DEFAULT_EFFECTS));
    if (unknown.length) {
      throw new AgentError(
        'invalid_input',
        `Unknown effects ${unknown.join(', ')}; valid keys: ${Object.keys(DEFAULT_EFFECTS).join(', ')}`,
        unknown.map((k) => ({ path: [...path, 'liquidGlass', 'effects', k].join('.'), message: 'Unknown effect' })),
      );
    }
  }

  const names = new Map<LayerSpec, string>();
  let n = 0;
  for (const { layer } of entries) {
    let name = layer.name;
    while (!name || (!layer.name && taken.has(name))) name = `${layer.type === 'group' ? 'Group' : 'Layer'} ${++n}`;
    taken.add(name);
    names.set(layer, name);
  }

  const results = await Promise.allSettled(entries.map(({ path, layer }) => (
    layer.type !== 'group' && layer.src ? loadSource(layer.src, [...path, 'src'].join('.')) : Promise.resolve(undefined)
  )));
  const failed = results.find((r) => r.status === 'rejected');
  const loaded = results.map((r) => (r.status === 'fulfilled' ? r.value : undefined));
  if (failed) {
    loaded.forEach((s) => s && URL.revokeObjectURL(s.url));
    throw failed.reason;
  }
  const sources = new Map(entries.map(({ layer }, i) => [layer, loaded[i]]));
  return { names, sources };
}

// ── Layers ──

function mergeGlass(base: LiquidGlassConfig, patch: GlassPatch): LiquidGlassConfig {
  return {
    ...base,
    ...patch,
    blur: { ...base.blur, ...patch.blur },
    translucency: { ...base.translucency, ...patch.translucency },
    translucencyGradient: patch.translucencyGradient ? { ...base.translucencyGradient, ...patch.translucencyGradient } as NonNullable<LiquidGlassConfig['translucencyGradient']> : base.translucencyGradient,
    shadow: { ...base.shadow, ...patch.shadow },
    effects: patch.effects ? { ...base.effects, ...(patch.effects as Partial<LayerEffects>) } : base.effects,
  };
}

function layerChanges(layer: Layer, patch: LayerPatch, source?: Source): Partial<Layer> {
  const { src, layout, liquidGlass, ...rest } = patch;
  return {
    ...rest,
    ...(layout && { layout: { ...layer.layout, ...layout } }),
    ...(liquidGlass && { liquidGlass: mergeGlass(layer.liquidGlass, liquidGlass) }),
    ...(source && { blobUrl: source.url, sourceFile: `${rest.name ?? layer.name}.${source.ext}` }),
  };
}

function insert(specs: LayerSpec[], parentId: string | null, prepared: Awaited<ReturnType<typeof prepare>>) {
  for (const spec of [...specs].reverse()) {
    const name = prepared.names.get(spec)!;
    if (spec.type === 'group') {
      const { type, layers = [], ...fields } = spec;
      const id = addGroup();
      updateLayer(id, { ...fields, name });
      insert(layers, id, prepared);
      continue;
    }
    const { type, ...patch } = spec;
    const source = prepared.sources.get(spec);
    const id = addLayer(source?.url, source && `${name}.${source.ext}`, parentId, source?.scale);
    updateLayer(id, layerChanges($layers.get().find((l) => l.id === id)!, { ...patch, name }));
  }
}

function toBackground(spec: BackgroundSpec): Partial<BackgroundConfig> {
  if ('colors' in spec) {
    return { type: 'gradient', bgType: 'custom', stops: [{ offset: 0, color: spec.colors[0] }, { offset: 1, color: spec.colors[1] }], angle: 90 };
  }
  const { hue, tint = 20, brightness = 100 } = spec;
  return { type: 'gradient', bgType: 'preset', hue, tint, brightness, colors: bgColorsFromHueTint(hue, tint, brightness), angle: 90 };
}

// ── State ──

const childrenOf = (layers: Layer[], parentId: string | null) => layers.filter((l) => l.parentId === parentId).sort((a, b) => b.order - a.order);

function layerState(layer: Layer, layers: Layer[]): Record<string, unknown> {
  const common = { id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode };
  if (layer.type === 'group') return { type: 'group', ...common, layers: childrenOf(layers, layer.id).map((l) => layerState(l, layers)) };
  return {
    type: 'layer',
    ...common,
    file: layer.sourceFile ?? null,
    layout: layer.layout,
    fill: layer.fill,
    liquidGlass: Object.fromEntries(GLASS_KEYS.filter((k) => layer.liquidGlass[k] !== undefined).map((k) => [k, layer.liquidGlass[k]])),
  };
}

function backgroundState(bg: BackgroundConfig) {
  if (bg.bgType === 'custom' && bg.stops?.length) {
    const stops = [...bg.stops].sort((a, b) => a.offset - b.offset);
    return { colors: [stops[0].color, stops[stops.length - 1].color] };
  }
  return { hue: bg.hue ?? 220, tint: bg.tint ?? 20, brightness: bg.brightness ?? 100 };
}

function state() {
  const layers = $layers.get();
  return {
    name: $iconName.get(),
    appearance: $appearanceMode.get(),
    webgl: $webgl2Status.get(),
    background: backgroundState($background.get()),
    layers: childrenOf(layers, null).map((l) => layerState(l, layers)),
  };
}

// ── API ──

async function apply(input: unknown) {
  const recipe = parse(RecipeSchema, input, 'recipe');
  const prepared = await prepare(recipeLayers(recipe), new Set());
  batch(() => {
    resetDocument();
    if (recipe.name) setIconName(recipe.name);
    if (recipe.background) updateBackground(toBackground(recipe.background));
    insert(recipe.layers ?? [], null, prepared);
    selectLayer(null);
  });
  clearHistory();
  setAppearanceMode(recipe.appearance ?? 'default');
  return state();
}

async function add(input: unknown, parent?: string) {
  const spec = parse(LayerSchema, input, 'layer');
  const group = parent === undefined ? null : find(parent);
  if (group && (group.type !== 'group' || spec.type === 'group')) {
    throw new AgentError('invalid_input', 'parent must be a group, and groups cannot be nested');
  }
  const entries = recipeLayers({ layers: [spec] }).map((e) => ({ ...e, path: e.path.slice(2) }));
  const prepared = await prepare(entries, new Set($layers.get().map((l) => l.name)));
  batch(() => {
    insert([spec], group?.id ?? null, prepared);
    selectLayer(null);
  });
  return state();
}

async function update(ref: string, input: unknown) {
  const { id, type } = find(ref);
  const patch = parse(LayerPatchSchema, input, 'patch');
  const extra = type === 'group' ? Object.keys(patch).filter((k) => !GROUP_FIELDS.includes(k)) : [];
  if (extra.length) throw new AgentError('invalid_input', `Groups only take ${GROUP_FIELDS.join(', ')}; got ${extra.join(', ')}`);
  if (patch.name && $layers.get().some((l) => l.name === patch.name && l.id !== id)) {
    throw new AgentError('invalid_input', `Duplicate layer name "${patch.name}"`, [{ path: 'name', message: 'Duplicate layer name' }]);
  }
  const { sources } = await prepare([{ path: [], layer: { ...patch, name: undefined } }], new Set());
  const layer = find(id);
  updateLayer(id, layerChanges(layer, patch, [...sources.values()][0]));
  return state();
}

function remove(ref: string) {
  removeLayer(find(ref).id);
  return state();
}

function setBackground(input: unknown) {
  updateBackground(toBackground(parse(BackgroundSchema, input, 'background')));
  return state();
}

function setAppearance(mode: unknown) {
  setAppearanceMode(parse(z.enum(APPEARANCES), mode, 'appearance'));
  return state();
}

const blobToBase64 = async (blob: Blob) => bytesToBase64(new Uint8Array(await blob.arrayBuffer()));

async function render(input: unknown = {}) {
  const { size = 1024, mode = $appearanceMode.get(), format = 'png', bare } = parse(RenderSchema, input, 'render options');
  return blobToBase64(await exportIcon($layers.get(), $background.get(), $lightAngle.get(), mode, { format, size, bare }));
}

async function exportIconFile() {
  return { path: 'icon.icon.zip', base64: await blobToBase64(await exportIconDocument($iconName.get(), $layers.get(), $background.get())) };
}

async function exportFiles(input: unknown = {}) {
  const output = parse(OutputSchema, input, 'output');
  const layers = $layers.get();
  const background = $background.get();
  const light = $lightAngle.get();
  if ('zip' in output) return [{ path: 'icon.zip', base64: await blobToBase64(await exportZip(layers, background, light)) }];
  if ('icon' in output) return [await exportIconFile()];
  const { format = 'png', sizes = [1024], modes = [$appearanceMode.get()], bare } = output;
  const files: { path: string; base64: string }[] = [];
  for (const mode of modes) {
    for (const size of sizes) {
      const blob = await exportIcon(layers, background, light, mode, { format, size, bare });
      files.push({ path: `icon-${size}${mode === 'default' ? '' : `-${mode}`}.${format === 'jpeg' ? 'jpg' : 'png'}`, base64: await blobToBase64(blob) });
    }
  }
  return files;
}

async function load(input: unknown) {
  const { icon, name = 'Untitled.icon' } = parse(z.strictObject({ icon: z.string().min(1), name: z.string().optional() }), input, 'load options');
  try {
    loadDocument(await importIconDocument(new Blob([base64ToBytes(icon)]), name));
  } catch (err) {
    throw new AgentError('invalid_icon', err instanceof Error ? err.message : String(err));
  }
  return state();
}

function schema() {
  const { layout, liquidGlass } = createLayer('');
  return {
    version: API_VERSION,
    guide: GUIDE,
    recipe: z.toJSONSchema(RecipeSchema, { io: 'input' }),
    patch: z.toJSONSchema(LayerPatchSchema, { io: 'input' }),
    defaults: {
      layout,
      liquidGlass: Object.fromEntries(GLASS_KEYS.filter((k) => liquidGlass[k] !== undefined).map((k) => [k, liquidGlass[k]])),
      effects: { ...DEFAULT_EFFECTS, ...liquidGlass.effects },
    },
    appearances: APPEARANCES,
    blendModes: BLEND_MODES,
  };
}

const api = {
  version: API_VERSION,
  ready: Promise.resolve(),
  apply,
  addLayer: add,
  update,
  remove,
  setBackground,
  setAppearance,
  render,
  export: exportFiles,
  exportIcon: exportIconFile,
  load,
  state,
  schema,
};

export type LiquidComposerApi = typeof api;

declare global {
  interface Window { liquidComposer?: LiquidComposerApi }
}

async function openLink() {
  const encoded = /^#r=(.+)$/.exec(location.hash)?.[1];
  if (!encoded) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const recipe = decodeRecipe(encoded);
    if ($persistenceEnabled.get() && $layers.get().length && !window.confirm('Replace the current icon with the one from this link?')) return;
    await apply(recipe);
  } catch (err) {
    console.error(err);
    window.alert(`This link does not hold a valid icon. ${err instanceof Error ? err.message : ''}`);
  }
}

export function installAgentApi(restored: Promise<unknown>) {
  const ready = restored.then(openLink, openLink);
  window.liquidComposer = { ...api, ready };
  window.addEventListener('hashchange', () => ready.then(openLink));
}

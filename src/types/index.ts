export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

// Apple Icon Composer 2025 defines 3 modes: Default, Dark, Clear.
export type AppearanceMode = 'default' | 'dark' | 'clear';

export interface ColorStop {
  offset: number; // 0-1
  color: string;  // hex
}

export type FillConfig =
  | { type: 'none' }
  | { type: 'solid'; color: string }
  | { type: 'gradient'; stops: ColorStop[]; angle: number };

export interface LiquidGlassConfig {
  enabled: boolean;
  mode: 'individual' | 'all';
  specular: boolean;
  blur: { enabled: boolean; value: number };
  translucency: { enabled: boolean; value: number };
  dark: { enabled: boolean; value: number };
  mono: { enabled: boolean; value: number };
  shadow: {
    enabled: boolean;
    value: number;
    type?: 'chromatic' | 'neutral';
  };
  // SDF-based rendering parameters (all optional — defaults in renderer)
  refraction?: { enabled: boolean; thickness: number; factor: number; dispersion: number };
  fresnel?: { enabled: boolean; range: number; factor: number; hardness: number };
  glare?: { enabled: boolean; range: number; convergence: number; factor: number; angle: number };
  tint?: { r: number; g: number; b: number; a: number };
}

export interface LayerLayout {
  x: number;
  y: number;
  scale: number;
}

export interface Layer {
  id: string;
  name: string;
  type: 'layer' | 'group';
  parentId: string | null;
  order: number;
  visible: boolean;
  collapsed?: boolean;
  blobUrl?: string;
  sourceFile?: string;
  opacity: number;    // 0-100
  blendMode: BlendMode;
  fill: FillConfig;
  liquidGlass: LiquidGlassConfig;
  layout: LayerLayout;
}

export type BackgroundPreset = 'warm' | 'cool' | 'forest' | 'ocean' | 'sunset' | 'mono';

export interface BackgroundConfig {
  type: 'gradient' | 'solid' | 'image';
  preset?: BackgroundPreset;
  color?: string;
  colors?: [string, string]; // gradient start/end
  angle?: number;
  hue?: number;        // 0–360
  tint?: number;       // 0–100, 0 = vibrant, 100 = very pale
  brightness?: number; // 0–100, 0 = black, 100 = full brightness (default 100)
}

export interface AppearanceOverride {
  opacity?: number;
  fill?: FillConfig;
  liquidGlass?: Partial<LiquidGlassConfig>;
  visible?: boolean;
}

export interface IconDocument {
  name: string;
  modified: boolean;
  layers: Layer[];
  background: BackgroundConfig;
  lightAngle: number;
  appearanceMode: AppearanceMode;
  zoom: number;
}

export interface UIState {
  selectedLayerId: string | null;
  expandedGroups: Set<string>;
  inspectorTab: 'brush' | 'document';
  zoom: number;
  lightAngle: number;
  appearanceMode: AppearanceMode;
}

export interface RenderContext {
  layers: Layer[];
  background: BackgroundConfig;
  lightAngle: number;
  appearanceMode: AppearanceMode;
  size: number;
}

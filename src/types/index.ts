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

// Apple HIG defines 6 modes for iOS 26: Default Light/Dark, Clear Light/Dark, Tinted Light/Dark.
// clear-light / clear-dark use Liquid Glass on the background layer (planned for Phase 3).
export type AppearanceMode = 'default' | 'dark' | 'mono' | 'clear-light' | 'clear-dark';

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
    type: 'neutral' | 'chromatic';
    enabled: boolean;
    value: number;
  };
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

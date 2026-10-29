import { zipSync } from "fflate";
import type {
    RenderContext,
    Layer,
    BackgroundConfig,
    AppearanceMode,
    LayerEffects,
} from "../types/index";
import type { LiquidGlassConfig } from "../types/index";
import { squirclePath, createBackgroundCanvas } from "./ImageProcessor";
import { LiquidGlassRenderer } from "./LiquidGlass";
import {
    CHICLET_CLEAR_HIGHLIGHTS,
    CHICLET_HIGHLIGHTS,
    CHICLET_LIGHT_LONGITUDE,
    CHICLET_LUMINANCE,
    CLEAR_MODE,
    LAYER_SHADOW,
    MATERIAL,
    MITIGATED,
    SYSTEM_GRADIENT,
} from "./glassContract";
import type {
    DarklightPlacement,
    GlassRenderer,
    LiquidGlassParams,
    Vcm,
} from "./glassContract";
import {
    $webgl2Restores,
    setWebgl2Status,
    setWebgl2Error,
} from "../store/uiStore";

type RGB = { r: number; g: number; b: number };
type Frame = { x: number; y: number; w: number; h: number };

export const DEFAULT_EFFECTS: LayerEffects = {
    domeIntensity: 0,
    domeRadius: 80,
    innerRimWidth: 1.4,
    innerRimLitAlpha: 65,
    innerRimShadowAlpha: 28,
    innerShadowWidth: 1.6,
    innerShadowAlpha: 18,
    outerBorderWidth: 0.16,
    outerBorderAlpha: 35,
    specularEdge: 20,
    rimIntensity: 26,
    bottomHighlight: 35,
    envReflection: 0,
    innerGlow: 20,
    ambientRim: 30,
    aoDarken: 72,
    frostiness: 0,
    edgeDarken: 15,
    bevel: 1.25,
    refraction: 50,
    keyHighlight: 100,
    fillHighlight: 100,
    darklight: 100,
};

// [1] INNER SPECULAR DOME — soft light filling the layer interior on the lit side
const LAYER_DOME_CENTER_ALPHA = 0.18; // brightness at the brightest point
const LAYER_DOME_MID_ALPHA = 0.09; // brightness halfway across
const LAYER_DOME_EDGE_ALPHA = 0.05; // brightness near the edge before fading out
const LAYER_DOME_BLUR_BASE = 0.014;

// [2] INNER COLORED RIM — thin ring inside the layer edge, tinted with the layer color
const LAYER_INNER_RIM_MID_ALPHA = 0.5; // intensity in the middle
const LAYER_INNER_RIM_BLUR = 0.0015;
const LAYER_INNER_RIM_ALPHA_BLUR = 0.5; // opacity of the blurred pass
const LAYER_INNER_RIM_ALPHA_SHARP = 0.7; // opacity of the sharp pass layered on top
const LAYER_HOLES_RIM_ALPHA_BLUR = 0.5;
const LAYER_HOLES_RIM_ALPHA_SHARP = 0.7;

// [2b] RIM TINT — background sampled under the layer, mixed into rim and outer border
const LAYER_RIM_BG_SAT = 2.0; // saturation boost of the sampled background
const LAYER_RIM_BG_LIFT = 0.35; // lift toward white
const LAYER_RIM_BG_MIX = 0.65; // share of background tint over layer color

// [4] INNER SHADOW — darkens the inner edge on the shadow side (concave depth)
const LAYER_INNER_SHADOW_MID_ALPHA = 0.12; // midpoint
const LAYER_INNER_SHADOW_BLUR = 0.008; // softness (× size)
const LAYER_INNER_SHADOW_ALPHA_BLUR = 0.8; // opacity of blurred pass
const LAYER_INNER_SHADOW_ALPHA_SHARP = 0.3; // opacity of sharp pass

// [5] OUTER BORDER — thin ring outside the layer shape, colored with the layer's own color
const LAYER_OUTSIDE_SPEC_WIDTH = 0.0035; // specular band outside the shape (× size), placement outside
const LAYER_OUTSIDE_INNER_SCALE = 0.5; // × inner rim, placement outside

// [6] DROP SHADOW — inner ring of the art, shifted down, blurred, composed in multiply
const LAYER_SHADOW_WORK_SIZE = 512; // px, built at this size and upscaled (blur σ 9.6 px)
const LAYER_SHADOW_RING_STEPS = 24; // offsets per circle of the ring dilation

const CHICLET_CONIC_STOPS = 256;
const CHICLET_BUILD_SIZE = 2048; // px, chiclet highlights built once and scaled to the render size

const rasterCache = new Map<string, Promise<HTMLImageElement>>();

function loadRaster(
    url: string,
    rasterSize: number,
): Promise<HTMLImageElement> {
    const key = `${url}:${rasterSize}`;
    let pending = rasterCache.get(key);
    if (!pending) {
        pending = new Promise((resolve, reject) => {
            const img = new Image(rasterSize, rasterSize);
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
        rasterCache.set(key, pending);
        pending.catch(() => rasterCache.delete(key));
        if (rasterCache.size > 32)
            rasterCache.delete(rasterCache.keys().next().value!);
    }
    return pending;
}

type BgEntry = { canvas: HTMLCanvasElement; key: string; luma?: number };

const bgCanvasCache = new Map<string, BgEntry>();

const shadowCache = new Map<
    string,
    { canvas: HTMLCanvasElement; key: string }
>();

type LayerShadow = {
    canvas: HTMLCanvasElement;
    key: string;
    alpha: number;
    overdraw: number;
    x: number;
    y: number;
    w: number;
};
type LayerOverdraw = { canvas: HTMLCanvasElement; alpha: number };

function layerShadow(
    layer: Layer,
    content: HTMLCanvasElement,
    frame: Frame,
    size: number,
    tintKey: string,
    translucency: number,
): LayerShadow | null {
    const { shadow } = layer.liquidGlass;
    if (!shadow.enabled || shadow.value <= 0) return null;

    const alpha = Math.min(
        1,
        (LAYER_SHADOW.neutralOpacity * shadow.value) / 100,
    );
    const overdraw =
        Math.min(1, translucency / LAYER_SHADOW.translucencyForMaxOverdraw) *
        LAYER_SHADOW.maxOverdraw.neutral;
    const work = Math.min(size, LAYER_SHADOW_WORK_SIZE);
    const q = work / size;
    const u = work / 1024;
    const ring = LAYER_SHADOW.ringWidth * u;
    const offsetY = LAYER_SHADOW.offsetY * u;
    const blurPx = Math.min(LAYER_SHADOW.radius, 1) * MATERIAL.blurMax * u;
    const pad = Math.ceil(offsetY + 3 * blurPx);
    const side = work + 2 * pad;
    const inside =
        frame.x >= 0 &&
        frame.y >= 0 &&
        frame.x + frame.w <= size &&
        frame.y + frame.h <= size;
    const dx = inside ? Math.round((layer.layout.x / 100) * size) : 0;
    const dy = inside ? Math.round((layer.layout.y / 100) * size) : 0;
    const key = `${size}:${tintKey}:${layer.layout.scale}:${inside ? "" : `${layer.layout.x}:${layer.layout.y}`}`;

    let entry = shadowCache.get(layer.id);
    if (entry?.key !== key) {
        const { canvas: art, ctx: ac } = getScratchCanvas("shadow-art", side);
        ac.imageSmoothingQuality = "high";
        ac.drawImage(content, pad - dx * q, pad - dy * q, work, work);
        const { canvas: outside, ctx: oc } = getScratchCanvas(
            "shadow-outside",
            side,
        );
        oc.fillStyle = "#000";
        if (inside) oc.fillRect(0, 0, side, side);
        else oc.fillRect(pad, pad, work, work);
        oc.globalCompositeOperation = "destination-out";
        oc.drawImage(art, 0, 0);
        const { canvas: near, ctx: nc } = getScratchCanvas("shadow-near", side);
        nc.drawImage(outside, 0, 0);
        for (const r of [ring, ring * 0.75, ring / 2, ring / 4]) {
            for (let i = 0; i < LAYER_SHADOW_RING_STEPS; i++) {
                const a = (2 * Math.PI * i) / LAYER_SHADOW_RING_STEPS;
                nc.drawImage(outside, r * Math.cos(a), r * Math.sin(a));
            }
        }
        ac.globalCompositeOperation = "destination-in";
        ac.drawImage(near, 0, 0);
        ac.globalCompositeOperation = "source-atop";
        ac.fillStyle = "#000";
        ac.fillRect(0, 0, side, side);

        const canvas = entry?.canvas ?? document.createElement("canvas");
        if (canvas.width !== side) canvas.width = canvas.height = side;
        const sc = canvas.getContext("2d")!;
        sc.clearRect(0, 0, side, side);
        sc.filter = `blur(${blurPx}px)`;
        sc.drawImage(art, 0, offsetY);
        sc.filter = "none";
        entry = { canvas, key };
        shadowCache.set(layer.id, entry);
        if (shadowCache.size > 16)
            shadowCache.delete(shadowCache.keys().next().value!);
    }
    return {
        canvas: entry.canvas,
        key,
        alpha,
        overdraw,
        x: dx - pad / q,
        y: dy - pad / q,
        w: side / q,
    };
}

// ─── Shared tiny canvas for color sampling (avoids per-render allocation) ────
const _colorSampleCanvas = document.createElement("canvas");
_colorSampleCanvas.width = _colorSampleCanvas.height = 16;
const _colorSampleCtx = _colorSampleCanvas.getContext("2d")!;

const layerTintCache = new Map<string, RGB>();

function averageColor(
    content: HTMLCanvasElement,
    under?: HTMLCanvasElement,
): RGB | null {
    const s = 16;
    const tc = _colorSampleCtx;
    tc.clearRect(0, 0, s, s);
    tc.drawImage(content, 0, 0, s, s);
    if (under) {
        tc.globalCompositeOperation = "source-in";
        tc.drawImage(under, 0, 0, s, s);
        tc.globalCompositeOperation = "source-over";
    }
    const data = tc.getImageData(0, 0, s, s).data;
    let r = 0,
        g = 0,
        b = 0,
        n = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 60) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n++;
        }
    }
    return n === 0 ? null : { r: r / n, g: g / n, b: b / n };
}

function resolvePlacement(
    specular: LiquidGlassConfig["specular"],
    colorMode: boolean,
    iconBright: boolean,
): DarklightPlacement {
    if (specular === false) return "off";
    if (specular !== true) return specular;
    return colorMode && iconBright ? "inside" : "outside";
}

// ── Chiclet luminance: brightest gradient stop, read at the canvas corners ──
function backgroundLuma(entry: BgEntry): number {
    if (entry.luma === undefined) {
        const n = entry.canvas.width - 1;
        const tc = _colorSampleCtx;
        tc.clearRect(0, 0, 4, 1);
        [
            [0, 0],
            [n, 0],
            [0, n],
            [n, n],
        ].forEach(([x, y], i) =>
            tc.drawImage(entry.canvas, x, y, 1, 1, i, 0, 1, 1),
        );
        const data = tc.getImageData(0, 0, 4, 1).data;
        entry.luma = 0;
        for (let i = 0; i < data.length; i += 4) {
            entry.luma = Math.max(
                entry.luma,
                (0.2126 * data[i] +
                    0.7152 * data[i + 1] +
                    0.0722 * data[i + 2]) /
                    255,
            );
        }
    }
    return entry.luma;
}

function getCachedBgCanvas(bg: BackgroundConfig, size: number): BgEntry {
    const key = `${size}:${JSON.stringify(bg)}`;
    const cached = bgCanvasCache.get(key);
    if (cached) return cached;
    const canvas = createBackgroundCanvas(bg as any, size, size);
    const entry: BgEntry = { canvas, key };
    bgCanvasCache.set(key, entry);
    if (bgCanvasCache.size > 8) {
        bgCanvasCache.delete(bgCanvasCache.keys().next().value!);
    }
    return entry;
}

let _glCanvas: HTMLCanvasElement | null = null;
let _glRenderer: LiquidGlassRenderer | null = null;
let _glSize = 0;
let _glFailed = false;
let _lastWebglError = "";

type ScratchCanvas = {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
};
type ScratchPool = {
    getCanvas: (key: string, size: number) => ScratchCanvas;
};

const layerScratch: ScratchPool = {
    getCanvas: (key, size) => getScratchCanvas(key, size),
};

function reportWebglError(err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    const short = raw.split("\n")[0].slice(0, 180);
    setWebgl2Error(short || "Unknown WebGL2 error");
    if (raw && raw !== _lastWebglError) {
        console.error("WebGL2 error:", raw);
        _lastWebglError = raw;
    }
}

function getWebGLRenderer(size: number): LiquidGlassRenderer | null {
    if (_glFailed) return null;
    try {
        if (!_glCanvas) {
            _glCanvas = document.createElement("canvas");
            _glCanvas.addEventListener("webglcontextlost", e => {
                e.preventDefault();
                _glRenderer = null;
                _glSize = 0;
            });
            _glCanvas.addEventListener("webglcontextrestored", () => {
                _glFailed = false;
                $webgl2Restores.set($webgl2Restores.get() + 1);
            });
        }
        if (size !== _glSize) {
            if (_glRenderer) _glRenderer.resize(size);
            else {
                _glCanvas.width = size;
                _glCanvas.height = size;
            }
            _glSize = size;
        }
        if (!_glRenderer) {
            try {
                _glRenderer = new LiquidGlassRenderer(_glCanvas);
            } catch (err) {
                _glFailed = true;
                throw err;
            }
        }
        return _glRenderer;
    } catch (err) {
        reportWebglError(err);
        return null;
    }
}

const scratchPool = new Map<string, ScratchCanvas>();

function getScratchCanvas(
    key: string,
    width: number,
    height = width,
    willReadFrequently = false,
): ScratchCanvas {
    let entry = scratchPool.get(key);
    if (!entry) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently })!;
        entry = { canvas, ctx };
        scratchPool.set(key, entry);
    }
    const { canvas, ctx } = entry;
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.clearRect(0, 0, width, height);
    return entry;
}

// ── Frees canvases and rasters above 2048 px once the queued renders finish ──
function releaseLargeScratch(): void {
    renderChain = renderChain.then(() => {
        for (const { canvas } of scratchPool.values()) {
            if (canvas.width > 2048) canvas.width = canvas.height = 0;
        }
        if (featherMask && featherMask.width > 2048) featherMask = null;
        for (const [key, entry] of bgCanvasCache)
            if (entry.canvas.width > 2048) bgCanvasCache.delete(key);
        for (const [id, entry] of shadowCache)
            if (parseInt(entry.key) > 2048) shadowCache.delete(id);
        for (const key of rasterCache.keys())
            if (Number(key.slice(key.lastIndexOf(":") + 1)) > 2048)
                rasterCache.delete(key);
    });
}

function blendModeToCanvas(mode: string): GlobalCompositeOperation {
    const map: Record<string, GlobalCompositeOperation> = {
        normal: "source-over",
        multiply: "multiply",
        screen: "screen",
        overlay: "overlay",
        darken: "darken",
        lighten: "lighten",
        "color-dodge": "color-dodge",
        "color-burn": "color-burn",
        "hard-light": "hard-light",
        "soft-light": "soft-light",
        difference: "difference",
        exclusion: "exclusion",
        hue: "hue",
        saturation: "saturation",
        color: "color",
        luminosity: "luminosity",
        "plus-lighter": "lighter",
    };
    return map[mode] ?? "source-over";
}

function mapTranslucency(value: number, enabled: boolean): number {
    if (!enabled) return 0;
    return Math.max(0, Math.min(1, value / 100));
}

// ── Dark adaptation ──
const DARK_ADAPT_LIGHT = 0.85; // HSL L, art or fill at or above takes the light background
const DARK_ADAPT_BG_MIN = 0.2; // HSL L, light background below it adapts nothing

const lightArtCache = new Map<string, boolean>();

function hslLightness({ r, g, b }: RGB): number {
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

function isLightFill(fill: Layer["fill"]): boolean {
    const light = (hex: string) => {
        const rgb = hexToRgb(hex);
        return rgb !== null && hslLightness(rgb) >= DARK_ADAPT_LIGHT;
    };
    if (fill.type === "solid") return light(fill.color);
    return fill.type === "gradient" && fill.stops.every(s => light(s.color));
}

function isLightArt(img: HTMLImageElement, key: string): boolean {
    let light = lightArtCache.get(key);
    if (light === undefined) {
        const s = 64;
        const { ctx } = getScratchCanvas("dark-adapt-probe", s);
        ctx.drawImage(img, 0, 0, s, s);
        const data = ctx.getImageData(0, 0, s, s).data;
        light = true;
        for (let i = 0; i < data.length && light; i += 4) {
            light =
                data[i + 3] <= 60 ||
                hslLightness({ r: data[i], g: data[i + 1], b: data[i + 2] }) >=
                    DARK_ADAPT_LIGHT;
        }
        lightArtCache.set(key, light);
        if (lightArtCache.size > 32)
            lightArtCache.delete(lightArtCache.keys().next().value!);
    }
    return light;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return match
        ? {
              r: parseInt(match[1], 16),
              g: parseInt(match[2], 16),
              b: parseInt(match[3], 16),
          }
        : null;
}

function drawLayerBevel(
    outCtx: CanvasRenderingContext2D,
    contentCanvas: HTMLCanvasElement,
    size: number,
    lightAngle: number,
    contentAvg: RGB | null,
    bgAvg: RGB | null,
    placement: DarklightPlacement,
    liquidGlass: LiquidGlassConfig,
    scratch: ScratchPool,
    rect: { cx: number; cy: number; half: number },
): void {
    const angleRad = (lightAngle * Math.PI) / 180;
    const lx = Math.cos(angleRad);
    const ly = -Math.sin(angleRad);
    const blurT = liquidGlass.blur?.enabled ? liquidGlass.blur.value / 100 : 0;
    const fx = { ...DEFAULT_EFFECTS, ...liquidGlass.effects };
    const rimLit = fx.innerRimLitAlpha / 100;
    const rimShadow = fx.innerRimShadowAlpha / 100;
    const bottom = fx.bottomHighlight / 100;
    const rimBottom = rimShadow + (rimLit - rimShadow) * bottom;
    const rimScale = placement === "outside" ? LAYER_OUTSIDE_INNER_SCALE : 1;
    const half = Math.max(rect.half, 1);
    const fit = (
        dst: CanvasRenderingContext2D,
        src: CanvasImageSource,
        px: number,
    ) => {
        const k = 1 - px / half;
        dst.drawImage(
            src,
            rect.cx * (1 - k),
            rect.cy * (1 - k),
            size * k,
            size * k,
        );
    };

    const layerColor = (() => {
        if (!contentAvg) return { r: 255, g: 255, b: 255 };
        const mix = 0.55;
        return {
            r: Math.round(contentAvg.r + (255 - contentAvg.r) * mix),
            g: Math.round(contentAvg.g + (255 - contentAvg.g) * mix),
            b: Math.round(contentAvg.b + (255 - contentAvg.b) * mix),
        };
    })();
    const rimColor = (() => {
        if (!bgAvg) return layerColor;
        const { r, g, b } = bgAvg;
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const tint = (c: number, base: number) => {
            const sat = Math.max(
                0,
                Math.min(255, gray + (c - gray) * LAYER_RIM_BG_SAT),
            );
            const lift = sat + (255 - sat) * LAYER_RIM_BG_LIFT;
            return Math.round(base + (lift - base) * LAYER_RIM_BG_MIX);
        };
        return {
            r: tint(r, layerColor.r),
            g: tint(g, layerColor.g),
            b: tint(b, layerColor.b),
        };
    })();
    const lc = (a: number) =>
        `rgba(${rimColor.r},${rimColor.g},${rimColor.b},${a})`;

    // ── [1] Inner specular dome ───────────────────────────────────────────────
    if (liquidGlass.specular && fx.domeIntensity > 0) {
        const { canvas: domeCv, ctx: dc } = scratch.getCanvas(
            "layer-dome",
            size,
        );
        dc.drawImage(contentCanvas, 0, 0);
        dc.globalCompositeOperation = "source-in";
        const litX = rect.cx + lx * rect.half * 0.84;
        const litY = rect.cy + ly * rect.half * 0.84;
        const grad = dc.createRadialGradient(
            litX,
            litY,
            0,
            litX,
            litY,
            rect.half * 2 * (fx.domeRadius / 100),
        );
        grad.addColorStop(0.0, `rgba(255,255,255,${LAYER_DOME_CENTER_ALPHA})`);
        grad.addColorStop(0.18, `rgba(255,255,255,${LAYER_DOME_MID_ALPHA})`);
        grad.addColorStop(0.45, `rgba(255,255,255,${LAYER_DOME_EDGE_ALPHA})`);
        grad.addColorStop(0.7, "rgba(255,255,255,0.00)");
        grad.addColorStop(1.0, "rgba(255,255,255,0.00)");
        dc.fillStyle = grad;
        dc.fillRect(0, 0, size, size);
        const blur = Math.max(
            6,
            size * LAYER_DOME_BLUR_BASE + blurT * size * 0.018,
        );
        outCtx.save();
        outCtx.globalCompositeOperation = "screen";
        outCtx.globalAlpha = fx.domeIntensity / 100;
        outCtx.filter = `blur(${blur}px)`;
        outCtx.drawImage(domeCv, 0, 0);
        outCtx.filter = "none";
        outCtx.restore();
    }

    // ── [2] Inner colored rim (+ interior holes) ─────────────────────────────
    if (placement !== "off") {
        const rimW = Math.max(
            3,
            size * (fx.innerRimWidth / 100) + blurT * size * 0.01,
        );
        const blur = Math.max(0.6, size * LAYER_INNER_RIM_BLUR);

        const buildRimCanvas = (
            srcCanvas: HTMLCanvasElement,
            key: string,
            maskKey: string,
        ) => {
            const { canvas: rimCv, ctx: rc } = scratch.getCanvas(key, size);
            rc.drawImage(srcCanvas, 0, 0);
            const { canvas: mask, ctx: mc } = scratch.getCanvas(maskKey, size);
            mc.filter = `blur(${Math.max(1.2, rimW * 0.38)}px)`;
            fit(mc, srcCanvas, rimW / 2);
            rc.globalCompositeOperation = "destination-out";
            rc.drawImage(mask, 0, 0);
            rc.globalCompositeOperation = "source-in";
            const grad = rc.createLinearGradient(
                rect.cx + lx * rect.half,
                rect.cy + ly * rect.half,
                rect.cx - lx * rect.half,
                rect.cy - ly * rect.half,
            );
            grad.addColorStop(0.0, lc(rimLit));
            grad.addColorStop(0.4, lc(LAYER_INNER_RIM_MID_ALPHA));
            grad.addColorStop(0.7, lc(rimShadow));
            grad.addColorStop(1.0, lc(rimBottom));
            rc.fillStyle = grad;
            rc.fillRect(0, 0, size, size);
            return rimCv;
        };

        const rimCv = buildRimCanvas(
            contentCanvas,
            "layer-rim",
            "layer-rim-mask",
        );
        outCtx.save();
        outCtx.globalCompositeOperation = "screen";
        outCtx.globalAlpha = LAYER_INNER_RIM_ALPHA_BLUR * rimScale;
        outCtx.filter = `blur(${blur}px)`;
        outCtx.drawImage(rimCv, 0, 0);
        outCtx.filter = "none";
        outCtx.globalAlpha = LAYER_INNER_RIM_ALPHA_SHARP * rimScale;
        outCtx.drawImage(rimCv, 0, 0);
        outCtx.restore();

        {
            const { canvas: holeCv, ctx: hc } = scratch.getCanvas(
                "layer-holes",
                size,
            );
            hc.fillStyle = "rgba(255,255,255,1)";
            hc.fillRect(0, 0, size, size);
            hc.globalCompositeOperation = "destination-out";
            hc.drawImage(contentCanvas, 0, 0);
            const { canvas: holeMask, ctx: hm } = scratch.getCanvas(
                "layer-holes-mask",
                size,
            );
            hm.filter = `blur(${Math.max(1.2, rimW * 0.38)}px)`;
            fit(hm, holeCv, rimW / 2);
            hc.globalCompositeOperation = "destination-out";
            hc.drawImage(holeMask, 0, 0);
            const { canvas: dilCv, ctx: dc } = scratch.getCanvas(
                "layer-holes-dilate",
                size,
            );
            const dpad = rimW * 1.2;
            dc.filter = `blur(${rimW * 0.6}px)`;
            fit(dc, contentCanvas, -dpad);
            dc.filter = "none";
            hc.globalCompositeOperation = "destination-in";
            hc.drawImage(dilCv, 0, 0);
            const grad = hc.createLinearGradient(
                rect.cx + lx * rect.half,
                rect.cy + ly * rect.half,
                rect.cx - lx * rect.half,
                rect.cy - ly * rect.half,
            );
            grad.addColorStop(0.0, lc(rimLit));
            grad.addColorStop(0.4, lc(LAYER_INNER_RIM_MID_ALPHA));
            grad.addColorStop(0.7, lc(rimShadow));
            grad.addColorStop(1.0, lc(rimBottom));
            hc.globalCompositeOperation = "source-in";
            hc.fillStyle = grad;
            hc.fillRect(0, 0, size, size);
            outCtx.save();
            outCtx.globalCompositeOperation = "screen";
            outCtx.globalAlpha = LAYER_HOLES_RIM_ALPHA_BLUR * rimScale;
            outCtx.filter = `blur(${blur}px)`;
            outCtx.drawImage(holeCv, 0, 0);
            outCtx.filter = "none";
            outCtx.globalAlpha = LAYER_HOLES_RIM_ALPHA_SHARP * rimScale;
            outCtx.drawImage(holeCv, 0, 0);
            outCtx.restore();
        }
    }

    // ── [4] Inner shadow on the shadow side ──────────────────────────────────
    {
        const darkW = Math.max(
            2,
            size * (fx.innerShadowWidth / 100) + blurT * size * 0.006,
        );
        const { canvas: darkCv, ctx: dc } = scratch.getCanvas(
            "layer-inner-shadow",
            size,
        );
        dc.drawImage(contentCanvas, 0, 0);
        const { canvas: darkMask, ctx: dm } = scratch.getCanvas(
            "layer-inner-shadow-mask",
            size,
        );
        dm.filter = `blur(${Math.max(2, darkW * 0.55)}px)`;
        fit(dm, contentCanvas, darkW / 2);
        dc.globalCompositeOperation = "destination-out";
        dc.drawImage(darkMask, 0, 0);
        dc.globalCompositeOperation = "source-in";
        const grad = dc.createLinearGradient(
            rect.cx - lx * rect.half,
            rect.cy - ly * rect.half,
            rect.cx + lx * rect.half,
            rect.cy + ly * rect.half,
        );
        grad.addColorStop(0.0, `rgba(0,0,10,${fx.innerShadowAlpha / 100})`);
        grad.addColorStop(0.2, `rgba(0,0,10,${LAYER_INNER_SHADOW_MID_ALPHA})`);
        grad.addColorStop(0.5, "rgba(0,0,10,0.00)");
        dc.fillStyle = grad;
        dc.fillRect(0, 0, size, size);
        const blur = Math.max(
            2,
            size * LAYER_INNER_SHADOW_BLUR + blurT * size * 0.003,
        );
        outCtx.save();
        outCtx.globalCompositeOperation = "multiply";
        outCtx.globalAlpha = LAYER_INNER_SHADOW_ALPHA_BLUR;
        outCtx.filter = `blur(${blur}px)`;
        outCtx.drawImage(darkCv, 0, 0);
        outCtx.filter = "none";
        outCtx.globalAlpha = LAYER_INNER_SHADOW_ALPHA_SHARP;
        outCtx.drawImage(darkCv, 0, 0);
        outCtx.restore();
    }

    // ── [5] Outer border ring (layer color, outside shape) ───────────────────
    if (placement === "outside") {
        const d = Math.max(1.5, size * LAYER_OUTSIDE_SPEC_WIDTH);
        const k = d / Math.SQRT2;
        const { canvas: outerCv, ctx: oc } = scratch.getCanvas(
            "layer-outer-border",
            size,
        );
        for (const [dx, dy] of [
            [d, 0],
            [-d, 0],
            [0, d],
            [0, -d],
            [k, k],
            [k, -k],
            [-k, k],
            [-k, -k],
        ]) {
            oc.drawImage(contentCanvas, dx, dy);
        }
        oc.globalCompositeOperation = "destination-out";
        oc.drawImage(contentCanvas, 0, 0);
        oc.globalCompositeOperation = "source-in";
        const grad = oc.createLinearGradient(
            rect.cx + lx * rect.half,
            rect.cy + ly * rect.half,
            rect.cx - lx * rect.half,
            rect.cy - ly * rect.half,
        );
        grad.addColorStop(0.0, lc(0.85));
        grad.addColorStop(0.5, lc(0.15));
        grad.addColorStop(1.0, lc(0.85 * bottom));
        oc.fillStyle = grad;
        oc.fillRect(0, 0, size, size);
        outCtx.drawImage(outerCv, 0, 0);
    } else {
        const dilate = Math.max(1.5, size * (fx.outerBorderWidth / 100));
        const { canvas: outerCv, ctx: oc } = scratch.getCanvas(
            "layer-outer-border",
            size,
        );
        oc.filter = `blur(${Math.max(0.5, dilate * 0.5)}px)`;
        fit(oc, contentCanvas, -dilate);
        oc.filter = "none";
        oc.globalCompositeOperation = "destination-out";
        oc.drawImage(contentCanvas, 0, 0);
        oc.globalCompositeOperation = "source-in";
        oc.fillStyle = lc(1);
        oc.fillRect(0, 0, size, size);
        outCtx.save();
        outCtx.globalCompositeOperation = "source-over";
        outCtx.globalAlpha = fx.outerBorderAlpha / 100;
        outCtx.drawImage(outerCv, 0, 0);
        outCtx.restore();
    }
}

async function buildContentCanvas(
    layer: Layer,
    size: number,
    adaptBg: HTMLCanvasElement | null = null,
): Promise<{ canvas: HTMLCanvasElement; frame: Frame }> {
    const { layout } = layer;
    const scale = layout.scale / 100;
    const offsetX = (layout.x / 100) * size;
    const offsetY = (layout.y / 100) * size;
    const place = (x: number, y: number, w: number, h: number): Frame => ({
        x: size / 2 + offsetX + (x - size / 2) * scale,
        y: size / 2 + offsetY + (y - size / 2) * scale,
        w: w * scale,
        h: h * scale,
    });
    let frame = place(0, 0, size, size);

    const { canvas, ctx } = getScratchCanvas("layer-content", size);

    ctx.save();
    ctx.translate(size / 2 + offsetX, size / 2 + offsetY);
    ctx.scale(scale, scale);
    ctx.translate(-size / 2, -size / 2);

    if (layer.blobUrl) {
        try {
            const img = await loadRaster(
                layer.blobUrl,
                Math.ceil((size * Math.max(1, scale)) / 512) * 512,
            );
            const iw = img.naturalWidth;
            const ih = img.naturalHeight;
            const sc = Math.min(size / iw, size / ih);
            const w = iw * sc;
            const h = ih * sc;
            const x = (size - w) / 2;
            const y = (size - h) / 2;
            frame = place(x, y, w, h);

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, x, y, w, h);

            ctx.globalCompositeOperation = "source-atop";
            if (
                adaptBg &&
                (layer.fill.type === "none"
                    ? /\.svg$/i.test(layer.sourceFile ?? "") &&
                      isLightArt(img, layer.blobUrl)
                    : isLightFill(layer.fill))
            ) {
                ctx.drawImage(adaptBg, 0, 0, size, size);
            } else if (layer.fill.type === "solid") {
                ctx.fillStyle = layer.fill.color ?? "#ffffff";
                ctx.fillRect(0, 0, size, size);
            } else if (
                layer.fill.type === "gradient" &&
                "stops" in layer.fill
            ) {
                const grad = ctx.createLinearGradient(0, 0, 0, size);
                layer.fill.stops.forEach(s =>
                    grad.addColorStop(s.offset, s.color),
                );
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, size, size);
            }
            ctx.globalCompositeOperation = "source-over";
        } catch {}
    } else {
        ctx.clip(squirclePath(size));
        if (adaptBg && isLightFill(layer.fill)) {
            ctx.drawImage(adaptBg, 0, 0, size, size);
        } else if (layer.fill.type === "solid") {
            ctx.fillStyle = layer.fill.color ?? "#ffffff";
            ctx.fillRect(0, 0, size, size);
        } else if (layer.fill.type === "gradient" && "stops" in layer.fill) {
            const grad = ctx.createLinearGradient(0, 0, 0, size);
            layer.fill.stops.forEach(s => grad.addColorStop(s.offset, s.color));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, size);
        }
    }

    ctx.restore();
    return { canvas, frame };
}

function drawContentFlat(
    outCtx: CanvasRenderingContext2D,
    contentCanvas: HTMLCanvasElement,
): void {
    outCtx.drawImage(contentCanvas, 0, 0);
}

function drawContentTranslucent(
    outCtx: CanvasRenderingContext2D,
    contentCanvas: HTMLCanvasElement,
    frame: Frame,
    translucency: number,
    gradient?: NonNullable<LiquidGlassConfig['translucencyGradient']>,
): void {
    if ((!gradient?.enabled && translucency <= 0) || frame.h <= 0)
        return drawContentFlat(outCtx, contentCanvas);
    const { canvas, ctx } = getScratchCanvas(
        "layer-translucent",
        contentCanvas.width,
    );
    ctx.drawImage(contentCanvas, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    if (gradient?.enabled) {
        const angle = gradient.angle * Math.PI / 180;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const extent = Math.abs(dx) * frame.w + Math.abs(dy) * frame.h;
        const cx = frame.x + frame.w / 2;
        const cy = frame.y + frame.h / 2;
        const grad = ctx.createLinearGradient(cx - dx * extent / 2, cy - dy * extent / 2, cx + dx * extent / 2, cy + dy * extent / 2);
        const start = Math.max(0, Math.min(99, gradient.start)) / 100;
        const end = Math.max(start + 0.01, Math.min(100, gradient.end)) / 100;
        const startOpacity = Math.max(0, Math.min(100, gradient.startOpacity)) / 100;
        const endOpacity = Math.max(0, Math.min(100, gradient.endOpacity)) / 100;
        grad.addColorStop(0, `rgba(0,0,0,${startOpacity})`);
        grad.addColorStop(start, `rgba(0,0,0,${startOpacity})`);
        grad.addColorStop(end, `rgba(0,0,0,${endOpacity})`);
        grad.addColorStop(1, `rgba(0,0,0,${endOpacity})`);
        ctx.fillStyle = grad;
    } else {
        const v = 1 - Math.max(0, Math.min(1, translucency));
        const opacity = v * v * (3 - 2 * v);
        ctx.fillStyle = `rgba(0,0,0,${opacity})`;
    }

    ctx.fillRect(0, 0, canvas.width, canvas.height);
    outCtx.drawImage(canvas, 0, 0);
}

// ── Clear mask of flat content (glass off or no WebGL): R = 0.85·luma, G = 1, B = 0, alpha kept ──
function encodeClearContent(content: HTMLCanvasElement): HTMLCanvasElement {
    const { canvas, ctx } = getScratchCanvas(
        "clear-content",
        content.width,
        content.height,
        true,
    );
    ctx.drawImage(content, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        d[i] =
            CLEAR_MODE.contentLightening *
            (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        d[i + 1] = 255;
        d[i + 2] = 0;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

// ── Mitigated Clear: flat gray chiclet, then lightening (VCM in R), darkening (− G) and highlights (VCM in B) ──
function composeClear(
    c: CanvasRenderingContext2D,
    size: number,
    chicletLinear: number,
): void {
    const { canvas, ctx } = getScratchCanvas("clear-compose", size, size, true);
    ctx.drawImage(c.canvas, 0, 0);
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    const { lightening, darkening, highlights, lighteningVCM, highlightsVCM } =
        CLEAR_MODE;
    const vcmGray = (y: number, k: Vcm) =>
        Math.min(1, Math.max(0, k.black + (k.white - k.black) * y));
    const chiclet =
        chicletLinear <= 0.0031308
            ? 12.92 * chicletLinear
            : 1.055 * chicletLinear ** (1 / 2.4) - 0.055;
    const lift = vcmGray(chiclet, lighteningVCM) - chiclet;
    for (let i = 0; i < d.length; i += 4) {
        let g = chiclet + ((lightening * d[i]) / 255) * lift;
        g = Math.max(0, g - darkening * (1 - d[i + 1] / 255));
        g += ((highlights * d[i + 2]) / 255) * (vcmGray(g, highlightsVCM) - g);
        d[i] = d[i + 1] = d[i + 2] = 255 * g;
    }
    ctx.putImageData(img, 0, 0);
    c.globalCompositeOperation = "copy";
    c.drawImage(canvas, 0, 0);
    c.globalCompositeOperation = "source-over";
}

async function renderLayerToCanvas(
    layer: Layer,
    size: number,
    mode: AppearanceMode,
    adaptBg: BgEntry | null,
    lightAngle: number,
    iconBright: boolean,
    bgCanvas: HTMLCanvasElement,
    scratch: ScratchPool,
    renderer: GlassRenderer | null,
    shadowOpacity: number,
    bgKey = "",
): Promise<{
    canvas: HTMLCanvasElement;
    over: LayerOverdraw | null;
    shadow: LayerShadow | null;
} | null> {
    if (!layer.visible) return null;

    const { canvas: contentCanvas, frame } = await buildContentCanvas(
        layer,
        size,
        adaptBg?.canvas ?? null,
    );
    const liquidGlass = layer.liquidGlass;
    const colorMode = mode !== "clear" && mode !== "clearDark";

    const { canvas: out, ctx: outCtx } = getScratchCanvas("layer-out", size);

    if (!liquidGlass.enabled) {
        drawContentFlat(
            outCtx,
            colorMode ? contentCanvas : encodeClearContent(contentCanvas),
        );
        return { canvas: out, over: null, shadow: null };
    }

    // ── Smooth lighting mask, separate from the sharp artwork and silhouette ──
    const lightingBlurPx = Math.max(1.0, size * 0.0013);
    const { canvas: lightingMask, ctx: mc } = scratch.getCanvas(
        "layer-lighting-mask",
        size,
    );
    mc.filter = `blur(${lightingBlurPx}px)`;
    mc.drawImage(contentCanvas, 0, 0);

    const fillKey =
        layer.fill.type === "solid"
            ? layer.fill.color
            : layer.fill.type === "gradient"
              ? JSON.stringify(layer.fill.stops)
              : "";
    const tintKey = `${layer.id}:${mode}:${layer.blobUrl ?? ""}:${layer.fill.type}:${fillKey}:${adaptBg?.key ?? ""}`;

    let contentAvg = layerTintCache.get(tintKey) ?? null;
    if (!contentAvg) {
        contentAvg = averageColor(lightingMask);
        if (contentAvg) {
            layerTintCache.set(tintKey, contentAvg);
            if (layerTintCache.size > 32)
                layerTintCache.delete(layerTintCache.keys().next().value!);
        }
    }
    const placement = resolvePlacement(
        liquidGlass.specular,
        colorMode,
        iconBright,
    );
    const translucency = mapTranslucency(
        liquidGlass.translucency.value,
        liquidGlass.translucency.enabled,
    );

    const shadow = layerShadow(
        layer,
        contentCanvas,
        frame,
        size,
        tintKey,
        translucency,
    );
    const overdrawAlpha =
        shadow && layer.blendMode === "normal"
            ? shadow.alpha * shadow.overdraw
            : 0;

    const drawWithoutRefraction = () => {
        // ── Shadow overdraw, clipped to the art, composed by the caller over the layer ──
        let over: LayerOverdraw | null = null;
        if (shadow && overdrawAlpha > 0) {
            const { canvas, ctx } = scratch.getCanvas(
                "layer-shadow-over",
                size,
            );
            ctx.drawImage(
                shadow.canvas,
                shadow.x,
                shadow.y,
                shadow.w,
                shadow.w,
            );
            ctx.globalCompositeOperation = "destination-in";
            ctx.drawImage(contentCanvas, 0, 0);
            over = { canvas, alpha: overdrawAlpha };
        }
        const rect = {
            cx: size * (0.5 + layer.layout.x / 100),
            cy: size * (0.5 + layer.layout.y / 100),
            half: (size * layer.layout.scale) / 200,
        };
        drawContentTranslucent(
            outCtx,
            colorMode ? contentCanvas : encodeClearContent(contentCanvas),
            frame,
            translucency,
            liquidGlass.translucency.enabled && liquidGlass.translucencyGradient?.enabled ? liquidGlass.translucencyGradient : undefined,
        );
        if (colorMode)
            drawLayerBevel(
                outCtx,
                lightingMask,
                size,
                lightAngle,
                contentAvg,
                averageColor(lightingMask, bgCanvas),
                placement,
                liquidGlass,
                scratch,
                rect,
            );
        return { canvas: out, over, shadow };
    };

    if (!renderer) return drawWithoutRefraction();

    const u = size / 1024;
    const fx = { ...DEFAULT_EFFECTS, ...liquidGlass.effects };
    const strength = fx.refraction / 100;
    const params: LiquidGlassParams = {
        darkMode: mode === "dark",
        blurRadiusPx: liquidGlass.blur.enabled
            ? Math.min(liquidGlass.blur.value / 100, 1) * MATERIAL.blurMax * u
            : 0,
        frostiness: colorMode ? fx.frostiness / 100 : 0,
        translucency,
        translucencyGradient: liquidGlass.translucency.enabled && liquidGlass.translucencyGradient?.enabled ? liquidGlass.translucencyGradient : undefined,
        layerBounds: [
            frame.x / size,
            frame.y / size,
            frame.w / size,
            frame.h / size,
        ],
        refractionStrengthPx:
            liquidGlass.refraction?.enabled === false
                ? 0
                : Math.sign(strength) *
                  Math.min(Math.abs(strength), 1) *
                  MATERIAL.strengthMax *
                  u,
        refractionHeightPx: Math.min(
            Math.max((fx.bevel / 100) * size, MATERIAL.heightMin * u),
            (MATERIAL.heightMin + MATERIAL.heightRange) * u,
        ),
        aberration: (liquidGlass.aberration ?? 0) / 100,
        lightAngle,
        placement,
        lightIntensity: (liquidGlass.specularIntensity ?? 100) / 100,
        keyGain: fx.keyHighlight / 100,
        fillGain: fx.fillHighlight / 100,
        darkGain: fx.darklight / 100,
        useVCM: true,
        lightingBlurPx,
        shadowAlpha: shadow ? shadow.alpha * shadowOpacity : 0,
        overdrawAlpha,
        clearMask: colorMode ? undefined : CLEAR_MODE.contentLightening,
    };

    // ── Own shadow at render size: the shader puts it under the glass, undisplaced, and over the content ──
    let shadowTex: HTMLCanvasElement | undefined;
    if (shadow) {
        const { canvas, ctx } = scratch.getCanvas("layer-shadow-tex", size);
        ctx.drawImage(shadow.canvas, shadow.x, shadow.y, shadow.w, shadow.w);
        shadowTex = canvas;
    }

    try {
        renderer.render(
            contentCanvas,
            lightingMask,
            bgCanvas,
            params,
            bgKey,
            shadowTex,
        );
    } catch (err) {
        reportWebglError(err);
        return drawWithoutRefraction();
    }

    outCtx.drawImage(renderer.canvas, 0, 0);

    return { canvas: out, over: null, shadow };
}

function composite(
    dst: CanvasRenderingContext2D,
    src: HTMLCanvasElement,
    alpha: number,
    blendMode: string,
    x = 0,
    y = 0,
    w = src.width,
    h = src.height,
): void {
    dst.save();
    dst.globalAlpha = alpha;
    dst.globalCompositeOperation = blendModeToCanvas(blendMode);
    dst.drawImage(src, x, y, w, h);
    dst.restore();
}

let renderChain: Promise<void> = Promise.resolve();

export function renderIconToCanvas(
    outputCanvas: HTMLCanvasElement,
    ctx: RenderContext,
    bare = false,
): Promise<void> {
    const run = renderChain.then(() =>
        renderIconToCanvasImpl(outputCanvas, ctx, bare),
    );
    renderChain = run.catch(() => {});
    return run;
}

async function renderIconToCanvasImpl(
    outputCanvas: HTMLCanvasElement,
    ctx: RenderContext,
    bare: boolean,
): Promise<void> {
    const { layers, background, lightAngle, appearanceMode, size } = ctx;
    const isClear =
        appearanceMode === "clear" || appearanceMode === "clearDark";

    const renderer = getWebGLRenderer(size);
    if (renderer) setWebgl2Status("active");
    const scratch = layerScratch;

    // ── Double-buffering: render into scratch canvas, swap atomically at end ──
    const { canvas: masterCanvas, ctx: c } = getScratchCanvas(
        "master-buffer",
        size,
    );

    const darkBg: BackgroundConfig = {
        type: "gradient",
        bgType: "custom",
        stops: [
            { offset: 0, color: SYSTEM_GRADIENT.dark[0] },
            { offset: 1, color: SYSTEM_GRADIENT.dark[1] },
        ],
        angle: 90,
    };
    const clearMaskBg: BackgroundConfig = { type: "solid", color: "#00ff00" };
    const bgEntry = getCachedBgCanvas(
        isClear ? clearMaskBg : appearanceMode === "dark" ? darkBg : background,
        size,
    );
    const { canvas: glassBgCanvas, key: glassBgKey } = bgEntry;
    const iconBright = backgroundLuma(bgEntry) >= CHICLET_LUMINANCE.minBright;
    const lightBg =
        appearanceMode === "dark" ? getCachedBgCanvas(background, size) : null;
    const lightBgAvg = lightBg && averageColor(lightBg.canvas);
    const adaptBg =
        lightBgAvg && hslLightness(lightBgAvg) >= DARK_ADAPT_BG_MIN
            ? lightBg
            : null;

    if (!bare) c.drawImage(glassBgCanvas, 0, 0, size, size);

    const rootLayers = [...layers]
        .filter(l => l.visible && l.parentId === null)
        .sort((a, b) => a.order - b.order);
    let paintIndex = 0;

    const { canvas: runningBg, ctx: rbCtx } = getScratchCanvas(
        "running-bg",
        size,
    );
    rbCtx.drawImage(glassBgCanvas, 0, 0);

    for (const layer of rootLayers) {
        const feedBg = layer.liquidGlass?.enabled ? runningBg : glassBgCanvas;

        if (layer.type === "group") {
            const children = [...layers]
                .filter(l => l.parentId === layer.id && l.visible)
                .sort((a, b) => a.order - b.order);

            const { canvas: groupCanvas, ctx: gc } = getScratchCanvas(
                "layer-group",
                size,
            );

            for (const child of children) {
                const childFeedBg = child.liquidGlass?.enabled
                    ? runningBg
                    : glassBgCanvas;
                const lc = await renderLayerToCanvas(
                    child,
                    size,
                    appearanceMode,
                    adaptBg,
                    lightAngle,
                    iconBright,
                    childFeedBg,
                    scratch,
                    renderer,
                    (child.opacity / 100) * (layer.opacity / 100),
                    paintIndex++ === 0 ? glassBgKey : "",
                );
                if (lc) {
                    if (lc.shadow) {
                        const { canvas: shadow, alpha, x, y, w } = lc.shadow;
                        const a = alpha * (child.opacity / 100);
                        composite(
                            c,
                            shadow,
                            a * (layer.opacity / 100),
                            "multiply",
                            x,
                            y,
                            w,
                            w,
                        );
                        composite(
                            rbCtx,
                            shadow,
                            a * (layer.opacity / 100),
                            "multiply",
                            x,
                            y,
                            w,
                            w,
                        );
                        const { canvas: siblings, ctx: sc } = getScratchCanvas(
                            "group-shadow",
                            size,
                        );
                        sc.drawImage(shadow, x, y, w, w);
                        sc.globalCompositeOperation = "destination-in";
                        sc.drawImage(groupCanvas, 0, 0);
                        composite(gc, siblings, a, "multiply");
                    }
                    composite(
                        gc,
                        lc.canvas,
                        child.opacity / 100,
                        child.blendMode,
                    );
                    composite(
                        rbCtx,
                        lc.canvas,
                        (child.opacity / 100) * (layer.opacity / 100),
                        layer.blendMode === "normal"
                            ? child.blendMode
                            : layer.blendMode,
                    );
                    if (lc.over) {
                        composite(
                            gc,
                            lc.over.canvas,
                            lc.over.alpha * (child.opacity / 100),
                            "multiply",
                        );
                        composite(
                            rbCtx,
                            lc.over.canvas,
                            lc.over.alpha *
                                (child.opacity / 100) *
                                (layer.opacity / 100),
                            "multiply",
                        );
                    }
                }
            }

            composite(c, groupCanvas, layer.opacity / 100, layer.blendMode);
        } else {
            const lc = await renderLayerToCanvas(
                layer,
                size,
                appearanceMode,
                adaptBg,
                lightAngle,
                iconBright,
                feedBg,
                scratch,
                renderer,
                layer.opacity / 100,
                paintIndex++ === 0 ? glassBgKey : "",
            );
            if (lc) {
                if (lc.shadow) {
                    const { canvas: shadow, alpha, x, y, w } = lc.shadow;
                    composite(
                        c,
                        shadow,
                        alpha * (layer.opacity / 100),
                        "multiply",
                        x,
                        y,
                        w,
                        w,
                    );
                    composite(
                        rbCtx,
                        shadow,
                        alpha * (layer.opacity / 100),
                        "multiply",
                        x,
                        y,
                        w,
                        w,
                    );
                }
                composite(c, lc.canvas, layer.opacity / 100, layer.blendMode);
                composite(
                    rbCtx,
                    lc.canvas,
                    layer.opacity / 100,
                    layer.blendMode,
                );
                if (lc.over) {
                    composite(
                        c,
                        lc.over.canvas,
                        lc.over.alpha * (layer.opacity / 100),
                        "multiply",
                    );
                    composite(
                        rbCtx,
                        lc.over.canvas,
                        lc.over.alpha * (layer.opacity / 100),
                        "multiply",
                    );
                }
            }
        }
    }

    // ── Chiclet highlights: white (blue in the Clear mask) plus-lighter, then black plus-darker as invert → add → invert ──
    if (!bare) {
        const { light, dark } = isClear
            ? getChicletHighlights(CHICLET_CLEAR_HIGHLIGHTS, "#0000ff")
            : getChicletHighlights(CHICLET_HIGHLIGHTS, "#ffffff");
        c.fillStyle = "#ffffff";
        c.globalCompositeOperation = "lighter";
        c.drawImage(light, 0, 0, size, size);
        c.globalCompositeOperation = "difference";
        c.fillRect(0, 0, size, size);
        c.globalCompositeOperation = "lighter";
        c.drawImage(dark, 0, 0, size, size);
        c.globalCompositeOperation = "difference";
        c.fillRect(0, 0, size, size);
    }

    if (isClear)
        composeClear(
            c,
            size,
            appearanceMode === "clear"
                ? MITIGATED.clearLight
                : MITIGATED.clearDark,
        );

    // ── Squircle mask, after the highlights so the subtractive pass sees opaque pixels ──
    if (!bare) {
        c.globalCompositeOperation = "destination-in";
        c.fill(squirclePath(size));
        c.globalCompositeOperation = "source-over";
    }

    // ── Soft edge feather — erases 1-2px outside squircle to anti-alias the clip ──
    if (!bare) {
        c.save();
        c.globalCompositeOperation = "destination-out";
        c.drawImage(getFeatherMask(size), 0, 0);
        c.restore();
    }

    // ── Atomic swap: copy result in one operation, resizing only when the size changed ──
    if (outputCanvas.width !== size || outputCanvas.height !== size)
        outputCanvas.width = outputCanvas.height = size;
    const outCtx = outputCanvas.getContext("2d");
    if (outCtx) {
        outCtx.clearRect(0, 0, size, size);
        outCtx.drawImage(masterCanvas, 0, 0);
    }
}

// ── Chiclet band: inner squircle band of width h, alpha t / (1 + (1 − t)(1/bias − 2)), t = 1 at the edge ──
function drawChicletBand(
    ctx: CanvasRenderingContext2D,
    size: number,
    distance: number,
    bias: number,
): void {
    const h = (distance * size) / 1024;
    const rings = Math.ceil(h);
    const amount = 1 / bias - 2;
    const level = (j: number) => {
        const t = 1 - (j - 0.5) / rings;
        return j > rings ? 0 : Math.round((255 * t) / (1 + (1 - t) * amount));
    };
    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = "lighter";
    for (let j = 1; j <= rings; j++) {
        ctx.strokeStyle = `rgba(255,255,255,${(level(j) - level(j + 1)) / 255})`;
        ctx.lineWidth = (2 * j * h) / rings;
        ctx.stroke(squirclePath(size));
    }
}

type ChicletHighlight = {
    distance: number;
    spreadDeg: number;
    bias: number;
    angleFromKey: number;
    opacity: number;
    dark: boolean;
};
type ChicletHighlightCanvases = {
    light: HTMLCanvasElement;
    dark: HTMLCanvasElement;
};

const chicletHighlights = new Map<
    readonly ChicletHighlight[],
    ChicletHighlightCanvases
>();

// ── Chiclet highlights of a set: band × conic falloff around the light, built once and scaled to the render size ──
function getChicletHighlights(
    set: readonly ChicletHighlight[],
    lightColor: string,
): ChicletHighlightCanvases {
    const cached = chicletHighlights.get(set);
    if (cached) return cached;
    const size = CHICLET_BUILD_SIZE;
    const target = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        return { canvas, ctx: canvas.getContext("2d")! };
    };
    const { canvas: light, ctx: lc } = target();
    const { canvas: dark, ctx: dc } = target();
    const { canvas: band, ctx: bc } = target();
    const { canvas: hl, ctx: hc } = target();
    const specs = [...set].sort(
        (a, b) => a.distance - b.distance || a.bias - b.bias,
    );
    let bandKey = "";
    for (const s of specs) {
        if (`${s.distance}:${s.bias}` !== bandKey) {
            drawChicletBand(bc, size, s.distance, s.bias);
            bandKey = `${s.distance}:${s.bias}`;
        }
        hc.globalCompositeOperation = "copy";
        hc.drawImage(band, 0, 0);
        hc.globalCompositeOperation = "destination-in";
        const a0 = CHICLET_LIGHT_LONGITUDE + s.angleFromKey - Math.PI / 2;
        const cosSpread = Math.cos((s.spreadDeg * Math.PI) / 180);
        const grad = hc.createConicGradient(0, size / 2, size / 2);
        for (let i = 0; i <= CHICLET_CONIC_STOPS; i++) {
            const phi = (2 * Math.PI * i) / CHICLET_CONIC_STOPS;
            grad.addColorStop(
                i / CHICLET_CONIC_STOPS,
                `rgba(0,0,0,${Math.max(0, (Math.cos(phi - a0) - cosSpread) / (1 - cosSpread))})`,
            );
        }
        hc.fillStyle = grad;
        hc.fillRect(0, 0, size, size);
        const tc = s.dark ? dc : lc;
        tc.globalCompositeOperation = "lighter";
        for (let a = s.opacity; a > 0; a--) {
            tc.globalAlpha = Math.min(1, a);
            tc.drawImage(hl, 0, 0);
        }
    }
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = "source-in";
    lc.fillStyle = lightColor;
    lc.fillRect(0, 0, size, size);
    const entry = { light, dark };
    chicletHighlights.set(set, entry);
    return entry;
}

let featherMask: HTMLCanvasElement | null = null;

function getFeatherMask(size: number): HTMLCanvasElement {
    if (featherMask?.width === size) return featherMask;
    const outside = document.createElement("canvas");
    outside.width = outside.height = size;
    const oc = outside.getContext("2d")!;
    oc.fillStyle = "#000000";
    oc.fillRect(0, 0, size, size);
    oc.globalCompositeOperation = "destination-out";
    oc.fill(squirclePath(size));

    const featherPx = 1.2;
    const mask = featherMask ?? document.createElement("canvas");
    mask.width = mask.height = size;
    const mc = mask.getContext("2d")!;
    mc.filter = `blur(${featherPx}px)`;
    mc.drawImage(outside, 0, 0);
    featherMask = mask;
    return mask;
}

export type ExportFormat = "png" | "jpeg";
export interface ExportOptions {
    format: ExportFormat;
    size: number;
    allModes?: boolean;
    clipboard?: boolean;
    bare?: boolean;
}

const EXPORT_QUALITY = 0.95;

function downscale(
    source: HTMLCanvasElement,
    target: number,
): HTMLCanvasElement {
    let current = source;
    while (current.width > target) {
        const next = Math.max(target, Math.floor(current.width / 2));
        const { canvas, ctx } = getScratchCanvas(`downscale-${next}`, next);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(current, 0, 0, next, next);
        current = canvas;
    }
    return current;
}

async function renderForExport(
    layers: RenderContext["layers"],
    background: RenderContext["background"],
    lightAngle: number,
    mode: AppearanceMode,
    renderSize: number,
    bare = false,
): Promise<HTMLCanvasElement> {
    const rendered = document.createElement("canvas");
    await renderIconToCanvas(
        rendered,
        {
            layers,
            background,
            lightAngle,
            appearanceMode: mode,
            size: renderSize,
        },
        bare,
    );
    return rendered;
}

function canvasToBlob(
    canvas: HTMLCanvasElement,
    format: ExportFormat,
): Promise<Blob> {
    if (format === "jpeg") {
        const ctx = canvas.getContext("2d")!;
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    return new Promise((resolve, reject) =>
        canvas.toBlob(
            blob =>
                blob
                    ? resolve(blob)
                    : reject(new Error(`Export failed for image/${format}`)),
            `image/${format}`,
            EXPORT_QUALITY,
        ),
    );
}

export async function exportIcon(
    layers: RenderContext["layers"],
    background: RenderContext["background"],
    lightAngle: number,
    mode: AppearanceMode,
    { format, size, bare }: ExportOptions = { format: "png", size: 1024 },
): Promise<Blob> {
    const renderSize = Math.max(size, Math.min(2048, Math.max(1024, size * 2)));
    try {
        const rendered = await renderForExport(
            layers,
            background,
            lightAngle,
            mode,
            renderSize,
            bare,
        );
        return await canvasToBlob(downscale(rendered, size), format);
    } finally {
        releaseLargeScratch();
    }
}

const RENDITION_NAMES: Record<AppearanceMode, string> = {
    default: "Default",
    dark: "Dark",
    clear: "ClearLight",
    clearDark: "ClearDark",
};
const ZIP_SIZES = [4096, 2048, 1024, 512, 256];

export async function exportZip(
    layers: RenderContext["layers"],
    background: RenderContext["background"],
    lightAngle: number,
): Promise<Blob> {
    const files: Record<string, Uint8Array> = {};
    try {
        for (const renderSize of [4096, 2048]) {
            for (const [mode, rendition] of Object.entries(RENDITION_NAMES) as [
                AppearanceMode,
                string,
            ][]) {
                const rendered = await renderForExport(
                    layers,
                    background,
                    lightAngle,
                    mode,
                    renderSize,
                );
                for (const size of ZIP_SIZES.filter(
                    s => s > 2048 === renderSize > 2048,
                )) {
                    const blob = await canvasToBlob(
                        downscale(rendered, size),
                        "png",
                    );
                    files[`${rendition}/icon-${size}.png`] = new Uint8Array(
                        await blob.arrayBuffer(),
                    );
                }
            }
        }
    } finally {
        releaseLargeScratch();
    }
    return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], {
        type: "application/zip",
    });
}

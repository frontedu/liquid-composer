import VERT_SRC  from './shaders/vertex.vert.glsl?raw';
import BLUR_SRC  from './shaders/blur.frag.glsl?raw';
import GLASS_SRC from './shaders/liquidGlass.frag.glsl?raw';
import SEED_SRC  from './shaders/sdfSeed.frag.glsl?raw';
import JFA_SRC   from './shaders/sdfJfa.frag.glsl?raw';
import FIELD_SRC from './shaders/sdfField.frag.glsl?raw';
import { DARKLIGHT_VCM, GLYPH_HIGHLIGHTS, HIGHLIGHT_VCM, MATERIAL } from './glassContract';
import type { GlassRenderer, LiquidGlassParams } from './glassContract';

const SDF_REACH             = 20;   // units of 1/1024, highlight reach and scissor margin outside the layer frame
const SDF_CLEAR             = new Uint32Array([65535, 65535, 0, 0]);
const SDF_SMOOTHING         = 0.005; // × size, sigma of the seed mask blur
const SDF_SMOOTHING_MAX     = 4.95; // px [I]
const REFRACTION_SATURATION = 0.2;  // × size, depth where the SDF saturates
const BG_CACHE_MAX_SIZE     = 2048; // px, above it every background shares one slot

type UvRect = [number, number, number, number]; // x0, y0, x1, y1, y down

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}\n\nSource:\n${src}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragSrc: string): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return prog;
}

function assertRenderSize(gl: WebGL2RenderingContext, size: number) {
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (size > maxTexture) throw new Error(`Render size ${size} exceeds MAX_TEXTURE_SIZE ${maxTexture}`);
}

function makeTexture(gl: WebGL2RenderingContext, w: number, h: number, hdr = false): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (hdr) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makeSeedTexture(gl: WebGL2RenderingContext, n: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16UI, n, n, 0, gl.RG_INTEGER, gl.UNSIGNED_SHORT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makeFBO(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fbo;
}

function uploadSourceTexture(gl: WebGL2RenderingContext, tex: WebGLTexture, source: TexImageSource, mipmaps = true) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
}

function drawFullscreenQuad(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject) {
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

// ── Scissor from a UV rect on an n×n target; flipped = window row 0 is the image bottom ──
function setScissor(gl: WebGL2RenderingContext, n: number, r: UvRect, flipped: boolean) {
  const x0 = Math.max(0, Math.floor(r[0] * n));
  const x1 = Math.min(n, Math.ceil(r[2] * n));
  const y0 = Math.max(0, Math.floor((flipped ? 1 - r[3] : r[1]) * n));
  const y1 = Math.min(n, Math.ceil((flipped ? 1 - r[1] : r[3]) * n));
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
}

// ── Highlight table → uHl (render px, image space y down) ──
function highlightUniforms(p: LiquidGlassParams, size: number): Float32Array {
  const hl = new Float32Array(GLYPH_HIGHLIGHTS.length * 8);
  const lon = Math.PI / 2 - p.lightAngle * Math.PI / 180;
  GLYPH_HIGHLIGHTS.forEach((h, i) => {
    const outsetOpacity = h.dark && p.placement === 'outside' ? h.outsetOpacity : undefined;
    const outset = outsetOpacity !== undefined;
    const height = Math.max(h.distance * size / 1024, h.minPx);
    const spread = h.spreadDeg * Math.PI / 180;
    const angle = lon + h.angleFromKey;
    const gain = h.dark ? p.darkGain : h.angleFromKey === 0 ? p.keyGain : p.fillGain;
    const opacity = p.placement === 'off' ? 0 : (outsetOpacity ?? p.lightIntensity * h.opacity) * gain;
    hl.set([
      height,
      outset ? -height : 0,
      spread > Math.PI || (Math.cos(spread) === -1 && h.bias === 1) ? -1000 : Math.cos(spread),
      1 / h.bias - 2,
      outset ? 0 : h.curvature,
      Math.sin(angle),
      -Math.cos(angle),
      opacity,
    ], i * 8);
  });
  return hl;
}

interface UniformCache {
  blur_uTex: WebGLUniformLocation | null;
  blur_uTexelSize: WebGLUniformLocation | null;
  blur_uRadius: WebGLUniformLocation | null;
  blur_uHorizontal: WebGLUniformLocation | null;
  seed_uMaskTex: WebGLUniformLocation | null;
  seed_uSdfSize: WebGLUniformLocation | null;
  jfa_uSeedTex: WebGLUniformLocation | null;
  jfa_uStep: WebGLUniformLocation | null;
  field_uSeedTex: WebGLUniformLocation | null;
  field_uMaskTex: WebGLUniformLocation | null;
  field_uScale: WebGLUniformLocation | null;
  glass_uLayerTex: WebGLUniformLocation | null;
  glass_uLightingTex: WebGLUniformLocation | null;
  glass_uBlurredBgTex: WebGLUniformLocation | null;
  glass_uOrigBgTex: WebGLUniformLocation | null;
  glass_uSdfTex: WebGLUniformLocation | null;
  glass_uShadowTex: WebGLUniformLocation | null;
  glass_uParams1: WebGLUniformLocation | null;
  glass_uParams2: WebGLUniformLocation | null;
  glass_uParams3: WebGLUniformLocation | null;
  glass_uParams4: WebGLUniformLocation | null;
  glass_uLayerBounds: WebGLUniformLocation | null;
  glass_uTranslucencyGradient: WebGLUniformLocation | null;
  glass_uTranslucencyGradient2: WebGLUniformLocation | null;
  glass_uHl: WebGLUniformLocation | null;
  glass_uVcm: WebGLUniformLocation | null;
  glass_uTexelSize: WebGLUniformLocation | null;
}

interface SdfField {
  tex: WebGLTexture;                // signed distance px + outward normal, also the horizontal pass of the mask blur
  fbo: WebGLFramebuffer;
  mask: WebGLTexture;               // layer alpha smoothed for the seeds
  maskFbo: WebGLFramebuffer;
}

// ── Size-dependent textures and FBOs, rebuilt by resize() ──
interface Targets {
  size: number;
  blurSize: number;
  sdfSize: number;
  texA: WebGLTexture;               // horizontal blur pass
  fboA: WebGLFramebuffer;
  texR: WebGLTexture;               // glass background of the layer frame, blurred in place
  fboR: WebGLFramebuffer;
  keyedBg: WebGLTexture;            // background of the first painted layer (bgKey)
  runningBg: WebGLTexture | null;   // background of the next layers
  layerTex: WebGLTexture;
  lightingTex: WebGLTexture | null; // fallback seeds and edge normals, null with the field
  shadowTex: WebGLTexture;
  sdfTex: [WebGLTexture, WebGLTexture];
  sdfFbo: [WebGLFramebuffer, WebGLFramebuffer];
  field: SdfField | null;           // null without float render targets: the composite reads the seeds
}

export class LiquidGlassRenderer implements GlassRenderer {
  private gl: WebGL2RenderingContext;
  private blurProg: WebGLProgram;
  private glassProg: WebGLProgram;
  private seedProg: WebGLProgram;
  private jfaProg: WebGLProgram;
  private fieldProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uniforms: UniformCache;
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;
  private hdr: boolean;
  private targets: Targets;
  readonly canvas: HTMLCanvasElement;
  private _lastBgKey: string = '';

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      alpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    assertRenderSize(gl, canvas.width);
    this.canvas = canvas;
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));

    this.blurProg  = createProgram(gl, BLUR_SRC);
    this.glassProg = createProgram(gl, this.hdr ? GLASS_SRC.replace('\n', '\n#define SDF_FIELD\n') : GLASS_SRC);
    this.seedProg  = createProgram(gl, SEED_SRC);
    this.jfaProg   = createProgram(gl, JFA_SRC);
    this.fieldProg = createProgram(gl, FIELD_SRC);

    this.uniforms = {
      blur_uTex:        gl.getUniformLocation(this.blurProg,  'uTex'),
      blur_uTexelSize:  gl.getUniformLocation(this.blurProg,  'uTexelSize'),
      blur_uRadius:     gl.getUniformLocation(this.blurProg,  'uRadius'),
      blur_uHorizontal: gl.getUniformLocation(this.blurProg,  'uHorizontal'),
      seed_uMaskTex:    gl.getUniformLocation(this.seedProg,  'uMaskTex'),
      seed_uSdfSize:    gl.getUniformLocation(this.seedProg,  'uSdfSize'),
      jfa_uSeedTex:     gl.getUniformLocation(this.jfaProg,   'uSeedTex'),
      jfa_uStep:        gl.getUniformLocation(this.jfaProg,   'uStep'),
      field_uSeedTex:   gl.getUniformLocation(this.fieldProg, 'uSeedTex'),
      field_uMaskTex:   gl.getUniformLocation(this.fieldProg, 'uMaskTex'),
      field_uScale:     gl.getUniformLocation(this.fieldProg, 'uScale'),
      glass_uLayerTex:     gl.getUniformLocation(this.glassProg, 'uLayerTex'),
      glass_uLightingTex:  gl.getUniformLocation(this.glassProg, 'uLightingTex'),
      glass_uBlurredBgTex: gl.getUniformLocation(this.glassProg, 'uBlurredBgTex'),
      glass_uOrigBgTex:    gl.getUniformLocation(this.glassProg, 'uOrigBgTex'),
      glass_uSdfTex:       gl.getUniformLocation(this.glassProg, 'uSdfTex'),
      glass_uShadowTex:    gl.getUniformLocation(this.glassProg, 'uShadowTex'),
      glass_uParams1:      gl.getUniformLocation(this.glassProg, 'uParams1'),
      glass_uParams2:      gl.getUniformLocation(this.glassProg, 'uParams2'),
      glass_uParams3:      gl.getUniformLocation(this.glassProg, 'uParams3'),
      glass_uParams4:      gl.getUniformLocation(this.glassProg, 'uParams4'),
      glass_uLayerBounds:  gl.getUniformLocation(this.glassProg, 'uLayerBounds'),
      glass_uTranslucencyGradient: gl.getUniformLocation(this.glassProg, 'uTranslucencyGradient'),
      glass_uTranslucencyGradient2: gl.getUniformLocation(this.glassProg, 'uTranslucencyGradient2'),
      glass_uHl:           gl.getUniformLocation(this.glassProg, 'uHl'),
      glass_uVcm:          gl.getUniformLocation(this.glassProg, 'uVcm'),
      glass_uTexelSize:    gl.getUniformLocation(this.glassProg, 'uTexelSize'),
    };

    // VAO + buffers (fullscreen quad, shared by all passes)
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const positions = new Float32Array([-1, -1,  1, -1, -1, 1,  1, 1]);
    const uvs       = new Float32Array([ 0,  1,  1,  1,  0, 0,  1, 0]);

    this.posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    const u = this.uniforms;
    gl.useProgram(this.blurProg);
    gl.uniform1i(u.blur_uTex, 0);
    gl.useProgram(this.seedProg);
    gl.uniform1i(u.seed_uMaskTex, 0);
    gl.useProgram(this.jfaProg);
    gl.uniform1i(u.jfa_uSeedTex, 4);
    gl.useProgram(this.fieldProg);
    gl.uniform1i(u.field_uMaskTex, 0);
    gl.uniform1i(u.field_uSeedTex, 4);
    gl.useProgram(this.glassProg);
    gl.uniform1i(u.glass_uLayerTex, 0);
    gl.uniform1i(u.glass_uBlurredBgTex, 1);
    gl.uniform1i(u.glass_uOrigBgTex, 2);
    gl.uniform1i(u.glass_uLightingTex, 3);
    gl.uniform1i(u.glass_uSdfTex, 4);
    gl.uniform1i(u.glass_uShadowTex, 5);
    gl.uniform4fv(u.glass_uVcm, [
      HIGHLIGHT_VCM.black, HIGHLIGHT_VCM.white, HIGHLIGHT_VCM.sat, 0,
      DARKLIGHT_VCM.black, DARKLIGHT_VCM.white, DARKLIGHT_VCM.sat, 0,
    ]);

    this.targets = this.createTargets(canvas.width);
  }

  resize(size: number) {
    if (size === this.targets.size) return;
    assertRenderSize(this.gl, size);
    this.releaseTargets();
    this.canvas.width = size;
    this.canvas.height = size;
    this.targets = this.createTargets(size);
    this._lastBgKey = '';
  }

  private createTargets(size: number): Targets {
    const { gl } = this;
    const blurSize = Math.min(size, 1024);
    const sdfSize = Math.min(size, size >= 4096 ? 2048 : 1024);

    const texA = makeTexture(gl, blurSize, blurSize, this.hdr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const texR = makeTexture(gl, blurSize, blurSize, this.hdr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const sdfTex: [WebGLTexture, WebGLTexture] = [makeSeedTexture(gl, sdfSize), makeSeedTexture(gl, sdfSize)];
    let field: SdfField | null = null;
    if (this.hdr) {
      const tex = makeTexture(gl, sdfSize, sdfSize, true);
      const mask = makeTexture(gl, sdfSize, sdfSize, true);
      field = { tex, fbo: makeFBO(gl, tex), mask, maskFbo: makeFBO(gl, mask) };
    }

    const u = this.uniforms;
    gl.useProgram(this.seedProg);
    gl.uniform1f(u.seed_uSdfSize, sdfSize);
    gl.useProgram(this.glassProg);
    gl.uniform2f(u.glass_uTexelSize, 1 / size, 1 / size);

    return {
      size,
      blurSize,
      sdfSize,
      texA,
      fboA: makeFBO(gl, texA),
      texR,
      fboR: makeFBO(gl, texR),
      keyedBg: this.createBgTexture(size),
      runningBg: null,
      layerTex: makeTexture(gl, size, size),
      lightingTex: field ? null : makeTexture(gl, size, size),
      shadowTex: makeTexture(gl, size, size),
      sdfTex,
      sdfFbo: [makeFBO(gl, sdfTex[0]), makeFBO(gl, sdfTex[1])],
      field,
    };
  }

  private createBgTexture(size: number): WebGLTexture {
    const { gl } = this;
    const tex = makeTexture(gl, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  private releaseTargets() {
    const { gl, targets: t } = this;
    const f = t.field;
    for (const tex of [t.texA, t.texR, t.keyedBg, t.runningBg, t.layerTex, t.lightingTex, t.shadowTex, ...t.sdfTex, f?.tex, f?.mask]) if (tex) gl.deleteTexture(tex);
    for (const fbo of [t.fboA, t.fboR, ...t.sdfFbo, f?.fbo, f?.maskFbo]) if (fbo) gl.deleteFramebuffer(fbo);
  }

  // ── Separable Gaussian on an n×n target, scissored to rect: src → tmp (horizontal, flipped) → dst (vertical) ──
  private blur(src: WebGLTexture, dst: WebGLFramebuffer, radius: number, rect: UvRect, n = this.targets.blurSize, tmp = this.targets.texA, tmpFbo = this.targets.fboA) {
    const { gl } = this;
    const u = this.uniforms;

    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tmpFbo);
    gl.viewport(0, 0, n, n);
    gl.clear(gl.COLOR_BUFFER_BIT);
    setScissor(gl, n, rect, true);
    gl.useProgram(this.blurProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform2f(u.blur_uTexelSize, 1 / n, 1 / n);
    gl.uniform1f(u.blur_uRadius, radius);
    gl.uniform1i(u.blur_uHorizontal, 1);
    drawFullscreenQuad(gl, this.vao);

    gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
    setScissor(gl, n, rect, false);
    gl.bindTexture(gl.TEXTURE_2D, tmp);
    if (Math.ceil(radius * 3) > 24) gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(u.blur_uHorizontal, 0);
    drawFullscreenQuad(gl, this.vao);

    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Background: the first painted layer (bgKey) keeps its own texture ──
  private uploadBackground(bgSource: TexImageSource, mipmaps: boolean, bgKey: string): WebGLTexture {
    const { targets: t } = this;
    const cacheKey = t.size <= BG_CACHE_MAX_SIZE ? bgKey : '';
    if (cacheKey && cacheKey === this._lastBgKey) return t.keyedBg;
    const tex = cacheKey || t.size > BG_CACHE_MAX_SIZE ? t.keyedBg : (t.runningBg ??= this.createBgTexture(t.size));
    if (tex === t.keyedBg) this._lastBgKey = cacheKey;
    uploadSourceTexture(this.gl, tex, bgSource, mipmaps);
    return tex;
  }

  // ── SDF: seed mask (layer alpha blurred, or lightingTex without float targets), seeds on its 0.5 isoline, jump flooding up to reachPx, field ──
  private buildSdf(rect: UvRect, reachPx: number): WebGLTexture {
    const { gl, targets: t } = this;
    const n = t.sdfSize;
    const f = t.field;

    if (f) {
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.maskFbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.blur(t.layerTex, f.maskFbo, Math.min(SDF_SMOOTHING * t.size, SDF_SMOOTHING_MAX) * n / t.size, rect, n, f.tex, f.fbo);
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, n, n);
    for (const fbo of t.sdfFbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clearBufferuiv(gl.COLOR, 0, SDF_CLEAR);
    }
    setScissor(gl, n, rect, false);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.sdfFbo[0]);
    gl.useProgram(this.seedProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f ? f.mask : t.lightingTex);
    drawFullscreenQuad(gl, this.vao);

    const steps: number[] = [];
    for (let step = 2 ** Math.max(0, Math.ceil(Math.log2(reachPx * n / t.size)) - 1); step >= 1; step /= 2) steps.push(step);
    steps.push(1);

    gl.useProgram(this.jfaProg);
    gl.activeTexture(gl.TEXTURE4);
    let src = 0;
    for (const step of steps) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.sdfFbo[1 - src]);
      gl.bindTexture(gl.TEXTURE_2D, t.sdfTex[src]);
      gl.uniform1i(this.uniforms.jfa_uStep, step);
      drawFullscreenQuad(gl, this.vao);
      src = 1 - src;
    }

    if (f) {
      gl.bindTexture(gl.TEXTURE_2D, t.sdfTex[src]);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
      gl.clearBufferfv(gl.COLOR, 0, [-reachPx, 0, 0, 0]);
      setScissor(gl, n, rect, false);
      gl.useProgram(this.fieldProg);
      gl.uniform2f(this.uniforms.field_uScale, t.size / n, reachPx * n / t.size);
      drawFullscreenQuad(gl, this.vao);
    }

    gl.disable(gl.SCISSOR_TEST);
    return f ? f.tex : t.sdfTex[src];
  }

  private bindGlassTextures(orig: WebGLTexture, blurred: WebGLTexture, sdf: WebGLTexture) {
    const { gl, targets: t } = this;
    [t.layerTex, blurred, orig, t.lightingTex, sdf, t.shadowTex].forEach((tex, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    });
  }

  render(layerSource: TexImageSource, lightingSource: TexImageSource, bgSource: TexImageSource, params: LiquidGlassParams, bgKey = '', shadow?: TexImageSource) {
    const { gl, targets: t } = this;
    const sz = t.size;
    const refract = params.refractionStrengthPx !== 0;
    const blurred = params.blurRadiusPx > 0;
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);

    const bgMips = blurred && !refract;
    const bg = this.uploadBackground(bgSource, bgMips, bgKey && `${bgKey}:${bgMips}`);

    uploadSourceTexture(gl, t.layerTex, layerSource, false);
    if (t.lightingTex) uploadSourceTexture(gl, t.lightingTex, lightingSource, false);
    if (shadow) uploadSourceTexture(gl, t.shadowTex, shadow, false);

    // ── Layer frame grown by the highlight reach; SDF reach covers the refraction depth ──
    const hl = highlightUniforms(params, sz);
    const lit = GLYPH_HIGHLIGHTS.some((_, i) => hl[i * 8 + 7] > 0);
    const [bx, by, bw, bh] = params.layerBounds;
    const margin = (SDF_REACH * sz / 1024 + 2) / sz;
    const rect: UvRect = [bx - margin, by - margin, bx + bw + margin, by + bh + margin];
    const heightPx = Math.max(1, params.refractionHeightPx);
    const satPx = REFRACTION_SATURATION * sz;
    const reachPx = Math.max(SDF_REACH * sz / 1024, refract ? Math.min(heightPx, satPx) : 0) + 2;
    const sdfTex = lit || refract ? this.buildSdf(rect, reachPx) : t.field?.tex ?? t.sdfTex[0];

    const u = this.uniforms;
    const blur01 = Math.min(1, params.blurRadiusPx / (MATERIAL.blurMax * sz / 1024));
    const dark = params.darkMode ? 1 : 0;
    gl.useProgram(this.glassProg);
    gl.uniform4f(u.glass_uParams2, params.refractionStrengthPx / sz, heightPx, satPx, params.aberration);
    gl.uniform4f(u.glass_uParams3, params.frostiness, params.useVCM ? 1 : 0, params.lightingBlurPx, sz / t.sdfSize);
    gl.uniform4f(u.glass_uParams4, shadow ? params.shadowAlpha ?? 0 : 0, shadow ? params.overdrawAlpha ?? 0 : 0, 0, params.clearMask ?? 0);
    gl.uniform4f(u.glass_uLayerBounds, ...params.layerBounds);
    const gradient = params.translucencyGradient;
    gl.uniform4f(u.glass_uTranslucencyGradient, (gradient?.angle ?? 90), (gradient?.start ?? 0) / 100, (gradient?.end ?? 100) / 100, (gradient?.startOpacity ?? 100) / 100);
    gl.uniform4f(u.glass_uTranslucencyGradient2, (gradient?.endOpacity ?? 0) / 100, gradient?.enabled ? 1 : 0, 0, 0);
    gl.uniform4fv(u.glass_uHl, hl);

    // ── Blur: glass background of the layer frame (displaced × coverage with refraction, own shadow multiplied), blurred, normalized by the composite ──
    if (blurred) {
      const n = t.blurSize;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboR);
      gl.viewport(0, 0, n, n);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform4f(u.glass_uParams1, blur01, params.translucency, 1, dark);
      this.bindGlassTextures(bg, t.texA, sdfTex);
      setScissor(gl, n, rect, false);
      drawFullscreenQuad(gl, this.vao);
      gl.disable(gl.SCISSOR_TEST);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.texR);
      if (Math.ceil(params.blurRadiusPx * n / sz * 3) > 24) gl.generateMipmap(gl.TEXTURE_2D);
      this.blur(t.texR, t.fboR, params.blurRadiusPx * n / sz, rect);
      gl.useProgram(this.glassProg);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, sz, sz);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(u.glass_uParams1, blur01, params.translucency, 0, dark);
    this.bindGlassTextures(bg, blurred ? t.texR : t.texA, sdfTex);
    setScissor(gl, sz, rect, true);
    drawFullscreenQuad(gl, this.vao);
    gl.disable(gl.SCISSOR_TEST);
  }

  dispose() {
    const { gl } = this;
    this.releaseTargets();
    for (const prog of [this.blurProg, this.glassProg, this.seedProg, this.jfaProg, this.fieldProg]) gl.deleteProgram(prog);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.uvBuf);
    gl.deleteVertexArray(this.vao);
  }
}

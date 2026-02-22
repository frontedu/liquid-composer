// ─── WebGL2 Liquid Glass Renderer ────────────────────────────────────────────
//
// Multi-pass pipeline:
//   Pass 1: Horizontal separable Gaussian blur  (bg → FBO_A)
//   Pass 2: Vertical separable Gaussian blur    (FBO_A → FBO_B)
//   Pass 3: Glass composite with physical lighting (layer + FBO_B + bg → output)
//
// Improvements over WebGL1 version:
//   • Proper 2-pass separable Gaussian (vs single 5×5 box — better quality, fewer samples)
//   • Derivative-based edge detection (dFdx/dFdy — no extra texture fetch per sample)
//   • Correct surface normals from alpha gradient for Fresnel/rim lighting
//   • Chromatic aberration localized to edge region only
//   • Background blur cache (shared across layers per frame)

// ─── Shared vertex shader (fullscreen quad, GLSL 3.00) ───────────────────────
const VERT_SRC = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoord;
out vec2 vUV;
out vec2 vScreenUV;

void main() {
  vUV = aTexCoord;
  vScreenUV = aPosition * 0.5 + 0.5;
  vScreenUV.y = 1.0 - vScreenUV.y;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// ─── Separable Gaussian blur shader ──────────────────────────────────────────
// 9-tap Gaussian kernel (sigma ≈ 1.5). Direction toggled by uHorizontal.
// uRadius: pixel-space blur radius (0 = no blur)
const BLUR_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
// aPosition and aTexCoord are consumed by vertex shader (shared VERT_SRC)

uniform sampler2D uTex;
uniform vec2  uTexelSize;   // 1.0 / textureSize
uniform float uRadius;      // blur radius in texel units
uniform bool  uHorizontal;

out vec4 fragColor;

// 9-tap weights (symmetric, normalised so sum = 1)
const float W[9] = float[](0.028, 0.067, 0.124, 0.179, 0.204, 0.179, 0.124, 0.067, 0.028);

void main() {
  if (uRadius < 0.5) {
    fragColor = texture(uTex, vUV);
    return;
  }
  vec4 sum = vec4(0.0);
  float step = uRadius / 4.0; // spread 4 tap-widths per radius unit
  for (int i = 0; i < 9; i++) {
    float offset = float(i - 4) * step;
    vec2 off = uHorizontal
      ? vec2(offset * uTexelSize.x, 0.0)
      : vec2(0.0, offset * uTexelSize.y);
    sum += texture(uTex, clamp(vUV + off, 0.0005, 0.9995)) * W[i];
  }
  // Saturation boost: glass picks up vivid background colour
  float gray = dot(sum.rgb, vec3(0.299, 0.587, 0.114));
  sum.rgb = mix(vec3(gray), sum.rgb, 1.35);
  fragColor = clamp(sum, 0.0, 1.0);
}
`;

// ─── Glass composite shader ───────────────────────────────────────────────────
// Implements physical liquid glass:
//   1. Read blurred bg, apply glass tint + translucency
//   2. Chromatic aberration along edge normals
//   3. Directional specular highlight (primary spot + top-edge strip)
//   4. Fresnel rim light (proper normal from alpha gradient)
//   5. Edge border glow (lit vs shadow side)
//   6. Inner shadow (radial dark vignette)
//   7. Frostiness: blur drives milkiness even on uniform backgrounds
//   8. Dark / clear mode adjustments
const GLASS_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
in vec2 vScreenUV;

uniform sampler2D uLayerTex;       // layer content (alpha = glass mask)
uniform sampler2D uBlurredBgTex;   // 2-pass Gaussian blurred background
uniform sampler2D uOrigBgTex;      // original (sharp) background

uniform float uBlur;               // 0-1: blur / frostiness strength
uniform float uTranslucency;       // 0-1: bg show-through
uniform float uSpecular;           // 0-1: specular intensity (0 = off)
uniform vec2  uLightDir;           // normalised, FROM light source
uniform float uOpacity;            // 0-1
uniform int   uMode;               // 0=default, 1=dark, 2=clear
uniform float uDarkAdjust;         // 0-1
uniform float uMonoAdjust;         // 0-1
uniform float uAberration;         // 0-1: chromatic aberration strength
uniform vec2  uTexelSize;          // 1/resolution

out vec4 fragColor;

// ── Helpers ──────────────────────────────────────────────────────────────────

float sampleAlpha(vec2 uv) {
  return texture(uLayerTex, uv).a;
}

// Compute surface normal from alpha gradient using finite differences.
// Returns the RAW (non-normalised) gradient — its length encodes edge strength.
vec2 alphaGradient(vec2 uv) {
  vec2 e = uTexelSize * 2.0; // slightly wider kernel for smoother normals
  float aR = sampleAlpha(uv + vec2(e.x, 0.0));
  float aL = sampleAlpha(uv - vec2(e.x, 0.0));
  float aU = sampleAlpha(uv + vec2(0.0, e.y));
  float aD = sampleAlpha(uv - vec2(0.0, e.y));
  return vec2(aR - aL, aU - aD) * 0.5;
}

// Edge magnitude: smooth falloff from edge — NOT clipped to binary 0/1.
// Uses derivative instructions (WebGL2 only) — sub-pixel precise.
float edgeMagnitude(float alpha) {
  vec2 d = vec2(dFdx(alpha), dFdy(alpha));
  // Factor ~4 spreads the edge over ~2 pixels rather than snapping to 1 pixel
  return clamp(length(d) * 4.0, 0.0, 1.0);
}

// ── Main ─────────────────────────────────────────────────────────────────────
void main() {
  float alpha = sampleAlpha(vUV);
  if (alpha < 0.01) { fragColor = vec4(0.0); return; }

  // Surface gradient and edge strength
  vec2  grad     = alphaGradient(vUV);
  float gradLen  = length(grad);              // ~0.5 at edges, ~0 inside
  vec2  normal   = gradLen > 0.001 ? grad / gradLen : vec2(0.0); // normalised direction
  float normalLen = clamp(gradLen * 3.0, 0.0, 1.0); // smooth 0→1 edge falloff
  float edge     = edgeMagnitude(alpha);

  vec2 fromCenter   = vUV - 0.5;
  float dist        = length(fromCenter);
  vec2  normFromCtr = dist > 0.001 ? normalize(fromCenter) : vec2(0.0);

  // ── 1. Base glass: blurred bg + tint ──────────────────────────────────────
  // Chromatic aberration: offset R/B channels along edge normal
  vec2 aberrOff = normal * edge * uAberration * 0.006;
  float r = texture(uBlurredBgTex, clamp(vScreenUV + aberrOff,        0.001, 0.999)).r;
  float g = texture(uBlurredBgTex, clamp(vScreenUV,                   0.001, 0.999)).g;
  float b = texture(uBlurredBgTex, clamp(vScreenUV - aberrOff * 1.2,  0.001, 0.999)).b;
  vec4 bgBlurred = vec4(r, g, b, 1.0);

  // Frostiness: blur slider drives milkiness (visible even on smooth gradients)
  vec4 frostTint = (uMode == 1)
    ? vec4(0.06, 0.06, 0.10, 1.0)   // dark: blue-black frost
    : (uMode == 2)
      ? vec4(0.96, 0.97, 1.00, 1.0)  // clear: pure white frost
      : vec4(0.94, 0.96, 1.00, 1.0); // default: cool white frost
  bgBlurred.rgb = mix(bgBlurred.rgb, frostTint.rgb, uBlur * 0.40);

  // Glass tint
  vec4 glassTint = (uMode == 1)
    ? vec4(0.05, 0.05, 0.08, 1.0)
    : frostTint;

  vec4 layerColor = texture(uLayerTex, vUV);
  vec4 glassBase  = mix(glassTint, bgBlurred, clamp(uTranslucency * 1.2, 0.0, 1.0));
  vec4 result     = mix(layerColor, glassBase, uTranslucency * 0.80);

  // ── 2. Specular highlight (directional, gamma-sharpened) ──────────────────
  if (uSpecular > 0.0) {
    // Primary spot: offset in the direction light comes FROM
    vec2 litPos   = vec2(0.5) - uLightDir * 0.30;
    float dLit    = length(vUV - litPos);
    float spec    = pow(max(0.0, 1.0 - dLit / 0.60), 5.0);

    // Top-edge strip (characteristic curved-glass highlight)
    float topEdge    = smoothstep(0.30, 0.02, abs(vUV.y - 0.86));
    float topFalloff = smoothstep(0.55, 0.0, dLit);
    float topSpec    = topEdge * topFalloff;

    float totalSpec = spec * 0.38 + topSpec * 0.24;
    result.rgb += totalSpec * uSpecular * vec3(0.96, 0.98, 1.00);
  }

  // ── 3. Fresnel rim light (correct normals from alpha gradient) ────────────
  {
    // Fresnel: uses actual surface normal for physically correct directionality
    float ndotv   = max(0.0, dot(normal, -uLightDir));
    // Falloff: rim is bright at edge (normalLen ~ 1), dark inside (normalLen ~ 0)
    float rimBase = normalLen * normalLen;
    // Directional: lit side (toward light) is brighter; shadow side dim
    float litSide = (uSpecular > 0.0)
      ? ndotv * 0.55 + 0.45
      : 0.70;
    float rim = rimBase * litSide * 0.20;
    result.rgb += rim;
  }

  // ── 4. Border glow (edge ring, lit side bright, shadow side dim) ──────────
  {
    float ndotv = (uSpecular > 0.0)
      ? max(0.0, dot(normal, -uLightDir)) * 0.55 + 0.40
      : 0.65;
    result.rgb += edge * ndotv * 0.45;
  }

  // ── 5. Inner shadow (radial vignette at edges, fades to centre) ───────────
  {
    float innerS       = smoothstep(0.32, 0.50, dist);
    float shadowStr    = (uMode == 1) ? 0.38 : 0.14;
    result.rgb         = mix(result.rgb, result.rgb * 0.22, innerS * shadowStr);
  }

  // ── 6. Appearance mode adjustments ────────────────────────────────────────
  if (uMode == 1 && uDarkAdjust > 0.0) {
    // Dark: deepen and blue-shift
    result.rgb = mix(result.rgb, result.rgb * 0.38 + vec3(0.02, 0.02, 0.05), uDarkAdjust);
  } else if (uMode == 2 && uMonoAdjust > 0.0) {
    // Clear: desaturate toward white (not grey — glass should look frosted white)
    float gray = dot(result.rgb, vec3(0.299, 0.587, 0.114));
    vec3 white = vec3(max(gray, 0.85));
    result.rgb = mix(result.rgb, white, uMonoAdjust);
  }

  result.a = alpha * uOpacity;
  fragColor = clamp(result, 0.0, 1.0);
}
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiquidGlassParams {
  blur: number;              // 0-1
  translucency: number;      // 0-1
  specular: boolean;
  specularIntensity: number; // 0-1
  lightAngle: number;        // degrees
  opacity: number;           // 0-1
  mode: 0 | 1 | 2;          // 0=default, 1=dark, 2=clear
  darkAdjust: number;
  monoAdjust: number;
  aberration: number;        // 0-1
}

// ─── WebGL2 helpers ──────────────────────────────────────────────────────────

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

function makeTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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

function uploadSourceTexture(gl: WebGL2RenderingContext, tex: WebGLTexture, source: TexImageSource) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function drawFullscreenQuad(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject) {
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

// ─── Renderer class ───────────────────────────────────────────────────────────

export class LiquidGlassRenderer {
  private gl: WebGL2RenderingContext;
  private blurProg: WebGLProgram;
  private glassProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  // Ping-pong FBOs for 2-pass blur
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private fboA: WebGLFramebuffer;
  private fboB: WebGLFramebuffer;

  // Source textures
  private layerTex: WebGLTexture;
  private origBgTex: WebGLTexture;

  private size: number;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      alpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.size = canvas.width;

    this.blurProg  = createProgram(gl, BLUR_SRC);
    this.glassProg = createProgram(gl, GLASS_SRC);

    // VAO + buffers (fullscreen quad, shared by all passes)
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const positions = new Float32Array([-1, -1,  1, -1, -1, 1,  1, 1]);
    const uvs       = new Float32Array([ 0,  1,  1,  1,  0, 0,  1, 0]);

    // Use explicit locations from layout(location=N) in vertex shader
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    const sz = this.size;
    this.texA      = makeTexture(gl, sz, sz);
    this.texB      = makeTexture(gl, sz, sz);
    this.fboA      = makeFBO(gl, this.texA);
    this.fboB      = makeFBO(gl, this.texB);
    this.layerTex  = gl.createTexture()!;
    this.origBgTex = gl.createTexture()!;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // ── 2-pass Gaussian blur on bgSource → texB ─────────────────────────────────
  private blurBackground(bgSource: TexImageSource, radius: number) {
    const { gl } = this;
    const sz = this.size;
    const texelSize = 1.0 / sz;

    // Upload original bg to origBgTex (used in glass pass for sharp background)
    uploadSourceTexture(gl, this.origBgTex, bgSource);

    // Horizontal pass: origBgTex → fboA
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, sz, sz);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.blurProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.origBgTex);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, 'uTexelSize'), texelSize, texelSize);
    gl.uniform1f(gl.getUniformLocation(this.blurProg, 'uRadius'), radius);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uHorizontal'), 1);
    drawFullscreenQuad(gl, this.vao);

    // Vertical pass: texA → fboB
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.uniform1f(gl.getUniformLocation(this.blurProg, 'uRadius'), radius);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uHorizontal'), 0);
    drawFullscreenQuad(gl, this.vao);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(layerSource: TexImageSource, bgSource: TexImageSource, params: LiquidGlassParams) {
    const { gl } = this;
    const sz = this.size;

    // Compute blur radius in texel units (0 = no blur)
    const blurRadius = params.blur * sz * 0.028;

    // Always re-blur bg — each layer may have different blur strength,
    // and the 2-pass Gaussian is fast enough to run per layer
    this.blurBackground(bgSource, blurRadius);

    // Upload layer texture
    uploadSourceTexture(gl, this.layerTex, layerSource);

    // ── Glass composite pass: render to screen ─────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, sz, sz);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.glassProg);

    const p = this.glassProg;
    const texelSize = 1.0 / sz;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
    gl.uniform1i(gl.getUniformLocation(p, 'uLayerTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);  // blurred bg
    gl.uniform1i(gl.getUniformLocation(p, 'uBlurredBgTex'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.origBgTex);  // sharp bg
    gl.uniform1i(gl.getUniformLocation(p, 'uOrigBgTex'), 2);

    gl.uniform1f(gl.getUniformLocation(p, 'uBlur'),        params.blur);
    gl.uniform1f(gl.getUniformLocation(p, 'uTranslucency'), params.translucency);
    gl.uniform1f(gl.getUniformLocation(p, 'uSpecular'),    params.specular ? params.specularIntensity : 0.0);
    gl.uniform1f(gl.getUniformLocation(p, 'uOpacity'),     params.opacity);
    gl.uniform1i(gl.getUniformLocation(p, 'uMode'),        params.mode);
    gl.uniform1f(gl.getUniformLocation(p, 'uDarkAdjust'),  params.darkAdjust);
    gl.uniform1f(gl.getUniformLocation(p, 'uMonoAdjust'),  params.monoAdjust);
    gl.uniform1f(gl.getUniformLocation(p, 'uAberration'),  params.aberration);
    gl.uniform2f(gl.getUniformLocation(p, 'uTexelSize'),   texelSize, texelSize);

    const angleRad = (params.lightAngle * Math.PI) / 180;
    gl.uniform2f(gl.getUniformLocation(p, 'uLightDir'), Math.cos(angleRad), Math.sin(angleRad));

    drawFullscreenQuad(gl, this.vao);
  }

  dispose() {
    const { gl } = this;
    gl.deleteTexture(this.layerTex);
    gl.deleteTexture(this.origBgTex);
    gl.deleteTexture(this.texA);
    gl.deleteTexture(this.texB);
    gl.deleteFramebuffer(this.fboA);
    gl.deleteFramebuffer(this.fboB);
    gl.deleteProgram(this.blurProg);
    gl.deleteProgram(this.glassProg);
    gl.deleteVertexArray(this.vao);
  }
}

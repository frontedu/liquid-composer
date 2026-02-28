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
uniform bool  uSaturate;

out vec4 fragColor;

// Linear ↔ sRGB conversion for physically correct blur blending
vec3 toLinear(vec3 srgb) { return pow(srgb, vec3(2.2)); }
vec3 toSRGB(vec3 lin)   { return pow(lin, vec3(1.0 / 2.2)); }

// 9-tap weights (symmetric, normalised so sum = 1)
const float W[9] = float[](0.028, 0.067, 0.124, 0.179, 0.204, 0.179, 0.124, 0.067, 0.028);

void main() {
  if (uRadius < 0.5) {
    vec4 s = texture(uTex, vUV);
    s.rgb = toLinear(s.rgb);
    fragColor = s;
    return;
  }
  vec4 sum = vec4(0.0);
  float step = uRadius / 4.0; // spread 4 tap-widths per radius unit
  for (int i = 0; i < 9; i++) {
    float offset = float(i - 4) * step;
    vec2 off = uHorizontal
      ? vec2(offset * uTexelSize.x, 0.0)
      : vec2(0.0, offset * uTexelSize.y);
    vec4 s = texture(uTex, clamp(vUV + off, 0.0005, 0.9995));
    // Blur in linear space for physically correct blending
    s.rgb = toLinear(s.rgb);
    sum += s * W[i];
  }
  // Keep output in LINEAR space — the glass composite shader expects linear input.
  // Saturation boost: glass picks up vivid background colour
  // Adaptive to blur radius — stronger blur = more desaturation = more compensation
  // Only applies if uSaturate is true (typically dark mode)
  if (uSaturate) {
    float gray = dot(sum.rgb, vec3(0.299, 0.587, 0.114));
    float satBoost = 1.0 + clamp(uRadius / 8.0, 0.0, 1.0) * 0.5;  // 1.0..1.5
    sum.rgb = mix(vec3(gray), sum.rgb, satBoost);
  }
  fragColor = sum; // linear output (no clamping — HDR FBO accepts >1.0)
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
uniform float uAberration;         // 0-1: chromatic aberration strength
uniform vec2  uTexelSize;          // 1/resolution
uniform float uDarkAdjust;         // 0-1: dark mode adjustment
uniform float uMonoAdjust;         // 0-1: clear mode adjustment

out vec4 fragColor;

// ── Color space conversion ──────────────────────────────────────────────────
vec3 toLinear(vec3 srgb) { return pow(max(srgb, 0.0), vec3(2.2)); }
vec3 toSRGB(vec3 lin)   { return pow(max(lin, 0.0), vec3(1.0 / 2.2)); }

// ACES filmic tone mapping (fits HDR values into [0,1] with natural highlights)
vec3 acesToneMap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

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

// Edge magnitude: smooth falloff from edge
// Uses derivative instructions to find the pixel-space width of the edge
float edgeMagnitude(float alpha) {
  vec2 d = vec2(dFdx(alpha), dFdy(alpha));
  float w = length(d);
  // Scale edge width with resolution so borders are consistent at any size.
  float px = max(uTexelSize.x, uTexelSize.y);
  return smoothstep(0.0, px * 1.25, w); 
}

// ── Main ─────────────────────────────────────────────────────────────────────
void main() {
  float alpha = sampleAlpha(vUV);
  if (alpha < 0.01) { fragColor = vec4(0.0); return; }

  // ── Work in linear color space for physically correct lighting ────────────
  // All texture samples will be linearized; final output converted to sRGB.

  // uThickness / uStrength are now internal "smart constants" for maximum quality
  const float uThickness = 0.65; 
  const float uStrength  = 0.72;

  // Surface gradient and edge strength
  vec2  grad     = alphaGradient(vUV);
  float gradLen  = length(grad);              // ~0.5 at edges, ~0 inside
  vec2  normal   = gradLen > 0.001 ? grad / gradLen : vec2(0.0); // normalised direction
  
  // High-fidelity volumetric height derivative
  float thicknessScale = 1.0 + uThickness * 3.0; 
  float normalLen = clamp(gradLen * 3.4 * thicknessScale, 0.0, 1.0); 
  float edge     = edgeMagnitude(alpha);

  // Corner proximity: detect closeness to shape corners for corner-boost refraction
  float cornerProx = min(vUV.x, 1.0 - vUV.x) * min(vUV.y, 1.0 - vUV.y);
  float cornerBoost = exp(-cornerProx * 40.0) * 0.5;

  // Edge / Rim / Base intensity zones (exponential falloff from edge)
  float edgeZone = edge;                             // sharp boundary
  float rimZone  = smoothstep(0.08, 0.80, normalLen); // intermediate ring (wider)
  float baseZone = 1.0 - normalLen;                   // deep interior

  // Convert light direction to UV space (uLightDir is in math coords Y-up,
  // but vUV / normal are in UV coords Y-down → flip Y).
  // outwardNormal = -normal (gradient points inward); litDir points toward light.
  vec2 litDir = vec2(uLightDir.x, -uLightDir.y); // UV-space toward-light direction

  vec2 fromCenter   = vUV - 0.5;
  float dist        = length(fromCenter);
  vec2  normFromCtr = dist > 0.001 ? normalize(fromCenter) : vec2(0.0);

  // ── 1. Base glass: blurred bg + tint ──────────────────────────────────────
  // Very subtle magnification
  float magStrength = 0.008 * baseZone * uTranslucency;
  vec2 magUV = vScreenUV + (vScreenUV - 0.5) * magStrength;

  // Simple, fast chromatic aberration (tight to the edge band)
  float edgeBand = pow(edge, 1.0) * smoothstep(0.06, 0.85, normalLen);
  vec2 aberrOff = normal * edgeBand * uAberration * 0.010;
  float r = texture(uBlurredBgTex, clamp(magUV + aberrOff, 0.001, 0.999)).r;
  float g = texture(uBlurredBgTex, clamp(magUV,            0.001, 0.999)).g;
  float b = texture(uBlurredBgTex, clamp(magUV - aberrOff, 0.001, 0.999)).b;
  vec4 bgBlurred = vec4(r, g, b, 1.0); 

  // Frostiness & Tint
  vec4 frostTint = (uMode == 1) ? vec4(0.08, 0.08, 0.12, 1.0) : vec4(1.0);
  vec4 bgSharp = texture(uOrigBgTex, clamp(magUV, 0.001, 0.999));
  bgSharp.rgb = toLinear(bgSharp.rgb);
  vec4 bgBase = mix(bgSharp, bgBlurred, clamp(uBlur, 0.0, 1.0));
  bgBase.rgb = mix(bgBase.rgb, frostTint.rgb, uBlur * 0.35);

  vec4 layerColor = texture(uLayerTex, vUV);
  layerColor.rgb = toLinear(layerColor.rgb);
  vec4 glassBase  = bgBase;  // glass base is always the (blurred) background

  float luma = dot(layerColor.rgb, vec3(0.299, 0.587, 0.114));
  float mask = layerColor.a;
  // translucency=0 → layer fully visible over bg; translucency=1 → bg fully visible (glass)
  float layerMix = (1.0 - uTranslucency) * mask;
  vec4 result = mix(glassBase, layerColor, layerMix);

  // ── 2. Volumetric 3D Modeling (Cushion Effect) ───────────────────────────
  // Uses inward normal + very wide falloff to simulate a physical 3D dome interior
  {
    // shadow side is where inward normal points away from light source
    float shadowWeight = max(0.0, -dot(normal, litDir));
    // convexity: 1.0 at center, 0.0 at edges. Extremely wide curve (pow 0.3)
    float dome = pow(1.0 - normalLen, 0.35); 
    
    // Ambient Occlusion + Directional Shadowing
    // This creates the "weight" and "volume" of the object
    float ao = mix(0.12, 0.55, shadowWeight) * dome;
    
    // Apply darkening - deeper on shadow side, subtle at center
    result.rgb *= mix(1.0, 0.58, ao);

    // Add a very subtle "internal bounce" on the lit side (inner glow)
    float litSideHighlight = max(0.0, -dot(normal, litDir)) * pow(normalLen, 2.0) * 0.15;
    result.rgb += vec3(1.0, 0.98, 0.92) * litSideHighlight;
  }

  // ── 3. Specular & Rim (Detailed) ──────────────────────────────────────────
    if (uSpecular > 0.0) {
      vec2 litPos = vec2(0.5) + litDir * 0.48;
      float spec  = pow(max(0.0, 1.0 - length(vUV - litPos) / 0.22), 10.0);
      
      float ndotv = max(0.0, -dot(normal, litDir));
      float rim   = pow(normalLen, 2.4) * pow(ndotv, 3.0) * 0.50;

      // No dark boost — dark content shouldn't get amplified specular (causes large white blob)
      float edgeMask = smoothstep(0.35, 0.92, normalLen);
      float specEdge = spec * edgeMask * edgeBand;
      result.rgb += (specEdge * 0.22 + rim) * uSpecular * vec3(1.0);
    }

  // ── 4. Subtle Edge Detais ──────────────────────────────────────────────────
  {
    // Sharp edge catching light
    result.rgb += edge * max(0.0, -dot(normal, litDir)) * 0.18;
  }

  // ── 5. Environment reflection (procedural sky/ground) ─────────────────────
  // Simulates glass surface catching ambient light from an imaginary
  // environment. Uses a procedural gradient: warm white on the lit side,
  // cool blue-gray on the shadow side (like sky reflecting on glass).
  {
    // How much the outward normal faces the light direction
    float envNdotL = max(0.0, -dot(normal, litDir));
    // Warm (lit) vs cool (shadow) environment colour
    vec3 envWarm = vec3(1.00, 0.97, 0.92);  // warm sunlit
    vec3 envCool = vec3(0.75, 0.80, 0.90);  // cool sky
    vec3 envColor = mix(envCool, envWarm, envNdotL);

    // Fresnel-like: reflection is stronger at grazing angles (edges)
    float envFresnel = normalLen * normalLen * 0.25;
    // Modulate by specular control so user can dial it down
    float envIntensity = envFresnel * (uSpecular > 0.0 ? uSpecular : 0.3);
    // In dark mode, reduce and shift to cooler tones
    if (uMode == 1) {
      envColor = mix(envColor, vec3(0.15, 0.18, 0.25), 0.6);
      envIntensity *= 0.5;
    }
    result.rgb += envColor * envIntensity;
  }

  // ── Edge inner glow ───────────────────────────────────────────────────────
  // Glass edges catch light internally, creating a luminous inner glow that
  // radiates inward from the content boundary. Warm-shifted, lit-side weighted.
  {
    // Inner glow uses normalLen as distance-from-edge (1 at edge, 0 inside)
    float innerGlowFalloff = normalLen * exp(-normalLen * 0.55); // peaks just inside edge
    float litWeight = max(0.0, -dot(normal, litDir)) * 0.6 + 0.4;
    vec3 glowColor = vec3(1.00, 0.96, 0.88); // warm
    if (uMode == 1) glowColor = vec3(0.40, 0.45, 0.60); // dark mode: cool blue
    float glowIntensity = innerGlowFalloff * litWeight * 0.22;
    result.rgb += glowColor * glowIntensity;
  }

  // ── Ambient background rim (shadow side) ─────────────────────────────────
  // On the side opposite to the light, the glass edge catches the background
  // colour — like environment colour bleeding into the rim, grounding the icon
  // visually in its surroundings.
  {
    float shadowRim = max(0.0, dot(normal, litDir));  // 1.0 on shadow side
    float rimBand   = pow(normalLen, 0.8) * shadowRim;
    vec3 bgColor = toLinear(texture(uOrigBgTex, vUV).rgb);
    // Boost saturation so the ambient colour reads vividly against dark content
    float bgGray = dot(bgColor, vec3(0.299, 0.587, 0.114));
    bgColor = mix(vec3(bgGray), bgColor, 1.65);
    result.rgb += bgColor * rimBand * 0.55;
  }

  // ── Light-angle content dimming ───────────────────────────────────────────
  // Shadow side of the glass darkens content slightly for directional depth.
  {
    float ndotFromCenter = dot(normFromCtr, litDir);
    // lit side = 1.0, shadow side = ~0.88 (subtle darkening)
    float dimFactor = 0.94 + ndotFromCenter * 0.06;
    result.rgb *= mix(1.0, dimFactor, uTranslucency * 0.8);
  }

  // ── 5a. Directional Inner Shadow (away from light source) ────────────────
  {
    // Directional shadow factor: 1.0 on the far side of light
    float shadowSide = max(0.0, dot(normal, litDir));
    float innerS     = smoothstep(0.18, 0.48, dist);
    // Strength scales the shadow density
    float shadowStr  = ((uMode == 1) ? 0.45 : 0.22) * (0.5 + uStrength * 0.5);
    
    // Invert shadow on the interior based on dist and normal
    result.rgb       = mix(result.rgb, result.rgb * 0.35, shadowSide * innerS * shadowStr * baseZone);
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

  // ── Glass-aware bloom ─────────────────────────────────────────────────────
  // Bright areas visible through glass subtly bleed light at the edges,
  // creating a diffusion halo that makes the glass feel alive.
  {
    float brightness = dot(result.rgb, vec3(0.299, 0.587, 0.114));
    float bloomThreshold = 0.80;
    if (brightness > bloomThreshold) {
      float bloomAmount = (brightness - bloomThreshold) / (1.0 - bloomThreshold);
      // Bloom is strongest at edges (rimZone) and softer inside
      float bloomEdge = mix(rimZone, edgeZone, 0.3) * bloomAmount * 0.18;
      // Warm bloom color
      vec3 bloomColor = result.rgb * 0.5 + vec3(0.5, 0.48, 0.44) * 0.5;
      result.rgb += bloomColor * bloomEdge;
    }
  }

  // ── HDR tone mapping + sRGB conversion ────────────────────────────────────
  // Apply ACES filmic tone map to gracefully compress HDR highlights,
  // then convert from linear space back to sRGB for display.
  result.rgb = acesToneMap(result.rgb);
  result.rgb = toSRGB(result.rgb);

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

function makeTexture(gl: WebGL2RenderingContext, w: number, h: number, hdr = false): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (hdr) {
    // HDR: RGBA16F allows values > 1.0 for proper bloom/specular accumulation
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

    // HDR: check if rendering to float textures is supported (EXT_color_buffer_float)
    const hdrSupported = !!gl.getExtension('EXT_color_buffer_float');

    this.texA      = makeTexture(gl, sz, sz, hdrSupported);
    this.texB      = makeTexture(gl, sz, sz, hdrSupported);
    this.fboA      = makeFBO(gl, this.texA);
    this.fboB      = makeFBO(gl, this.texB);
    this.layerTex  = gl.createTexture()!;
    this.origBgTex = gl.createTexture()!;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // ── 2-pass Gaussian blur on bgSource → texB ─────────────────────────────────
  private blurBackground(bgSource: TexImageSource, radius: number, saturate: boolean) {
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
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uSaturate'), saturate ? 1 : 0);
    drawFullscreenQuad(gl, this.vao);

    // Vertical pass: texA → fboB
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.uniform1f(gl.getUniformLocation(this.blurProg, 'uRadius'), radius);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uHorizontal'), 0);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uSaturate'), saturate ? 1 : 0);
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
    this.blurBackground(bgSource, blurRadius, params.mode === 1);

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

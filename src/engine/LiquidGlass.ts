// ─── Vertex shader ───────────────────────────────────────────────────────────
const VERT_SRC = `
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vUV;
varying vec2 vScreenUV;

void main() {
  vUV = aTexCoord;
  vScreenUV = aPosition * 0.5 + 0.5;
  vScreenUV.y = 1.0 - vScreenUV.y;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// ─── Fragment shader ──────────────────────────────────────────────────────────
// Implements all Liquid Glass passes:
//   1. Background blur (5×5 box, saturation boost)
//   2. Chromatic aberration (per-channel UV offset based on edge distance)
//   3. Glass tint overlay
//   4. Specular highlight (gamma-sharpened, directional)
//   5. Secondary top-edge specular (characteristic of Apple glass)
//   6. Fresnel rim (edge-based, directional)
//   7. Inner shadow (radial dark vignette at edges)
//   8. Border glow (alpha-gradient edge detection)
//   9. Dark / mono mode adjustments
const FRAG_SRC = `
precision mediump float;

varying vec2 vUV;
varying vec2 vScreenUV;

uniform sampler2D uLayerTex;
uniform sampler2D uBackgroundTex;

uniform float uBlur;           // 0-1 → background blur strength
uniform float uTranslucency;   // 0-1 → how much bg shows through
uniform float uSpecular;       // 0-1 → specular intensity (0 = disabled)
uniform vec2  uLightDir;       // normalized: light comes FROM this direction
uniform float uOpacity;        // 0-1
uniform int   uMode;           // 0=default 1=dark 2=mono
uniform float uDarkAdjust;     // 0-1
uniform float uMonoAdjust;     // 0-1
uniform float uAberration;     // 0-1 → chromatic aberration strength

// ── Helpers ──────────────────────────────────────────────────────────────────

// 5×5 box blur on a texture, with 40% saturation boost
vec4 blurAndSaturate(sampler2D tex, vec2 uv, float radius) {
  if (radius < 0.001) {
    vec4 c = texture2D(tex, uv);
    float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = mix(vec3(g), c.rgb, 1.4);
    return c;
  }
  float s = radius * 0.010;
  vec4 sum = vec4(0.0);
  for (float dx = -2.0; dx <= 2.0; dx += 1.0) {
    for (float dy = -2.0; dy <= 2.0; dy += 1.0) {
      sum += texture2D(tex, clamp(uv + vec2(dx, dy) * s, 0.001, 0.999));
    }
  }
  vec4 blurred = sum / 25.0;
  // Saturation boost: glass picks up vivid background colour
  float gray = dot(blurred.rgb, vec3(0.299, 0.587, 0.114));
  blurred.rgb = mix(vec3(gray), blurred.rgb, 1.40);
  return clamp(blurred, 0.0, 1.0);
}

// Detect silhouette edge: returns 1.0 at the boundary of the layer alpha
float edgeDetect(sampler2D tex, vec2 uv) {
  float step = 0.007;
  float c  = texture2D(tex, uv).a;
  float up = texture2D(tex, uv + vec2(0.0,  step)).a;
  float dn = texture2D(tex, uv + vec2(0.0, -step)).a;
  float lt = texture2D(tex, uv + vec2(-step, 0.0)).a;
  float rt = texture2D(tex, uv + vec2( step, 0.0)).a;
  float minN = min(min(up, dn), min(lt, rt));
  // We are on an edge if we are opaque and at least one neighbour is transparent
  return smoothstep(0.5, 0.0, minN) * c;
}

// ── Main ──────────────────────────────────────────────────────────────────────
void main() {
  vec4 layerColor = texture2D(uLayerTex, vUV);
  if (layerColor.a < 0.01) { gl_FragColor = vec4(0.0); return; }

  vec2 fromCenter = vUV - 0.5;
  float distFromCenter = length(fromCenter);        // 0=center  ~0.7=corner
  vec2  normDir = distFromCenter > 0.001 ? normalize(fromCenter) : vec2(0.0);

  // ── PASS 1 + 2: Background blur with chromatic aberration ────────────────
  float blurStr = uBlur * 0.55;

  // Aberration: channels diverge more at the silhouette edge
  float edgeFactor = clamp(distFromCenter * 1.8, 0.0, 1.0);
  float chromaOffset = edgeFactor * uAberration * 0.012;

  vec2 uvR = clamp(vScreenUV + normDir * chromaOffset,        0.001, 0.999);
  vec2 uvG = vScreenUV;
  vec2 uvB = clamp(vScreenUV - normDir * chromaOffset * 1.3,  0.001, 0.999);

  float rr = blurAndSaturate(uBackgroundTex, uvR, blurStr).r;
  float gg = blurAndSaturate(uBackgroundTex, uvG, blurStr).g;
  float bb = blurAndSaturate(uBackgroundTex, uvB, blurStr).b;
  vec4 bgBlurred = vec4(rr, gg, bb, 1.0);

  // ── PASS 3: Glass tint overlay ────────────────────────────────────────────
  vec4 glassTint = (uMode == 1)
    ? vec4(0.04, 0.04, 0.07, 1.0)   // dark: blue-black tint
    : vec4(0.96, 0.97, 1.00, 1.0);  // light: cool white tint

  vec4 glassBase = mix(glassTint, bgBlurred, clamp(uTranslucency * 1.2, 0.0, 1.0));

  // Blend glass base with original layer colour
  vec4 result = mix(layerColor, glassBase, uTranslucency * 0.80);

  // ── PASS 4 + 5: Specular highlight ───────────────────────────────────────
  if (uSpecular > 0.0) {
    // Primary: focused bright spot at the lit corner
    // uLightDir points FROM the light, so litPos is in the opposite direction
    vec2 litPos = vec2(0.5) - uLightDir * 0.32;
    float dLit = length(vUV - litPos);
    // Gamma-sharpened (exponent=5): crisp but smooth highlight
    float spec = pow(max(0.0, 1.0 - dLit / 0.65), 5.0);

    // Secondary: top-edge strip (curved glass characteristic)
    float topEdge   = smoothstep(0.28, 0.02, abs(vUV.y - 0.86));
    float topFalloff = smoothstep(0.60, 0.0, dLit);
    float topSpec   = topEdge * topFalloff;

    float totalSpec = spec * 0.70 + topSpec * 0.55;
    vec3  specColor = vec3(0.96, 0.98, 1.00); // slightly cool white
    result.rgb += totalSpec * uSpecular * specColor;
  }

  // ── PASS 6: Fresnel rim light ─────────────────────────────────────────────
  {
    // Fresnel: strongest at edges, falls off towards centre
    float fresnel = distFromCenter * 2.0;        // 0→centre, 1→edge
    fresnel = clamp(fresnel, 0.0, 1.0);
    fresnel = fresnel * fresnel;                 // square for tighter edge

    // Directional modulation: lit side is brighter
    float litSide = (uSpecular > 0.0)
      ? max(0.0, dot(normDir, -uLightDir)) * 0.5 + 0.55
      : 0.75;

    float rim = fresnel * litSide * 0.38;
    result.rgb += rim;
  }

  // ── PASS 7: Inner shadow ──────────────────────────────────────────────────
  {
    // Soft dark vignette near the silhouette, fading to transparent at centre
    float innerS = smoothstep(0.35, 0.52, distFromCenter);
    float shadowStrength = (uMode == 1) ? 0.45 : 0.18;
    result.rgb = mix(result.rgb, result.rgb * 0.25, innerS * shadowStrength);
  }

  // ── PASS 8: Border glow ───────────────────────────────────────────────────
  {
    float edge = edgeDetect(uLayerTex, vUV);

    // Directional: lit side of border is brighter
    float borderBright = (uSpecular > 0.0)
      ? max(0.0, dot(normDir, -uLightDir)) * 0.55 + 0.45
      : 0.70;

    result.rgb += edge * borderBright * 0.90;
  }

  // ── PASS 9: Dark / Mono mode adjustments ─────────────────────────────────
  if (uMode == 1 && uDarkAdjust > 0.0) {
    result.rgb = mix(result.rgb, result.rgb * 0.40 + vec3(0.02, 0.02, 0.05), uDarkAdjust);
  } else if (uMode == 2 && uMonoAdjust > 0.0) {
    float gray = dot(result.rgb, vec3(0.299, 0.587, 0.114));
    result.rgb = mix(result.rgb, vec3(gray), uMonoAdjust);
  }

  result.a = layerColor.a * uOpacity;
  gl_FragColor = clamp(result, 0.0, 1.0);
}
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiquidGlassParams {
  blur: number;             // 0-1
  translucency: number;     // 0-1
  specular: boolean;
  specularIntensity: number; // 0-1
  lightAngle: number;       // degrees
  opacity: number;          // 0-1
  mode: 0 | 1 | 2;         // 0=default, 1=dark, 2=mono
  darkAdjust: number;
  monoAdjust: number;
  aberration: number;       // 0-1 → chromatic aberration strength
}

// ─── WebGL helpers ────────────────────────────────────────────────────────────

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER,   VERT_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

function uploadTexture(gl: WebGLRenderingContext, tex: WebGLTexture, source: TexImageSource) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// ─── Renderer class ───────────────────────────────────────────────────────────

export class LiquidGlassRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private posBuffer: WebGLBuffer;
  private uvBuffer: WebGLBuffer;
  private layerTex: WebGLTexture;
  private bgTex: WebGLTexture;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', {
      premultipliedAlpha: false,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;

    this.program = createProgram(gl);

    const positions = new Float32Array([-1, -1,  1, -1, -1, 1,  1, 1]);
    const uvs       = new Float32Array([ 0,  1,  1,  1,  0, 0,  1, 0]);

    this.posBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    this.uvBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    this.layerTex = gl.createTexture()!;
    this.bgTex    = gl.createTexture()!;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  render(layerSource: TexImageSource, bgSource: TexImageSource, params: LiquidGlassParams) {
    const { gl, program } = this;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);
    uploadTexture(gl, this.layerTex, layerSource);
    gl.uniform1i(gl.getUniformLocation(program, 'uLayerTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    uploadTexture(gl, this.bgTex, bgSource);
    gl.uniform1i(gl.getUniformLocation(program, 'uBackgroundTex'), 1);

    gl.uniform1f(gl.getUniformLocation(program, 'uBlur'),        params.blur);
    gl.uniform1f(gl.getUniformLocation(program, 'uTranslucency'), params.translucency);
    gl.uniform1f(gl.getUniformLocation(program, 'uSpecular'),    params.specular ? params.specularIntensity : 0.0);
    gl.uniform1f(gl.getUniformLocation(program, 'uOpacity'),     params.opacity);
    gl.uniform1i(gl.getUniformLocation(program, 'uMode'),        params.mode);
    gl.uniform1f(gl.getUniformLocation(program, 'uDarkAdjust'),  params.darkAdjust);
    gl.uniform1f(gl.getUniformLocation(program, 'uMonoAdjust'),  params.monoAdjust);
    gl.uniform1f(gl.getUniformLocation(program, 'uAberration'),  params.aberration);

    const angleRad = (params.lightAngle * Math.PI) / 180;
    gl.uniform2f(
      gl.getUniformLocation(program, 'uLightDir'),
      Math.cos(angleRad),
      Math.sin(angleRad),
    );

    const posLoc = gl.getAttribLocation(program, 'aPosition');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uvLoc = gl.getAttribLocation(program, 'aTexCoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const { gl } = this;
    gl.deleteTexture(this.layerTex);
    gl.deleteTexture(this.bgTex);
    gl.deleteBuffer(this.posBuffer);
    gl.deleteBuffer(this.uvBuffer);
    gl.deleteProgram(this.program);
  }
}

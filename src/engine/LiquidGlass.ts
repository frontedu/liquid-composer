// ─── WebGL2 Liquid Glass Renderer ────────────────────────────────────────────
//
// Multi-pass pipeline:
//   Pass 1: Horizontal separable Gaussian blur  (bg → FBO_A)
//   Pass 2: Vertical separable Gaussian blur    (FBO_A → FBO_B)
//   Pass 3: Glass composite with physical lighting (layer + FBO_B + bg → output)

import VERT_SRC  from './shaders/vertex.vert.glsl';
import BLUR_SRC  from './shaders/blur.frag.glsl';
import GLASS_SRC from './shaders/liquidGlass.frag.glsl';

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

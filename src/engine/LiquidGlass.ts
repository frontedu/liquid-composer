import VERT_SRC  from './shaders/vertex.vert.glsl?raw';
import BLUR_SRC  from './shaders/blur.frag.glsl?raw';
import GLASS_SRC from './shaders/liquidGlass.frag.glsl?raw';

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
  specularEdge: number;
  rimIntensity: number;
  envReflection: number;
  innerGlow: number;
  ambientRim: number;
  aoDarken: number;
  frostiness: number;
  refraction: number;        // 0-1
  bevel: number;             // fraction of size
  layerRect: [number, number, number, number]; // center x, y and half extents, in UV
}

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
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
}

function drawFullscreenQuad(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject) {
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

interface UniformCache {
  blur_uTex: WebGLUniformLocation | null;
  blur_uTexelSize: WebGLUniformLocation | null;
  blur_uRadius: WebGLUniformLocation | null;
  blur_uHorizontal: WebGLUniformLocation | null;
  blur_uSaturate: WebGLUniformLocation | null;
  glass_uLayerTex: WebGLUniformLocation | null;
  glass_uBlurredBgTex: WebGLUniformLocation | null;
  glass_uOrigBgTex: WebGLUniformLocation | null;
  glass_uParams1: WebGLUniformLocation | null;
  glass_uParams2: WebGLUniformLocation | null;
  glass_uParams3: WebGLUniformLocation | null;
  glass_uParams4: WebGLUniformLocation | null;
  glass_uParams5: WebGLUniformLocation | null;
  glass_uTexelSize: WebGLUniformLocation | null;
  glass_uLightDir: WebGLUniformLocation | null;
  glass_uLayerRect: WebGLUniformLocation | null;
}

export class LiquidGlassRenderer {
  private gl: WebGL2RenderingContext;
  private blurProg: WebGLProgram;
  private glassProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uniforms: UniformCache;

  // Ping-pong FBOs for 2-pass blur
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private fboA: WebGLFramebuffer;
  private fboB: WebGLFramebuffer;

  private layerTex: WebGLTexture;
  private origBgTex: WebGLTexture;
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;

  private size: number;
  private blurSize: number;
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
    this.size = canvas.width;
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (this.size > maxTexture) throw new Error(`Render size ${this.size} exceeds MAX_TEXTURE_SIZE ${maxTexture}`);
    this.canvas = canvas;

    this.blurProg  = createProgram(gl, BLUR_SRC);
    this.glassProg = createProgram(gl, GLASS_SRC);

    this.uniforms = {
      blur_uTex:        gl.getUniformLocation(this.blurProg,  'uTex'),
      blur_uTexelSize:  gl.getUniformLocation(this.blurProg,  'uTexelSize'),
      blur_uRadius:     gl.getUniformLocation(this.blurProg,  'uRadius'),
      blur_uHorizontal: gl.getUniformLocation(this.blurProg,  'uHorizontal'),
      blur_uSaturate:   gl.getUniformLocation(this.blurProg,  'uSaturate'),
      glass_uLayerTex:     gl.getUniformLocation(this.glassProg, 'uLayerTex'),
      glass_uBlurredBgTex: gl.getUniformLocation(this.glassProg, 'uBlurredBgTex'),
      glass_uOrigBgTex:    gl.getUniformLocation(this.glassProg, 'uOrigBgTex'),
      glass_uParams1:      gl.getUniformLocation(this.glassProg, 'uParams1'),
      glass_uParams2:      gl.getUniformLocation(this.glassProg, 'uParams2'),
      glass_uParams3:      gl.getUniformLocation(this.glassProg, 'uParams3'),
      glass_uParams4:      gl.getUniformLocation(this.glassProg, 'uParams4'),
      glass_uParams5:      gl.getUniformLocation(this.glassProg, 'uParams5'),
      glass_uTexelSize:    gl.getUniformLocation(this.glassProg, 'uTexelSize'),
      glass_uLightDir:     gl.getUniformLocation(this.glassProg, 'uLightDir'),
      glass_uLayerRect:    gl.getUniformLocation(this.glassProg, 'uLayerRect'),
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

    const sz = Math.min(this.size, 1024);
    this.blurSize = sz;

    const hdrSupported = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));

    this.texA      = makeTexture(gl, sz, sz, hdrSupported);
    this.texB      = makeTexture(gl, sz, sz, hdrSupported);
    this.fboA      = makeFBO(gl, this.texA);
    this.fboB      = makeFBO(gl, this.texB);
    this.layerTex  = makeTexture(gl, this.size, this.size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.origBgTex = makeTexture(gl, this.size, this.size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

    const u = this.uniforms;
    gl.useProgram(this.blurProg);
    gl.uniform1i(u.blur_uTex, 0);
    gl.uniform2f(u.blur_uTexelSize, 1 / sz, 1 / sz);
    gl.useProgram(this.glassProg);
    gl.uniform1i(u.glass_uLayerTex, 0);
    gl.uniform1i(u.glass_uBlurredBgTex, 1);
    gl.uniform1i(u.glass_uOrigBgTex, 2);
    gl.uniform2f(u.glass_uTexelSize, 1 / this.size, 1 / this.size);
  }

  private blurBackground(bgSource: TexImageSource, radius: number, saturate: boolean, bgKey: string) {
    if (bgKey && bgKey === this._lastBgKey) return;
    this._lastBgKey = bgKey;
    const { gl } = this;
    const sz = this.blurSize;
    radius *= sz / this.size;

    uploadSourceTexture(gl, this.origBgTex, bgSource);
    if (radius === 0) return;

    const u = this.uniforms;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, sz, sz);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.blurProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.origBgTex);
    gl.uniform1f(u.blur_uRadius, radius);
    gl.uniform1i(u.blur_uHorizontal, 1);
    gl.uniform1i(u.blur_uSaturate, 0);
    drawFullscreenQuad(gl, this.vao);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.uniform1i(u.blur_uHorizontal, 0);
    gl.uniform1i(u.blur_uSaturate, saturate ? 1 : 0);
    drawFullscreenQuad(gl, this.vao);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(layerSource: TexImageSource, bgSource: TexImageSource, params: LiquidGlassParams, bgKey = '') {
    const { gl } = this;
    const sz = this.size;

    // Compute blur radius in texel units (0 = no blur)
    const blurRadius = params.blur * sz * 0.028;

    const effectiveBgKey = bgKey ? `${bgKey}:${blurRadius.toFixed(2)}:${params.mode}` : '';
    this.blurBackground(bgSource, blurRadius, params.mode === 1, effectiveBgKey);

    uploadSourceTexture(gl, this.layerTex, layerSource);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, sz, sz);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.glassProg);

    const u = this.uniforms;
    const angleRad = (params.lightAngle * Math.PI) / 180;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.origBgTex);

    gl.uniform4f(u.glass_uParams1, params.blur, params.translucency, params.specular ? params.specularIntensity : 0.0, params.opacity);
    gl.uniform4f(u.glass_uParams2, params.darkAdjust, params.monoAdjust, params.aberration, params.mode);
    gl.uniform4f(u.glass_uParams3, params.specularEdge, params.rimIntensity, params.envReflection, params.innerGlow);
    gl.uniform4f(u.glass_uParams4, params.ambientRim, params.aoDarken, params.frostiness, params.refraction);
    const bevelTexels = Math.max(1, params.bevel * sz);
    gl.uniform4f(u.glass_uParams5, Math.log2(bevelTexels), bevelTexels, 0.0, 0.0);
    gl.uniform2f(u.glass_uLightDir, Math.cos(angleRad), Math.sin(angleRad));
    gl.uniform4f(u.glass_uLayerRect, ...params.layerRect);

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
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.uvBuf);
    gl.deleteVertexArray(this.vao);
  }
}

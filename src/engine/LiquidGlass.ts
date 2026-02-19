import type { Layer, BackgroundConfig, AppearanceMode } from '../types/index';

const VERT_SRC = `
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vUV;
varying vec2 vScreenUV;

void main() {
  vUV = aTexCoord;
  vScreenUV = aPosition * 0.5 + 0.5;
  vScreenUV.y = 1.0 - vScreenUV.y; // flip Y for WebGL→canvas coord alignment
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;

varying vec2 vUV;
varying vec2 vScreenUV;

uniform sampler2D uLayerTex;
uniform sampler2D uBackgroundTex;
uniform float uBlur;
uniform float uTranslucency;
uniform float uSpecular;
uniform vec2 uLightDir;
uniform float uOpacity;
uniform int uMode;
uniform float uDarkAdjust;
uniform float uMonoAdjust;

vec4 sampleBlurred(sampler2D tex, vec2 uv, float radius) {
  if (radius < 0.001) return texture2D(tex, uv);
  float step = radius * 0.015;
  vec4 sum = vec4(0.0);
  float count = 0.0;
  for (float dx = -2.0; dx <= 2.0; dx += 1.0) {
    for (float dy = -2.0; dy <= 2.0; dy += 1.0) {
      vec2 off = vec2(dx, dy) * step;
      sum += texture2D(tex, clamp(uv + off, 0.0, 1.0));
      count += 1.0;
    }
  }
  return sum / count;
}

float specularHighlight(vec2 uv, vec2 lightDir) {
  vec2 fromCenter = uv - 0.5;
  float dist = length(fromCenter);
  vec2 normal2D = length(fromCenter) > 0.001 ? normalize(fromCenter) : vec2(0.0);
  float rimFactor = smoothstep(0.15, 0.45, dist);
  float highlight = pow(max(dot(normal2D, normalize(lightDir)), 0.0), 4.0) * rimFactor;
  // Secondary highlight along top edge, characteristic of curved glass
  float topSpec = smoothstep(0.25, 0.0, abs(uv.y - 0.82)) * smoothstep(0.42, 0.08, dist);
  return highlight * 0.55 + topSpec * 0.45;
}

void main() {
  vec4 layerColor = texture2D(uLayerTex, vUV);
  if (layerColor.a < 0.01) { gl_FragColor = vec4(0.0); return; }

  vec4 bgBlurred = sampleBlurred(uBackgroundTex, vScreenUV, uBlur);

  vec4 glassTint = vec4(1.0, 1.0, 1.0, 0.12);
  vec4 result = mix(glassTint, bgBlurred, uTranslucency);
  result = mix(layerColor, result, uTranslucency * layerColor.a);

  if (uSpecular > 0.0) {
    float spec = specularHighlight(vUV, uLightDir);
    vec3 specColor = vec3(0.95, 0.97, 1.0);
    result.rgb += spec * uSpecular * specColor * 0.6;
  }

  if (uMode == 1) {
    result.rgb = mix(result.rgb, result.rgb * 0.4 + vec3(0.03, 0.03, 0.06), uDarkAdjust);
  } else if (uMode == 2) {
    float gray = dot(result.rgb, vec3(0.299, 0.587, 0.114));
    result.rgb = mix(result.rgb, vec3(gray), uMonoAdjust);
  }

  vec2 fc = vUV - 0.5;
  float edge = smoothstep(0.25, 0.5, length(fc));
  result.rgb += edge * 0.08;

  result.a = layerColor.a * uOpacity;
  gl_FragColor = clamp(result, 0.0, 1.0);
}
`;

export interface LiquidGlassParams {
  blur: number;          // 0-1
  translucency: number;  // 0-1
  specular: boolean;
  specularIntensity: number; // 0-1
  lightAngle: number;    // degrees
  opacity: number;       // 0-1
  mode: 0 | 1 | 2;      // 0=default, 1=dark, 2=mono
  darkAdjust: number;
  monoAdjust: number;
}

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
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
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

export class LiquidGlassRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private posBuffer: WebGLBuffer;
  private uvBuffer: WebGLBuffer;
  private layerTex: WebGLTexture;
  private bgTex: WebGLTexture;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;

    this.program = createProgram(gl);

    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const uvs = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);

    this.posBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    this.uvBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    this.layerTex = gl.createTexture()!;
    this.bgTex = gl.createTexture()!;

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

    gl.uniform1f(gl.getUniformLocation(program, 'uBlur'), params.blur);
    gl.uniform1f(gl.getUniformLocation(program, 'uTranslucency'), params.translucency);
    gl.uniform1f(gl.getUniformLocation(program, 'uSpecular'), params.specular ? params.specularIntensity : 0);
    gl.uniform1f(gl.getUniformLocation(program, 'uOpacity'), params.opacity);
    gl.uniform1i(gl.getUniformLocation(program, 'uMode'), params.mode);
    gl.uniform1f(gl.getUniformLocation(program, 'uDarkAdjust'), params.darkAdjust);
    gl.uniform1f(gl.getUniformLocation(program, 'uMonoAdjust'), params.monoAdjust);

    const angleRad = (params.lightAngle * Math.PI) / 180;
    gl.uniform2f(
      gl.getUniformLocation(program, 'uLightDir'),
      Math.cos(angleRad),
      Math.sin(angleRad)
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

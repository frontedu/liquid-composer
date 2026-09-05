#version 300 es
precision highp float;

in vec2 vUV;

uniform sampler2D uTex;
uniform vec2  uTexelSize;   // 1.0 / textureSize
uniform float uRadius;      // blur radius in texel units
uniform bool  uHorizontal;
uniform bool  uSaturate;

out vec4 fragColor;

const int MAX_TAPS = 24;    // per side

vec3 toLinear(vec3 srgb) { vec3 s = max(srgb, 0.0); return s * s; }

vec4 fetch(vec2 uv) {
  vec4 s = texture(uTex, clamp(uv, 0.0005, 0.9995));
  if (uHorizontal) s.rgb = toLinear(s.rgb);  // only decode sRGB on pass 1
  return s;
}

void main() {
  if (uRadius < 0.5) {
    fragColor = fetch(vUV);
    return;
  }
  float sigma  = uRadius * 0.5;
  float span   = ceil(sigma * 3.0);
  float stride = max(1.0, ceil(span / float(MAX_TAPS)));
  int   taps   = int(min(span / stride, float(MAX_TAPS)));
  float coeff  = -0.5 / (sigma * sigma);
  vec2  dir    = uHorizontal ? vec2(uTexelSize.x, 0.0) : vec2(0.0, uTexelSize.y);

  vec4  sum  = fetch(vUV);
  float wsum = 1.0;
  for (int i = 1; i <= MAX_TAPS; i++) {
    if (i > taps) break;
    float x = float(i) * stride;
    float w = exp(x * x * coeff);
    vec2 off = dir * x;
    sum  += (fetch(vUV + off) + fetch(vUV - off)) * w;
    wsum += 2.0 * w;
  }
  sum /= wsum;

  if (uSaturate) {
    float gray = dot(sum.rgb, vec3(0.299, 0.587, 0.114));
    float satBoost = 1.0 + clamp(uRadius / 8.0, 0.0, 1.0) * 0.5;  // 1.0..1.5
    sum.rgb = mix(vec3(gray), sum.rgb, satBoost);
  }
  fragColor = sum;
}

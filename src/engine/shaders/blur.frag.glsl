#version 300 es
precision highp float;

in vec2 vUV;

uniform sampler2D uTex;
uniform vec2  uTexelSize;   // 1.0 / textureSize
uniform float uRadius;      // blur radius in texel units
uniform bool  uHorizontal;
uniform bool  uSaturate;

out vec4 fragColor;

// Fast sRGB→linear approximation (x^2 ≈ x^2.2, avoids costly pow())
// Only needed on horizontal pass — vertical pass receives data already in linear space.
vec3 toLinear(vec3 srgb) { vec3 s = max(srgb, 0.0); return s * s; }

// 9-tap weights (symmetric, normalised so sum = 1)
const float W[9] = float[](0.028, 0.067, 0.124, 0.179, 0.204, 0.179, 0.124, 0.067, 0.028);

void main() {
  if (uRadius < 0.5) {
    vec4 s = texture(uTex, vUV);
    if (uHorizontal) s.rgb = toLinear(s.rgb);  // only decode sRGB on pass 1
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
    // Pass 1 (horizontal): decode sRGB → linear for correct blending.
    // Pass 2 (vertical): input is already linear from HDR FBO — skip decode.
    if (uHorizontal) s.rgb = toLinear(s.rgb);
    sum += s * W[i];
  }
  // Keep output in LINEAR space — glass composite expects linear input.
  // Saturation boost: glass picks up vivid background colour.
  // Adaptive to blur radius — stronger blur = more desaturation = more compensation.
  // Only applies if uSaturate is true (dark mode).
  if (uSaturate) {
    float gray = dot(sum.rgb, vec3(0.299, 0.587, 0.114));
    float satBoost = 1.0 + clamp(uRadius / 8.0, 0.0, 1.0) * 0.5;  // 1.0..1.5
    sum.rgb = mix(vec3(gray), sum.rgb, satBoost);
  }
  fragColor = sum; // linear output (no clamping — HDR FBO accepts >1.0)
}

#version 300 es
precision highp float;

#define MAX_BLUR_RADIUS 128

in vec2 v_uv;

uniform sampler2D u_inputTex;
uniform vec2 u_resolution;
uniform int u_blurRadius;
uniform float u_blurWeights[MAX_BLUR_RADIUS + 1];

out vec4 fragColor;

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec4 color = texture(u_inputTex, v_uv) * u_blurWeights[0];

  for (int i = 1; i <= u_blurRadius; ++i) {
    float w = u_blurWeights[i];
    float offset = float(i) * texelSize.x;
    color += texture(u_inputTex, v_uv + vec2(offset, 0.0)) * w;
    color += texture(u_inputTex, v_uv - vec2(offset, 0.0)) * w;
  }

  fragColor = color;
}

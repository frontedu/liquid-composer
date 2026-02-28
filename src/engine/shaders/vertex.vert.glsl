#version 300 es
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

attribute vec2 aPosition;
attribute vec2 aTexCoord;

varying vec2 vUV;
varying vec2 vScreenUV;

uniform vec2 uResolution;

void main() {
  vUV = aTexCoord;
  vScreenUV = (aPosition * 0.5 + 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}

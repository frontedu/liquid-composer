precision mediump float;

varying vec2 vUV;
varying vec2 vScreenUV;

uniform sampler2D uLayerTex;
uniform sampler2D uBackgroundTex;
uniform float uBlur;         // 0.0 - 1.0
uniform float uTranslucency; // 0.0 - 1.0
uniform float uSpecular;     // 0.0 - 1.0
uniform vec2 uLightDir;      // normalized light direction
uniform float uOpacity;      // 0.0 - 1.0
uniform int uMode;           // 0=default, 1=dark, 2=mono
uniform float uDarkAdjust;   // 0.0 - 1.0
uniform float uMonoAdjust;   // 0.0 - 1.0

// Simple box blur approximation using 9 samples
vec4 sampleBlurred(sampler2D tex, vec2 uv, float radius) {
  if (radius < 0.001) return texture2D(tex, uv);

  float step = radius * 0.02;
  vec4 sum = vec4(0.0);
  float count = 0.0;

  for (float dx = -2.0; dx <= 2.0; dx += 1.0) {
    for (float dy = -2.0; dy <= 2.0; dy += 1.0) {
      vec2 offset = vec2(dx, dy) * step;
      sum += texture2D(tex, uv + offset);
      count += 1.0;
    }
  }
  return sum / count;
}

// Calculate specular highlight from light direction and surface normal
float specularHighlight(vec2 uv, vec2 lightDir) {
  // Approximate surface normal from UV (we treat corners as raised)
  vec2 center = vec2(0.5);
  vec2 fromCenter = uv - center;

  // Fake normal based on radial distance + squircle shape
  float dist = length(fromCenter);
  vec2 normal2D = normalize(fromCenter + vec2(0.0001));

  // Rim lighting: specular at edges
  float rimFactor = smoothstep(0.2, 0.5, dist);

  // Highlight direction dot product
  float highlight = max(dot(normal2D, normalize(lightDir)), 0.0);
  highlight = pow(highlight, 4.0) * rimFactor;

  // Top-edge specular highlight (frosted glass characteristic)
  float topSpec = smoothstep(0.3, 0.0, abs(uv.y - 0.85)) * smoothstep(0.4, 0.1, dist);

  return highlight * 0.6 + topSpec * 0.4;
}

void main() {
  vec4 layerColor = texture2D(uLayerTex, vUV);

  // Only process visible pixels
  if (layerColor.a < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // 1. Blurred background (frosted glass base)
  vec4 bgBlurred = sampleBlurred(uBackgroundTex, vScreenUV, uBlur);

  // 2. Translucency blend: mix layer with blurred background
  vec4 result = mix(layerColor, bgBlurred, uTranslucency * layerColor.a);

  // 3. Specular highlights
  if (uSpecular > 0.0) {
    float spec = specularHighlight(vUV, uLightDir);
    vec3 specColor = mix(vec3(1.0), vec3(0.8, 0.9, 1.0), 0.3); // slight blue tint
    result.rgb += spec * uSpecular * specColor * 0.5;
  }

  // 4. Appearance mode adjustments
  if (uMode == 1) {
    // Dark mode: darken the glass
    result.rgb = mix(result.rgb, result.rgb * 0.3, uDarkAdjust);
    result.rgb += vec3(0.05, 0.05, 0.08); // slight blue tint for glass in dark
  } else if (uMode == 2) {
    // Mono mode: desaturate
    float gray = dot(result.rgb, vec3(0.299, 0.587, 0.114));
    result.rgb = mix(result.rgb, vec3(gray), uMonoAdjust);
  }

  // 5. Glass edge brightening (characteristic of real glass)
  vec2 fromCenter = vUV - 0.5;
  float edge = smoothstep(0.3, 0.5, length(fromCenter));
  result.rgb = mix(result.rgb, result.rgb * 1.15, edge * 0.3);

  result.a = layerColor.a * uOpacity;

  gl_FragColor = clamp(result, 0.0, 1.0);
}

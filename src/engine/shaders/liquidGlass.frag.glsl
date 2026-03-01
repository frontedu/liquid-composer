#version 300 es
precision highp float;

// [A] SPECULAR — bright spot at the lit corner edge
const float GL_SPECULAR_EDGE  = 0.22; // specular intensity clipped to edge ring
const float GL_RIM_INTENSITY  = 0.28; // Fresnel rim brightness (grazing angle glow)
const float GL_RIM_POWER      = 2.4;  // rim falloff — higher = thinner rim
const float GL_RIM_NDOT_POWER = 3.0;  // rim light-angle response — higher = more directional
// [C] ENVIRONMENT REFLECTION — glass surface reflecting ambient surroundings
const float GL_ENV_FRESNEL    = 0.14; // reflection strength at grazing angles
// [D] INNER GLOW — warm/cool luminous band just inside the edge
const float GL_INNER_GLOW     = 0.22; // glow intensity
// [E] AMBIENT RIM — background color bleeding into the shadow-side edge
const float GL_AMBIENT_RIM    = 0.55; // bg color intensity on shadow rim
const float GL_AMBIENT_SAT    = 2.65; // saturation boost of the bg color sample
// [F] VOLUMETRIC DEPTH
const float GL_AO_DARKEN      = 0.58; // ambient occlusion darkening (lower = darker)
const float GL_FROSTINESS     = 0.35; // how much blur makes glass milky/opaque
// =============================================================================

in vec2 vUV;
in vec2 vScreenUV;

uniform sampler2D uLayerTex;       // layer content (alpha = glass mask)
uniform sampler2D uBlurredBgTex;   // 2-pass Gaussian blurred background
uniform sampler2D uOrigBgTex;      // original (sharp) background

uniform vec4  uParams1;            // x=blur, y=translucency, z=specular, w=opacity
uniform vec4  uParams2;            // x=darkAdjust, y=monoAdjust, z=aberration, w=mode
uniform vec2  uLightDir;           // normalised, FROM light source
uniform vec2  uTexelSize;          // 1/resolution

out vec4 fragColor;

// ── Color space conversion (~95% accurate gamma, avoids costly pow) ──────────
vec3 toLinear(vec3 srgb) { vec3 s = max(srgb, 0.0); return s * s; }
vec3 toSRGB(vec3 lin)    { return sqrt(max(lin, 0.0)); }

// ACES filmic tone mapping (fits HDR values into [0,1] with natural highlights)
vec3 acesToneMap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

float sampleAlpha(vec2 uv) {
  return texture(uLayerTex, uv).a;
}

// Surface normal from alpha gradient via finite differences.
// Returns the RAW (non-normalised) gradient — its length encodes edge strength.
vec2 alphaGradient(vec2 uv) {
  vec2 e = uTexelSize * 2.0;
  float aR = sampleAlpha(uv + vec2(e.x, 0.0));
  float aL = sampleAlpha(uv - vec2(e.x, 0.0));
  float aU = sampleAlpha(uv + vec2(0.0, e.y));
  float aD = sampleAlpha(uv - vec2(0.0, e.y));
  return vec2(aR - aL, aU - aD) * 0.5;
}

// Edge magnitude: smooth falloff from edge using screen-space derivatives.
float edgeMagnitude(float alpha) {
  vec2 d = vec2(dFdx(alpha), dFdy(alpha));
  float w = length(d);
  float px = max(uTexelSize.x, uTexelSize.y);
  return smoothstep(0.0, px * 1.25, w);
}

// ── Main ─────────────────────────────────────────────────────────────────────
void main() {
  float alpha = sampleAlpha(vUV);
  if (alpha < 0.01) { fragColor = vec4(0.0); return; }

  // Internal smart constants for maximum quality (not exposed as uniforms)
  const float uThickness = 0.65;
  const float uStrength  = 0.72;

  // Surface gradient and edge strength
  vec2  grad     = alphaGradient(vUV);
  float gradLen  = length(grad);
  vec2  normal   = gradLen > 0.001 ? grad / gradLen : vec2(0.0);

  float thicknessScale = 1.0 + uThickness * 3.0;
  float normalLen = clamp(gradLen * 3.4 * thicknessScale, 0.0, 1.0);
  float edge     = edgeMagnitude(alpha);

  // Corner proximity for corner-boost refraction
  float cornerProx  = min(vUV.x, 1.0 - vUV.x) * min(vUV.y, 1.0 - vUV.y);
  float cornerBoost = exp(-cornerProx * 40.0) * 0.5;

  // Edge / Rim / Base intensity zones
  float edgeZone = edge;
  float rimZone  = smoothstep(0.08, 0.80, normalLen);
  float baseZone = 1.0 - normalLen;

  // Light direction in UV space (Y flipped — UV is Y-down, math is Y-up)
  vec2 litDir = vec2(uLightDir.x, -uLightDir.y);

  vec2  fromCenter   = vUV - 0.5;
  float dist         = length(fromCenter);
  vec2  normFromCtr  = dist > 0.001 ? normalize(fromCenter) : vec2(0.0);

  // ── 1. Base glass: blurred bg + tint ──────────────────────────────────────
  float magStrength = 0.008 * baseZone * uParams1.y;
  vec2  magUV       = vScreenUV + (vScreenUV - 0.5) * magStrength;

  float edgeBand  = pow(edge, 1.0) * smoothstep(0.06, 0.85, normalLen);
  vec2  aberrOff  = normal * edgeBand * uParams2.z * 0.010;
  float r = texture(uBlurredBgTex, clamp(magUV + aberrOff, 0.001, 0.999)).r;
  float g = texture(uBlurredBgTex, clamp(magUV,            0.001, 0.999)).g;
  float b = texture(uBlurredBgTex, clamp(magUV - aberrOff, 0.001, 0.999)).b;
  vec4 bgBlurred = vec4(r, g, b, 1.0);

  int mode = int(uParams2.w + 0.5);
  vec4 frostTint = (mode == 1) ? vec4(0.08, 0.08, 0.12, 1.0) : vec4(1.0);
  vec4 bgSharp   = texture(uOrigBgTex, clamp(magUV, 0.001, 0.999));
  bgSharp.rgb    = toLinear(bgSharp.rgb);
  vec4 bgBase    = mix(bgSharp, bgBlurred, clamp(uParams1.x, 0.0, 1.0));
  bgBase.rgb     = mix(bgBase.rgb, frostTint.rgb, uParams1.x * GL_FROSTINESS);

  vec4 layerColor = texture(uLayerTex, vUV);
  layerColor.rgb  = toLinear(layerColor.rgb);
  vec4 glassBase  = bgBase;

  float mask    = layerColor.a;
  float layerMix = (1.0 - uParams1.y) * mask;
  vec4 result   = mix(glassBase, layerColor, layerMix);

  // ── 2. Volumetric 3D Modeling (Cushion / AO) ──────────────────────────────
  {
    float shadowWeight = max(0.0, -dot(normal, litDir));
    float dome         = pow(1.0 - normalLen, 0.35);
    float ao           = mix(0.12, 0.55, shadowWeight) * dome;
    result.rgb        *= mix(1.0, GL_AO_DARKEN, ao);
  }

  // ── 3. Specular & Rim ──────────────────────────────────────────────────────
  if (uParams1.z > 0.0) {
    vec2  litPos  = vec2(0.5) + litDir * 0.48;
    float spec    = pow(max(0.0, 1.0 - length(vUV - litPos) / 0.22), 10.0);
    float ndotv   = max(0.0, -dot(normal, litDir));
    float rim     = pow(normalLen, GL_RIM_POWER) * pow(ndotv, GL_RIM_NDOT_POWER) * GL_RIM_INTENSITY;
    float edgeMask = smoothstep(0.35, 0.92, normalLen);
    float specEdge = spec * edgeMask * edgeBand;
    result.rgb    += (specEdge * GL_SPECULAR_EDGE + rim) * uParams1.z * vec3(1.0);
  }

  // ── 4. Environment reflection ──────────────────────────────────────────────
  {
    float envNdotL  = max(0.0, -dot(normal, litDir));
    vec3  envWarm   = vec3(1.00, 0.97, 0.92);
    vec3  envCool   = vec3(0.75, 0.80, 0.90);
    vec3  envColor  = mix(envCool, envWarm, envNdotL);
    float envFresnel   = normalLen * normalLen * GL_ENV_FRESNEL;
    float envIntensity = envFresnel * (uParams1.z > 0.0 ? uParams1.z : 0.3);
    if (mode == 1) {
      envColor      = mix(envColor, vec3(0.15, 0.18, 0.25), 0.6);
      envIntensity *= 0.5;
    }
    result.rgb += envColor * envIntensity;
  }

  // ── 5. Inner edge glow ────────────────────────────────────────────────────
  {
    float innerGlowFalloff = normalLen * exp(-normalLen * 0.55);
    float litWeight        = max(0.0, -dot(normal, litDir)) * 0.6 + 0.4;
    vec3  glowColor        = vec3(1.00, 0.96, 0.88);
    if (mode == 1) glowColor = vec3(0.40, 0.45, 0.60);
    result.rgb += glowColor * innerGlowFalloff * litWeight * GL_INNER_GLOW;
  }

  // ── 6. Ambient background rim (shadow side) ───────────────────────────────
  {
    float shadowRim = max(0.0, dot(normal, litDir));
    float rimBand   = pow(normalLen, 0.8) * shadowRim;
    vec3  bgColor   = toLinear(texture(uOrigBgTex, vUV).rgb);
    float bgGray    = dot(bgColor, vec3(0.299, 0.587, 0.114));
    bgColor         = mix(vec3(bgGray), bgColor, GL_AMBIENT_SAT);
    result.rgb     += bgColor * rimBand * GL_AMBIENT_RIM;
  }

  // ── 7. Light-angle content dimming ────────────────────────────────────────
  {
    float ndotFromCenter = dot(normFromCtr, litDir);
    float dimFactor      = 0.94 + ndotFromCenter * 0.06;
    result.rgb          *= mix(1.0, dimFactor, uParams1.y * 0.8);
  }

  // ── 8. Directional inner shadow ───────────────────────────────────────────
  {
    float shadowSide = max(0.0, dot(normal, litDir));
    float innerS     = smoothstep(0.18, 0.48, dist);
    float shadowStr  = ((mode == 1) ? 0.45 : 0.22) * (0.5 + uStrength * 0.5);
    result.rgb       = mix(result.rgb, result.rgb * 0.35, shadowSide * innerS * shadowStr * baseZone);
  }

  // ── 9. Appearance mode adjustments ────────────────────────────────────────
  if (mode == 1 && uParams2.x > 0.0) {
    result.rgb = mix(result.rgb, result.rgb * 0.38 + vec3(0.02, 0.02, 0.05), uParams2.x);
  } else if (mode == 2 && uParams2.y > 0.0) {
    float gray = dot(result.rgb, vec3(0.299, 0.587, 0.114));
    vec3  white = vec3(max(gray, 0.85));
    result.rgb = mix(result.rgb, white, uParams2.y);
  }

  // ── 10. Glass-aware bloom ─────────────────────────────────────────────────
  {
    float brightness     = dot(result.rgb, vec3(0.299, 0.587, 0.114));
    float bloomThreshold = 0.80;
    if (brightness > bloomThreshold) {
      float bloomAmount = (brightness - bloomThreshold) / (1.0 - bloomThreshold);
      float bloomEdge   = mix(rimZone, edgeZone, 0.3) * bloomAmount * 0.18;
      vec3  bloomColor  = result.rgb * 0.5 + vec3(0.5, 0.48, 0.44) * 0.5;
      result.rgb       += bloomColor * bloomEdge;
    }
  }

  // ── HDR tone mapping + sRGB conversion ────────────────────────────────────
  result.rgb = acesToneMap(result.rgb);
  result.rgb = toSRGB(result.rgb);

  result.a   = alpha * uParams1.w;
  fragColor  = clamp(result, 0.0, 1.0);
}

#version 300 es
precision highp float;

// [A] SPECULAR — bright spot at the lit corner edge
const float GL_RIM_POWER      = 2.4;  // rim falloff — higher = thinner rim
const float GL_RIM_NDOT_POWER = 3.0;
// [E] AMBIENT RIM — background color bleeding into the shadow-side edge
const float GL_AMBIENT_SAT    = 2.65; // saturation boost of the bg color sample

in vec2 vUV;
in vec2 vScreenUV;

uniform sampler2D uLayerTex;       // layer content (alpha = glass mask)
uniform sampler2D uBlurredBgTex;   // 2-pass Gaussian blurred background
uniform sampler2D uOrigBgTex;      // original (sharp) background

uniform vec4  uParams1;            // x=blur, y=translucency, z=specular, w=opacity
uniform vec4  uParams2;            // x=darkAdjust, y=monoAdjust, z=aberration, w=mode
uniform vec4  uParams3;            // x=specularEdge, y=rimIntensity, z=envReflection, w=innerGlow
uniform vec4  uParams4;            // x=ambientRim, y=aoDarken, z=frostiness, w=refraction
uniform vec4  uParams5;            // x=bevelLod, y=bevelTexels
uniform vec2  uLightDir;           // normalised, FROM light source
uniform vec2  uTexelSize;          // 1/resolution
uniform vec4  uLayerRect;          // xy=center, zw=half extents (UV)

out vec4 fragColor;

// ── Color space conversion (~95% accurate gamma, avoids costly pow) ──────────
vec3 toLinear(vec3 srgb) { vec3 s = max(srgb, 0.0); return s * s; }
vec3 toSRGB(vec3 lin)    { return sqrt(max(lin, 0.0)); }

float sampleAlpha(vec2 uv) {
  return texture(uLayerTex, uv).a;
}

vec2 alphaGradient(vec2 uv) {
  vec2 e = max(uTexelSize * 2.0, vec2(2.0 / 1536.0));
  float aR = sampleAlpha(uv + vec2(e.x, 0.0));
  float aL = sampleAlpha(uv - vec2(e.x, 0.0));
  float aU = sampleAlpha(uv + vec2(0.0, e.y));
  float aD = sampleAlpha(uv - vec2(0.0, e.y));
  return vec2(aR - aL, aU - aD) * 0.5;
}

float edgeMagnitude(float alpha) {
  vec2 d = vec2(dFdx(alpha), dFdy(alpha));
  float w = length(d);
  float px = max(uTexelSize.x, uTexelSize.y);
  return smoothstep(0.0, px * 1.25, w);
}

vec2 bevelGradient(vec2 uv, float lod, vec2 eps) {
  float aR = textureLod(uLayerTex, uv + vec2(eps.x, 0.0), lod).a;
  float aL = textureLod(uLayerTex, uv - vec2(eps.x, 0.0), lod).a;
  float aU = textureLod(uLayerTex, uv + vec2(0.0, eps.y), lod).a;
  float aD = textureLod(uLayerTex, uv - vec2(0.0, eps.y), lod).a;
  return vec2(aR - aL, aU - aD);
}

void main() {
  float alpha = sampleAlpha(vUV);
  float edge  = edgeMagnitude(alpha);
  if (alpha < 0.01) { fragColor = vec4(0.0); return; }

  vec2  grad     = alphaGradient(vUV);
  float gradLen  = length(grad);
  vec2  normal   = gradLen > 0.001 ? grad / gradLen : vec2(0.0);

  float normalLen = clamp(gradLen * 3.4 * 2.95, 0.0, 1.0);

  float edgeZone = edge;
  float rimZone  = smoothstep(0.08, 0.80, normalLen);
  float baseZone = 1.0 - normalLen;

  // ── Bevel field: coarse mip of the layer alpha ≈ distance to edge ─────────
  float bevelLod = uParams5.x;
  vec2  bevelEps = uParams5.y * 0.5 * uTexelSize;
  float aBevel   = textureLod(uLayerTex, vUV, bevelLod).a;
  vec2  gB       = bevelGradient(vUV, bevelLod, bevelEps);
  vec2  nIn      = length(gB) > 1e-4 ? normalize(gB) : vec2(0.0);   // points inward
  float tB       = clamp((aBevel - 0.5) * 2.0, 0.0, 1.0);          // 0 edge → 1 plateau
  float bevelF   = smoothstep(0.0, 1.0, 1.0 - smoothstep(0.0, 1.0, tB));

  vec2 litDir = vec2(uLightDir.x, -uLightDir.y);

  float ext          = max(uLayerRect.z, uLayerRect.w);
  vec2  fromCenter   = vUV - uLayerRect.xy;
  float dist         = length(fromCenter) * 0.5 / ext;
  vec2  normFromCtr  = dist > 0.001 ? normalize(fromCenter) : vec2(0.0);

  // ── 1. Base glass: Snell refraction through a squircle bevel ─────────────
  float uB    = 1.0 - tB;
  float u4    = uB * uB * uB * uB;
  float hB    = pow(1.0 - u4, 0.25);                                  // bevel height 0 edge → 1 plateau
  float slope = (uB * uB * uB) / max(pow(1.0 - u4, 0.75), 1e-3);
  vec3  N3    = normalize(vec3(-slope * nIn, 1.0));                   // tilts outward on the bevel
  vec3  R3    = refract(vec3(0.0, 0.0, -1.0), N3, 1.0 / 1.5);
  float bevelUV = uParams5.y * uTexelSize.x;
  vec2  dispUV  = (R3.xy / max(-R3.z, 0.05)) * (hB + 0.22) * bevelUV * uParams4.w;
  dispUV = clamp(dispUV, vec2(-bevelUV), vec2(bevelUV));

  float edgeBand = pow(edge, 1.0) * smoothstep(0.06, 0.85, normalLen);
  float ca  = uParams2.z * 0.25;
  vec2  uvR = clamp(vScreenUV + dispUV * (1.0 - ca), 0.001, 0.999);
  vec2  uvG = clamp(vScreenUV + dispUV,              0.001, 0.999);
  vec2  uvB = clamp(vScreenUV + dispUV * (1.0 + ca), 0.001, 0.999);
  vec4 bgBlurred = vec4(texture(uBlurredBgTex, uvR).r, texture(uBlurredBgTex, uvG).g, texture(uBlurredBgTex, uvB).b, 1.0);

  int mode = int(uParams2.w + 0.5);
  vec4 frostTint = (mode == 1) ? vec4(0.08, 0.08, 0.12, 1.0) : vec4(1.0);
  vec4 bgSharp   = vec4(textureLod(uOrigBgTex, uvR, 0.0).r, textureLod(uOrigBgTex, uvG, 0.0).g, textureLod(uOrigBgTex, uvB, 0.0).b, 1.0);
  bgSharp.rgb    = toLinear(bgSharp.rgb);
  vec4 bgBase    = mix(bgSharp, bgBlurred, clamp(uParams1.x, 0.0, 1.0) * (1.0 - 0.15 * bevelF));
  bgBase.rgb     = mix(bgBase.rgb, frostTint.rgb, uParams1.x * uParams4.z);

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
    result.rgb        *= mix(1.0, uParams4.y, ao);
  }

  vec3 base = result.rgb;
  vec3 hl   = vec3(0.0);

  // ── 3. Specular & Rim ──────────────────────────────────────────────────────
  if (uParams1.z > 0.0) {
    vec2  litPos  = uLayerRect.xy + litDir * 0.96 * uLayerRect.zw;
    float spec    = pow(max(0.0, 1.0 - length(vUV - litPos) / (0.44 * ext)), 10.0);
    float ndotv   = max(0.0, -dot(normal, litDir));
    float rim     = pow(normalLen, GL_RIM_POWER) * pow(ndotv, GL_RIM_NDOT_POWER) * uParams3.y;
    float edgeMask = smoothstep(0.35, 0.92, normalLen);
    float specEdge = spec * edgeMask * edgeBand;
    hl += (specEdge * uParams3.x + rim) * uParams1.z;
  }

  // ── 4. Environment reflection ──────────────────────────────────────────────
  {
    float envNdotL  = max(0.0, -dot(normal, litDir));
    vec3  envWarm   = vec3(1.00, 0.97, 0.92);
    vec3  envCool   = vec3(0.75, 0.80, 0.90);
    vec3  envColor  = mix(envCool, envWarm, envNdotL);
    float envFresnel   = normalLen * normalLen * uParams3.z;
    float envIntensity = envFresnel * (uParams1.z > 0.0 ? uParams1.z : 0.3);
    if (mode == 1) {
      envColor      = mix(envColor, vec3(0.15, 0.18, 0.25), 0.6);
      envIntensity *= 0.5;
    }
    hl += envColor * envIntensity;
  }

  // ── 5. Inner edge glow ────────────────────────────────────────────────────
  {
    float innerGlowFalloff = normalLen * exp(-normalLen * 0.55);
    float litWeight        = max(0.0, -dot(normal, litDir)) * 0.6 + 0.4;
    vec3  glowColor        = vec3(1.00, 0.96, 0.88);
    if (mode == 1) glowColor = vec3(0.40, 0.45, 0.60);
    hl += glowColor * innerGlowFalloff * litWeight * uParams3.w;
  }

  // ── 6. Ambient background rim (shadow side) ───────────────────────────────
  {
    float shadowRim = max(0.0, dot(normal, litDir));
    float rimBand   = pow(normalLen, 0.8) * shadowRim;
    vec3  bgColor   = toLinear(textureLod(uOrigBgTex, vUV, 0.0).rgb);
    float bgGray    = dot(bgColor, vec3(0.299, 0.587, 0.114));
    bgColor         = mix(vec3(bgGray), bgColor, GL_AMBIENT_SAT);
    hl += bgColor * rimBand * uParams4.x;
  }

  // ── 7. Light-angle content dimming ────────────────────────────────────────
  {
    float ndotFromCenter = dot(normFromCtr, litDir);
    float dimFactor      = 0.94 + ndotFromCenter * 0.06;
    base *= mix(1.0, dimFactor, uParams1.y * 0.8);
  }

  // ── 8. Directional inner shadow ───────────────────────────────────────────
  {
    float shadowSide = max(0.0, dot(normal, litDir));
    float innerS     = smoothstep(0.18, 0.48, dist);
    float shadowStr  = ((mode == 1) ? 0.45 : 0.22) * 0.86;
    base = mix(base, base * 0.35, shadowSide * innerS * shadowStr * baseZone);
  }

  // ── Combine: highlights screened over the base ───────────────────────────
  vec3 hlSoft = 1.0 - exp(-hl);
  result.rgb  = base + hlSoft * (1.0 - base);

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
      result.rgb += bloomColor * bloomEdge * (1.0 - result.rgb);
    }
  }

  // ── sRGB conversion ────────────────────────────────────────────────────────
  result.rgb = toSRGB(clamp(result.rgb, 0.0, 1.0));

  result.a   = alpha * uParams1.w;
  fragColor  = clamp(result, 0.0, 1.0);
}

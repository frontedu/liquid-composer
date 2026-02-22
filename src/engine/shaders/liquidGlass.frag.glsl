#version 300 es
precision highp float;

#define PI 3.14159265359

// Per-channel refractive indices for chromatic dispersion
const float N_R = 1.0 - 0.02;
const float N_G = 1.0;
const float N_B = 1.0 + 0.02;

in vec2 v_uv;

// Textures
uniform sampler2D u_layerTex;       // layer content (alpha = glass mask)
uniform sampler2D u_blurredBg;      // Gaussian-blurred background
uniform sampler2D u_bg;             // original (sharp) background

// Canvas / DPR
uniform vec2  u_resolution;         // canvas size in physical pixels
uniform float u_dpr;                // device pixel ratio

// Glass shape / SDF params
uniform float u_refThickness;       // SDF edge refraction thickness (px, ~80)
uniform float u_refFactor;          // refraction index (~1.3)
uniform float u_refDispersion;      // chromatic dispersion strength

// Fresnel params
uniform float u_fresnelRange;       // Fresnel falloff range
uniform float u_fresnelFactor;      // Fresnel overall intensity
uniform float u_fresnelHardness;    // Fresnel onset shift

// Glare params
uniform float u_glareRange;
uniform float u_glareConvergence;
uniform float u_glareOppositeFactor;
uniform float u_glareFactor;
uniform float u_glareHardness;
uniform float u_glareAngle;         // radians

// Glass tint
uniform vec4  u_tint;               // RGBA tint colour

// Legacy compat
uniform float u_opacity;
uniform float u_translucency;       // 0-1 mix between sharp and blurred bg inside glass

// Appearance
uniform int   u_mode;               // 0 = default, 1 = dark, 2 = clear

out vec4 fragColor;

// ─── SDF from alpha mask ──────────────────────────────────────────────────────
// We compute an approximate SDF from the layer's alpha channel. For each
// fragment we sample the alpha and its neighbours to compute:
//   • signed distance (negative = inside, positive = outside)
//   • gradient (surface normal direction)
//
// The alpha-based SDF is resolution-independent because the step sizes are
// normalised to physical pixels, and the mapping uses the actual alpha falloff
// rather than a fixed pixel radius.

float sampleAlpha(vec2 uv) {
  return texture(u_layerTex, uv).a;
}

// Compute signed distance from the alpha edge.
// Inside (alpha ≈ 1): negative distance  (how far from the edge into the shape)
// Outside (alpha ≈ 0): positive distance
// At the boundary (alpha ≈ 0.5): ~0
float alphaSDF(vec2 uv) {
  float a = sampleAlpha(uv);
  // Map alpha [0..1] to signed distance.
  // The key insight: we measure HOW MANY PIXELS from the edge we are by
  // sampling in a ring and finding the nearest edge crossing.
  // For performance we use a fast approximation: treat alpha as a linear
  // ramp around edges (anti-aliased content) and map 0.5 → 0 distance.

  // Quick path: fully transparent or fully opaque — use a multi-sample walk
  // to estimate pixel distance to the 0.5 isoline.
  if (a < 0.01) return 1.0;  // outside, far from edge

  // Estimate distance using neighbourhood gradient magnitude.
  // This converts alpha slope into pixel-space distance.
  vec2 texelSize = 1.0 / u_resolution;

  // Central-difference gradient of alpha
  float aR = sampleAlpha(uv + vec2(texelSize.x, 0.0));
  float aL = sampleAlpha(uv - vec2(texelSize.x, 0.0));
  float aU = sampleAlpha(uv + vec2(0.0, texelSize.y));
  float aD = sampleAlpha(uv - vec2(0.0, texelSize.y));

  vec2 grad = vec2(aR - aL, aU - aD) * 0.5;
  float gradMag = length(grad);

  // Distance from the 0.5 isoline in screen pixels
  // d ≈ (alpha - 0.5) / |∇alpha|  — but clamp to avoid divz
  float d;
  if (gradMag > 0.001) {
    d = -(a - 0.5) / gradMag;  // negative inside (a > 0.5 → d < 0)
  } else {
    // Flat region: very inside or very outside
    d = a > 0.5 ? -u_refThickness * 2.0 : u_refThickness * 2.0;
  }

  return d;
}

// Gradient of the SDF → surface normal
vec2 sdfNormal(vec2 uv) {
  vec2 texelSize = 1.0 / u_resolution;
  vec2 e = texelSize * 1.5;

  float dR = alphaSDF(uv + vec2(e.x, 0.0));
  float dL = alphaSDF(uv - vec2(e.x, 0.0));
  float dU = alphaSDF(uv + vec2(0.0, e.y));
  float dD = alphaSDF(uv - vec2(0.0, e.y));

  return vec2(dR - dL, dU - dD) / (2.0 * e);
}

// ─── Dispersion helper ────────────────────────────────────────────────────────
// Sample blurred+sharp bg with per-channel UV offset for chromatic dispersion
vec4 getTextureDispersion(
  vec2 offset,
  float dispersionStrength,
  float blurMix  // 0 = sharp bg, 1 = fully blurred
) {
  vec4 pixel = vec4(1.0);

  float bgR = mix(
    texture(u_bg, v_uv + offset * (1.0 - (N_R - 1.0) * dispersionStrength)).r,
    texture(u_blurredBg, v_uv + offset * (1.0 - (N_R - 1.0) * dispersionStrength)).r,
    blurMix
  );
  float bgG = mix(
    texture(u_bg, v_uv + offset * (1.0 - (N_G - 1.0) * dispersionStrength)).g,
    texture(u_blurredBg, v_uv + offset * (1.0 - (N_G - 1.0) * dispersionStrength)).g,
    blurMix
  );
  float bgB = mix(
    texture(u_bg, v_uv + offset * (1.0 - (N_B - 1.0) * dispersionStrength)).b,
    texture(u_blurredBg, v_uv + offset * (1.0 - (N_B - 1.0) * dispersionStrength)).b,
    blurMix
  );

  pixel.r = bgR;
  pixel.g = bgG;
  pixel.b = bgB;

  return pixel;
}

// ─── Angle helper ─────────────────────────────────────────────────────────────
float vec2ToAngle(vec2 v) {
  float angle = atan(v.y, v.x);
  if (angle < 0.0) angle += 2.0 * PI;
  return angle;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
void main() {
  float alpha = sampleAlpha(v_uv);

  // Early out for fully transparent pixels
  if (alpha < 0.01) {
    // Outside glass: pass through the original background
    fragColor = texture(u_bg, v_uv);
    return;
  }

  // Compute SDF distance in pixel-space units
  float sdfDist = alphaSDF(v_uv);   // negative = inside glass
  vec2  u_res1x = u_resolution / u_dpr;

  // Normalised distance from edge in pixels (positive inside glass)
  // nmerged mimics the reference: -1 * sdf * resolution1x.y
  float nmerged = -sdfDist;  // positive inside

  // ── Snell's Law refraction edge factor ──────────────────────────────────
  float x_R_ratio = 1.0 - nmerged / u_refThickness;
  float thetaI = asin(clamp(pow(clamp(x_R_ratio, 0.0, 1.0), 2.0), 0.0, 1.0));
  float thetaT = asin(clamp(1.0 / u_refFactor * sin(thetaI), -1.0, 1.0));
  float edgeFactor = -tan(thetaT - thetaI);

  // Deep inside the glass (past refThickness) → no refraction offset
  if (nmerged >= u_refThickness) {
    edgeFactor = 0.0;
  }

  // ── Compute surface normal ──────────────────────────────────────────────
  vec2 normal = sdfNormal(v_uv);
  float normalLen = length(normal);

  // ── Build the glass colour ──────────────────────────────────────────────
  vec4 outColor;

  if (edgeFactor <= 0.0) {
    // Deep interior: show blurred background with tint
    outColor = mix(texture(u_bg, v_uv), texture(u_blurredBg, v_uv), u_translucency);
    outColor = mix(outColor, vec4(u_tint.rgb, 1.0), u_tint.a * 0.8);
  } else {
    // Edge region: apply refraction + dispersion
    // Compute glass edge height for blur blending (0 at edge, 1 deep inside)
    float edgeH = clamp(nmerged / u_refThickness, 0.0, 1.0);

    // UV offset from refraction: normal × edgeFactor → UV displacement
    vec2 refractionOffset = -normal * edgeFactor * 0.05 * u_dpr *
      vec2(u_resolution.y / (u_res1x.x * u_dpr), 1.0);

    // Sample with chromatic dispersion
    float blurMix = mix(edgeH, 1.0, u_translucency);
    vec4 refractedPixel = getTextureDispersion(
      refractionOffset,
      u_refDispersion,
      blurMix
    );

    // Glass tint
    outColor = mix(refractedPixel, vec4(u_tint.rgb, 1.0), u_tint.a * 0.8);

    // ── Fresnel reflection ────────────────────────────────────────────────
    float fresnelFactor = clamp(
      pow(
        1.0 + sdfDist / 1500.0 * pow(500.0 / max(u_fresnelRange, 1.0), 2.0) + u_fresnelHardness,
        5.0
      ),
      0.0,
      1.0
    );

    outColor = mix(
      outColor,
      vec4(1.0),
      fresnelFactor * u_fresnelFactor * 0.7 * normalLen
    );

    // ── Directional glare ─────────────────────────────────────────────────
    float glareGeoFactor = clamp(
      pow(
        1.0 + sdfDist / 1500.0 * pow(500.0 / max(u_glareRange, 1.0), 2.0) + u_glareHardness,
        5.0
      ),
      0.0,
      1.0
    );

    float glareAngle = (vec2ToAngle(normalize(normal + vec2(0.0001))) - PI / 4.0 + u_glareAngle) * 2.0;
    int glareFarside = 0;

    if (
      (glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5)) ||
      glareAngle < PI * (0.0 - 0.5)
    ) {
      glareFarside = 1;
    }

    float glareAngleFactor =
      (0.5 + sin(glareAngle) * 0.5) *
      (glareFarside == 1 ? 1.2 * u_glareOppositeFactor : 1.2) *
      u_glareFactor;
    glareAngleFactor = clamp(pow(glareAngleFactor, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);

    outColor = mix(
      outColor,
      vec4(1.0),
      glareAngleFactor * glareGeoFactor * normalLen
    );
  }

  // ── Appearance mode adjustments ─────────────────────────────────────────
  if (u_mode == 1) {
    // Dark mode
    outColor.rgb = mix(outColor.rgb, outColor.rgb * 0.35 + vec3(0.02, 0.02, 0.05), 0.4);
  }

  // ── Anti-aliasing at glass boundary ─────────────────────────────────────
  // Smooth blend at the SDF boundary so edges aren't jagged
  float aaFactor = smoothstep(0.5, -0.5, sdfDist);
  vec4 bgPixel = texture(u_bg, v_uv);

  outColor = mix(bgPixel, outColor, aaFactor);
  outColor.a = aaFactor * u_opacity;

  fragColor = clamp(outColor, 0.0, 1.0);
}

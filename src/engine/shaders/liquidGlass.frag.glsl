#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

// ── Calibration ──
const float SDF_FIX = 16.0f;      // matches sdfSeed
const uint SDF_NONE = 65535u;
const vec2 RGSS4[4] = vec2[4](vec2(-0.125f, -0.375f), vec2(0.375f, -0.125f), vec2(-0.375f, 0.125f), vec2(0.125f, 0.375f));

in vec2 vUV;

uniform sampler2D uLayerTex;      // layer content (alpha = glass mask)
uniform sampler2D uBlurredBgTex;  // glass background, premultiplied, blurred
uniform sampler2D uOrigBgTex;     // original (sharp) background
uniform sampler2D uShadowTex;     // own shadow, offset and blurred, alpha = coverage
#ifdef SDF_FIELD
uniform sampler2D uSdfTex;        // signed distance px (+ inside), outward normal
#else
uniform sampler2D uLightingTex;   // smoothed alpha, edge normals
uniform usampler2D uSdfTex;        // nearest edge point, SDF texels × SDF_FIX
#endif

uniform vec4 uParams1;             // x=blur 0..1, y=translucency, z=pass (0 color, 1 glass background), w=darkMode
uniform vec4 uParams2;             // x=refraction strength (UV, signed), y=height px, z=saturation px, w=aberration
uniform vec4 uParams3;             // x=frostiness, y=useVCM, z=lightingBlurPx, w=sdfScale (px per SDF texel)
uniform vec4 uParams4;             // x=shadow alpha over the glass background, y=shadow overdraw alpha over the content, w=Clear mask R = w × luma (0 = color)
uniform vec4 uLayerBounds;         // x0, y0, w, h (UV, y down)
uniform vec4 uTranslucencyGradient; // angle degrees, start %, end %, start opacity
uniform vec4 uTranslucencyGradient2; // end opacity, enabled, unused, unused
uniform vec4 uHl[12];              // [2i]=(height px, inset px, cos spread, bias amount) [2i+1]=(curvature, Lx, Ly, opacity); 0..3 light, 4..5 dark
uniform vec4 uVcm[2];              // (black, white, saturation, 0): [0] highlight, [1] darklight
uniform vec2 uTexelSize;           // 1/resolution

out vec4 fragColor;

#ifdef SDF_FIELD
void edgeField(vec2 uv, float alpha, out float dpx, out vec2 nOut) {
  vec4 f = textureLod(uSdfTex, uv, 0.0f);
  dpx = f.x;
  nOut = f.yz / max(length(f.yz), 1e-4f);
}
#else
float sampleAlpha(vec2 uv) {
  return textureLod(uLightingTex, uv, 0.0f).a;
}

vec2 alphaGradient(vec2 uv) {
  vec2 e = max(2.0f, uParams3.z) * uTexelSize;
  float aR = sampleAlpha(uv + vec2(e.x, 0.0f));
  float aL = sampleAlpha(uv - vec2(e.x, 0.0f));
  float aU = sampleAlpha(uv + vec2(0.0f, e.y));
  float aD = sampleAlpha(uv - vec2(0.0f, e.y));
  return vec2(aR - aL, aU - aD) * 0.5f;
}

// ── Nearest edge point among the seeds of the 2×2 SDF texels around p ──
vec2 nearestSeed(vec2 p, out float dist) {
  ivec2 n = textureSize(uSdfTex, 0);
  ivec2 b = ivec2(floor(p - 0.5f));
  vec2 best = p;
  float bestD = 1e20f;
  for(int i = 0; i < 4; i++) {
    ivec2 q = clamp(b + ivec2(i & 1, i >> 1), ivec2(0), n - 1);
    uvec2 s = texelFetch(uSdfTex, q, 0).rg;
    if(s.x == SDF_NONE)
      continue;
    vec2 sp = vec2(s) / SDF_FIX;
    float d = dot(sp - p, sp - p);
    if(d < bestD) {
      bestD = d;
      best = sp;
    }
  }
  dist = sqrt(bestD);
  return best;
}

float edgeDist(vec2 p) {
  float d;
  nearestSeed(p, d);
  return d;
}

void edgeField(vec2 uv, float alpha, out float dpx, out vec2 nOut) {
  vec2 p = uv * vec2(textureSize(uSdfTex, 0));
  float dist;
  vec2 toSeed = nearestSeed(p, dist) - p;
  float side = alpha >= 0.5f ? 1.0f : -1.0f;
  vec2 grad = vec2(edgeDist(p + vec2(1.0f, 0.0f)) - edgeDist(p - vec2(1.0f, 0.0f)), edgeDist(p + vec2(0.0f, 1.0f)) - edgeDist(p - vec2(0.0f, 1.0f)));
  nOut = -side * grad / max(length(grad), 1e-4f);
  dpx = dist * side;
  if(dist < 2.5f) {
    vec2 g = alphaGradient(uv);
    float gLen = length(g);
    if(gLen > 0.02f) {
      vec2 nGrad = -g / gLen;
      float w = smoothstep(1.0f, 2.5f, dist);
      nOut = mix(nGrad, nOut, w);
      nOut /= max(length(nOut), 1e-4f);
      dpx = mix(dot(toSeed, nGrad), dpx, w);
    }
  }
  dpx *= uParams3.w;
}
#endif

// ── Sharp background, 4 RGSS taps per pixel clamped to the layer frame + 1 px; aberration splits R and B ──
vec3 bgTap(vec2 uv) {
  return textureLod(uOrigBgTex, clamp(uv, 0.001f, 0.999f), 0.0f).rgb;
}

vec3 frameTap(vec2 uv) {
  return bgTap(clamp(uv, uLayerBounds.xy - uTexelSize, uLayerBounds.xy + uLayerBounds.zw + uTexelSize));
}

vec3 sharpBg(vec2 uv, vec2 disp, vec2 px) {
  float ca = uParams2.w * 0.25f;
  vec3 s = vec3(0.0f);
  for(int i = 0; i < 4; i++) {
    vec2 o = uv + RGSS4[i] * px;
    s += ca > 0.0f ? vec3(frameTap(o + disp * (1.0f - ca)).r, frameTap(o + disp).g, frameTap(o + disp * (1.0f + ca)).b) : frameTap(o + disp);
  }
  return s * 0.25f;
}

// ── glassHighlight (Icon Composer 27.2), d in render px ──
float glassHL(float dpx, vec2 nOut, vec4 a, vec4 b, float aa) {
  float d = dpx - a.y;
  float band = clamp(d / aa + 0.5f, 0.0f, 1.0f) * clamp((a.x - d) / aa + 0.5f, 0.0f, 1.0f);
  float k = smoothstep(0.0f, 1.0f, (a.x - 1.0f) * 0.5f) * b.x;
  float prof = mix(1.0f, 1.0f - clamp(d / a.x, 0.0f, 1.0f), k);
  float f = clamp((dot(b.yz, nOut) - a.z) / max(1.0f - a.z, 1.0f / 1024.0f), 0.0f, 1.0f) * prof;
  return band * f / max(1.0f + (1.0f - f) * a.w, 1.0f / 1024.0f) * b.w;
}

// ── Vibrant color matrix: black + (white − black)·Y + sat·(c − Y) ──
vec3 vcm(vec3 c, vec4 k) {
  float Y = dot(c, vec3(0.2126f, 0.7152f, 0.0722f));
  return k.x + (k.y - k.x) * Y + k.z * (c - Y);
}

// ── Clear mask (R lightening, G 1 − darkening, B highlights): darklight = multiply (1,0,1), highlight = screen (1,0,0) ──
vec3 darken(vec3 c, float a) {
  if(uParams4.w > 0.0f)
    return vec3(c.r, c.g * (1.0f - a), c.b);
  return uParams3.y > 0.5f ? mix(c, clamp(vcm(c, uVcm[1]), 0.0f, 1.0f), a) : max(c - a, 0.0f);
}

vec3 lighten(vec3 c, float a) {
  if(uParams4.w > 0.0f)
    return vec3(1.0f - (1.0f - c.r) * (1.0f - a), c.gb);
  return uParams3.y > 0.5f ? mix(c, clamp(vcm(c, uVcm[0]), 0.0f, 1.0f), a) : min(c + a, 1.0f);
}

// ── Composition in sRGB with gamma, the working space of Icon Composer ──
void main() {
  bool bgPass = uParams1.z > 0.5f;
  vec2 uv = bgPass ? vec2(vUV.x, 1.0f - vUV.y) : vUV;
  vec2 px = fwidth(vUV);
  vec4 layerColor = textureLod(uLayerTex, uv, 0.0f);
  if(uParams4.w > 0.0f)
    layerColor.rgb = vec3(uParams4.w * dot(layerColor.rgb, vec3(0.2126f, 0.7152f, 0.0722f)), 1.0f, 0.0f);
  float alpha = layerColor.a;
  bool lit = !bgPass && uHl[1].w + uHl[3].w + uHl[5].w + uHl[7].w + uHl[9].w + uHl[11].w > 0.0f;
  bool outset = lit && uHl[8].y < 0.0f && uHl[9].w + uHl[11].w > 0.0f;
  bool refr = uParams2.x != 0.0f;
  bool sdf = lit || refr;
  if(!bgPass && !sdf && alpha < 0.01f) {
    fragColor = vec4(0.0f);
    return;
  }

  // ── 1. Signed distance to the silhouette (px, + inside), outward normal and coverage ──
  float dpx = 0.0f;
  vec2 nOut = vec2(0.0f);
  if(sdf)
    edgeField(uv, alpha, dpx, nOut);
  float dc = clamp(dpx, -4.0f, 4.0f);
  float fdc = fwidth(dc);
  float cov = sdf ? clamp(dc / max(fdc, 1e-4f) + 0.5f, 0.0f, 1.0f) : alpha;

  // ── 2. Refraction: S·n_in·(1 − sqrt(1 − (1 − t)²)), t = d/h ──────────────
  vec2 dispUV = vec2(0.0f);
  if(refr) {
    float d = min(dpx, uParams2.z);
    float fw = max(fwidth(d), 1e-4f);
    float u = 1.0f - clamp(d / uParams2.y, 0.0f, 1.0f);
    float inner = clamp((uParams2.y - d) / fw + 0.5f, 0.0f, 1.0f);
    vec2 nIn = dpx < uParams2.z ? -nOut : vec2(0.0f);
    dispUV = nIn * (uParams2.x * (1.0f - sqrt(max(1.0f - u * u, 0.0f))) * inner);
  }

  // ── 3. Glass background in the layer frame: displaced × coverage (or opaque), own shadow multiplied undisplaced ──
  vec4 shadow = textureLod(uShadowTex, uv, 0.0f);
  float aS = shadow.a * uParams4.x;
  vec3 mulS = mix(vec3(1.0f), shadow.rgb, aS);
  if(bgPass) {
    vec4 b = refr ? (cov > 0.0f ? vec4(sharpBg(uv, dispUV, px) * cov, cov) : vec4(0.0f)) : vec4(texture(uOrigBgTex, uv).rgb, 1.0f);
    vec3 cs = shadow.rgb * aS;
    vec2 r = uv - uLayerBounds.xy;
    bool inFrame = all(greaterThanEqual(r, vec2(0.0f))) && all(lessThanEqual(r, uLayerBounds.zw));
    fragColor = inFrame ? vec4(cs * (1.0f - b.a) + b.rgb * (1.0f - aS) + cs * b.rgb, aS + b.a - aS * b.a) : vec4(0.0f);
    return;
  }
  if(alpha < 0.01f && cov <= 0.0f && !(outset && dpx > uHl[8].y - 1.0f)) {
    fragColor = vec4(0.0f);
    return;
  }

  vec3 bg;
  if(uParams1.x > 0.0f) {
    vec4 b = textureLod(uBlurredBgTex, uv, 0.0f);
    bg = b.a > 0.01f ? b.rgb / b.a : sharpBg(uv, dispUV, px) * mulS;
  } else {
    bg = (refr ? sharpBg(uv, dispUV, px) : bgTap(uv)) * mulS;
  }
  vec3 frostTint = uParams1.w > 0.5f ? vec3(0.08f, 0.08f, 0.12f) : vec3(1.0f);
  bg = mix(bg, frostTint, uParams1.x * uParams3.x);

  // ── 4. Artwork opacity: uniform translucency or a configurable directional gradient. ──
  float v;
  if (uTranslucencyGradient2.y > 0.5f) {
    vec2 local = clamp((uv - uLayerBounds.xy) / max(uLayerBounds.zw, vec2(1e-4)), 0.0, 1.0);
    vec2 localSize = max(uLayerBounds.zw, vec2(1e-4));
    vec2 localPx = local * localSize;
    float angle = radians(uTranslucencyGradient.x);
    vec2 direction = vec2(cos(angle), sin(angle));
    float extent = max(abs(direction.x) * localSize.x + abs(direction.y) * localSize.y, 1e-4);
    float projected = clamp(dot(localPx - localSize * 0.5, direction) / (0.5 * extent) * 0.5 + 0.5, 0.0, 1.0);
    float start = clamp(uTranslucencyGradient.y, 0.0, 1.0);
    float end = clamp(uTranslucencyGradient.z, start + 1e-4, 1.0);
    float t = smoothstep(0.0, 1.0, clamp((projected - start) / max(end - start, 1e-4), 0.0, 1.0));
    v = mix(clamp(uTranslucencyGradient.w, 0.0, 1.0), clamp(uTranslucencyGradient2.x, 0.0, 1.0), t);
  } else {
    v = 1.0f - clamp(uParams1.y, 0.0f, 1.0f);
    v = v * v * (3.0f - 2.0f * v);
  }
  // Composite the artwork against the sampled underlying layers using its
  // opacity field. The glass pass already has the real backdrop available in
  // `bg`; treating this as ordinary source-over alpha caused the backdrop to
  // be blended a second time and made translucency read like a color fade.
  // Keep silhouette coverage only for antialiased edges, and mix the actual
  // artwork color with the sampled backdrop according to the opacity value.
  float aOut = cov;
  vec3 c = mix(bg, layerColor.rgb, clamp(v, 0.0f, 1.0f));
  c *= mix(vec3(1.0f), shadow.rgb, shadow.a * uParams4.y * alpha);

  // ── 5. Highlights and darklights, one VCM pass each ──────────────────────
  if(lit) {
    float aa = 0.833f * max(abs(nOut.x) + abs(nOut.y), 1.0f);
    float aDk = 0.0f;
    for(int i = 4; i < 6; i++) {
      float a = glassHL(dpx, nOut, uHl[2 * i], uHl[2 * i + 1], aa);
      aDk += a;
      if(!outset)
        c = darken(c, a);
    }
    for(int i = 0; i < 4; i++) c = lighten(c, glassHL(dpx, nOut, uHl[2 * i], uHl[2 * i + 1], aa));

    if(outset && aDk > 0.0f) {
      vec3 dk = darken(bgTap(uv) * mulS, 1.0f);
      float a2 = aOut + aDk * (1.0f - aOut);
      c = (c * aOut + dk * aDk * (1.0f - aOut)) / max(a2, 1e-4f);
      aOut = a2;
    }
  }

  fragColor = vec4(clamp(c, 0.0f, 1.0f), aOut);
}

/// <reference path="../.astro/types.d.ts" />

// GLSL shader files (handled as raw strings by Vite glslRaw plugin)
declare module '*.glsl' {
  const src: string;
  export default src;
}
declare module '*.vert.glsl' {
  const src: string;
  export default src;
}
declare module '*.frag.glsl' {
  const src: string;
  export default src;
}
// glsl.d.ts — TypeScript declarations for GLSL shader imports via vite-plugin-glsl
declare module '*.vert.glsl' {
  const src: string;
  export default src;
}

declare module '*.frag.glsl' {
  const src: string;
  export default src;
}

declare module '*.glsl' {
  const src: string;
  export default src;
}

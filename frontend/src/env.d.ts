/// <reference path="../.astro/types.d.ts" />
/// <reference types="vite/client" />

// Raw text imports for Fluent (.ftl) locale files
declare module '*.ftl?raw' {
  const content: string;
  export default content;
}
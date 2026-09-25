/**
 * Ambient type for Vite's `?raw` imports, used by the Google boundary test to
 * read Worker source files as strings. Vitest understands `?raw`; `tsc` does
 * not, so it needs this declaration to typecheck.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}

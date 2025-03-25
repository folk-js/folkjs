/** A raw tagged template literal that just provides GLSL syntax highlighting/LSP support. */
export const glsl = String.raw;

/** A raw tagged template literal that just provides HTML syntax highlighting/LSP support. */
export const html = String.raw;

export function css(strings: TemplateStringsArray, ...values: any[]) {
  const styles = new CSSStyleSheet();
  styles.replaceSync(String.raw(strings, ...values));
  return styles;
}

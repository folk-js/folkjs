/** A raw tagged template literal that just provides GLSL syntax highlighting/LSP support. */
export const glsl = String.raw;

// Some websites with strict CSP require trusted types for using DOM APIS prone to XSS
const policy = (window as any)?.trustedTypes.createPolicy('folkjs', {
  createHTML: (s: string) => s,
});

/** A raw tagged template literal that just provides HTML syntax highlighting/LSP support. */
export function html(strings: TemplateStringsArray, ...values: any[]) {
  const str = String.raw(strings, values);
  return policy ? policy.createHTML(str) : str;
}

export function css(strings: TemplateStringsArray, ...values: any[]) {
  const styles = new CSSStyleSheet();
  styles.replaceSync(String.raw(strings, ...values));
  return styles;
}

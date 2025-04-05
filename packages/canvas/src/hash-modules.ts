// Ported from https://github.com/tomlarkworthy/lopecode

let importmap: HTMLScriptElement | null = null;
let mainScript: HTMLScriptElement | null = null;

export function execute() {
  cleanup();

  const imports: Record<string, string> = {};

  document.querySelectorAll<HTMLScriptElement>('script[type=hash-module]').forEach((module) => {
    imports['#' + module.id] = URL.createObjectURL(new Blob([module.text], { type: 'application/javascript' }));
    module.remove();
  });

  importmap = document.createElement('script');
  importmap.type = 'importmap';
  importmap.text = JSON.stringify({ imports }, null, 2);
  document.head.appendChild(importmap);

  // We need the entry point of all JS modules that import hash modules to also be a hash module in order to guarantee this importmap is generated before the other modules run.
  if (imports['#main']) {
    mainScript = document.createElement('script');
    mainScript.type = 'module';
    mainScript.text = 'import "#main"';
    document.head.appendChild(mainScript);
  }
}

export function cleanup() {
  importmap?.remove();
  mainScript?.remove();
}

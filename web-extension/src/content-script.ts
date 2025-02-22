function injectScript(src: string) {
  const s = document.createElement('script');

  s.src = chrome.runtime.getURL(src);
  // s.onload = () => s.remove();
  document.documentElement.append(s);
}

injectScript('dist/injected.js');

import browser from 'webextension-polyfill';

function injectScript(src: string) {
  const s = document.createElement('script');
  s.src = browser.runtime.getURL(src);
  s.onload = () => s.remove();
  document.documentElement.append(s);
}

injectScript('src/injected.js');

import browser from 'webextension-polyfill';

function injectScript(src: string) {
  const s = document.createElement('script');
  s.src = browser.runtime.getURL(src);
  s.onload = () => s.remove();
  document.documentElement.append(s);
}

// Wait until a selection is made to inject the script
browser.runtime.onMessage.addListener((message: any) => {
  if (message.type !== 'prototype-selected') return;

  switch (message.prototype) {
    case 'canvasify': {
      injectScript('src/injected/canvasify.js');
      return;
    }
    case 'copyAndPaste': {
      injectScript('src/injected/copy-and-paste.js');
      return;
    }
    case 'presence': {
      injectScript('src/injected/presence.js');
      return;
    }
  }
});

import browser from 'webextension-polyfill';

function injectScript(src: string) {
  const s = document.createElement('script');
  s.src = browser.runtime.getURL(src);
  s.onload = () => s.remove();
  document.documentElement.append(s);
}

function selectScript(prototype: string) {
  switch (prototype) {
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
}

browser.storage.local.onChanged.addListener(({ prototype }) => {
  if (prototype) {
    selectScript(prototype.newValue as string);
  }
});

async function loadSelectedPrototype() {
  const { prototype = 'none' } = await browser.storage.local.get('prototype');
  selectScript(prototype as string);
}

loadSelectedPrototype();

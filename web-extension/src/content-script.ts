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
      break;
    }
    case 'copyAndPaste': {
      injectScript('src/injected/copy-and-paste.js');
      break;
    }
    case 'presence': {
      injectScript('src/injected/presence.js');
      break;
    }
    case 'cross-iframe-relationships': {
      injectScript('src/injected/cross-iframe-relationships.js');
      break;
    }
    case 'dom3d': {
      injectScript('src/injected/dom3d.js');
      break;
    }
    case 'network-indicator': {
      injectScript('src/injected/network-indicator.js');

      browser.runtime.onMessage.addListener((event: unknown) => {
        if (event && typeof event === 'object' && 'networkMonitor' in event) {
          const networkMonitor = document.documentElement.querySelector('#folk-network-indicator')!;
          if (event.networkMonitor) {
            networkMonitor.setAttribute('active', '');
          } else {
            networkMonitor.removeAttribute('active');
          }
        }
        // make sure to send a response back
        // due to a race condition we might see an error or two since this listener isnt set up before the background script
        return Promise.resolve(true);
      });
      break;
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

import browser from 'webextension-polyfill';

let activeTabId: number | null = null;
let activeRequests = 0;

function onBeforeRequest() {
  if (activeRequests === 0 && activeTabId !== null) {
    browser.tabs.sendMessage(activeTabId, { networkMonitor: true });
  }

  activeRequests += 1;
}

function onRequestCompleted() {
  activeRequests -= 1;

  if (activeRequests === 0 && activeTabId !== null) {
    browser.tabs.sendMessage(activeTabId, { networkMonitor: false });
  }
}

function onActivated(activeInfo: browser.Tabs.OnActivatedActiveInfoType) {
  activeTabId = activeInfo.tabId;
}

function startMonitoringNetwork() {
  activeRequests = 0;
  browser.tabs.onActivated.addListener(onActivated);
  browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ['<all_urls>'] });
  browser.webRequest.onCompleted.addListener(onRequestCompleted, { urls: ['<all_urls>'] });
  browser.webRequest.onErrorOccurred.addListener(onRequestCompleted, { urls: ['<all_urls>'] });
}

function stopMonitoringNetwork() {
  browser.tabs.onActivated.removeListener(onActivated);
  browser.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
  browser.webRequest.onCompleted.removeListener(onRequestCompleted);
  browser.webRequest.onErrorOccurred.removeListener(onRequestCompleted);
}

browser.storage.local.onChanged.addListener(({ prototype }) => {
  if (prototype.newValue === 'network-indicator') {
    startMonitoringNetwork();
  }

  if (prototype.oldValue === 'network-indicator') {
    stopMonitoringNetwork();
  }
});

async function loadSelectedPrototype() {
  const { prototype = 'none' } = await browser.storage.local.get('prototype');

  if (prototype === 'network-indicator') {
    startMonitoringNetwork();
  }
}

loadSelectedPrototype();

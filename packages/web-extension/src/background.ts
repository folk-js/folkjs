import browser from 'webextension-polyfill';

browser.action.onClicked.addListener((tab: any) => {
  browser.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/content-script.js'],
  });
});

import browser from 'webextension-polyfill';

document.addEventListener('input', async (e) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });

  browser.tabs.sendMessage(tabs[0].id!, {
    type: 'prototype-selected',
    prototype: (e.target as HTMLInputElement).value,
  });
});

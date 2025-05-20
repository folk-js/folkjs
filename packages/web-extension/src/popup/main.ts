import browser from 'webextension-polyfill';

document.addEventListener('input', async (e) => {
  browser.storage.local.set({ prototype: (e.target as HTMLInputElement).value });
});

async function loadSelectedPrototype() {
  const { prototype = 'none' } = await browser.storage.local.get('prototype');

  const el = document.querySelector<HTMLInputElement>(`input[value="${prototype}"]`);

  if (el) {
    el.checked = true;
  }
}

loadSelectedPrototype();

document.addEventListener('copy', (e) => {
  if (!(e.target instanceof HTMLElement) || e.target.shape === undefined) return;

  e.preventDefault();

  const clipboardItem = new ClipboardItem({
    'text/html': e.target.outerHTML,
  });

  navigator.clipboard.write([clipboardItem]);
});

document.addEventListener('paste', (e) => {
  const folkData = e.clipboardData?.getData('text/html');

  if (folkData === undefined) return;

  e.preventDefault();

  const template = document.createElement('template');

  template.setHTMLUnsafe(folkData);

  // Sanitize the copied HTML
  template.content.querySelectorAll('script, style').forEach((el) => el.remove());

  if (template.content.querySelector('[folk-shape]')) {
    import('@folkjs/labs/standalone/folk-shape-attribute');
  }

  document.body.appendChild(template.content.cloneNode(true));
});

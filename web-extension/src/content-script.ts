// browser.runtime.onMessage.addListener((message: any) => {
//   console.log();
//   if (message.action === 'insertFolkCanvas') {
//     const script = document.createElement('script');
//     script.src = browser.runtime.getURL('injected.js');
//     document.documentElement.appendChild(script);
//   }
//   return true;
// });

function injectScript(src: string) {
  const s = document.createElement('script');

  s.src = chrome.runtime.getURL(src);
  console.log(s.src);
  // s.onload = () => s.remove();
  document.documentElement.append(s);
}

injectScript('dist/injected.js');

import '@folkjs/labs/standalone/folk-presence';

// hardcode automerge document id for now. In the future we should have one document per domain?
history.pushState(null, '', '#automerge:EizZWvqx6vLC2NsH955eC7ckEkF');

const presence = document.createElement('folk-presence');

document.documentElement.appendChild(presence);

import PartySocket from 'partysocket';

export class SyncInput extends HTMLElement {
  static tagName = 'sync-input';

  #input: HTMLInputElement;
  #ws!: PartySocket;

  constructor() {
    super();
    this.#input = document.createElement('input');
    this.#input.type = 'text';

    // Listen for input changes
    this.#input.addEventListener('input', () => {
      this.#ws.send(
        JSON.stringify({
          value: this.#input.value,
        }),
      );
    });
  }

  connectedCallback() {
    this.appendChild(this.#input);

    // Connect to PartyKit
    this.#ws = new PartySocket({
      host: 'folk-sync.orionreed.partykit.dev',
      room: 'sync-test',
    });

    this.#ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.#input.value = data.value;
    };
  }
}

customElements.define(SyncInput.tagName, SyncInput);

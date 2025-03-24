export type RolePrompt = {
  role: string;
  content: string;
};

export type Prompt = string | RolePrompt[];

declare global {
  interface HTMLElementTagNameMap {
    'folk-llm': FolkLLM;
  }
}

export class FolkLLM extends HTMLElement {
  static tagName = 'folk-llm';

  static define() {
    if (customElements.get(this.tagName)) return;
    customElements.define(this.tagName, this);
  }

  #shadow = this.attachShadow({ mode: 'open' });

  connectedCallback() {
    this.#update(new Set(['systemPrompt', 'prompt']));
  }

  #session: any;

  #isModelReady = window?.ai.languageModel
    .capabilities()
    .then((capabilities: any) => capabilities.available === 'readily');

  #systemPrompt: Prompt = this.getAttribute('system-prompt') || '';
  get systemPrompt() {
    return this.#systemPrompt;
  }
  set systemPrompt(systemPrompt) {
    this.#systemPrompt = systemPrompt;
    this.#requestUpdate('systemPrompt');
  }

  #prompt: Prompt = this.getAttribute('prompt') || '';
  get prompt() {
    return this.#prompt;
  }
  set prompt(prompt) {
    this.#prompt = prompt;
    this.#requestUpdate('prompt');
  }

  #updatedProperties = new Set<string>();
  #isUpdating = false;

  async #requestUpdate(property: string) {
    this.#updatedProperties.add(property);

    if (this.#isUpdating) return;

    this.#isUpdating = true;
    await true;
    this.#isUpdating = false;
    this.#update(this.#updatedProperties);
    this.#updatedProperties.clear();
  }

  async #update(updatedProperties: Set<string>) {
    if (updatedProperties.has('systemPrompt')) {
      this.#session?.destroy();

      const initialPrompt =
        typeof this.#systemPrompt === 'string'
          ? { systemPrompt: this.#systemPrompt }
          : { initialPrompts: this.systemPrompt };
      this.#session = await window.ai.languageModel.create(initialPrompt);
      this.#runPrompt();
    } else if (updatedProperties.has('prompt') && this.#session !== undefined) {
      const oldSession = this.#session;
      this.#session = await oldSession.clone();
      oldSession.destroy();
      this.#runPrompt();
    }
  }

  async #runPrompt() {
    if (this.prompt.length === 0 || this.#session === undefined) return;

    this.#shadow.textContent = '';

    this.dispatchEvent(new Event('started'));
    const stream = await this.#session.promptStreaming(this.prompt);

    for await (const chunk of stream) {
      this.#shadow.setHTMLUnsafe(chunk);
    }

    this.dispatchEvent(new Event('finished'));
  }
}

declare global {
  interface Window {
    ai: any;
  }
}

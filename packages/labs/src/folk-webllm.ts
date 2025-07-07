import { canIUseWebGPU } from '@folkjs/dom/CanIUse';
import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';

export type RolePrompt = {
  role: string;
  content: string;
};

export type Prompt = string | RolePrompt[];

declare global {
  interface HTMLElementTagNameMap {
    'folk-webllm': FolkWebLLM;
  }
}

/**
 * A web component that provides an interface to run WebLLM models directly in the browser.
 * Uses WebGPU for hardware acceleration and supports a variety of models.
 */
export class FolkWebLLM extends HTMLElement {
  static tagName = 'folk-webllm';

  static define() {
    if (customElements.get(this.tagName)) return;
    customElements.define(this.tagName, this);
  }

  private outputEl!: HTMLElement;
  private progressBar!: HTMLElement;
  private statusEl!: HTMLElement;
  private controlsEl!: HTMLElement;

  private engine: any;
  private _systemPrompt = 'You are a helpful assistant.';
  private _prompt = '';
  private _model = '';

  constructor() {
    super();

    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          overflow: auto;
          font-family: system-ui, sans-serif;
        }
        .controls {
          display: flex;
          align-items: center;
          flex-wrap: nowrap;
          padding: 4px 8px;
          background: #f5f5f5;
          border-bottom: 1px solid #ddd;
          font-size: 12px;
          min-height: 24px;
        }
        .status {
          flex: 0 0 auto;
          margin-right: 8px;
          padding: 2px 6px;
          border-radius: 3px;
          background-color: #eee;
          color: #555;
          white-space: nowrap;
        }
        .progress {
          flex: 1 1 40px;
          min-width: 40px;
          height: 4px;
          background-color: #eee;
          border-radius: 2px;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          background-color: #4caf50;
          width: 0%;
          transition: width 0.3s;
        }
        #model-controls {
          display: flex;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          align-items: center;
        }
        .model-select {
          flex: 0 1 auto;
          margin-left: 8px;
          max-width: 150px;
          min-width: 80px;
          font-size: 12px;
          padding: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: monospace;
        }
        .model-select option {
          font-size: 12px;
          padding: 4px;
          white-space: nowrap;
          font-family: monospace;
        }
        .model-select option.low-resource {
          color: #155724;
          background-color: #f7fff9;
        }
        .load-btn {
          flex: 0 0 auto;
          margin-left: 4px;
          padding: 2px 6px;
          background-color: #4caf50;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }
        .output {
          padding: 1em;
        }
        .loading {
          color: #666;
          font-style: italic;
        }
        .error {
          color: #721c24;
          background-color: #f8d7da;
          padding: 8px;
          border-radius: 4px;
          margin-top: 8px;
        }
      </style>
      <div class="controls">
        <div class="status" id="status">Initializing...</div>
        <div class="progress">
          <div class="progress-bar" id="progress-bar"></div>
        </div>
        <div id="model-controls"></div>
      </div>
      <div class="output" id="output"></div>
    `;

    this.outputEl = this.shadowRoot!.querySelector('#output') as HTMLElement;
    this.progressBar = this.shadowRoot!.querySelector('#progress-bar') as HTMLElement;
    this.statusEl = this.shadowRoot!.querySelector('#status') as HTMLElement;
    this.controlsEl = this.shadowRoot!.querySelector('#model-controls') as HTMLElement;
  }

  connectedCallback() {
    if (this.hasAttribute('system-prompt')) {
      this._systemPrompt = this.getAttribute('system-prompt') || this._systemPrompt;
    }

    if (this.hasAttribute('model')) {
      this._model = this.getAttribute('model') || '';
    }

    if (canIUseWebGPU()) {
      if (this._model) {
        this.initializeModel(this._model);
      } else {
        this.fetchAvailableModels();
      }
    } else {
      this.updateStatus('Error: WebGPU not supported', 'error');
    }
  }

  get systemPrompt() {
    return this._systemPrompt;
  }

  set systemPrompt(value) {
    this._systemPrompt = value;
    if (this.isConnected) {
      this.setAttribute('system-prompt', value);
    }
  }

  get model() {
    return this._model;
  }

  set model(value) {
    if (this._model !== value) {
      this._model = value;
      if (this.isConnected) {
        this.setAttribute('model', value);
        if (value) {
          this.initializeModel(value);
        }
      }
    }
  }

  get prompt() {
    return this._prompt;
  }

  set prompt(value) {
    this._prompt = value;

    this.processPrompt(value);
  }

  updateStatus(text: string, type = 'normal') {
    if (this.statusEl) {
      this.statusEl.textContent = text;

      this.statusEl.style.backgroundColor = '#eee';
      this.statusEl.style.color = '#555';

      if (type === 'error') {
        this.statusEl.style.backgroundColor = '#f8d7da';
        this.statusEl.style.color = '#721c24';
      } else if (type === 'success') {
        this.statusEl.style.backgroundColor = '#d4edda';
        this.statusEl.style.color = '#155724';
      } else if (type === 'warning') {
        this.statusEl.style.backgroundColor = '#fff3cd';
        this.statusEl.style.color = '#856404';
      }
    }
  }

  updateProgress(progress: any) {
    if (this.progressBar && progress && typeof progress.progress === 'number') {
      this.progressBar.style.width = `${progress.progress * 100}%`;
    }
    if (progress && progress.text) {
      this.updateStatus(progress.text);
    }
  }

  async fetchAvailableModels() {
    try {
      this.updateStatus('Fetching models...', 'warning');

      const modelList = prebuiltAppConfig.model_list || {};

      this.showModelSelector(modelList.map((model) => model.model_id));
      this.updateStatus('Select a model', 'normal');
    } catch (error) {
      console.error('Error fetching models:', error);
      this.updateStatus('Error fetching models', 'warning');
    }
  }

  showModelSelector(models: string[]) {
    this.controlsEl.innerHTML = `
      <select class="model-select" id="model-select" title="Select a model to load">
        ${models.map((model) => `<option value="${model}">${model}</option>`).join('')}
      </select>
      <button class="load-btn" id="load-model-btn">Load</button>
    `;

    const loadBtn = this.shadowRoot!.querySelector('#load-model-btn');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        const selectEl = this.shadowRoot!.querySelector('#model-select') as HTMLSelectElement;
        if (selectEl) {
          const selectedModel = selectEl.value;
          this.initializeModel(selectedModel);

          this._model = selectedModel;
          this.setAttribute('model', selectedModel);
        }
      });
    }
  }

  async initializeModel(modelId: string) {
    try {
      this.controlsEl.innerHTML = '';
      this.outputEl.innerHTML = '';
      this.updateStatus(`Loading ${modelId}...`, 'warning');
      this.progressBar.style.width = '0%';

      console.log(`Attempting to load model: ${modelId}`);

      const initProgressCallback = (progress: any) => {
        this.updateProgress(progress);
      };

      this.engine = await CreateMLCEngine(modelId, {
        initProgressCallback,
      });

      this.updateStatus(`Model: ${modelId}`, 'success');
    } catch (error) {
      console.error('Model loading error:', error);

      this.updateStatus(
        `Error loading model: ${error instanceof Error ? error.message.split('.')[0] : 'Unknown error'}`,
        'error',
      );

      this.fetchAvailableModels();
      this.updateStatus('Error loading model', 'error');
    }
  }

  async processPrompt(prompt: string) {
    if (!prompt || !this.engine) return;

    try {
      this.dispatchEvent(new CustomEvent('started'));
      this.outputEl.innerHTML = '';
      this.updateStatus('Generating...', 'warning');

      const messages = [
        {
          role: 'system',
          content: this._systemPrompt,
        },
        { role: 'user', content: prompt },
      ];

      let generatedText = '';

      const chunks = await this.engine.chat.completions.create({
        messages,
        temperature: 0.1,
        stream: true,
      });

      for await (const chunk of chunks) {
        const content = chunk.choices[0]?.delta?.content || '';
        generatedText += content;

        const processedContent = this.processMarkdownCodeBlocks(generatedText);
        const cleanContent = this.simpleSanitizeHtml(processedContent);

        this.outputEl.innerHTML = cleanContent;
      }

      this.updateStatus('Done', 'success');
      console.log('generatedText', generatedText);

      this.dispatchEvent(new CustomEvent('finished'));
    } catch (error) {
      console.error(error);
      this.updateStatus(
        `Error: ${error instanceof Error ? error.message.split('.')[0] : 'Generation failed'}`,
        'error',
      );
      this.dispatchEvent(new CustomEvent('finished'));
    }
  }

  private processMarkdownCodeBlocks(text: string): string {
    // More flexible regex to capture code blocks with different formatting
    const codeBlockRegex = /```(?:html|)?\s*([\s\S]*?)\s*```/g;

    let result = text;

    // Check if there are any code blocks
    if (text.includes('```')) {
      // First try to find HTML code blocks
      const htmlMatches = text.match(/```(?:html)?\s*([\s\S]*?)\s*```/);
      if (htmlMatches && htmlMatches[1]) {
        // We found an HTML code block, use just its contents
        result = htmlMatches[1].trim();
      } else {
        // No HTML block, use general code block extractor
        result = text.replace(codeBlockRegex, (_, codeContent) => {
          return codeContent.trim();
        });

        // If we still have backticks in the result, remove them
        if (result.includes('```')) {
          result = result.replace(/```/g, '');
        }
      }

      // Remove any "Note:" or additional commentary after the code
      const noteIndex = result.indexOf('Note:');
      if (noteIndex > 0) {
        result = result.substring(0, noteIndex).trim();
      }
    }

    return result;
  }

  private simpleSanitizeHtml(html: string): string {
    const lastLtIndex = html.lastIndexOf('<');
    const lastGtIndex = html.lastIndexOf('>');

    // If there's a < character after the last > character, it's an incomplete tag
    if (lastLtIndex > lastGtIndex) {
      return html.substring(0, lastLtIndex);
    }

    // Also check for incomplete HTML entities
    const lastAmpIndex = html.lastIndexOf('&');
    const lastSemiIndex = html.lastIndexOf(';');

    if (lastAmpIndex > lastSemiIndex) {
      return html.substring(0, lastAmpIndex);
    }

    return html;
  }
}

FolkWebLLM.define();

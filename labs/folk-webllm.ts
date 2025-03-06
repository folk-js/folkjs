// Import WebLLM directly from module with proper named imports
import { CreateMLCEngine } from '@mlc-ai/web-llm';
import { Experimental } from '../lib/Experimental';

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

  // UI Elements
  private outputEl!: HTMLElement;
  private progressBar!: HTMLElement;
  private modelSelectorEl!: HTMLElement;
  private statusEl: HTMLElement | null = null;
  private modelInfoEl: HTMLElement | null = null;

  // Engine and model data
  private engine: any;
  private _systemPrompt = 'You are a helpful assistant.';
  private _prompt = '';

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
        }
        .output {
          white-space: pre-wrap;
          font-family: system-ui, sans-serif;
          line-height: 1.5;
          padding: 8px;
        }
        .loading {
          color: #666;
          font-style: italic;
        }
        .progress {
          margin-top: 12px;
          width: 100%;
          height: 8px;
          background-color: #eee;
          border-radius: 4px;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          background-color: #4caf50;
          width: 0%;
          transition: width 0.3s;
        }
        .model-selector {
          margin-top: 16px;
          padding: 8px;
          background-color: #f5f5f5;
          border-radius: 4px;
        }
        .model-selector select {
          width: 100%;
          padding: 4px;
        }
        .model-selector button {
          margin-top: 8px;
          padding: 4px 8px;
          background-color: #4caf50;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
      </style>
      <div class="output">
        <div class="loading">Initializing WebLLM...</div>
        <div class="progress">
          <div class="progress-bar" id="progress-bar"></div>
        </div>
        <div class="model-selector" id="model-selector"></div>
      </div>
    `;

    const outputEl = this.shadowRoot!.querySelector('.output');
    const progressBar = this.shadowRoot!.querySelector('#progress-bar');
    const modelSelectorEl = this.shadowRoot!.querySelector('#model-selector');

    if (outputEl) this.outputEl = outputEl as HTMLElement;
    if (progressBar) this.progressBar = progressBar as HTMLElement;
    if (modelSelectorEl) this.modelSelectorEl = modelSelectorEl as HTMLElement;

    // Get external elements by ID
    this.statusEl = document.getElementById('model-status');
    this.modelInfoEl = document.getElementById('model-info');
  }

  connectedCallback() {
    // Set system prompt from attribute if provided
    if (this.hasAttribute('system-prompt')) {
      this._systemPrompt = this.getAttribute('system-prompt') || this._systemPrompt;
    }

    // Check WebGPU support before showing model selection
    if (Experimental.canWebGPU()) {
      // Initialize by showing model selection
      this.showDirectModelSelection();
    } else {
      // Show error message if WebGPU is not supported
      this.outputEl.innerHTML = `
        <div class="output">
          <div style="color: #721c24; background-color: #f8d7da; padding: 10px; border-radius: 4px;">
            WebGPU is not supported in this browser. WebLLM requires a browser with WebGPU support, such as Chrome 113+ or Edge 113+.
          </div>
        </div>
      `;
      if (this.statusEl) {
        this.statusEl.textContent = 'Error: WebGPU not supported';
        this.statusEl.style.backgroundColor = '#f8d7da';
        this.statusEl.style.color = '#721c24';
      }
    }
  }

  // System prompt property
  get systemPrompt() {
    return this._systemPrompt;
  }

  set systemPrompt(value) {
    this._systemPrompt = value;
    if (this.isConnected) {
      this.setAttribute('system-prompt', value);
    }
  }

  // User prompt property
  get prompt() {
    return this._prompt;
  }

  set prompt(value) {
    this._prompt = value;
    // Process the prompt when it's set
    this.processPrompt(value);
  }

  updateProgress(progress: any) {
    if (this.progressBar && progress && typeof progress.progress === 'number') {
      this.progressBar.style.width = `${progress.progress * 100}%`;
    }
    if (this.statusEl && progress && progress.text) {
      this.statusEl.textContent = progress.text;
    }
  }

  showDirectModelSelection() {
    // Provide a direct selection of models known to work with WebLLM
    this.modelSelectorEl.innerHTML = `
      <p>Select a model to load:</p>
      <select id="model-select">
        <option value="Llama-3.2-1B-Instruct-q4f32_1-MLC">Llama-3.2-1B-Instruct (1B)</option>
        <option value="Phi-2-3B-4bit-MLC">Phi-2 (3B)</option>
        <option value="Gemma-2B-Instruct-Q4_0-WASM-MLC">Gemma-2B-Instruct (2B)</option>
        <option value="Llama-3.1-8B-Instruct-q4f32_1-MLC">Llama-3.1-8B-Instruct (8B)</option>
      </select>
      <button id="load-model-btn">Load Model</button>
    `;

    // Add event listener to the load button
    const loadBtn = this.shadowRoot!.querySelector('#load-model-btn');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        const selectEl = this.shadowRoot!.querySelector('#model-select') as HTMLSelectElement;
        if (selectEl) {
          const selectedModel = selectEl.value;
          this.initializeModel(selectedModel);
        }
      });
    }
  }

  async initializeModel(modelId: string) {
    try {
      // Hide the model selector
      this.modelSelectorEl.style.display = 'none';

      this.outputEl.innerHTML = `
        <div class="loading">Initializing ${modelId} model...</div>
        <div class="progress">
          <div class="progress-bar" id="progress-bar"></div>
        </div>
      `;
      const progressBarElement = this.shadowRoot!.querySelector('#progress-bar');
      if (progressBarElement) {
        this.progressBar = progressBarElement as HTMLElement;
      }

      console.log(`Attempting to load model: ${modelId}`);

      // Progress callback to update UI
      const initProgressCallback = (progress: any) => {
        this.updateProgress(progress);
      };

      // Initialize engine with the selected model using CreateMLCEngine directly
      this.engine = await CreateMLCEngine(modelId, {
        initProgressCallback,
      });

      // Update model info based on the model ID
      let infoText = `Using ${modelId}`;
      let sizeMatch = modelId.match(/(\d+(?:\.\d+)?)B/);
      if (sizeMatch) {
        infoText += `, a ${sizeMatch[1]}B parameter model`;
      }
      infoText += ` running in your browser`;

      if (this.modelInfoEl) {
        this.modelInfoEl.textContent = infoText;
      }

      this.outputEl.innerHTML = `<div class="output">
        Model loaded! Click on the recipe to double the ingredients.
      </div>`;

      if (this.statusEl) {
        this.statusEl.textContent = 'Ready';
        this.statusEl.style.backgroundColor = '#d4edda';
        this.statusEl.style.color = '#155724';
      }

      // Dispatch event when model is loaded
      this.dispatchEvent(new CustomEvent('modelLoaded', { detail: { modelId } }));
    } catch (error) {
      this.outputEl.innerHTML = `<div class="output">
        Error loading model: ${error instanceof Error ? error.message : String(error)}
        
        You may need to try a different browser with WebGPU support.
        <div class="model-selector">
          <button id="back-to-models-btn">Back to Model Selection</button>
        </div>
      </div>`;

      // Add back button listener
      const backBtn = this.shadowRoot!.querySelector('#back-to-models-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          this.showDirectModelSelection();
        });
      }

      if (this.statusEl) {
        this.statusEl.textContent = 'Error';
        this.statusEl.style.backgroundColor = '#f8d7da';
        this.statusEl.style.color = '#721c24';
      }

      console.error(error);

      // Dispatch error event
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    }
  }

  // Handle prompt input
  async processPrompt(prompt: string) {
    if (!prompt || !this.engine) return;

    try {
      this.dispatchEvent(new CustomEvent('started'));

      this.outputEl.innerHTML = '<div class="loading">Generating response...</div>';

      if (this.statusEl) {
        this.statusEl.textContent = 'Generating';
        this.statusEl.style.backgroundColor = '#fff3cd';
        this.statusEl.style.color = '#856404';
      }

      const messages = [
        {
          role: 'system',
          content: this._systemPrompt,
        },
        { role: 'user', content: prompt },
      ];

      // Use streaming for real-time output
      let generatedText = '';
      const chunks = await this.engine.chat.completions.create({
        messages,
        temperature: 0.1,
        stream: true,
      });

      // Process streaming response
      for await (const chunk of chunks) {
        const content = chunk.choices[0]?.delta?.content || '';
        generatedText += content;
        this.outputEl.innerHTML = generatedText;
      }

      if (this.statusEl) {
        this.statusEl.textContent = 'Done';
        this.statusEl.style.backgroundColor = '#d4edda';
        this.statusEl.style.color = '#155724';
      }

      this.dispatchEvent(new CustomEvent('finished'));
    } catch (error) {
      this.outputEl.innerHTML = `Error generating response: ${error instanceof Error ? error.message : String(error)}`;

      if (this.statusEl) {
        this.statusEl.textContent = 'Error';
        this.statusEl.style.backgroundColor = '#f8d7da';
        this.statusEl.style.color = '#721c24';
      }

      console.error(error);
      this.dispatchEvent(new CustomEvent('finished'));
    }
  }
}

// Register the component
FolkWebLLM.define();

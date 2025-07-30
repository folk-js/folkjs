import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';
import { html3 } from '@folkjs/dom/tags';
import 'inspector-elements';

declare global {
  interface HTMLElementTagNameMap {
    'folk-repl': FolkRepl;
  }
}

export class FolkRepl extends ReactiveElement {
  static override styles = css`
    :host {
      display: block;
      font-family: monospace;
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 8px;
      background: #f9f9f9;
    }

    .input-line {
      display: flex;
      align-items: flex-start;
      width: 100%;
    }

    .prompt {
      color: #007acc;
      font-weight: bold;
      margin-right: 4px;
      flex-shrink: 0;
    }

    code {
      border: none;
      background: transparent;
      font-family: inherit;
      font-size: inherit;
      outline: none;
      min-height: 20px;
      white-space: pre-wrap;
      flex: 1;
      width: 100%;
    }

    code[contenteditable]:empty::after {
      content: attr(data-placeholder);
      color: #999;
      pointer-events: none;
    }

    .result {
      margin-left: 16px;
      margin-bottom: 8px;
    }

    .error {
      color: #d32f2f;
      background: #ffebee;
      padding: 4px 8px;
      border-radius: 3px;
      border-left: 3px solid #d32f2f;
    }
  `;

  value = '';
  #input!: HTMLElement;
  #variables: Record<string, any> = {};

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot() as ShadowRoot;

    const { frag, input } = this.#createInput();

    this.#input = input;

    // Set up event listeners
    this.#input.addEventListener('input', this.#handleInput);
    this.#input.addEventListener('keydown', this.#handleKeyDown);

    root.appendChild(frag);
    return root;
  }

  #createInput = () => {
    return html3(
      `<div class="input-line"><span class="prompt">❯</span><code ref="input" contenteditable="true" data-placeholder="Enter JavaScript code..."></code></div>`,
    );
  };

  #handleInput = (e: Event) => {
    const target = e.target as HTMLDivElement;
    this.value = target.textContent || '';
  };

  #handleKeyDown = (e: KeyboardEvent) => {
    // Execute on Enter (but allow Shift+Enter for new lines)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.#execute();
    }
  };

  // TODO: clean this up
  #execute() {
    if (!this.value.trim()) return;

    const input = this.value.trim();
    let result: any;
    let error: string | undefined;

    try {
      const declaration = this.#parseDeclaration(input);

      if (declaration) {
        // For declarations: extract the value and store it directly
        if (declaration.type === 'assignment') {
          // Reassignment: florb = 99
          const varDeclarations = Object.entries(this.#variables)
            .map(([name]) => `var ${name} = arguments[0].${name};`)
            .join('');
          const value = eval(`(function() { ${varDeclarations} return ${declaration.expression}; })`)(this.#variables);
          this.#variables[declaration.name] = value;
          result = value;
        } else {
          // New declaration: const florb = 1555
          // Just evaluate the expression part and store it
          const varDeclarations = Object.entries(this.#variables)
            .map(([name]) => `var ${name} = arguments[0].${name};`)
            .join('');
          const value = eval(`(function() { ${varDeclarations} return ${declaration.expression}; })`)(this.#variables);
          this.#variables[declaration.name] = value;
          result = value;
        }
      } else {
        // For expressions: inject variables and evaluate
        const varDeclarations = Object.entries(this.#variables)
          .map(([name]) => `var ${name} = arguments[0].${name};`)
          .join('');
        result = eval(`(function() { ${varDeclarations} return ${input}; })`)(this.#variables);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    // Freeze current input (remove contenteditable)
    this.#input.removeAttribute('contenteditable');

    // Add result
    if (error) {
      const { frag } = html3(`<div class="result"><div class="error">${error}</div></div>`);
      this.shadowRoot!.appendChild(frag);
    } else {
      const { frag, inspector } = html3(
        `<div class="result"><ix-object-inspector ref="inspector"></ix-object-inspector></div>`,
      );
      (inspector as any).data = result;
      this.shadowRoot!.appendChild(frag);

      // TODO figure out custom elem whenDefined dependencies
    }

    // Create new input
    const { frag: inputFrag, input: newInput } = this.#createInput();

    // Add new input to root
    this.shadowRoot!.appendChild(inputFrag);

    // Update reference and set up listeners
    this.#input = newInput;
    this.#input.addEventListener('input', this.#handleInput);
    this.#input.addEventListener('keydown', this.#handleKeyDown);

    // Clear value and focus new input
    this.value = '';
    this.#input.focus();

    // Ensure cursor is at the beginning of the contenteditable
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(this.#input);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  #parseDeclaration(code: string): {
    type: 'var' | 'let' | 'const' | 'function' | 'class' | 'assignment';
    name: string;
    expression?: string;
    fullCode: string;
  } | null {
    // Variable declarations: let foo = 5, const bar = [1,2,3], var baz = "hello"
    let match = code.match(/^(let|const|var)\s+(\w+)\s*=\s*(.+)$/);
    if (match) {
      return {
        type: match[1] as 'let' | 'const' | 'var',
        name: match[2],
        expression: match[3],
        fullCode: code,
      };
    }

    // Function declarations: function myFunc() { return 42; }
    match = code.match(/^function\s+(\w+)\s*\([^)]*\)\s*\{.*\}$/s);
    if (match) {
      return {
        type: 'function',
        name: match[1],
        fullCode: code,
      };
    }

    // Class declarations: class MyClass { constructor() {} }
    match = code.match(/^class\s+(\w+)(?:\s+extends\s+\w+)?\s*\{.*\}$/s);
    if (match) {
      return {
        type: 'class',
        name: match[1],
        fullCode: code,
      };
    }

    // Variable assignment (no declaration): foo = 5
    match = code.match(/^(\w+)\s*=\s*(.+)$/);
    if (match && this.#variables.hasOwnProperty(match[1])) {
      return {
        type: 'assignment',
        name: match[1],
        expression: match[2],
        fullCode: code,
      };
    }

    return null; // Not a declaration
  }
}

FolkRepl.define();

import { FolkElement } from '@folkjs/canvas';
import { css, type CSSResultGroup } from '@folkjs/canvas/reactive-element';
import { ELEMENT_IO_MAP, type ElementIO } from './html-io.js';

/**
 * Pipes data from element before to element after the <pipe> using {@link "html-io"}
 * This was thrown together quickly, most of the mess is in the special casing of scripts.
 * TBD what this becomes...
 */
export class FolkPipe extends FolkElement {
  static override tagName = 'folk-pipe';

  static override styles: CSSResultGroup = css`
    :host {
      display: none;
    }
  `;

  #sourceElement: Element | null = null;
  #targetElement: Element | null = null;

  #structuralObserver: MutationObserver | null = null;
  #contentObserver: MutationObserver | null = null;
  #eventCleanup: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.#setup();
    this.#observeStructuralChanges();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#cleanup();
  }

  #setup() {
    this.#sourceElement = this.previousElementSibling;
    this.#targetElement = this.nextElementSibling;

    if (!this.#sourceElement || !this.#targetElement) return;

    this.#setupObservation();
    this.#pipe();
  }

  #cleanup() {
    this.#eventCleanup?.();
    this.#eventCleanup = null;
    this.#contentObserver?.disconnect();
    this.#contentObserver = null;
    this.#structuralObserver?.disconnect();
    this.#structuralObserver = null;
    this.#sourceElement = null;
    this.#targetElement = null;
  }

  async #pipe() {
    if (!this.#sourceElement || !this.#targetElement) return;

    try {
      const sourceValue = await this.#getValue(this.#sourceElement);
      await this.#setValue(this.#targetElement, sourceValue);
    } catch (error) {
      console.error('Error in pipe:', error);
      await this.#setValue(this.#targetElement, `Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async #getValue(element: Element): Promise<any> {
    if (element.tagName === 'SCRIPT') {
      return this.#getScriptValue(element as HTMLScriptElement);
    }

    const io = ELEMENT_IO_MAP.get(element.tagName);
    return io ? await io.getValue(element) : '';
  }

  async #setValue(element: Element, value: any): Promise<void> {
    if (element.tagName === 'SCRIPT') {
      return this.#setScriptValue(element as HTMLScriptElement, value);
    }

    const io = ELEMENT_IO_MAP.get(element.tagName);
    if (io) {
      await io.setValue(element, value);
    }
  }

  // Script-specific logic isolated here
  async #getScriptValue(script: HTMLScriptElement): Promise<any> {
    // Return cached result if available
    if ((script as any)._pipeResult !== undefined) {
      return (script as any)._pipeResult;
    }

    // Execute hash module
    if (script.type === 'hash-module' && script.id) {
      try {
        const module = await import(`#${script.id}`);

        if (typeof module.default === 'function') {
          const inputValue = await this.#getScriptInput(script);
          const result = await module.default(inputValue);
          (script as any)._pipeResult = result;
          return result;
        }
      } catch (error) {
        console.error('Error executing hash module:', error);
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    return script.textContent || '';
  }

  async #setScriptValue(script: HTMLScriptElement, value: any): Promise<void> {
    if (script.type === 'hash-module' && script.id) {
      try {
        const module = await import(`#${script.id}`);

        if (typeof module.default === 'function') {
          const result = await module.default(value);
          (script as any)._pipeResult = result;
          this.#triggerDownstreamPipe(script);
        }
      } catch (error) {
        console.error('Error executing hash module on setValue:', error);
        (script as any)._pipeResult = `Error: ${error instanceof Error ? error.message : String(error)}`;
        this.#triggerDownstreamPipe(script);
      }
    } else {
      script.textContent = String(value);
    }
  }

  async #getScriptInput(script: HTMLScriptElement): Promise<any> {
    const prevPipe = script.previousElementSibling;
    if (prevPipe?.tagName === 'FOLK-PIPE') {
      const prevSource = prevPipe.previousElementSibling;
      if (prevSource) {
        return await this.#getValue(prevSource);
      }
    }
    return undefined;
  }

  #triggerDownstreamPipe(script: HTMLScriptElement): void {
    const nextPipe = script.nextElementSibling;
    if (nextPipe?.tagName === 'FOLK-PIPE') {
      script.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  #setupObservation() {
    if (!this.#sourceElement) return;

    // Event listening
    const isScript = this.#sourceElement.tagName === 'SCRIPT';
    const io = ELEMENT_IO_MAP.get(this.#sourceElement.tagName);
    const eventName = isScript ? 'input' : io?.getChangeEventName(this.#sourceElement) || 'input';

    const handler = () => this.#pipe();
    this.#sourceElement.addEventListener(eventName, handler);

    if (this.#sourceElement.hasAttribute('contenteditable')) {
      this.#sourceElement.addEventListener('input', handler);
    }

    this.#eventCleanup = () => {
      if (this.#sourceElement) {
        this.#sourceElement.removeEventListener(eventName, handler);
        if (this.#sourceElement.hasAttribute('contenteditable')) {
          this.#sourceElement.removeEventListener('input', handler);
        }
      }
    };

    // Content observation
    this.#contentObserver = new MutationObserver(() => this.#pipe());
    this.#contentObserver.observe(this.#sourceElement, {
      attributes: true,
      attributeFilter: ['value', 'src'],
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  #observeStructuralChanges() {
    if (!this.parentElement) return;

    this.#structuralObserver = new MutationObserver((mutations) => {
      // Simple check: if any child nodes changed in our parent, refresh
      const hasChildListChanges = mutations.some((m) => m.type === 'childList');
      if (hasChildListChanges) {
        this.#cleanup();
        this.#setup();
      }
    });

    this.#structuralObserver.observe(this.parentElement, {
      childList: true,
    });
  }
}

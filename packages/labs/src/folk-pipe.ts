import { FolkElement } from '@folkjs/canvas';
import { css, property, state, type CSSResultGroup } from '@folkjs/canvas/reactive-element';
import { ELEMENT_IO_MAP, type ElementIO } from './html-io.js';

// Hash module system integration
async function ensureHashModulesReady(): Promise<void> {
  // Check if hash modules are already ready (from HTML bootloader)
  if ((window as any).hashModulesReady) {
    return Promise.resolve();
  }

  // Wait for hash modules to be ready
  return new Promise<void>((resolve) => {
    const handleReady = () => {
      document.removeEventListener('hash-modules-ready', handleReady);
      resolve();
    };

    document.addEventListener('hash-modules-ready', handleReady);
  });
}

export class FolkPipe extends FolkElement {
  static override tagName = 'folk-pipe';

  static override styles: CSSResultGroup = css`
    :host {
      display: none;
    }
  `;

  @state() private sourceElement: Element | null = null;
  @state() private targetElement: Element | null = null;

  #structuralMutationObserver: MutationObserver | null = null;
  #contentMutationObserver: MutationObserver | null = null;
  #sourceEventListener: ((event: Event) => void) | null = null;
  #lastSourceValue: any = null;

  override connectedCallback() {
    super.connectedCallback();
    this.#setupPipe();
    this.#observeStructuralChanges();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#cleanup();
  }

  #setupPipe() {
    this.#findElements();
    this.#setupReactivity();
    this.#performInitialSync();
  }

  #findElements() {
    const previousSibling = this.previousElementSibling;
    const nextSibling = this.nextElementSibling;

    this.sourceElement = previousSibling;
    this.targetElement = nextSibling;
  }

  #setupReactivity() {
    this.#removeReactivity();

    if (!this.sourceElement) return;

    // Setup both event listening AND content observation
    this.#setupEventListening();
    this.#setupContentObservation();
  }

  #setupEventListening() {
    if (!this.sourceElement) return;

    // Special handling for script elements
    if (this.sourceElement.tagName === 'SCRIPT') {
      this.#sourceEventListener = () => {
        this.#syncFromSourceToTarget();
      };
      this.sourceElement.addEventListener('input', this.#sourceEventListener);
      return;
    }

    const io = this.#getElementIO(this.sourceElement);
    if (!io) return;

    const eventName = io.getChangeEventName(this.sourceElement);

    this.#sourceEventListener = () => {
      this.#syncFromSourceToTarget();
    };

    this.sourceElement.addEventListener(eventName, this.#sourceEventListener);

    // Also listen for contenteditable changes
    if (this.sourceElement.hasAttribute('contenteditable')) {
      this.sourceElement.addEventListener('input', this.#sourceEventListener);
    }
  }

  #setupContentObservation() {
    if (!this.sourceElement) return;

    this.#contentMutationObserver = new MutationObserver((mutations) => {
      let shouldSync = false;

      for (const mutation of mutations) {
        // Check for text content changes
        if (mutation.type === 'characterData') {
          shouldSync = true;
          break;
        }

        // Check for attribute changes (like value, src, etc.)
        if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;
          if (
            attrName === 'value' ||
            attrName === 'src' ||
            (this.sourceElement!.tagName === 'INPUT' && attrName === 'value')
          ) {
            shouldSync = true;
            break;
          }
        }

        // Check for child node changes (affects textContent)
        if (mutation.type === 'childList') {
          shouldSync = true;
          break;
        }
      }

      if (shouldSync) {
        this.#syncFromSourceToTarget();
      }
    });

    // Observe the source element for content changes
    this.#contentMutationObserver.observe(this.sourceElement, {
      attributes: true,
      attributeFilter: ['value', 'src'],
      characterData: true,
      childList: true,
      subtree: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    });
  }

  #removeReactivity() {
    this.#removeEventListening();
    this.#removeContentObservation();
  }

  #removeEventListening() {
    if (this.#sourceEventListener && this.sourceElement) {
      // Special handling for script elements
      if (this.sourceElement.tagName === 'SCRIPT') {
        this.sourceElement.removeEventListener('input', this.#sourceEventListener);
      } else {
        const io = this.#getElementIO(this.sourceElement);
        if (io) {
          const eventName = io.getChangeEventName(this.sourceElement);
          this.sourceElement.removeEventListener(eventName, this.#sourceEventListener);
        }

        if (this.sourceElement.hasAttribute('contenteditable')) {
          this.sourceElement.removeEventListener('input', this.#sourceEventListener);
        }
      }
    }
    this.#sourceEventListener = null;
  }

  #removeContentObservation() {
    this.#contentMutationObserver?.disconnect();
    this.#contentMutationObserver = null;
  }

  #performInitialSync() {
    this.#syncFromSourceToTarget();
  }

  async #syncFromSourceToTarget() {
    if (!this.sourceElement || !this.targetElement) return;

    try {
      let sourceValue;

      // Special handling for script elements
      if (this.sourceElement.tagName === 'SCRIPT') {
        sourceValue = await this.#handleScriptElement(this.sourceElement as HTMLScriptElement);
      } else {
        const sourceIO = this.#getElementIO(this.sourceElement);
        if (!sourceIO) return;
        sourceValue = await sourceIO.getValue(this.sourceElement);
      }

      if (sourceValue !== this.#lastSourceValue) {
        this.#lastSourceValue = sourceValue;
      }

      // Special handling for script targets
      if (this.targetElement.tagName === 'SCRIPT') {
        await this.#setScriptValue(this.targetElement as HTMLScriptElement, sourceValue);
      } else {
        const targetIO = this.#getElementIO(this.targetElement);
        if (targetIO) {
          await targetIO.setValue(this.targetElement, sourceValue);
        }
      }
    } catch (error) {
      console.error('Error syncing from source to target:', error);
      // Set error message on target
      const targetIO = this.#getElementIO(this.targetElement);
      if (targetIO) {
        targetIO.setValue(this.targetElement, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async #handleScriptElement(el: HTMLScriptElement): Promise<any> {
    // For hash modules, return the cached result from execution
    if (el.type === 'hash-module' && el.id) {
      // If we have a cached result, return it
      if ((el as any)._pipeResult !== undefined) {
        return (el as any)._pipeResult;
      }

      // Otherwise execute fresh (for initial sync)
      try {
        await ensureHashModulesReady();
        const module = await import(`#${el.id}`);

        if (typeof module.default === 'function') {
          const inputValue = await this.#getInputForScript(el);
          const result = await module.default(inputValue);
          (el as any)._pipeResult = result;
          return result;
        }
      } catch (error) {
        console.error('Error executing hash module:', error);
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    // Fallback to textContent for non-hash modules
    return el.textContent || '';
  }

  async #setScriptValue(el: HTMLScriptElement, value: any): Promise<void> {
    // For hash modules, execute and trigger downstream pipe
    if (el.type === 'hash-module' && el.id) {
      try {
        // Ensure all hash modules are processed first
        await ensureHashModulesReady();

        const module = await import(`#${el.id}`);

        if (typeof module.default === 'function') {
          const result = await module.default(value);

          // Store result so it can be retrieved by getValue (as actual object, not string)
          (el as any)._pipeResult = result;

          // Trigger the next pipe in the chain
          this.#triggerDownstreamPipe(el);
        }
      } catch (error) {
        console.error('Error executing hash module on setValue:', error);
        (el as any)._pipeResult = `Error: ${error instanceof Error ? error.message : String(error)}`;
        // Still trigger downstream even on error so error propagates
        this.#triggerDownstreamPipe(el);
      }
    } else {
      // For regular scripts, just set textContent
      el.textContent = String(value);
    }
  }

  async #getInputForScript(scriptElement: HTMLScriptElement): Promise<any> {
    const prevPipe = scriptElement.previousElementSibling;
    if (prevPipe && prevPipe.tagName === 'FOLK-PIPE') {
      const prevSource = prevPipe.previousElementSibling;
      if (prevSource) {
        return await this.#getValueFromPreviousInChain(prevSource);
      }
    }
    return undefined;
  }

  #getElementIO(element: Element): ElementIO | null {
    return ELEMENT_IO_MAP.get(element.tagName) || null;
  }

  async #getValueFromPreviousInChain(element: Element): Promise<any> {
    // Special handling for script elements
    if (element.tagName === 'SCRIPT') {
      return await this.#handleScriptElement(element as HTMLScriptElement);
    }

    const io = this.#getElementIO(element);
    if (!io) return undefined;

    return await io.getValue(element);
  }

  #observeStructuralChanges() {
    this.#structuralMutationObserver = new MutationObserver((mutations) => {
      let shouldRefresh = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if elements around us have changed
          const addedNodes = Array.from(mutation.addedNodes);
          const removedNodes = Array.from(mutation.removedNodes);

          if (addedNodes.includes(this) || removedNodes.includes(this)) {
            shouldRefresh = true;
            break;
          }

          // Check if our source or target elements were moved/removed
          if (this.sourceElement && removedNodes.includes(this.sourceElement)) {
            shouldRefresh = true;
            break;
          }
          if (this.targetElement && removedNodes.includes(this.targetElement)) {
            shouldRefresh = true;
            break;
          }

          // Check if siblings around us changed
          if (mutation.target === this.parentElement) {
            shouldRefresh = true;
            break;
          }
        }
      }

      if (shouldRefresh) {
        this.#setupPipe();
      }
    });

    // Observe the parent and document for structural changes
    if (this.parentElement) {
      this.#structuralMutationObserver.observe(this.parentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  #triggerDownstreamPipe(scriptElement: HTMLScriptElement): void {
    // Find the next pipe after this script
    const nextPipe = scriptElement.nextElementSibling;
    if (nextPipe && nextPipe.tagName === 'FOLK-PIPE') {
      // Trigger the script element to fire an input event so the pipe picks it up
      scriptElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  #cleanup() {
    this.#removeReactivity();
    this.#structuralMutationObserver?.disconnect();
    this.#structuralMutationObserver = null;
  }
}

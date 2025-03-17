/**
 * CopyPasteHandler - Manages copying and pasting of custom elements with support for
 * cross-page clipboard operations and dynamic import of unregistered elements.
 */
export class CopyPasteHandler {
  private selectedElements = new Set<Element>();
  private container: HTMLElement;
  private statusElement: HTMLElement | null;
  private mimeType: string;

  /**
   * Creates a new CopyPasteHandler
   * @param container - The container element that holds the elements to be copied/pasted
   * @param options - Configuration options
   */
  constructor(
    container: HTMLElement,
    options: {
      statusElement?: HTMLElement | null;
      selectionClass?: string;
      mimeType?: string;
    } = {},
  ) {
    this.container = container;
    this.statusElement = options.statusElement || null;
    this.mimeType = options.mimeType || 'application/folk-elements';

    const selectionClass = options.selectionClass || 'selected';

    // Set up click handler for selection
    this.container.addEventListener('click', (e) => {
      // Only select elements that are direct children of the container
      const target = e.target as HTMLElement;

      if (target !== this.container && this.container.contains(target)) {
        if (!e.shiftKey) {
          // Clear previous selection if not shift-clicking
          this.clearSelection();
        }

        // Toggle selection for the clicked element
        this.toggleSelection(target);

        // Update status
        this.updateStatus();

        // Stop propagation to prevent container from handling the click
        e.stopPropagation();
      } else if (target === this.container || e.currentTarget === this.container) {
        // Deselect all when clicking on empty space (without shift)
        if (!e.shiftKey) {
          this.clearSelection();
          this.updateStatus();
        }
      }
    });

    // Set up copy event
    document.addEventListener('copy', (e) => {
      if (this.selectedElements.size > 0) {
        const serializedElements = Array.from(this.selectedElements).map(this.serializeElement);
        e.clipboardData?.setData(this.mimeType, JSON.stringify(serializedElements));
        e.preventDefault();
        this.updateStatus(
          `Copied ${this.selectedElements.size} element${this.selectedElements.size > 1 ? 's' : ''} to clipboard`,
        );
      }
    });

    // Set up paste event
    document.addEventListener('paste', async (e) => {
      const folkData = e.clipboardData?.getData(this.mimeType);

      if (folkData) {
        try {
          const serializedElements = JSON.parse(folkData);

          // Create a document fragment to hold all new elements
          const fragment = document.createDocumentFragment();

          // Process each serialized element
          for (const serialized of serializedElements) {
            const newElement = await this.deserializeElement(serialized);

            // Generate a new ID to avoid duplicates
            if (newElement.hasAttribute('id')) {
              const originalId = newElement.getAttribute('id');
              const newId = `${originalId}_copy_${Date.now().toString().slice(-5)}`;
              newElement.setAttribute('id', newId);
            }

            fragment.appendChild(newElement);
          }

          // Add all elements to the container
          this.container.appendChild(fragment);

          // Update status
          this.updateStatus(
            `Pasted ${serializedElements.length} element${serializedElements.length > 1 ? 's' : ''} from clipboard`,
          );
          e.preventDefault();
        } catch (error) {
          console.error('Failed to paste elements:', error);
          this.updateStatus('Failed to paste elements');
        }
      }
    });

    // Set up keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && this.selectedElements.size > 0) {
        document.execCommand('copy');
      }

      // Ctrl+V or Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        document.execCommand('paste');
      }

      // Escape to clear selection
      if (e.key === 'Escape' && this.selectedElements.size > 0) {
        this.clearSelection();
        this.updateStatus();
      }
    });

    // Helper function to toggle selection for an element
    this.toggleSelection = (element: Element) => {
      if (this.selectedElements.has(element)) {
        this.selectedElements.delete(element);
        element.classList.remove(selectionClass);
      } else {
        this.selectedElements.add(element);
        element.classList.add(selectionClass);
      }
    };
  }

  /**
   * Clears all current selections
   */
  clearSelection(): void {
    const selectionClass = 'selected';
    this.selectedElements.forEach((element) => {
      element.classList.remove(selectionClass);
    });
    this.selectedElements.clear();
  }

  /**
   * Updates the status message if a status element is provided
   */
  private updateStatus(message?: string): void {
    if (!this.statusElement) return;

    const count = this.selectedElements.size;
    if (!message) {
      if (count === 0) {
        this.statusElement.textContent =
          'Use SHIFT+click to select multiple elements. Copy with Ctrl+C/Cmd+C, paste with Ctrl+V/Cmd+V.';
      } else {
        this.statusElement.textContent = `${count} element${count > 1 ? 's' : ''} selected. Copy with Ctrl+C/Cmd+C, paste with Ctrl+V/Cmd+V.`;
      }
    } else {
      this.statusElement.textContent = message;
    }
  }

  /**
   * Serializes an element to a JSON representation
   */
  private serializeElement(element: Element): any {
    const constructor = customElements.get(element.tagName.toLowerCase());

    // Check if importSrc is defined on the constructor
    if (!constructor?.importSrc) {
      console.error(
        `Warning: ${element.tagName.toLowerCase()} does not have importSrc defined. Cross-page pasting may not work.`,
      );
    }

    // Get all attributes
    const attributes: Record<string, string> = {};
    for (const attr of element.attributes) {
      attributes[attr.name] = attr.value;
    }

    // Get computed position if it's a folk-shape
    if (element.tagName.toLowerCase() === 'folk-shape') {
      // Get the computed style of the element
      const computedStyle = window.getComputedStyle(element);

      // Extract the folk-specific CSS variables that store the actual position and dimensions
      const folkX = computedStyle.getPropertyValue('--folk-x').trim();
      const folkY = computedStyle.getPropertyValue('--folk-y').trim();
      const folkWidth = computedStyle.getPropertyValue('--folk-width').trim();
      const folkHeight = computedStyle.getPropertyValue('--folk-height').trim();
      const folkRotation = computedStyle.getPropertyValue('--folk-rotation').trim();

      // Update the attributes with the current values from CSS variables
      if (folkX) attributes['x'] = folkX;
      if (folkY) attributes['y'] = folkY;
      if (folkWidth) attributes['width'] = folkWidth;
      if (folkHeight) attributes['height'] = folkHeight;
      if (folkRotation) attributes['rotation'] = folkRotation;
    }

    // Create serialized representation
    const serialized = {
      tagName: element.tagName.toLowerCase(),
      importSrc: constructor?.importSrc,
      attributes: attributes,
      innerHTML: element.innerHTML,
    };

    return serialized;
  }

  /**
   * Deserializes an element from a JSON representation
   */
  private async deserializeElement(serialized: any): Promise<Element> {
    const { tagName, importSrc, attributes, innerHTML } = serialized;

    // Check if the custom element is defined
    let constructor = customElements.get(tagName);

    // If not defined, import it dynamically
    if (!constructor && importSrc) {
      try {
        await import(importSrc);
        constructor = customElements.get(tagName);
      } catch (error) {
        console.error(`Failed to import ${tagName} from ${importSrc}:`, error);
      }
    } else if (!constructor && !importSrc) {
      console.error(`Cannot create ${tagName} element: No importSrc defined and element is not registered.`);
    }

    // Create the element
    const element = document.createElement(tagName);

    // Set attributes
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }

    // Set inner HTML
    element.innerHTML = innerHTML;

    return element;
  }

  /**
   * Toggles selection for an element
   */
  toggleSelection: (element: Element) => void;

  /**
   * Gets the currently selected elements
   */
  getSelectedElements(): Set<Element> {
    return this.selectedElements;
  }
}

// Add the importSrc property to the CustomElementConstructor interface
declare global {
  interface CustomElementConstructor {
    importSrc?: string;
  }
}

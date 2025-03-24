/**
 * CopyPasteHandler - Manages copying and pasting of custom elements with support for
 * cross-page clipboard operations and dynamic import of unregistered elements.
 *
 * NOTE: All very hacky, just wanted to get *something* working.
 */
export class CopyPasteHandler {
  private selectedElements = new Set<Element>();
  private container: HTMLElement;
  private mimeType: string;
  private onSelectionChange: ((selectedCount: number) => void) | null;

  /**
   * Creates a new CopyPasteHandler
   * @param container - The container element that holds the elements to be copied/pasted
   * @param options - Configuration options
   */
  constructor(
    container: HTMLElement,
    options: {
      selectionClass?: string;
      mimeType?: string;
      onSelectionChange?: (selectedCount: number) => void;
    } = {},
  ) {
    this.container = container;
    this.mimeType = options.mimeType || 'application/folk-elements';
    this.onSelectionChange = options.onSelectionChange || null;

    const selectionClass = options.selectionClass || 'selected';

    // Set up click handler for selection
    this.container.addEventListener('click', (e) => {
      // Get the actual target element
      const target = e.target as HTMLElement;

      // Check if we clicked directly on the container (empty space)
      if (target === this.container) {
        // Deselect all when clicking on empty space (without shift)
        if (!e.shiftKey) {
          this.clearSelection();
          this.notifySelectionChange();
        }
        return;
      }

      // Check if we clicked on a child element
      if (this.container.contains(target)) {
        if (!e.shiftKey) {
          // Clear previous selection if not shift-clicking
          this.clearSelection();
        }

        // Toggle selection for the clicked element
        this.toggleSelection(target, selectionClass);

        // Notify about selection change
        this.notifySelectionChange();

        // Stop propagation to prevent container from handling the click
        e.stopPropagation();
      }
    });

    // Set up copy event
    document.addEventListener('copy', (e) => {
      if (this.selectedElements.size > 0) {
        const serializedElements = Array.from(this.selectedElements).map(this.serializeElement);
        e.clipboardData?.setData(this.mimeType, JSON.stringify(serializedElements));
        e.preventDefault();
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
          e.preventDefault();
        } catch (error) {
          console.error('Failed to paste elements:', error);
        }
      }
    });

    // Set up keyboard shortcuts
    document.addEventListener('keydown', async (e) => {
      // Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && this.selectedElements.size > 0) {
        // Use Clipboard API instead of execCommand
        try {
          const serializedElements = Array.from(this.selectedElements).map(this.serializeElement);
          await navigator.clipboard.writeText(JSON.stringify(serializedElements));
          // Also set custom format if permissions allow
          // Note: This might not work in all browsers due to permission restrictions
          if (navigator.clipboard.write) {
            const clipboardItem = new ClipboardItem({
              [this.mimeType]: new Blob([JSON.stringify(serializedElements)], { type: this.mimeType }),
            });
            await navigator.clipboard.write([clipboardItem]);
          }
        } catch (error) {
          console.error('Failed to copy to clipboard:', error);
        }
        e.preventDefault();
      }

      // Ctrl+V or Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        try {
          // Try to read from clipboard using the Clipboard API
          const clipboardText = await navigator.clipboard.readText();
          try {
            // Try to parse as JSON
            const serializedElements = JSON.parse(clipboardText);
            if (Array.isArray(serializedElements)) {
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
              e.preventDefault();
            }
          } catch (parseError) {
            // Not our format, let the browser handle it
            console.log('Clipboard data is not in our format, letting browser handle paste');
          }
        } catch (error) {
          console.error('Failed to read from clipboard:', error);
          // Fall back to the paste event handler
          // The browser's paste event will still fire
        }
      }

      // Escape to clear selection
      if (e.key === 'Escape' && this.selectedElements.size > 0) {
        this.clearSelection();
        this.notifySelectionChange();
      }
    });
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
   * Notifies about selection changes
   */
  private notifySelectionChange(): void {
    if (this.onSelectionChange) {
      this.onSelectionChange(this.selectedElements.size);
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
    // NOTE: this is a hack to get the position of the element
    // TODO: sort out attribute reflection for folk-shape so we can make this generic
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
      //  NOTE: this is a hack to get the base URL of the project
      // TODO: find a better way to do this
      const baseUrl = new URL('.', import.meta.url).href.replace(/\/labs$/, '');
      const path = `${baseUrl}${importSrc}`;

      try {
        console.log(`Trying to import ${tagName} from: ${path}`);
        await import(path);

        // Check if the element is now defined
        if (customElements.get(tagName)) {
          console.log(`Successfully imported ${tagName} from ${path}`);
        }
      } catch (error) {
        console.error(`Failed to import ${tagName} from ${path}:`, error);
      }

      // Get the constructor again after import attempts
      constructor = customElements.get(tagName);
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
  toggleSelection(element: Element, selectionClass: string = 'selected'): void {
    if (this.selectedElements.has(element)) {
      this.selectedElements.delete(element);
      element.classList.remove(selectionClass);
    } else {
      this.selectedElements.add(element);
      element.classList.add(selectionClass);
    }
  }

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

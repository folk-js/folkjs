import { FolkElement, Point } from '@lib';
import { css } from '@lib/tags';
import { FolkAutomerge } from './FolkAutomerge';
import { FolkSpace } from './folk-space';

declare global {
  interface HTMLElementTagNameMap {
    'folk-presence': FolkPresence;
  }
}

interface PointerData {
  id: string;
  x: number;
  y: number;
  color: string;
  name: string;
  lastActive: number;
}

interface PointerState {
  pointers: Record<string, PointerData>;
}

// Add a list of short random name components
const shortAdjectives = [
  'red',
  'blue',
  'cool',
  'wild',
  'tiny',
  'big',
  'odd',
  'shy',
  'bold',
  'calm',
  'fast',
  'slow',
  'wise',
  'zany',
];
const shortNouns = [
  'cat',
  'dog',
  'fox',
  'owl',
  'bee',
  'ant',
  'bat',
  'elk',
  'fish',
  'frog',
  'hawk',
  'wolf',
  'bear',
  'duck',
];

/**
 * FolkPresence is a custom element that adds real-time collaborative cursors
 * to a folk-space element. It handles both the visual representation of pointers and
 * the synchronization of pointer positions across clients using FolkAutomerge.
 */
export class FolkPresence extends FolkElement {
  static tagName = 'folk-presence';

  static styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
    }

    .pointer {
      position: absolute;
      pointer-events: none;
      transform-origin: 0 0;
      transition: transform 0.05s ease-out;
    }

    .cursor {
      position: absolute;
      width: 14px;
      height: 21px;
    }

    .cursor svg {
      width: 100%;
      height: 100%;
      filter: drop-shadow(0px 1px 1px rgba(0, 0, 0, 0.3));
      transform-origin: top left;
    }

    .cursor svg path {
      fill: currentColor;
      stroke: #222;
      stroke-width: 0.5px;
    }

    .name-tag {
      position: absolute;
      left: 14px;
      top: -5px;
      color: #000;
      padding: 2px 0;
      font-size: 12px;
      white-space: nowrap;
      font-family: 'Recursive', sans-serif;
      font-variation-settings: 'CASL' 1;
      font-weight: 500;
    }

    .afk .cursor {
      opacity: 0.5;
    }

    .afk .name-tag::after {
      content: ' (away)';
      opacity: 0.7;
      font-style: italic;
    }
  `;

  // Automerge instance for syncing pointer positions
  public automerge!: FolkAutomerge<PointerState>;

  // Container element (usually the folk-space)
  private container!: HTMLElement;
  private folkSpace!: FolkSpace;

  // Map of pointer elements by ID
  private pointers: Map<string, HTMLElement> = new Map();

  // Local pointer information
  public localPointerId: string;
  private localPointerData: PointerData;

  // Throttling for mouse move events
  private throttleTimeout: number | null = null;
  private throttleDelay = 30; // ms

  // AFK and removal timeouts (in milliseconds)
  private afkTimeout = 30 * 1000; // 30 seconds for AFK
  private removalTimeout = 60 * 1000; // 1 minute for removal
  private activityCheckInterval: number | null = null;

  // Available colors for pointers
  private colors = [
    '#FF5722', // Deep Orange
    '#2196F3', // Blue
    '#4CAF50', // Green
    '#9C27B0', // Purple
    '#FFEB3B', // Yellow
    '#00BCD4', // Cyan
    '#F44336', // Red
    '#3F51B5', // Indigo
  ];

  // Username for this client
  #username: string;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Generate a random ID for this client's pointer
    this.localPointerId = this.generateId();

    // Set default username with short random name
    this.#username = this.generateShortRandomName();

    // Generate a random color for this user
    const randomColor = this.colors[Math.floor(Math.random() * this.colors.length)];

    // Initialize local pointer data
    this.localPointerData = {
      id: this.localPointerId,
      x: 0,
      y: 0,
      color: randomColor,
      name: this.#username,
      lastActive: Date.now(),
    };
  }

  connectedCallback() {
    super.connectedCallback();

    // Find the container (parent element, usually folk-space)
    this.container = this.parentElement || document.body;

    // Check if the container is a FolkSpace
    if (this.container instanceof FolkSpace) {
      this.folkSpace = this.container;
    } else {
      console.error('FolkMultiplayerPointers must be a child of FolkSpace');
    }

    // Initialize Automerge with initial state
    this.automerge = new FolkAutomerge<PointerState>({
      pointers: {
        [this.localPointerId]: this.localPointerData,
      },
    });

    // Listen for remote changes
    this.automerge.onRemoteChange((doc) => {
      this.updatePointersFromState(doc);
    });

    // Add mouse move listener to track local pointer
    this.container.addEventListener('mousemove', this.handleMouseMove);

    // Add mouse leave listener to hide local pointer when mouse leaves container
    this.container.addEventListener('mouseleave', this.handleMouseLeave);

    // Start activity check interval
    this.activityCheckInterval = window.setInterval(() => {
      this.checkActivityStatus();
    }, 5000); // Check every 5 seconds for more responsive removal
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Clean up event listeners
    this.container.removeEventListener('mousemove', this.handleMouseMove);
    this.container.removeEventListener('mouseleave', this.handleMouseLeave);

    // Clear activity check interval
    if (this.activityCheckInterval !== null) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }

    // Clear all pointers
    this.clearPointers();
  }

  /**
   * Generates a random ID for a pointer.
   */
  private generateId(): string {
    return `pointer-${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Generates a short random name like "redcat" or "bluefox"
   */
  private generateShortRandomName(): string {
    const adjective = shortAdjectives[Math.floor(Math.random() * shortAdjectives.length)];
    const noun = shortNouns[Math.floor(Math.random() * shortNouns.length)];
    return adjective + noun;
  }

  /**
   * Handles mouse move events to update the local pointer position.
   */
  private handleMouseMove = (event: MouseEvent) => {
    // Get mouse position relative to container
    const rect = this.container.getBoundingClientRect();
    const clientX = event.clientX - rect.left;
    const clientY = event.clientY - rect.top;

    // Use FolkSpace's mapPointFromParent to get the correct space coordinates
    let spacePoint: Point;
    if (this.folkSpace) {
      spacePoint = this.folkSpace.mapPointFromParent({ x: clientX, y: clientY });
    } else {
      // Fallback if not in a FolkSpace
      spacePoint = { x: clientX, y: clientY };
    }

    // Update local pointer with throttling
    if (this.throttleTimeout === null) {
      this.throttleTimeout = window.setTimeout(() => {
        this.updateLocalPointer({
          ...this.localPointerData,
          x: spacePoint.x,
          y: spacePoint.y,
          lastActive: Date.now(),
        });
        this.throttleTimeout = null;
      }, this.throttleDelay);
    }
  };

  /**
   * Handles mouse leave events to hide the local pointer.
   */
  private handleMouseLeave = () => {
    this.updateLocalPointer({
      ...this.localPointerData,
      x: -1000,
      y: -1000,
      lastActive: Date.now(),
    });
  };

  /**
   * Updates the local pointer position and syncs it with other clients.
   */
  private updateLocalPointer(data: PointerData) {
    this.localPointerData = data;

    // Update the Automerge document with the new pointer position
    this.automerge.change((doc) => {
      doc.pointers[this.localPointerId] = data;
    });
  }

  /**
   * Checks the activity status of all pointers and updates their AFK status or removes them.
   */
  private checkActivityStatus() {
    const now = Date.now();
    let hasChanges = false;

    this.automerge.change((doc) => {
      // Check all pointers
      for (const [id, pointer] of Object.entries(doc.pointers)) {
        const timeSinceActive = now - pointer.lastActive;

        // Remove pointers that have been inactive for too long
        if (timeSinceActive > this.removalTimeout && id !== this.localPointerId) {
          delete doc.pointers[id];
          hasChanges = true;

          // Also remove from the DOM immediately
          const pointerElement = this.pointers.get(id);
          if (pointerElement) {
            pointerElement.remove();
            this.pointers.delete(id);
          }
        }
      }
    });

    // Update the UI to reflect AFK status
    if (hasChanges) {
      this.automerge.whenReady((doc) => {
        this.updatePointersFromState(doc);
      });
    } else {
      // Even if no removals, still update AFK status
      this.automerge.whenReady((doc) => {
        this.updatePointersFromState(doc);
      });
    }
  }

  /**
   * Updates the pointers based on the current state from Automerge.
   */
  private updatePointersFromState(state: PointerState) {
    // Skip our own pointer
    const remotePointers = Object.values(state.pointers).filter((pointer) => pointer.id !== this.localPointerId);
    const now = Date.now();

    // Remove pointers that no longer exist
    for (const [id, pointerElement] of this.pointers.entries()) {
      if (!remotePointers.some((p) => p.id === id)) {
        pointerElement.remove();
        this.pointers.delete(id);
      }
    }

    // Update or create pointers
    for (const pointerData of remotePointers) {
      let pointerElement = this.pointers.get(pointerData.id);

      if (!pointerElement) {
        // Create new pointer element
        pointerElement = this.createPointerElement(pointerData);
        this.shadowRoot?.appendChild(pointerElement);
        this.pointers.set(pointerData.id, pointerElement);
      }

      // Update pointer with coordinates directly from the data
      // No need to transform coordinates here as they are already in space coordinates
      this.updatePointerElement(pointerElement, pointerData);

      // Check if pointer is AFK
      const isAfk = now - pointerData.lastActive > this.afkTimeout;
      pointerElement.classList.toggle('afk', isAfk);
    }
  }

  /**
   * Creates a new pointer element.
   */
  private createPointerElement(data: PointerData): HTMLElement {
    const pointerElement = document.createElement('div');
    pointerElement.className = 'pointer';
    pointerElement.dataset.pointerId = data.id;

    const cursorElement = document.createElement('div');
    cursorElement.className = 'cursor';

    // Create SVG cursor
    const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgElement.setAttribute('viewBox', '8 3 14 24');
    svgElement.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    svgElement.style.overflow = 'visible';

    // Create cursor path
    const cursorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    cursorPath.setAttribute(
      'd',
      'M 9 3 A 1 1 0 0 0 8 4 L 8 21 A 1 1 0 0 0 9 22 A 1 1 0 0 0 9.796875 21.601562 L 12.919922 18.119141 L 16.382812 26.117188 C 16.701812 26.855187 17.566828 27.188469 18.298828 26.855469 C 19.020828 26.527469 19.340672 25.678078 19.013672 24.955078 L 15.439453 17.039062 L 21 17 A 1 1 0 0 0 22 16 A 1 1 0 0 0 21.628906 15.222656 L 9.7832031 3.3789062 A 1 1 0 0 0 9 3 z',
    );

    svgElement.appendChild(cursorPath);
    cursorElement.appendChild(svgElement);

    const nameElement = document.createElement('div');
    nameElement.className = 'name-tag';

    pointerElement.appendChild(cursorElement);
    pointerElement.appendChild(nameElement);

    // Check if pointer is AFK
    const isAfk = Date.now() - data.lastActive > this.afkTimeout;
    if (isAfk) {
      pointerElement.classList.add('afk');
    }

    this.updatePointerElement(pointerElement, data);

    return pointerElement;
  }

  /**
   * Updates an existing pointer element with new data.
   */
  private updatePointerElement(element: HTMLElement, data: PointerData) {
    // Update position directly using the space coordinates
    element.style.transform = `translate(${data.x}px, ${data.y}px)`;

    // Update color
    const cursorElement = element.querySelector('.cursor') as HTMLElement | null;
    const nameElement = element.querySelector('.name-tag') as HTMLElement | null;

    if (cursorElement) {
      cursorElement.style.color = data.color;
    }

    if (nameElement) {
      nameElement.textContent = data.name;
      nameElement.style.display = data.name ? 'block' : 'none';
    }
  }

  /**
   * Clears all pointer elements.
   */
  private clearPointers() {
    for (const pointer of this.pointers.values()) {
      pointer.remove();
    }
    this.pointers.clear();
  }

  /**
   * Gets all active pointers (excluding AFK ones if specified)
   */
  getActivePointers(excludeAfk = false): PointerData[] {
    const now = Date.now();
    let pointers: PointerData[] = [];

    this.automerge.whenReady((doc) => {
      pointers = Object.values(doc.pointers);

      if (excludeAfk) {
        pointers = pointers.filter((p) => now - p.lastActive <= this.afkTimeout);
      }
    });

    return pointers;
  }

  /**
   * Sets the username for this client.
   */
  set username(value: string) {
    if (value && value !== this.#username) {
      this.#username = value;
      this.localPointerData.name = value;

      // Update the Automerge document with the new username
      this.automerge.change((doc) => {
        doc.pointers[this.localPointerId] = this.localPointerData;
      });
    }
  }

  /**
   * Gets the username for this client.
   */
  get username(): string {
    return this.#username;
  }

  /**
   * Sets the color for this client's pointer.
   */
  set usercolor(value: string) {
    if (value && value !== this.localPointerData.color) {
      this.localPointerData.color = value;

      // Update the Automerge document with the new color
      this.automerge.change((doc) => {
        doc.pointers[this.localPointerId] = this.localPointerData;
      });
    }
  }

  /**
   * Gets the color of the local pointer.
   */
  get color(): string {
    return this.localPointerData.color;
  }

  static define() {
    if (!customElements.get(FolkPresence.tagName)) {
      customElements.define(FolkPresence.tagName, FolkPresence);
    }
  }
}

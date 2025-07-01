// import { FolkElement, type Point } from '@folkjs/canvas';
// import { css } from '@folkjs/canvas/tags';
// import { FolkAutomerge } from './FolkAutomerge';
// import { FolkSpace } from './folk-space';

// declare global {
//   interface HTMLElementTagNameMap {
//     'folk-presence': FolkPresence;
//   }
// }

// interface PointerData {
//   id: string;
//   x: number;
//   y: number;
//   color: string;
//   name: string;
//   lastActive: number;
//   afk: boolean;
// }

// interface PointerState {
//   pointers: Record<string, PointerData>;
// }

// // Define Identity type
// interface Identity {
//   peerId: string;
//   username: string;
//   color: string;
// }

// // Add a list of short random name components
// const shortAdjectives = [
//   'red',
//   'blue',
//   'cool',
//   'wild',
//   'tiny',
//   'big',
//   'odd',
//   'shy',
//   'bold',
//   'calm',
//   'fast',
//   'slow',
//   'wise',
//   'zany',
// ] as const;
// const shortNouns = [
//   'cat',
//   'dog',
//   'fox',
//   'owl',
//   'bee',
//   'ant',
//   'bat',
//   'elk',
//   'fish',
//   'frog',
//   'hawk',
//   'wolf',
//   'bear',
//   'duck',
// ] as const;

// /**
//  * FolkPresence is a custom element that adds real-time collaborative cursors
//  * to a folk-space element. It handles both the visual representation of pointers and
//  * the synchronization of pointer positions across clients using FolkAutomerge.
//  */
// export class FolkPresence extends FolkElement {
//   static override tagName = 'folk-presence';

//   static override styles = css`
//     :host {
//       position: absolute;
//       top: 0;
//       left: 0;
//       width: 100%;
//       height: 100%;
//       pointer-events: none;
//       z-index: 1000;
//     }

//     .pointer {
//       position: absolute;
//       pointer-events: none;
//       transform-origin: 0 0;
//       transition: transform 0.05s ease-out;
//     }

//     .cursor {
//       position: absolute;
//       width: 14px;
//       height: 21px;
//     }

//     .cursor svg {
//       width: 100%;
//       height: 100%;
//       filter: drop-shadow(0px 1px 1px rgba(0, 0, 0, 0.3));
//       transform-origin: top left;
//     }

//     .cursor svg path {
//       fill: currentColor;
//       stroke: #222;
//       stroke-width: 0.5px;
//     }

//     .name-tag {
//       position: absolute;
//       left: 14px;
//       top: -5px;
//       color: #000;
//       padding: 2px 0;
//       font-size: 12px;
//       white-space: nowrap;
//       font-family: 'Recursive', sans-serif;
//       font-variation-settings: 'CASL' 1;
//       font-weight: 500;
//     }

//     .afk .cursor {
//       opacity: 0.5;
//     }

//     .afk .name-tag::after {
//       content: ' (away)';
//       opacity: 0.7;
//       font-style: italic;
//     }
//   `;

//   // Automerge instance for syncing pointer positions
//   public automerge!: FolkAutomerge<PointerState>;

//   // Container element (usually the folk-space)
//   #container!: HTMLElement;
//   #folkSpace!: FolkSpace;

//   // Map of pointer elements by ID
//   #pointers: Map<string, HTMLElement> = new Map();

//   // Identity for this client
//   #identity: Identity;

//   // Storage key prefix for localStorage
//   private static STORAGE_PREFIX = 'folk-presence-';

//   // Local pointer information
//   #localPointerData: PointerData;

//   // Throttling for mouse move events
//   #throttleTimeout: number | null = null;
//   #throttleDelay = 30; // ms

//   // AFK and removal timeouts (in milliseconds)
//   #afkTimeout = 30 * 1000; // 30 seconds for AFK
//   #removalTimeout = 60 * 1000; // 1 minute for removal
//   #activityCheckInterval: number | null = null;

//   // Available colors for pointers
//   #colors = [
//     '#FF5722', // Deep Orange
//     '#2196F3', // Blue
//     '#4CAF50', // Green
//     '#9C27B0', // Purple
//     '#FFEB3B', // Yellow
//     '#00BCD4', // Cyan
//     '#F44336', // Red
//     '#3F51B5', // Indigo
//   ];

//   constructor() {
//     super();
//     this.attachShadow({ mode: 'open' });

//     // Get or create persistent identity
//     this.#identity = this.#getPersistentIdentity();

//     // Initialize local pointer data
//     this.#localPointerData = {
//       id: this.#identity.peerId,
//       x: 0,
//       y: 0,
//       color: this.#identity.color,
//       name: this.#identity.username,
//       lastActive: Date.now(),
//       afk: false,
//     };
//   }

//   /**
//    * Gets or creates a persistent identity for the current URL hash.
//    */
//   #getPersistentIdentity(): Identity {
//     const hash = window.location.hash || '#default';
//     const storageKey = FolkPresence.STORAGE_PREFIX + hash;

//     // Try to get existing identity
//     const storedData = localStorage.getItem(storageKey);

//     if (storedData) {
//       try {
//         // Parse the stored JSON data
//         const identity = JSON.parse(storedData) as Partial<Identity>;

//         // Ensure the identity has all required fields
//         if (identity.peerId && identity.username && identity.color) {
//           return identity as Identity;
//         }
//         // If missing any fields, fall through to create a new one
//       } catch (e) {
//         console.error('Error parsing stored identity:', e);
//         // Fall through to create new identity if parsing fails
//       }
//     }

//     // Generate a random color for new users
//     const randomColor = this.#colors[Math.floor(Math.random() * this.#colors.length)];

//     // Create new identity if none exists or parsing failed
//     const newIdentity: Identity = {
//       peerId: this.#generateId(),
//       username: this.#generateShortRandomName(),
//       color: randomColor,
//     };

//     // Store the new identity
//     localStorage.setItem(storageKey, JSON.stringify(newIdentity));

//     return newIdentity;
//   }

//   /**
//    * Gets the user's identity (peer ID, username, and color).
//    */
//   get identity(): Identity {
//     return { ...this.#identity }; // Return a copy to prevent direct modification
//   }

//   /**
//    * Sets the username for this client.
//    */
//   set username(value: string) {
//     if (value && value !== this.#identity.username) {
//       // Update identity
//       this.#identity.username = value;

//       // Update pointer data
//       this.#localPointerData.name = value;

//       // Update stored identity
//       this.#saveIdentity();

//       // Update the Automerge document
//       this.automerge.change((doc) => {
//         doc.pointers[this.#identity.peerId] = this.#localPointerData;
//       });
//     }
//   }

//   /**
//    * Sets the color for this client's pointer.
//    */
//   set color(value: string) {
//     if (value && value !== this.#identity.color) {
//       // Update identity
//       this.#identity.color = value;

//       // Update pointer data
//       this.#localPointerData.color = value;

//       // Save to localStorage
//       this.#saveIdentity();

//       // Update the Automerge document
//       this.automerge.change((doc) => {
//         doc.pointers[this.#identity.peerId] = this.#localPointerData;
//       });
//     }
//   }

//   /**
//    * Saves the current identity to localStorage.
//    */
//   #saveIdentity(): void {
//     const hash = window.location.hash || '#default';
//     const storageKey = FolkPresence.STORAGE_PREFIX + hash;
//     localStorage.setItem(storageKey, JSON.stringify(this.#identity));
//   }

//   override connectedCallback() {
//     super.connectedCallback();

//     // Find the container (parent element, usually folk-space)
//     this.#container = this.parentElement || document.body;

//     // Check if the container is a FolkSpace
//     if (this.#container instanceof FolkSpace) {
//       this.#folkSpace = this.#container;
//     }

//     // Initialize Automerge with initial state
//     this.automerge = new FolkAutomerge<PointerState>({
//       pointers: {
//         [this.#identity.peerId]: this.#localPointerData,
//       },
//     });

//     // Listen for remote changes
//     this.automerge.onRemoteChange((doc) => {
//       this.#updatePointersFromState(doc);
//     });

//     // Add mouse move listener to track local pointer
//     this.#container.addEventListener('mousemove', this.#handleMouseMove);

//     // Add mouse leave listener to hide local pointer when mouse leaves container
//     this.#container.addEventListener('mouseleave', this.#handleMouseLeave);

//     // Start activity check interval
//     this.#activityCheckInterval = window.setInterval(() => {
//       this.#checkActivityStatus();
//     }, 5000); // Check every 5 seconds for more responsive removal

//     // Listen for hashchange to update identity if needed
//     window.addEventListener('hashchange', this.#handleHashChange);

//     // Listen for tab visibility changes (user changing tabs)
//     document.addEventListener('visibilitychange', this.#handleVisibilityChange);

//     // Listen for window focus/blur (user switching applications)
//     window.addEventListener('blur', this.#handleWindowBlur);
//     window.addEventListener('focus', this.#handleWindowFocus);

//     // Listen for beforeunload to remove user when closing browser/tab
//     window.addEventListener('beforeunload', this.#handleBeforeUnload);
//   }

//   /**
//    * Handles hash changes in the URL to update identity if needed.
//    */
//   #handleHashChange = () => {
//     const newIdentity = this.#getPersistentIdentity();
//     const oldPeerId = this.#identity.peerId;

//     // Update identity
//     this.#identity = newIdentity;

//     // Update pointer data with new identity
//     this.#localPointerData = {
//       ...this.#localPointerData,
//       id: newIdentity.peerId,
//       name: newIdentity.username,
//       color: newIdentity.color,
//     };

//     // Update in Automerge
//     this.automerge.change((doc) => {
//       // Remove old pointer if peer ID changed
//       if (oldPeerId !== newIdentity.peerId && doc.pointers[oldPeerId]) {
//         delete doc.pointers[oldPeerId];
//       }

//       // Add/update with new identity
//       doc.pointers[newIdentity.peerId] = this.#localPointerData;
//     });
//   };

//   /**
//    * Sets the AFK status of the local pointer and updates lastActive timestamp.
//    * @param afk Whether the pointer is AFK or not
//    */
//   #setAfk(afk: boolean) {
//     this.#updateLocalPointer({
//       ...this.#localPointerData,
//       afk,
//       lastActive: Date.now(),
//     });
//   }

//   /**
//    * Handles tab visibility changes (switching tabs)
//    */
//   #handleVisibilityChange = () => {
//     if (document.hidden) {
//       // User switched to another tab, mark as AFK
//       this.#setAfk(true);
//     } else {
//       // User returned to this tab, mark as active
//       this.#setAfk(false);
//     }
//   };

//   /**
//    * Handles window losing focus (user switched applications)
//    */
//   #handleWindowBlur = () => {
//     // User switched to another application, mark as AFK
//     this.#setAfk(true);
//   };

//   /**
//    * Handles window gaining focus (user returned to application)
//    */
//   #handleWindowFocus = () => {
//     // User returned to the application, mark as active
//     this.#setAfk(false);
//   };

//   /**
//    * Handles the beforeunload event to remove the user when closing the browser/tab.
//    */
//   #handleBeforeUnload = () => {
//     // Use synchronous Automerge change to ensure it's sent before page unloads
//     this.#removeSelf();
//   };

//   override disconnectedCallback() {
//     super.disconnectedCallback();

//     // Clean up event listeners
//     this.#container.removeEventListener('mousemove', this.#handleMouseMove);
//     this.#container.removeEventListener('mouseleave', this.#handleMouseLeave);
//     window.removeEventListener('hashchange', this.#handleHashChange);
//     document.removeEventListener('visibilitychange', this.#handleVisibilityChange);
//     window.removeEventListener('blur', this.#handleWindowBlur);
//     window.removeEventListener('focus', this.#handleWindowFocus);
//     window.removeEventListener('beforeunload', this.#handleBeforeUnload);

//     // Try to remove self from the document when component is disconnected
//     this.#removeSelf();

//     // Clear activity check interval
//     if (this.#activityCheckInterval !== null) {
//       clearInterval(this.#activityCheckInterval);
//       this.#activityCheckInterval = null;
//     }

//     // Clear all pointers
//     this.#clearPointers();
//   }

//   /**
//    * Generates a random ID for a pointer.
//    */
//   #generateId(): string {
//     return `pointer-${Math.random().toString(36).substring(2, 10)}`;
//   }

//   /**
//    * Generates a short random name like "redcat" or "bluefox"
//    */
//   #generateShortRandomName(): string {
//     const adjective = shortAdjectives[Math.floor(Math.random() * shortAdjectives.length)];
//     const noun = shortNouns[Math.floor(Math.random() * shortNouns.length)];
//     return adjective + noun;
//   }

//   /**
//    * Handles mouse move events to update the local pointer position.
//    */
//   #handleMouseMove = (event: MouseEvent) => {
//     // Get mouse position relative to container
//     const rect = this.#container.getBoundingClientRect();
//     const clientX = event.clientX - rect.left;
//     const clientY = event.clientY - rect.top;

//     // Use FolkSpace's mapPointFromParent to get the correct space coordinates
//     let spacePoint: Point;
//     if (this.#folkSpace) {
//       spacePoint = this.#folkSpace.mapPointFromParent({ x: clientX, y: clientY });
//     } else {
//       // Fallback if not in a FolkSpace
//       spacePoint = { x: clientX, y: clientY };
//     }

//     // Update local pointer with throttling
//     if (this.#throttleTimeout === null) {
//       this.#throttleTimeout = window.setTimeout(() => {
//         this.#updateLocalPointer({
//           ...this.#localPointerData,
//           x: spacePoint.x,
//           y: spacePoint.y,
//           lastActive: Date.now(),
//           afk: false,
//         });
//         this.#throttleTimeout = null;
//       }, this.#throttleDelay);
//     }
//   };

//   /**
//    * Handles mouse leave events when cursor leaves the container
//    */
//   #handleMouseLeave = () => {
//     // Just mark as AFK when mouse leaves the container
//     this.#setAfk(true);
//   };

//   /**
//    * Updates the local pointer position and syncs it with other clients.
//    */
//   #updateLocalPointer(data: PointerData) {
//     this.#localPointerData = data;

//     // Update the Automerge document with the new pointer position
//     this.automerge.change((doc) => {
//       doc.pointers[this.#identity.peerId] = data;
//     });
//   }

//   /**
//    * Removes this peer from the document.
//    */
//   #removeSelf() {
//     this.automerge.change((doc) => {
//       delete doc.pointers[this.#identity.peerId];
//     });
//   }

//   /**
//    * Updates the pointers based on the current state from Automerge.
//    */
//   #updatePointersFromState(state: PointerState) {
//     // Skip our own pointer
//     const remotePointers = Object.values(state.pointers).filter((pointer) => pointer.id !== this.#identity.peerId);

//     // Remove pointers that no longer exist
//     for (const [id, pointerElement] of this.#pointers.entries()) {
//       if (!remotePointers.some((p) => p.id === id)) {
//         pointerElement.remove();
//         this.#pointers.delete(id);
//       }
//     }

//     // Update or create pointers
//     for (const pointerData of remotePointers) {
//       let pointerElement = this.#pointers.get(pointerData.id);

//       if (!pointerElement) {
//         // Create new pointer element
//         pointerElement = this.#createPointerElement(pointerData);
//         this.shadowRoot?.appendChild(pointerElement);
//         this.#pointers.set(pointerData.id, pointerElement);
//       }

//       // Update pointer with coordinates directly from the data
//       this.#updatePointerElement(pointerElement, pointerData);

//       // Update AFK status from the explicit afk property
//       pointerElement.classList.toggle('afk', pointerData.afk);
//     }
//   }

//   /**
//    * Creates a new pointer element.
//    */
//   #createPointerElement(data: PointerData): HTMLElement {
//     const pointerElement = document.createElement('div');
//     pointerElement.className = 'pointer';
//     pointerElement.dataset.pointerId = data.id;

//     const cursorElement = document.createElement('div');
//     cursorElement.className = 'cursor';

//     // Create SVG cursor
//     const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
//     svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
//     svgElement.setAttribute('viewBox', '8 3 14 24');
//     svgElement.setAttribute('preserveAspectRatio', 'xMinYMin meet');
//     svgElement.style.overflow = 'visible';

//     // Create cursor path
//     const cursorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
//     cursorPath.setAttribute(
//       'd',
//       'M 9 3 A 1 1 0 0 0 8 4 L 8 21 A 1 1 0 0 0 9 22 A 1 1 0 0 0 9.796875 21.601562 L 12.919922 18.119141 L 16.382812 26.117188 C 16.701812 26.855187 17.566828 27.188469 18.298828 26.855469 C 19.020828 26.527469 19.340672 25.678078 19.013672 24.955078 L 15.439453 17.039062 L 21 17 A 1 1 0 0 0 22 16 A 1 1 0 0 0 21.628906 15.222656 L 9.7832031 3.3789062 A 1 1 0 0 0 9 3 z',
//     );

//     svgElement.appendChild(cursorPath);
//     cursorElement.appendChild(svgElement);

//     const nameElement = document.createElement('div');
//     nameElement.className = 'name-tag';

//     pointerElement.appendChild(cursorElement);
//     pointerElement.appendChild(nameElement);

//     // Check if pointer is AFK
//     const isAfk = Date.now() - data.lastActive > this.#afkTimeout;
//     if (isAfk) {
//       pointerElement.classList.add('afk');
//     }

//     this.#updatePointerElement(pointerElement, data);

//     return pointerElement;
//   }

//   /**
//    * Updates an existing pointer element with new data.
//    */
//   #updatePointerElement(element: HTMLElement, data: PointerData) {
//     // Update position directly using the space coordinates
//     element.style.transform = `translate(${data.x}px, ${data.y}px)`;

//     // Update color
//     const cursorElement = element.querySelector('.cursor') as HTMLElement | null;
//     const nameElement = element.querySelector('.name-tag') as HTMLElement | null;

//     if (cursorElement) {
//       cursorElement.style.color = data.color;
//     }

//     if (nameElement) {
//       nameElement.textContent = data.name;
//       nameElement.style.display = data.name ? 'block' : 'none';
//     }
//   }

//   /**
//    * Clears all pointer elements.
//    */
//   #clearPointers() {
//     for (const pointer of this.#pointers.values()) {
//       pointer.remove();
//     }
//     this.#pointers.clear();
//   }

//   /**
//    * Checks the activity status of all pointers and updates their AFK status or removes them.
//    */
//   #checkActivityStatus() {
//     const now = Date.now();
//     let hasChanges = false;

//     this.automerge.change((doc) => {
//       // Check all pointers
//       for (const [id, pointer] of Object.entries(doc.pointers)) {
//         const timeSinceActive = now - pointer.lastActive;

//         // Remove pointers that have been AFK for too long (except our own)
//         if (pointer.afk && timeSinceActive > this.#removalTimeout && id !== this.#identity.peerId) {
//           delete doc.pointers[id];
//           hasChanges = true;

//           // Also remove from the DOM immediately
//           const pointerElement = this.#pointers.get(id);
//           if (pointerElement) {
//             pointerElement.remove();
//             this.#pointers.delete(id);
//           }
//         }
//       }
//     });

//     // Update the UI to reflect AFK status
//     if (hasChanges) {
//       this.automerge.whenReady((doc) => {
//         this.#updatePointersFromState(doc);
//       });
//     }
//   }
// }

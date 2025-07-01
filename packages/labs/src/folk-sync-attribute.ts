import type { DelPatch, Doc, ObjID, Patch, Prop, PutPatch, SpliceTextPatch } from '@automerge/automerge';
import { getObjectId } from '@automerge/automerge';
import { DocHandle, ImmutableString, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { CustomAttribute } from '@folkjs/canvas';
// TODO: use @automerge/vanillajs package

/**
 * Helper to get object ID from a path in an Automerge document
 */
function getIdFromPath<T>(obj: Doc<T>, path: Prop[]): ObjID | null {
  return getObjectId(path.reduce((current: any, key) => current?.[key], obj));
}

/**
 * Get the path to the DOM node object (up to "childNodes" and its index)
 * Example: ["childNodes", 1, "attributes", "style", 5] -> ["childNodes", 1]
 */
function getNodePath(path: Prop[]): Prop[] {
  // Find the last occurrence of "childNodes"
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] === 'childNodes' && i + 1 < path.length && typeof path[i + 1] === 'number') {
      return path.slice(0, i + 2); // Include "childNodes" and the index
    }
  }
  // If no "childNodes" found, return empty path (root node)
  return [];
}

/**
 * Automerge node types - 1:1 correspondence with DOM
 */
interface AutomergeTextNode {
  nodeType: Node['TEXT_NODE'];
  textContent: string;
}

interface AutomergeCommentNode {
  nodeType: Node['COMMENT_NODE'];
  textContent: string;
}

interface AutomergeElementNode {
  nodeType: Node['ELEMENT_NODE'];
  tagName: string;
  attributes: { [key: string]: ImmutableString };
  childNodes: AutomergeNode[];
}

type AutomergeNode = AutomergeTextNode | AutomergeCommentNode | AutomergeElementNode;

export class FolkSyncAttribute extends CustomAttribute {
  static override attributeName = 'folk-sync';

  // Automerge repository and document handle
  #repo!: Repo;
  #handle!: DocHandle<AutomergeElementNode>;
  #networkAdapter!: BrowserWebSocketClientAdapter;
  #isLocalChange: boolean = false;

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  // Sync mappings - DOM node to Automerge symbol ID and vice versa
  #domToAutomergeId = new Map<Node, string>();
  #automergeIdToDom = new Map<string, Node>();

  // Flag to prevent recursive updates
  #isApplyingRemoteChanges = false;

  // Hash change listener
  #hashChangeListener?: () => void;

  /**
   * Helper to store DOM-Automerge mapping
   */
  #storeMapping(domNode: Node, automergeNode: AutomergeNode): void {
    const id = getObjectId(automergeNode);
    if (id) {
      this.#domToAutomergeId.set(domNode, id);
      this.#automergeIdToDom.set(id, domNode);
    } else {
      console.error(`No ID found for automerge object:`, automergeNode);
    }
  }

  /**
   * Find an Automerge node by its object ID by traversing the document
   * NOTE: The hope is that this will become redundant with new automerge APIs to do direct mutations by id
   */
  #findAutomergeNodeById(rootNode: AutomergeElementNode, targetId: string): AutomergeNode | null {
    // Check if this node matches
    const nodeId = getObjectId(rootNode);
    if (nodeId === targetId) {
      return rootNode;
    }

    // Recursively search children
    for (const child of rootNode.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const found = this.#findAutomergeNodeById(child, targetId);
        if (found) return found;
      } else {
        // Check text/comment nodes
        const childId = getObjectId(child);
        if (childId === targetId) {
          return child;
        }
      }
    }

    return null;
  }

  /**
   * Build Automerge document structure from DOM tree
   */
  #buildAutomergeFromDOM(element: Element): AutomergeElementNode {
    const attributes: { [key: string]: ImmutableString } = {};
    for (const attr of element.attributes) {
      // Use ImmutableString to prevent text merging conflicts
      attributes[attr.name] = new ImmutableString(attr.value);
    }

    const childNodes: AutomergeNode[] = [];
    for (const child of element.childNodes) {
      switch (child.nodeType) {
        case Node.ELEMENT_NODE: {
          childNodes.push(this.#buildAutomergeFromDOM(child as Element));
          break;
        }
        case Node.TEXT_NODE: {
          childNodes.push({
            nodeType: Node.TEXT_NODE,
            textContent: child.textContent || '',
          });
          break;
        }
        case Node.COMMENT_NODE: {
          childNodes.push({
            nodeType: Node.COMMENT_NODE,
            textContent: child.textContent || '',
          });
          break;
        }
      }
    }

    return {
      nodeType: Node.ELEMENT_NODE,
      tagName: element.tagName.toLowerCase(),
      attributes,
      childNodes,
    };
  }

  /**
   * Build DOM children from Automerge document (skips root element)
   */
  #buildDOMFromAutomerge(automergeRootNode: AutomergeElementNode, parentElement: Element): void {
    // For root node, don't create the element - just build its children into the parent
    for (const child of automergeRootNode.childNodes) {
      this.#buildDOMNode(child, parentElement);
    }
  }

  /**
   * Build a single DOM node from Automerge structure
   */
  #buildDOMNode(automergeNode: AutomergeNode, parentElement: Element): void {
    const { nodeType } = automergeNode;
    switch (nodeType) {
      case Node.ELEMENT_NODE: {
        const element = document.createElement(automergeNode.tagName);

        // Set attributes
        for (const [name, attrValue] of Object.entries(automergeNode.attributes)) {
          // All attributes are ImmutableString - extract the string value
          const value = attrValue.val;
          element.setAttribute(name, value);
        }

        // Add to parent
        parentElement.appendChild(element);

        // Process children recursively
        for (const child of automergeNode.childNodes) {
          this.#buildDOMNode(child, element);
        }

        // Store mapping
        this.#storeMapping(element, automergeNode);
        break;
      }

      case Node.TEXT_NODE: {
        const textNode = document.createTextNode(automergeNode.textContent);
        parentElement.appendChild(textNode);
        this.#storeMapping(textNode, automergeNode);
        break;
      }

      case Node.COMMENT_NODE: {
        const commentNode = document.createComment(automergeNode.textContent);
        parentElement.appendChild(commentNode);
        this.#storeMapping(commentNode, automergeNode);
        break;
      }

      default: {
        nodeType satisfies never;
        throw new Error(`Unhandled node type: ${nodeType}`);
      }
    }
  }

  /**
   * Handle DOM mutations - convert to Automerge changes
   */
  #handleDOMMutation(mutation: MutationRecord): void {
    if (!this.#handle) {
      console.warn('Cannot handle DOM mutation: Document handle not initialized');
      return;
    }

    const targetId = this.#domToAutomergeId.get(mutation.target);
    if (!targetId) {
      console.warn('Cannot find Automerge ID for mutated DOM node:', mutation.target);
      return;
    }

    console.log(`[${Date.now()}] Handling DOM mutation:`, mutation.type, 'for node:', targetId);

    // Set flag to indicate this is a local change
    this.#isLocalChange = true;

    console.log(`🔄 About to call handle.change() for ${mutation.type} mutation`);
    this.#handle.change((doc) => {
      console.log(`📄 Inside handle.change() callback`);
      const targetNode = this.#findAutomergeNodeById(doc, targetId);
      if (!targetNode) {
        console.warn('Cannot find Automerge node with ID:', targetId);
        return;
      }

      switch (mutation.type) {
        case 'attributes': {
          if (targetNode.nodeType === Node.ELEMENT_NODE && mutation.attributeName) {
            const element = mutation.target as Element;
            const newValue = element.getAttribute(mutation.attributeName);
            const oldValue = targetNode.attributes[mutation.attributeName];

            // Special logging for style attribute
            if (mutation.attributeName === 'style') {
              console.log(`🎨 DOM mutation - Style change:`);
              console.log(`  Mutation oldValue: "${mutation.oldValue}"`);
              console.log(`  Old Automerge: "${oldValue}"`);
              console.log(`  New DOM: "${newValue}"`);
              console.log(`  Current DOM at time of mutation: "${element.getAttribute('style')}"`);

              // Check if the new value is just an append of the old value
              if (mutation.oldValue && newValue && newValue.includes(mutation.oldValue)) {
                console.log(`🚨 NEW VALUE CONTAINS OLD VALUE - This suggests appending behavior!`);
                console.log(`  Appended part: "${newValue.replace(mutation.oldValue, '')}"`);
              }
            }

            if (newValue === null) {
              // Attribute was removed
              delete targetNode.attributes[mutation.attributeName];
            } else {
              // Attribute was added or changed
              // Always create a new ImmutableString to ensure proper Automerge tracking
              targetNode.attributes[mutation.attributeName] = new ImmutableString(String(newValue));

              console.log(
                `📝 Applied attribute change: ${mutation.attributeName}="${newValue}" to automerge node ${targetId}`,
              );

              // Debug: check the actual structure after the change
              console.log(`🔍 After change - targetNode.attributes:`, targetNode.attributes);
              console.log(`🔍 Specific attribute value:`, targetNode.attributes[mutation.attributeName]);
            }
          }
          break;
        }
        case 'characterData': {
          if (targetNode.nodeType === Node.TEXT_NODE || targetNode.nodeType === Node.COMMENT_NODE) {
            targetNode.textContent = mutation.target.textContent || '';
          }
          break;
        }
        case 'childList': {
          throw new Error('Not implemented');
          // if (targetNode.nodeType === Node.ELEMENT_NODE) {
          //   // Handle removed nodes
          //   for (const removedNode of mutation.removedNodes) {
          //     const removedId = this.#domToAutomergeId.get(removedNode);
          //     if (removedId) {
          //       // Find and remove the corresponding Automerge node
          //       const index = targetNode.childNodes.findIndex((child) => getObjectId(child) === removedId);
          //       if (index !== -1) {
          //         targetNode.childNodes.splice(index, 1);
          //       }
          //       // Clean up mappings
          //       this.#domToAutomergeId.delete(removedNode);
          //       this.#automergeIdToDom.delete(removedId);
          //     }
          //   }

          //   // Handle added nodes
          //   for (const addedNode of mutation.addedNodes) {
          //     let automergeNode: AutomergeNode;

          //     switch (addedNode.nodeType) {
          //       case Node.ELEMENT_NODE: {
          //         automergeNode = this.#buildAutomergeFromDOM(addedNode as Element);
          //         break;
          //       }
          //       case Node.TEXT_NODE: {
          //         automergeNode = {
          //           nodeType: Node.TEXT_NODE,
          //           textContent: addedNode.textContent || '',
          //         } satisfies AutomergeNode;
          //         break;
          //       }
          //       case Node.COMMENT_NODE: {
          //         automergeNode = {
          //           nodeType: Node.COMMENT_NODE,
          //           textContent: addedNode.textContent || '',
          //         } satisfies AutomergeNode;
          //         break;
          //       }
          //       default: {
          //         continue; // Skip unknown node types
          //       }
          //     }

          //     // Find the correct insertion position
          //     const domParent = mutation.target as Element;
          //     const addedNodeIndex = Array.from(domParent.childNodes).indexOf(addedNode as ChildNode);

          //     if (addedNodeIndex !== -1) {
          //       targetNode.childNodes.splice(addedNodeIndex, 0, automergeNode);
          //       // Store mapping for the new node
          //       this.#storeMapping(addedNode, automergeNode);
          //     }
          //   }
          // }
          break;
        }
        default: {
          mutation.type satisfies never;
          throw new Error(`Unhandled mutation type: ${mutation.type}`);
        }
      }
    });

    // Debug: Check document state after change
    const docAfterChange = this.#handle.doc();
    if (docAfterChange && mutation.type === 'attributes' && mutation.attributeName) {
      const nodeAfterChange = this.#findAutomergeNodeById(docAfterChange, targetId);
      if (nodeAfterChange && nodeAfterChange.nodeType === Node.ELEMENT_NODE) {
        console.log(
          `🔍 Document state after change - ${mutation.attributeName}:`,
          nodeAfterChange.attributes[mutation.attributeName],
        );
      }
    }

    // Reset the flag
    this.#isLocalChange = false;
  }

  /**
   * Handle Automerge patches - convert to DOM changes
   */
  async #handleAutomergePatches(patches: Patch[]): Promise<void> {
    // Set flag to prevent recursive updates
    this.#isApplyingRemoteChanges = true;

    try {
      const doc = this.#handle.doc();
      if (!doc) {
        console.warn('No document available for handling patches');
        return;
      }

      for (const patch of patches) {
        console.log('Processing patch:', patch);

        // Special logging for style-related patches
        if (patch.path.includes('style')) {
          console.log('🎨 Style-related patch:', patch);
        }

        // Get the node path (up to "childNodes" and its index)
        const nodePath = getNodePath(patch.path);

        // Get the object ID of the changed node
        const nodeObjectId = getIdFromPath(doc, nodePath);
        if (!nodeObjectId) {
          console.warn('Could not find object ID for node path:', nodePath);
          continue;
        }

        // Find the corresponding DOM node
        const domNode = this.#automergeIdToDom.get(nodeObjectId);
        if (!domNode) {
          console.warn('Could not find DOM node for object ID:', nodeObjectId);
          continue;
        }

        // Find the corresponding Automerge node in current doc
        const automergeNode = this.#findAutomergeNodeById(doc, nodeObjectId);
        if (!automergeNode) {
          console.warn('Could not find Automerge node for object ID:', nodeObjectId);
          continue;
        }

        // Special logging for style attribute updates
        if (automergeNode.nodeType === Node.ELEMENT_NODE && 'style' in automergeNode.attributes) {
          console.log(`🎨 About to update DOM with style: "${automergeNode.attributes.style}"`);
        }

        // Update DOM node to match current Automerge state
        this.#updateDOMNodeFromAutomerge(domNode, automergeNode);
      }
    } finally {
      // Always reset the flag
      this.#isApplyingRemoteChanges = false;
    }
  }

  /**
   * Update a DOM node to match the current state of its corresponding Automerge node
   * Only updates the node itself, not its children
   */
  #updateDOMNodeFromAutomerge(domNode: Node, automergeNode: AutomergeNode): void {
    switch (automergeNode.nodeType) {
      case Node.ELEMENT_NODE: {
        if (domNode.nodeType !== Node.ELEMENT_NODE) {
          console.warn('DOM node type mismatch: expected element, got', domNode.nodeType);
          return;
        }

        const domElement = domNode as Element;

        // Update attributes to match Automerge state
        // First, remove any attributes that don't exist in Automerge
        const existingAttributes = Array.from(domElement.attributes);
        for (const attr of existingAttributes) {
          if (!(attr.name in automergeNode.attributes)) {
            domElement.removeAttribute(attr.name);
            console.log(`✅ Removed attribute ${attr.name} from`, domElement.tagName);
          }
        }

        // Then, set/update attributes from Automerge
        for (const [name, attrValue] of Object.entries(automergeNode.attributes)) {
          // All attributes are ImmutableString - extract the string value
          const value = attrValue.val;
          const currentValue = domElement.getAttribute(name);

          if (currentValue !== value) {
            // Special logging for style attribute to debug the appending issue
            if (name === 'style') {
              console.log(`🎨 Style update from Automerge:`);
              console.log(`  Current DOM: "${currentValue}"`);
              console.log(`  New Automerge: "${value}"`);
              console.log(`  Length - Current: ${currentValue?.length || 0}, New: ${value.length}`);
            }
            domElement.setAttribute(name, value);
            console.log(`✅ Set ${name}="${value}" on`, domElement.tagName);
          }
        }
        break;
      }

      case Node.TEXT_NODE: {
        if (domNode.nodeType !== Node.TEXT_NODE) {
          console.warn('DOM node type mismatch: expected text node, got', domNode.nodeType);
          return;
        }

        if (domNode.textContent !== automergeNode.textContent) {
          domNode.textContent = automergeNode.textContent;
          console.log(`✅ Updated text content to "${automergeNode.textContent}"`);
        }
        break;
      }

      case Node.COMMENT_NODE: {
        if (domNode.nodeType !== Node.COMMENT_NODE) {
          console.warn('DOM node type mismatch: expected comment node, got', domNode.nodeType);
          return;
        }

        if (domNode.textContent !== automergeNode.textContent) {
          domNode.textContent = automergeNode.textContent;
          console.log(`✅ Updated comment content to "${automergeNode.textContent}"`);
        }
        break;
      }

      default: {
        console.warn('Unknown Automerge node type:', (automergeNode as any).nodeType);
      }
    }
  }

  /**
   * Start observing DOM mutations
   */
  #startObserving(): void {
    if (!this.#observer) {
      this.#observer = new MutationObserver((mutations) => {
        if (this.#isApplyingRemoteChanges) return;
        this.#handleMutations(mutations);
      });
    }

    this.#observer.observe(this.ownerElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    });
  }

  /**
   * Stop observing DOM mutations
   */
  #stopObserving(): void {
    if (this.#observer) {
      this.#observer.disconnect();
    }
  }

  /**
   * Handle DOM mutations and update Automerge document
   */
  #handleMutations(mutations: MutationRecord[]): void {
    if (!this.#handle) {
      throw new Error('Cannot handle mutations: Document handle not initialized');
    }

    console.log(`🔄 Processing ${mutations.length} mutations`);

    // Check for multiple style mutations in the same batch
    const styleMutations = mutations.filter((m) => m.type === 'attributes' && m.attributeName === 'style');
    if (styleMutations.length > 1) {
      console.log(`⚠️ Multiple style mutations in one batch:`, styleMutations.length);
    }

    // Process each mutation
    for (const mutation of mutations) {
      this.#handleDOMMutation(mutation);
    }
  }

  /**
   * Create a new document from the current DOM state and initialize it
   */
  #createNewDocument(): void {
    const initialDoc = this.#buildAutomergeFromDOM(this.ownerElement);
    this.#handle = this.#repo.create<AutomergeElementNode>(initialDoc as any);

    this.#handle
      .whenReady()
      .then(async () => {
        // Update the URL hash
        window.location.hash = this.#handle.url;

        // Initialize as a new document
        const doc = await this.#handle.doc();
        if (doc) {
          this.#initializeWithDocument(doc, true);
        }
      })
      .catch((error: any) => {
        console.error('FolkSync initialization promise rejected:', error);
        throw error;
      });
  }

  /**
   * Initialize when the attribute is connected to the DOM
   */
  override connectedCallback(): void {
    console.log(`FolkSync connected to <${this.ownerElement.tagName.toLowerCase()}>`);

    // Initialize Automerge repository
    this.#initializeRepo();

    // Initialize document based on current hash
    this.#initializeDocument();

    // Set up hash change listener
    this.#hashChangeListener = () => {
      console.log('Hash changed, reinitializing...');
      this.#reinitialize();
    };
    window.addEventListener('hashchange', this.#hashChangeListener);
  }

  /**
   * Initialize the Automerge repository
   */
  #initializeRepo(): void {
    const peerId = `peer-${Math.floor(Math.random() * 1_000_000)}`;
    console.log(`🔗 Initializing repo with peer ID: ${peerId}`);

    // Set up the WebSocket network adapter
    this.#networkAdapter = new BrowserWebSocketClientAdapter('wss://sync.automerge.org');
    console.log('🌐 Network adapter created');

    // Initialize the repo with network configuration
    this.#repo = new Repo({
      peerId: peerId as any,
      network: [this.#networkAdapter],
      // TODO: local storage
    });
  }

  /**
   * Initialize document based on current URL hash
   */
  async #initializeDocument(): Promise<void> {
    const hashDocId = window.location.hash.slice(1);

    // If no valid hash, create new document
    if (!hashDocId || !isValidAutomergeUrl(hashDocId)) {
      this.#createNewDocument();
      return;
    }

    // Try to connect to existing document
    this.#handle = await this.#repo.find<AutomergeElementNode>(hashDocId);

    try {
      const doc = this.#handle.doc();
      if (doc) {
        this.#initializeWithDocument(doc, false);
      } else {
        this.#createNewDocument();
      }
    } catch (error) {
      console.error('Error finding document:', error);
      this.#createNewDocument();
    }
  }

  /**
   * Reinitialize when hash changes
   */
  #reinitialize(): void {
    // Stop current sync
    this.#stopObserving();

    // Clear mappings
    this.#domToAutomergeId = new Map<Node, string>();
    this.#automergeIdToDom = new Map<string, Node>();

    // Initialize with new hash
    this.#initializeDocument();
  }

  /**
   * Initialize the sync system once we have a document
   */
  async #initializeWithDocument(doc: AutomergeElementNode, isNewDocument: boolean): Promise<void> {
    try {
      if (isNewDocument) {
        // New document created from DOM - no need to update DOM
        console.log('Initializing new document from DOM');
      } else {
        // Existing document from network - update DOM to match
        console.log('Initializing DOM from existing document');
        // Clear DOM children and rebuild from Automerge
        while (this.ownerElement.firstChild) {
          this.ownerElement.removeChild(this.ownerElement.firstChild);
        }
        this.#buildDOMFromAutomerge(doc, this.ownerElement);
      }

      // Set up the change handler for future updates only after successful initialization
      this.#handle.on('change', ({ doc: updatedDoc, patches, patchInfo }) => {
        console.log(
          `🔄 Change event triggered. Local change: ${this.#isLocalChange}, Patches: ${patches?.length || 0}`,
        );

        // Log all patches for debugging
        if (patches && patches.length > 0) {
          console.log('📄 All patches:', patches);

          // Check for attribute-related patches
          const attributePatches = patches.filter((p) => p.path.includes('attributes'));
          if (attributePatches.length > 0) {
            console.log('🏷️ Attribute patches:', attributePatches);
          }
        }

        if (updatedDoc && !this.#isLocalChange) {
          // Log incoming patches for debugging
          if (patches && patches.length > 0) {
            console.log('📥 Processing incoming patches:', patches);
          }

          this.#handleAutomergePatches(patches || []);
        } else if (this.#isLocalChange) {
          console.log('📤 Outgoing change - patches should propagate to network:', patches?.length || 0);
          if (patches && patches.length > 0) {
            console.log('📤 Outgoing patches:', patches);
          }
        }
      });

      // Start observing only after successful initialization
      this.#startObserving();

      console.log('FolkSync successfully initialized with document ID:', this.#handle.url);
    } catch (error) {
      console.error('FolkSync initialization failed:', error);
      // Fail fast, don't try to recover
      throw error;
    }
  }

  /**
   * Clean up when the attribute is disconnected from the DOM
   */
  override disconnectedCallback(): void {
    this.#stopObserving();

    // Remove hash change listener
    if (this.#hashChangeListener) {
      window.removeEventListener('hashchange', this.#hashChangeListener);
      this.#hashChangeListener = undefined;
    }

    console.log(`FolkSync disconnected from <${this.ownerElement.tagName.toLowerCase()}>`);
  }
}

FolkSyncAttribute.define();

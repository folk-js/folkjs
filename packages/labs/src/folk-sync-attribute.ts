import { getObjectId } from '@automerge/automerge';
import { type AnyDocumentId, DocHandle, isValidAutomergeUrl, type Patch, Repo } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { CustomAttribute } from '@folkjs/canvas';
// TODO: use @automerge/vanillajs package

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
  attributes: { [key: string]: string };
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
    const attributes: { [key: string]: string } = {};
    for (const attr of element.attributes) {
      attributes[attr.name] = attr.value;
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
        for (const [name, value] of Object.entries(automergeNode.attributes)) {
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

    console.log(mutation);

    const targetId = this.#domToAutomergeId.get(mutation.target);
    if (!targetId) {
      console.warn('Cannot find Automerge ID for mutated DOM node:', mutation.target);
      return;
    }

    console.log('Handling DOM mutation:', mutation.type, 'for node:', targetId);

    // Set flag to indicate this is a local change
    this.#isLocalChange = true;

    this.#handle.change((doc) => {
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

            if (newValue === null) {
              // Attribute was removed
              delete targetNode.attributes[mutation.attributeName];
            } else {
              // Attribute was added or changed
              targetNode.attributes[mutation.attributeName] = newValue;
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
          if (targetNode.nodeType === Node.ELEMENT_NODE) {
            // Handle removed nodes
            for (const removedNode of mutation.removedNodes) {
              const removedId = this.#domToAutomergeId.get(removedNode);
              if (removedId) {
                // Find and remove the corresponding Automerge node
                const index = targetNode.childNodes.findIndex((child) => getObjectId(child) === removedId);
                if (index !== -1) {
                  targetNode.childNodes.splice(index, 1);
                }
                // Clean up mappings
                this.#domToAutomergeId.delete(removedNode);
                this.#automergeIdToDom.delete(removedId);
              }
            }

            // Handle added nodes
            for (const addedNode of mutation.addedNodes) {
              let automergeNode: AutomergeNode;

              switch (addedNode.nodeType) {
                case Node.ELEMENT_NODE: {
                  automergeNode = this.#buildAutomergeFromDOM(addedNode as Element);
                  break;
                }
                case Node.TEXT_NODE: {
                  automergeNode = {
                    nodeType: Node.TEXT_NODE,
                    textContent: addedNode.textContent || '',
                  } satisfies AutomergeNode;
                  break;
                }
                case Node.COMMENT_NODE: {
                  automergeNode = {
                    nodeType: Node.COMMENT_NODE,
                    textContent: addedNode.textContent || '',
                  } satisfies AutomergeNode;
                  break;
                }
                default: {
                  continue; // Skip unknown node types
                }
              }

              // Find the correct insertion position
              const domParent = mutation.target as Element;
              const addedNodeIndex = Array.from(domParent.childNodes).indexOf(addedNode as ChildNode);

              if (addedNodeIndex !== -1) {
                targetNode.childNodes.splice(addedNodeIndex, 0, automergeNode);
                // Store mapping for the new node
                this.#storeMapping(addedNode, automergeNode);
              }
            }
          }
          break;
        }
        default: {
          mutation.type satisfies never;
          throw new Error(`Unhandled mutation type: ${mutation.type}`);
        }
      }
    });

    // Reset the flag
    this.#isLocalChange = false;
  }

  /**
   * Handle Automerge patches - convert to DOM changes
   */
  #handleAutomergePatches(patches: Patch[]): void {
    for (const patch of patches) {
      console.log(patch);
      const { action } = patch;
      switch (action) {
        case 'put': {
          // TODO: Handle put patches
          break;
        }
        case 'del': {
          // TODO: Handle delete patches
          break;
        }
        case 'splice': {
          // TODO: Handle splice patches (for arrays)
          break;
        }
        case 'inc':
        case 'insert':
        case 'mark':
        case 'unmark':
        case 'conflict': {
          // Skip these patch actions
          break;
        }
        default: {
          action satisfies never;
          throw new Error(`Unhandled patch: ${patch}`);
        }
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

    // Set up the WebSocket network adapter
    this.#networkAdapter = new BrowserWebSocketClientAdapter('wss://sync.automerge.org');

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
      this.#handle.on('change', ({ doc: updatedDoc, patches }) => {
        if (updatedDoc && !this.#isLocalChange) {
          // Log incoming patches for debugging
          if (patches && patches.length > 0) {
            console.log('📥 Incoming patches:', patches);
          }

          this.#handleAutomergePatches(patches || []);
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

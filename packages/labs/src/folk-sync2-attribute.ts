import { type AnyDocumentId, DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { CustomAttribute } from '@folkjs/canvas';

/**
 * Tree structure that directly mirrors DOM nodes
 */
interface AutomergeNode {
  nodeType: number;
  nodeName: string;
  textContent?: string;
  attributes?: { [key: string]: string };
  children?: AutomergeNode[];
}

/**
 * Root document structure
 */
interface SyncDocument {
  children: AutomergeNode[];
}

export class FolkSync2Attribute extends CustomAttribute {
  static override attributeName = 'folk-sync2';

  // Automerge setup
  #repo!: Repo;
  #handle!: DocHandle<SyncDocument>;

  // MutationObserver
  #observer: MutationObserver | null = null;

  // WeakMap for direct DOM → Automerge node lookups
  #domToAutomergeNode = new WeakMap<Node, AutomergeNode>();

  // Flag to prevent recursive updates
  #isApplyingRemoteChanges = false;

  /**
   * Initialize Automerge document from current DOM state
   */
  #initializeDocumentFromDOM(): void {
    console.log('Initializing Automerge document from DOM');

    this.#handle.change((doc: SyncDocument) => {
      doc.children = [];

      // Serialize all child nodes of the owner element
      Array.from(this.ownerElement.childNodes).forEach((domNode) => {
        const automergeNode = this.#serializeDOMNode(domNode);
        doc.children.push(automergeNode);
      });
    });
  }

  /**
   * Initialize DOM from existing Automerge document
   */
  #initializeDOMFromDocument(doc: SyncDocument): void {
    console.log('Initializing DOM from Automerge document');

    // Stop observing during DOM reconstruction
    this.#stopObserving();
    this.#isApplyingRemoteChanges = true;

    try {
      // Clear existing DOM children
      while (this.ownerElement.firstChild) {
        this.ownerElement.removeChild(this.ownerElement.firstChild);
      }

      // Clear WeakMap
      this.#domToAutomergeNode = new WeakMap();

      // Recreate DOM from Automerge tree
      doc.children.forEach((automergeNode) => {
        const domNode = this.#createDOMNode(automergeNode);
        this.ownerElement.appendChild(domNode);
      });
    } finally {
      this.#isApplyingRemoteChanges = false;
      this.#startObserving();
    }
  }

  /**
   * Serialize a DOM node into Automerge structure
   */
  #serializeDOMNode(domNode: Node): AutomergeNode {
    const automergeNode: AutomergeNode = {
      nodeType: domNode.nodeType,
      nodeName: domNode.nodeName.toLowerCase(),
    };

    // Store WeakMap association
    this.#domToAutomergeNode.set(domNode, automergeNode);

    switch (domNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const element = domNode as Element;

        // Serialize attributes
        if (element.attributes.length > 0) {
          automergeNode.attributes = {};
          for (const attr of element.attributes) {
            automergeNode.attributes[attr.name] = attr.value;
          }
        }

        // Serialize children
        if (element.childNodes.length > 0) {
          automergeNode.children = [];
          Array.from(element.childNodes).forEach((child) => {
            automergeNode.children!.push(this.#serializeDOMNode(child));
          });
        }
        break;
      }

      case Node.TEXT_NODE:
      case Node.COMMENT_NODE: {
        automergeNode.textContent = domNode.textContent || '';
        break;
      }
    }

    return automergeNode;
  }

  /**
   * Create DOM node from Automerge structure
   */
  #createDOMNode(automergeNode: AutomergeNode): Node {
    let domNode: Node;

    switch (automergeNode.nodeType) {
      case Node.ELEMENT_NODE: {
        domNode = document.createElement(automergeNode.nodeName);
        const element = domNode as Element;

        // Set attributes
        if (automergeNode.attributes) {
          for (const [name, value] of Object.entries(automergeNode.attributes)) {
            element.setAttribute(name, value);
          }
        }

        // Create children
        if (automergeNode.children) {
          automergeNode.children.forEach((childAutomergeNode) => {
            const childDomNode = this.#createDOMNode(childAutomergeNode);
            domNode.appendChild(childDomNode);
          });
        }
        break;
      }

      case Node.TEXT_NODE: {
        domNode = document.createTextNode(automergeNode.textContent || '');
        break;
      }

      case Node.COMMENT_NODE: {
        domNode = document.createComment(automergeNode.textContent || '');
        break;
      }

      default: {
        throw new Error(`Unsupported node type: ${automergeNode.nodeType}`);
      }
    }

    // Store WeakMap association
    this.#domToAutomergeNode.set(domNode, automergeNode);
    return domNode;
  }

  /**
   * Handle DOM mutations and update Automerge
   */
  #handleMutations(mutations: MutationRecord[]): void {
    // TODO: Implement DOM → Automerge updates using WeakMap lookups
    console.log('DOM mutations:', mutations);
  }

  /**
   * Handle remote Automerge changes using patches
   */
  #handleRemoteChange(): void {
    // TODO: Use Automerge patches for granular DOM updates
    console.log('Remote Automerge change - using patches for granular updates');
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
   * Initialize Automerge repo and document
   */
  #initializeAutomerge(): void {
    const peerId = `peer-${Math.floor(Math.random() * 1_000_000)}`;

    // Check for existing document in URL hash
    const hashDocId = window.location.hash.slice(1);
    let docId: string | undefined;

    if (hashDocId && isValidAutomergeUrl(hashDocId)) {
      docId = hashDocId;
    }

    // Set up network and repo
    const networkAdapter = new BrowserWebSocketClientAdapter('wss://sync.automerge.org');
    this.#repo = new Repo({
      peerId: peerId as any,
      network: [networkAdapter],
    });

    // Connect to existing document or create new one
    if (docId) {
      this.#handle = this.#repo.find<SyncDocument>(docId as unknown as AnyDocumentId);
    } else {
      this.#handle = this.#repo.create<SyncDocument>();
      this.#handle.whenReady().then(() => {
        window.location.hash = this.#handle.url;
      });
    }
  }

  /**
   * Initialize when connected to DOM
   */
  override connectedCallback(): void {
    console.log(`FolkSync2 connected to <${this.ownerElement.tagName.toLowerCase()}>`);

    this.#initializeAutomerge();

    this.#handle.whenReady().then(async () => {
      const doc = await this.#handle.doc();

      if (!doc || !doc.children || doc.children.length === 0) {
        // New document - initialize from DOM
        this.#initializeDocumentFromDOM();
      } else {
        // Existing document - initialize DOM from document
        this.#initializeDOMFromDocument(doc);
      }

      // Set up remote change handler
      this.#handle.on('change', ({ doc }) => {
        if (doc) {
          this.#handleRemoteChange();
        }
      });

      // Start observing DOM changes
      this.#startObserving();

      console.log('FolkSync2 initialized successfully');
    });
  }

  /**
   * Clean up when disconnected
   */
  override disconnectedCallback(): void {
    this.#stopObserving();
    console.log(`FolkSync2 disconnected from <${this.ownerElement.tagName.toLowerCase()}>`);
  }
}

FolkSync2Attribute.define();

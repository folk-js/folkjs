import {
  DocHandle,
  getBackend,
  getObjectId,
  ImmutableString,
  isValidAutomergeUrl,
  Repo,
  WebSocketClientAdapter,
  type Doc,
  type ObjID,
  type Patch,
  type PeerId,
  type Prop,
} from '@folkjs/collab/automerge';
import { CustomAttribute, customAttributes } from '@folkjs/dom/CustomAttribute';
import type { DOMJElement, DOMJNode } from '@folkjs/labs/dom-json';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Navigate to a node in the document using a path */
function getNodeAtPath<T>(doc: Doc<T>, path: Prop[]): unknown {
  return path.reduce((current: any, key) => current?.[key], doc);
}

/**
 * Extract the path to the containing DOM node from a patch path.
 * E.g., ["childNodes", 1, "attributes", "style"] -> ["childNodes", 1]
 */
function getNodePath(path: Prop[]): Prop[] {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] === 'childNodes' && i + 1 < path.length && typeof path[i + 1] === 'number') {
      return path.slice(0, i + 2);
    }
  }
  return [];
}

/** Extract the parent path from a childNodes patch path */
function getParentPath(path: Prop[]): Prop[] {
  const idx = path.lastIndexOf('childNodes');
  return idx >= 0 ? path.slice(0, idx) : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

export class DocChangeEvent extends Event {
  readonly docId: string;

  constructor(docId: string) {
    super('doc-change', { bubbles: true });
    this.docId = docId;
  }
}

declare global {
  interface ElementEventMap {
    'doc-change': DocChangeEvent;
  }
  interface Element {
    folkSync: FolkSyncAttribute | undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FolkSyncAttribute
// ─────────────────────────────────────────────────────────────────────────────

export class FolkSyncAttribute extends CustomAttribute {
  static override attributeName = 'folk-sync';

  static override define() {
    if (!customAttributes.isDefined(this.attributeName)) {
      Object.defineProperty(Element.prototype, 'folkSync', {
        get() {
          return customAttributes.get(this, FolkSyncAttribute.attributeName) as FolkSyncAttribute | undefined;
        },
      });
    }
    super.define();
  }

  #repo!: Repo;
  #handle!: DocHandle<DOMJElement>;
  #networkAdapter!: WebSocketClientAdapter;
  #observer: MutationObserver | null = null;

  // Bidirectional ID mappings between DOM nodes and Automerge object IDs
  #domToId = new Map<Node, ObjID>();
  #idToDom = new Map<ObjID, Node>();

  // Prevents the DocHandle 'change' event from processing our own local changes.
  // This flag must span the entire handle.change() call because the event fires AFTER it returns.
  #isLocalChange = false;

  // ─────────────────────────────────────────────────────────────────────────────
  // ID Mapping
  // ─────────────────────────────────────────────────────────────────────────────

  #storeMapping(domNode: Node, amNode: DOMJNode): void {
    const id = getObjectId(amNode);
    if (id) {
      this.#domToId.set(domNode, id);
      this.#idToDom.set(id, domNode);
    }
  }

  #removeMapping(domNode: Node): void {
    const id = this.#domToId.get(domNode);
    if (id) {
      this.#domToId.delete(domNode);
      this.#idToDom.delete(id);
    }
  }

  #removeMappingsRecursively(domNode: Node): void {
    this.#removeMapping(domNode);
    if (domNode.nodeType === Node.ELEMENT_NODE) {
      for (const child of (domNode as Element).childNodes) {
        this.#removeMappingsRecursively(child);
      }
    }
  }

  #createMappingsRecursively(domNode: Node, amNode: DOMJNode): void {
    this.#storeMapping(domNode, amNode);
    if (domNode.nodeType === Node.ELEMENT_NODE && amNode.nodeType === Node.ELEMENT_NODE) {
      const domChildren = Array.from((domNode as Element).childNodes);
      for (let i = 0; i < domChildren.length && i < amNode.childNodes.length; i++) {
        this.#createMappingsRecursively(domChildren[i], amNode.childNodes[i]);
      }
    }
  }

  /** Get an Automerge node by its object ID using getBackend().objInfo() for O(1) lookup */
  #getNodeById(doc: Doc<DOMJElement>, id: ObjID): DOMJNode | null {
    try {
      const info = getBackend(doc).objInfo(id);
      return info?.path ? (getNodeAtPath(doc, info.path) as DOMJNode) : null;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DOM ↔ Automerge Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  #serialize(node: Node): DOMJNode | null {
    switch (node.nodeType) {
      case Node.ELEMENT_NODE: {
        const el = node as Element;
        const attributes: Record<string, ImmutableString> = {};
        for (const attr of el.attributes) {
          attributes[attr.name] = new ImmutableString(attr.value);
        }
        const childNodes: DOMJNode[] = [];
        for (const child of el.childNodes) {
          const serialized = this.#serialize(child);
          if (serialized) childNodes.push(serialized);
        }
        return { nodeType: Node.ELEMENT_NODE, tagName: el.tagName.toLowerCase(), attributes, childNodes };
      }
      case Node.TEXT_NODE:
        return { nodeType: Node.TEXT_NODE, textContent: node.textContent || '' };
      case Node.COMMENT_NODE:
        return { nodeType: Node.COMMENT_NODE, textContent: node.textContent || '' };
      default:
        return null;
    }
  }

  #hydrate(amNode: DOMJNode): Node {
    switch (amNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const el = document.createElement(amNode.tagName);
        for (const [name, value] of Object.entries(amNode.attributes)) {
          el.setAttribute(name, value.val);
        }
        for (const child of amNode.childNodes) {
          el.appendChild(this.#hydrate(child));
        }
        return el;
      }
      case Node.TEXT_NODE:
        return document.createTextNode(amNode.textContent);
      case Node.COMMENT_NODE:
        return document.createComment(amNode.textContent);
      default:
        throw new Error(`Unknown node type: ${(amNode as any).nodeType}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Remote Change Handling (Automerge → DOM)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Apply remote patches by reconciling DOM to match Automerge state.
   * We disconnect the observer during this operation because MutationObserver
   * callbacks are async (microtasks), so a flag-based approach doesn't work.
   */
  #applyRemotePatches(patches: Patch[], doc: Doc<DOMJElement>): void {
    this.#observer?.disconnect();

    try {
      for (const patch of patches) {
        this.#applyRemotePatch(patch, doc);
      }
    } finally {
      this.#observer?.takeRecords(); // Discard any pending mutations
      this.#observer?.observe(this.ownerElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
  }

  #applyRemotePatch(patch: Patch, doc: Doc<DOMJElement>): void {
    switch (patch.action) {
      case 'insert':
      case 'del':
        this.#reconcileChildren(patch, doc);
        break;
      case 'put':
        this.#applyRemotePut(patch, doc);
        break;
    }
  }

  /**
   * Reconcile DOM children to match Automerge children.
   * For inserts: find Automerge children without DOM mappings, create and insert them.
   * For deletes: find DOM children without Automerge counterparts, remove them.
   */
  #reconcileChildren(patch: Patch, doc: Doc<DOMJElement>): void {
    if (!patch.path.includes('childNodes')) return;

    const parentPath = getParentPath(patch.path);
    const parentAmNode = getNodeAtPath(doc, parentPath) as DOMJElement | undefined;
    if (!parentAmNode || parentAmNode.nodeType !== Node.ELEMENT_NODE) return;

    const parentId = getObjectId(parentAmNode);
    if (!parentId) return;

    const parentDom = this.#idToDom.get(parentId);
    if (!parentDom || parentDom.nodeType !== Node.ELEMENT_NODE) return;

    const parentElement = parentDom as Element;

    // Build set of current Automerge child IDs
    const amChildIds = new Set<ObjID>();
    for (const amChild of parentAmNode.childNodes) {
      const id = getObjectId(amChild);
      if (id) amChildIds.add(id);
    }

    // Remove DOM children that no longer exist in Automerge
    for (const domChild of Array.from(parentElement.childNodes)) {
      const domChildId = this.#domToId.get(domChild);
      if (domChildId && !amChildIds.has(domChildId)) {
        parentElement.removeChild(domChild);
        this.#removeMappingsRecursively(domChild);
      }
    }

    // Insert Automerge children that don't exist in DOM
    for (let i = 0; i < parentAmNode.childNodes.length; i++) {
      const amChild = parentAmNode.childNodes[i];
      const amChildId = getObjectId(amChild);
      if (!amChildId || this.#idToDom.has(amChildId)) continue;

      // Create DOM node
      const newDom = this.#hydrate(amChild);

      // Find insertion point: first following sibling that exists in DOM
      let refNode: Node | null = null;
      for (let j = i + 1; j < parentAmNode.childNodes.length; j++) {
        const nextId = getObjectId(parentAmNode.childNodes[j]);
        if (nextId) {
          const nextDom = this.#idToDom.get(nextId);
          if (nextDom?.parentNode === parentElement) {
            refNode = nextDom;
            break;
          }
        }
      }

      parentElement.insertBefore(newDom, refNode);
      this.#createMappingsRecursively(newDom, amChild);
    }
  }

  #applyRemotePut(patch: Patch & { action: 'put' }, doc: Doc<DOMJElement>): void {
    const nodePath = getNodePath(patch.path);
    const amNode = getNodeAtPath(doc, nodePath) as DOMJNode | undefined;
    if (!amNode) return;

    const nodeId = getObjectId(amNode);
    if (!nodeId) return;

    const domNode = this.#idToDom.get(nodeId);
    if (!domNode) return;

    const propPath = patch.path.slice(nodePath.length);

    if (amNode.nodeType === Node.ELEMENT_NODE && propPath[0] === 'attributes') {
      const attrName = propPath[1] as string;
      const element = domNode as Element;
      const attrValue = amNode.attributes[attrName];
      if (attrValue) {
        element.setAttribute(attrName, attrValue.val);
      } else {
        element.removeAttribute(attrName);
      }
    } else if (amNode.nodeType === Node.TEXT_NODE || amNode.nodeType === Node.COMMENT_NODE) {
      if (propPath[0] === 'textContent') {
        domNode.textContent = amNode.textContent;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Local Change Handling (DOM → Automerge)
  // ─────────────────────────────────────────────────────────────────────────────

  #startObserving(): void {
    this.#observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        this.#handleMutation(mutation);
      }
    });

    this.#observer.observe(this.ownerElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  #stopObserving(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#domToId.clear();
    this.#idToDom.clear();
  }

  #handleMutation(mutation: MutationRecord): void {
    switch (mutation.type) {
      case 'attributes':
        this.#handleAttributeMutation(mutation);
        break;
      case 'characterData':
        this.#handleCharacterDataMutation(mutation);
        break;
      case 'childList':
        this.#handleChildListMutation(mutation);
        break;
    }
  }

  #handleAttributeMutation(mutation: MutationRecord): void {
    const targetId = this.#domToId.get(mutation.target);
    if (!targetId || !mutation.attributeName) return;

    const element = mutation.target as Element;
    const attrName = mutation.attributeName;
    const newValue = element.getAttribute(attrName);

    this.#applyLocalChange((doc) => {
      const node = this.#getNodeById(doc, targetId);
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

      if (newValue === null) {
        delete node.attributes[attrName];
      } else {
        node.attributes[attrName] = new ImmutableString(newValue);
      }
    });
  }

  #handleCharacterDataMutation(mutation: MutationRecord): void {
    const targetId = this.#domToId.get(mutation.target);
    if (!targetId) return;

    const newContent = mutation.target.textContent || '';

    this.#applyLocalChange((doc) => {
      const node = this.#getNodeById(doc, targetId);
      if (!node || (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.COMMENT_NODE)) return;
      node.textContent = newContent;
    });
  }

  #handleChildListMutation(mutation: MutationRecord): void {
    const parentId = this.#domToId.get(mutation.target);
    if (!parentId) return;
    if (mutation.addedNodes.length === 0 && mutation.removedNodes.length === 0) return;

    const parentElement = mutation.target as Element;
    const addedNodes = Array.from(mutation.addedNodes);
    const addedSet = new Set(addedNodes);

    // Collect IDs of removed nodes BEFORE clearing mappings (needed to find them in Automerge)
    const removedIds = new Map<Node, ObjID>();
    for (const removed of mutation.removedNodes) {
      const id = this.#domToId.get(removed);
      if (id) removedIds.set(removed, id);
    }

    this.#applyLocalChange((doc) => {
      const parentNode = this.#getNodeById(doc, parentId);
      if (!parentNode || parentNode.nodeType !== Node.ELEMENT_NODE) return;

      // Remove nodes from Automerge
      for (const removed of mutation.removedNodes) {
        const removedId = removedIds.get(removed);
        if (!removedId) continue;
        const idx = parentNode.childNodes.findIndex((c) => getObjectId(c) === removedId);
        if (idx !== -1) parentNode.childNodes.splice(idx, 1);
      }

      // Add nodes to Automerge
      for (const added of addedNodes) {
        const serialized = this.#serialize(added);
        if (!serialized) continue;

        // Calculate insertion index: count siblings before this node that are
        // either already mapped (existing) or in the current batch (being added)
        const domChildren = Array.from(parentElement.childNodes);
        const domIndex = domChildren.indexOf(added as ChildNode);
        let amIndex = 0;
        for (let i = 0; i < domIndex; i++) {
          if (this.#domToId.has(domChildren[i]) || addedSet.has(domChildren[i])) {
            amIndex++;
          }
        }

        parentNode.childNodes.splice(amIndex, 0, serialized);
      }
    });

    // Clean up mappings AFTER Automerge change (we needed IDs during the change)
    for (const removed of mutation.removedNodes) {
      this.#removeMappingsRecursively(removed);
    }
  }

  /**
   * Apply a local change to Automerge and create mappings for any new nodes.
   * Uses patchCallback to get immediate feedback about what was created.
   */
  #applyLocalChange(changeFn: (doc: DOMJElement) => void): void {
    this.#isLocalChange = true;
    try {
      this.#handle.change(changeFn, {
        patchCallback: (patches, info) => {
          // Create mappings for any newly inserted nodes
          for (const patch of patches) {
            if (patch.action === 'insert' && patch.path.includes('childNodes')) {
              this.#createMappingsForInsertedNodes(patch, info.after);
            }
          }
        },
      });
    } finally {
      this.#isLocalChange = false;
    }
  }

  /** Create mappings for nodes that were just inserted locally */
  #createMappingsForInsertedNodes(patch: Patch & { action: 'insert' }, doc: Doc<DOMJElement>): void {
    const parentPath = getParentPath(patch.path);
    const parentAmNode = getNodeAtPath(doc, parentPath) as DOMJElement | undefined;
    if (!parentAmNode || parentAmNode.nodeType !== Node.ELEMENT_NODE) return;

    const parentId = getObjectId(parentAmNode);
    if (!parentId) return;

    const parentDom = this.#idToDom.get(parentId);
    if (!parentDom || parentDom.nodeType !== Node.ELEMENT_NODE) return;

    const parentElement = parentDom as Element;

    // Find unmapped Automerge children and map them to their DOM counterparts by position
    for (let i = 0; i < parentAmNode.childNodes.length; i++) {
      const amChild = parentAmNode.childNodes[i];
      const amChildId = getObjectId(amChild);
      if (!amChildId || this.#idToDom.has(amChildId)) continue;

      const domChild = parentElement.childNodes[i];
      if (domChild) {
        this.#createMappingsRecursively(domChild, amChild);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    const peerId = `peer-${Math.floor(Math.random() * 1_000_000)}` as PeerId;
    this.#networkAdapter = new WebSocketClientAdapter('wss://sync.automerge.org');
    this.#repo = new Repo({ peerId, network: [this.#networkAdapter] });
  }

  override changedCallback(): void {
    this.#stopObserving();
    this.#initializeDocument();
  }

  override disconnectedCallback(): void {
    this.#stopObserving();
  }

  async #initializeDocument(): Promise<void> {
    const docId = this.value;

    if (!docId || !isValidAutomergeUrl(docId)) {
      await this.#createNewDocument();
      return;
    }

    this.#handle = await this.#repo.find<DOMJElement>(docId);

    try {
      const doc = this.#handle.doc();
      if (doc) {
        this.#initializeWithDocument(doc, false);
      } else {
        await this.#createNewDocument();
      }
    } catch {
      await this.#createNewDocument();
    }
  }

  async #createNewDocument(): Promise<void> {
    const initialDoc = this.#serialize(this.ownerElement) as DOMJElement;
    this.#handle = this.#repo.create<DOMJElement>(initialDoc);

    await this.#handle.whenReady();

    if (!this.value) {
      this.value = this.#handle.url;
    }

    const doc = this.#handle.doc();
    if (doc) {
      this.#initializeWithDocument(doc, true);
    }

    this.ownerElement.dispatchEvent(new DocChangeEvent(this.value));
  }

  #initializeWithDocument(doc: DOMJElement, isNew: boolean): void {
    if (isNew) {
      // New document: map existing DOM to Automerge IDs
      this.#createMappingsRecursively(this.ownerElement, doc);
    } else {
      // Existing document: rebuild DOM from Automerge
      this.ownerElement.replaceChildren();
      for (const child of doc.childNodes) {
        const domNode = this.#hydrate(child);
        this.ownerElement.appendChild(domNode);
        this.#createMappingsRecursively(domNode, child);
      }
      this.#storeMapping(this.ownerElement, doc);
    }

    // Listen for remote changes
    this.#handle.on('change', ({ doc: updatedDoc, patches }) => {
      if (updatedDoc && !this.#isLocalChange) {
        this.#applyRemotePatches(patches || [], updatedDoc);
      }
    });

    this.#startObserving();
  }
}

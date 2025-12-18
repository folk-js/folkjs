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

const OBSERVER_OPTIONS: MutationObserverInit = {
  attributes: true,
  characterData: true,
  childList: true,
  subtree: true,
};

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
  #observer: MutationObserver | null = null;

  // Bidirectional ID mappings between DOM nodes and Automerge object IDs
  #domToId = new Map<Node, ObjID>();
  #idToDom = new Map<ObjID, Node>();

  // Prevents processing our own local changes as remote patches.
  // Needed because the 'change' event fires synchronously during handle.change().
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
      const domChildren = (domNode as Element).childNodes;
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

  /** Get parent element from both Automerge doc and DOM for a childNodes patch */
  #getParentElements(patch: Patch, doc: Doc<DOMJElement>): { amParent: DOMJElement; domParent: Element } | null {
    const idx = patch.path.lastIndexOf('childNodes');
    const amParent = getNodeAtPath(doc, idx >= 0 ? patch.path.slice(0, idx) : []) as DOMJElement | undefined;
    if (!amParent || amParent.nodeType !== Node.ELEMENT_NODE) return null;

    const parentId = getObjectId(amParent);
    if (!parentId) return null;

    const domParent = this.#idToDom.get(parentId);
    if (!domParent || domParent.nodeType !== Node.ELEMENT_NODE) return null;

    return { amParent, domParent: domParent as Element };
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
      for (const patch of patches) this.#applyRemotePatch(patch, doc);
    } finally {
      this.#observer?.takeRecords();
      this.#observer?.observe(this.ownerElement, OBSERVER_OPTIONS);
    }
  }

  #applyRemotePatch(patch: Patch, doc: Doc<DOMJElement>): void {
    switch (patch.action) {
      case 'insert':
        this.#applyRemoteInsert(patch, doc);
        break;
      case 'del':
        this.#applyRemoteDel(patch, doc);
        break;
      case 'put':
        this.#applyRemotePut(patch, doc);
        break;
    }
  }

  /** Insert nodes at exact index from patch */
  #applyRemoteInsert(patch: Patch & { action: 'insert' }, doc: Doc<DOMJElement>): void {
    if (!patch.path.includes('childNodes')) return;

    const parents = this.#getParentElements(patch, doc);
    if (!parents) return;
    const { amParent, domParent } = parents;

    // Get the insertion index from the path (last element after 'childNodes')
    const idx = patch.path[patch.path.length - 1] as number;
    const count = patch.values.length;

    // Reference node is the current node at idx (before insertion)
    const refNode = domParent.childNodes[idx] || null;

    // Insert each new node from the Automerge document
    for (let i = 0; i < count; i++) {
      const amChild = amParent.childNodes[idx + i];
      if (!amChild) continue;

      // Skip if already mapped (e.g., local change that we're seeing as a patch)
      const amChildId = getObjectId(amChild);
      if (amChildId && this.#idToDom.has(amChildId)) continue;

      const newDom = this.#hydrate(amChild);
      domParent.insertBefore(newDom, refNode);
      this.#createMappingsRecursively(newDom, amChild);
    }
  }

  /** Delete nodes at exact index from patch */
  #applyRemoteDel(patch: Patch & { action: 'del'; length?: number }, doc: Doc<DOMJElement>): void {
    if (!patch.path.includes('childNodes')) return;

    const parents = this.#getParentElements(patch, doc);
    if (!parents) return;

    const idx = patch.path[patch.path.length - 1] as number;
    const count = patch.length ?? 1;

    for (let i = 0; i < count; i++) {
      const child = parents.domParent.childNodes[idx];
      if (child) {
        this.#removeMappingsRecursively(child);
        parents.domParent.removeChild(child);
      }
    }
  }

  #applyRemotePut(patch: Patch & { action: 'put' }, doc: Doc<DOMJElement>): void {
    const path = patch.path;

    // Handle attribute changes: path ends with ["attributes", attrName]
    const attrIdx = path.lastIndexOf('attributes');
    if (attrIdx !== -1 && attrIdx === path.length - 2) {
      const nodePath = path.slice(0, attrIdx);
      const attrName = path[attrIdx + 1] as string;
      const amNode = getNodeAtPath(doc, nodePath) as DOMJElement | undefined;
      if (!amNode) return;
      const domNode = this.#idToDom.get(getObjectId(amNode)!) as Element | undefined;
      if (!domNode) return;

      const attrValue = amNode.attributes[attrName];
      attrValue ? domNode.setAttribute(attrName, attrValue.val) : domNode.removeAttribute(attrName);
      return;
    }

    // Handle textContent changes: path ends with "textContent"
    if (path[path.length - 1] === 'textContent') {
      const nodePath = path.slice(0, -1);
      const amNode = getNodeAtPath(doc, nodePath) as DOMJNode | undefined;
      if (!amNode) return;
      const domNode = this.#idToDom.get(getObjectId(amNode)!);
      if (domNode) domNode.textContent = (amNode as { textContent: string }).textContent;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Local Change Handling (DOM → Automerge)
  // ─────────────────────────────────────────────────────────────────────────────

  #startObserving(): void {
    this.#observer = new MutationObserver((mutations) => mutations.forEach((m) => this.#handleMutation(m)));
    this.#observer.observe(this.ownerElement, OBSERVER_OPTIONS);
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
    if (!parentId || (mutation.addedNodes.length === 0 && mutation.removedNodes.length === 0)) return;

    const parentElement = mutation.target as Element;
    const addedSet = new Set(mutation.addedNodes);

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
      const domChildren = parentElement.childNodes;
      for (const added of mutation.addedNodes) {
        const serialized = this.#serialize(added);
        if (!serialized) continue;

        // Calculate insertion index: count siblings before this node that are
        // either already mapped (existing) or in the current batch (being added)
        const domIndex = Array.prototype.indexOf.call(domChildren, added);
        let amIndex = 0;
        for (let i = 0; i < domIndex; i++) {
          if (this.#domToId.has(domChildren[i]) || addedSet.has(domChildren[i])) amIndex++;
        }
        parentNode.childNodes.splice(amIndex, 0, serialized);
      }
    });

    // Create mappings for added nodes (after change, AM IDs are assigned)
    if (mutation.addedNodes.length > 0) {
      const doc = this.#handle.doc();
      if (doc) {
        const parentNode = this.#getNodeById(doc, parentId);
        if (parentNode?.nodeType === Node.ELEMENT_NODE) {
          const domChildren = parentElement.childNodes;
          for (let i = 0; i < parentNode.childNodes.length; i++) {
            const amChild = parentNode.childNodes[i];
            const amChildId = getObjectId(amChild);
            if (!amChildId || this.#idToDom.has(amChildId)) continue;
            const domChild = domChildren[i];
            if (domChild) this.#createMappingsRecursively(domChild, amChild);
          }
        }
      }
    }

    // Clean up mappings AFTER Automerge change (we needed IDs during the change)
    for (const removed of mutation.removedNodes) this.#removeMappingsRecursively(removed);
  }

  /** Apply a local change to Automerge, preventing the change event from triggering remote patch handling */
  #applyLocalChange(changeFn: (doc: DOMJElement) => void): void {
    this.#isLocalChange = true;
    try {
      this.#handle.change(changeFn);
    } finally {
      this.#isLocalChange = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    const peerId = `peer-${Math.floor(Math.random() * 1_000_000)}` as PeerId;
    this.#repo = new Repo({ peerId, network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
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

    // Try to find existing document
    if (docId && isValidAutomergeUrl(docId)) {
      this.#handle = await this.#repo.find<DOMJElement>(docId);
      try {
        const doc = this.#handle.doc();
        if (doc) {
          this.#initializeWithDocument(doc, false);
          return;
        }
      } catch {
        // Fall through to create new document
      }
    }

    // Create new document from current DOM state
    const initialDoc = this.#serialize(this.ownerElement) as DOMJElement;
    this.#handle = this.#repo.create<DOMJElement>(initialDoc);
    await this.#handle.whenReady();

    if (!this.value) this.value = this.#handle.url;

    const doc = this.#handle.doc();
    if (doc) this.#initializeWithDocument(doc, true);

    this.ownerElement.dispatchEvent(new DocChangeEvent(this.value));
  }

  #initializeWithDocument(doc: DOMJElement, isNew: boolean): void {
    if (!isNew) {
      // Existing document: rebuild DOM from Automerge
      this.ownerElement.replaceChildren();
      for (const child of doc.childNodes) {
        this.ownerElement.appendChild(this.#hydrate(child));
      }
    }

    // Map entire tree from root (works for both new and existing docs)
    this.#createMappingsRecursively(this.ownerElement, doc);

    // Listen for remote changes
    this.#handle.on('change', ({ doc: updatedDoc, patches }) => {
      if (updatedDoc && !this.#isLocalChange) {
        this.#applyRemotePatches(patches || [], updatedDoc);
      }
    });

    this.#startObserving();
  }
}

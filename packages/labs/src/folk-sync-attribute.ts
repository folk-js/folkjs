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
  type PatchCallback,
  type PeerId,
  type Prop,
} from '@folkjs/collab/automerge';
import { CustomAttribute, customAttributes } from '@folkjs/dom/CustomAttribute';
import type { DOMJElement, DOMJNode } from '@folkjs/labs/dom-json';

/**
 * Navigate to a node in the document using a path
 */
function getNodeAtPath<T>(doc: Doc<T>, path: Prop[]): any {
  return path.reduce((current: any, key) => current?.[key], doc);
}

/**
 * Get the path to the DOM node object (up to "childNodes" and its index)
 * Example: ["childNodes", 1, "attributes", "style"] -> ["childNodes", 1]
 */
function getNodePath(path: Prop[]): Prop[] {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] === 'childNodes' && i + 1 < path.length && typeof path[i + 1] === 'number') {
      return path.slice(0, i + 2);
    }
  }
  return [];
}

export class DocChangeEvent extends Event {
  #docId;

  get docId() {
    return this.#docId;
  }

  constructor(docId: string) {
    super('doc-change', { bubbles: true });
    this.#docId = docId;
  }
}

declare global {
  interface ElementEventMap {
    'doc-change': DocChangeEvent;
  }
}

declare global {
  interface Element {
    folkSync: FolkSyncAttribute | undefined;
  }
}

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

  // Bidirectional ID mappings
  #domToId = new Map<Node, ObjID>();
  #idToDom = new Map<ObjID, Node>();

  // Flag to prevent recursive updates when applying patches
  #isApplyingPatches = false;

  // ─────────────────────────────────────────────────────────────────────────────
  // ID Mapping Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  #storeMapping(domNode: Node, id: ObjID): void {
    this.#domToId.set(domNode, id);
    this.#idToDom.set(id, domNode);
  }

  #storeMappingFromNode(domNode: Node, automergeNode: DOMJNode): void {
    const id = getObjectId(automergeNode);
    if (id) {
      this.#storeMapping(domNode, id);
    }
  }

  #removeMapping(domNode: Node): void {
    const id = this.#domToId.get(domNode);
    if (id) {
      this.#domToId.delete(domNode);
      this.#idToDom.delete(id);
    }
  }

  #removeMappingsForSubtree(domNode: Node): void {
    this.#removeMapping(domNode);
    if (domNode.nodeType === Node.ELEMENT_NODE) {
      for (const child of (domNode as Element).childNodes) {
        this.#removeMappingsForSubtree(child);
      }
    }
  }

  /**
   * Get Automerge node by ID using objInfo to get path, then navigate
   */
  #getNodeById(doc: Doc<DOMJElement>, id: ObjID): DOMJNode | null {
    try {
      const backend = getBackend(doc);
      const info = backend.objInfo(id);
      if (!info?.path) return null;
      return getNodeAtPath(doc, info.path);
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DOM ↔ Automerge Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  #serializeElement(element: Element): DOMJElement {
    const attributes: { [key: string]: ImmutableString } = {};
    for (const attr of element.attributes) {
      attributes[attr.name] = new ImmutableString(attr.value);
    }

    const childNodes: DOMJNode[] = [];
    for (const child of element.childNodes) {
      const serialized = this.#serializeNode(child);
      if (serialized) childNodes.push(serialized);
    }

    return { nodeType: Node.ELEMENT_NODE, tagName: element.tagName.toLowerCase(), attributes, childNodes };
  }

  #serializeNode(node: Node): DOMJNode | null {
    switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        return this.#serializeElement(node as Element);
      case Node.TEXT_NODE:
        return { nodeType: Node.TEXT_NODE, textContent: node.textContent || '' };
      case Node.COMMENT_NODE:
        return { nodeType: Node.COMMENT_NODE, textContent: node.textContent || '' };
      default:
        return null;
    }
  }

  #hydrateNode(amNode: DOMJNode): Node {
    switch (amNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const el = document.createElement(amNode.tagName);
        for (const [name, value] of Object.entries(amNode.attributes)) {
          el.setAttribute(name, value.val);
        }
        for (const child of amNode.childNodes) {
          el.appendChild(this.#hydrateNode(child));
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

  #hydrateAndMapSubtree(amNode: DOMJNode, parent: Element): void {
    const domNode = this.#hydrateNode(amNode);
    parent.appendChild(domNode);
    this.#createMappingsForSubtree(domNode, amNode);
  }

  #createMappingsForSubtree(domNode: Node, amNode: DOMJNode): void {
    this.#storeMappingFromNode(domNode, amNode);
    if (domNode.nodeType === Node.ELEMENT_NODE && amNode.nodeType === Node.ELEMENT_NODE) {
      const domChildren = Array.from((domNode as Element).childNodes);
      for (let i = 0; i < domChildren.length && i < amNode.childNodes.length; i++) {
        this.#createMappingsForSubtree(domChildren[i], amNode.childNodes[i]);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Unified Patch Handler (for both local and remote changes)
  // ─────────────────────────────────────────────────────────────────────────────

  #handlePatches(patches: Patch[], doc: Doc<DOMJElement>, source: 'local' | 'remote'): void {
    this.#isApplyingPatches = true;

    try {
      for (const patch of patches) {
        this.#handlePatch(patch, doc, source);
      }
    } finally {
      this.#isApplyingPatches = false;
    }
  }

  #handlePatch(patch: Patch, doc: Doc<DOMJElement>, source: 'local' | 'remote'): void {
    switch (patch.action) {
      case 'insert':
        this.#handleInsert(patch, doc, source);
        break;
      case 'del':
        this.#handleDelete(patch, doc, source);
        break;
      case 'put':
        this.#handlePut(patch, doc, source);
        break;
      // splice, mark, unmark, inc, conflict - not typically used for DOM sync
    }
  }

  #handleInsert(patch: Patch & { action: 'insert' }, doc: Doc<DOMJElement>, source: 'local' | 'remote'): void {
    if (!patch.path.includes('childNodes')) return;

    const parentPath = patch.path.slice(0, patch.path.lastIndexOf('childNodes'));
    const insertIndex = patch.path[patch.path.length - 1] as number;

    // Get parent ID from path
    const parentNode = getNodeAtPath(doc, parentPath);
    const parentId = getObjectId(parentNode);
    if (!parentId) return;

    const parentDom = this.#idToDom.get(parentId);
    if (!parentDom || parentDom.nodeType !== Node.ELEMENT_NODE) return;

    const parentElement = parentDom as Element;
    const parentAmNode = parentNode as DOMJElement;

    // For local changes, we just need to create ID mappings for the newly inserted nodes
    // For remote changes, we also need to create DOM nodes
    if (source === 'local') {
      // Find the DOM node at the insert position and map it
      const amChild = parentAmNode.childNodes[insertIndex];
      if (amChild) {
        const domChild = parentElement.childNodes[insertIndex];
        if (domChild) {
          this.#createMappingsForSubtree(domChild, amChild);
        }
      }
    } else {
      // Remote: create DOM nodes for all inserted values
      for (let i = 0; i < patch.values.length; i++) {
        const amChild = parentAmNode.childNodes[insertIndex + i];
        if (amChild) {
          const newDomNode = this.#hydrateNode(amChild);
          const refNode = parentElement.childNodes[insertIndex + i] || null;
          parentElement.insertBefore(newDomNode, refNode);
          this.#createMappingsForSubtree(newDomNode, amChild);
        }
      }
    }
  }

  #handleDelete(patch: Patch & { action: 'del' }, doc: Doc<DOMJElement>, source: 'local' | 'remote'): void {
    if (!patch.path.includes('childNodes')) return;

    // For local deletes, DOM is already updated, just clean up mappings
    // For remote deletes, we need to remove DOM nodes

    if (source === 'local') {
      // Mappings are already cleaned up in the mutation handler
      return;
    }

    // Remote delete: find orphaned DOM nodes and remove them
    const parentPath = patch.path.slice(0, patch.path.lastIndexOf('childNodes'));
    const parentNode = getNodeAtPath(doc, parentPath);
    const parentId = getObjectId(parentNode);
    if (!parentId) return;

    const parentDom = this.#idToDom.get(parentId);
    if (!parentDom || parentDom.nodeType !== Node.ELEMENT_NODE) return;

    const parentElement = parentDom as Element;
    const parentAmNode = parentNode as DOMJElement;

    // Find DOM children that don't exist in Automerge anymore
    const amChildIds = new Set(parentAmNode.childNodes.map((c) => getObjectId(c)).filter(Boolean));

    const toRemove: Node[] = [];
    for (const domChild of Array.from(parentElement.childNodes)) {
      const domChildId = this.#domToId.get(domChild);
      if (domChildId && !amChildIds.has(domChildId)) {
        toRemove.push(domChild);
      }
    }

    for (const node of toRemove) {
      parentElement.removeChild(node);
      this.#removeMappingsForSubtree(node);
    }
  }

  #handlePut(patch: Patch & { action: 'put' }, doc: Doc<DOMJElement>, source: 'local' | 'remote'): void {
    // For local puts, DOM is already updated
    if (source === 'local') return;

    // Remote put: update the DOM to match
    const nodePath = getNodePath(patch.path);
    const amNode = getNodeAtPath(doc, nodePath);
    const nodeId = getObjectId(amNode);
    if (!nodeId) return;

    const domNode = this.#idToDom.get(nodeId);
    if (!domNode) return;

    // Determine what property changed
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
    } else if (
      (amNode.nodeType === Node.TEXT_NODE || amNode.nodeType === Node.COMMENT_NODE) &&
      propPath[0] === 'textContent'
    ) {
      domNode.textContent = amNode.textContent;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DOM Mutation Observer
  // ─────────────────────────────────────────────────────────────────────────────

  #startObserving(): void {
    this.#observer = new MutationObserver((mutations) => {
      if (this.#isApplyingPatches) return;

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
    const doc = this.#handle.doc();
    if (!doc) return;

    // Create patch callback to capture patches from local changes
    const patchCallback: PatchCallback<DOMJElement> = (patches, info) => {
      this.#handlePatches(patches, info.after, 'local');
    };

    switch (mutation.type) {
      case 'attributes':
        this.#handleAttributeMutation(mutation, patchCallback);
        break;
      case 'characterData':
        this.#handleCharacterDataMutation(mutation, patchCallback);
        break;
      case 'childList':
        this.#handleChildListMutation(mutation, patchCallback);
        break;
    }
  }

  #handleAttributeMutation(mutation: MutationRecord, patchCallback: PatchCallback<DOMJElement>): void {
    const targetId = this.#domToId.get(mutation.target);
    if (!targetId || !mutation.attributeName) return;

    const element = mutation.target as Element;
    const newValue = element.getAttribute(mutation.attributeName);

    this.#handle.change(
      (doc) => {
        const node = this.#getNodeById(doc, targetId);
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

        if (newValue === null) {
          delete node.attributes[mutation.attributeName!];
        } else {
          node.attributes[mutation.attributeName!] = new ImmutableString(newValue);
        }
      },
      { patchCallback },
    );
  }

  #handleCharacterDataMutation(mutation: MutationRecord, patchCallback: PatchCallback<DOMJElement>): void {
    const targetId = this.#domToId.get(mutation.target);
    if (!targetId) return;

    const newContent = mutation.target.textContent || '';

    this.#handle.change(
      (doc) => {
        const node = this.#getNodeById(doc, targetId);
        if (!node || (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.COMMENT_NODE)) return;

        node.textContent = newContent;
      },
      { patchCallback },
    );
  }

  #handleChildListMutation(mutation: MutationRecord, patchCallback: PatchCallback<DOMJElement>): void {
    const parentId = this.#domToId.get(mutation.target);
    if (!parentId) return;

    const parentElement = mutation.target as Element;

    // Handle removals first
    for (const removed of mutation.removedNodes) {
      this.#removeMappingsForSubtree(removed);
    }

    // Handle additions
    const addedNodes = Array.from(mutation.addedNodes);
    if (addedNodes.length === 0 && mutation.removedNodes.length === 0) return;

    this.#handle.change(
      (doc) => {
        const parentNode = this.#getNodeById(doc, parentId);
        if (!parentNode || parentNode.nodeType !== Node.ELEMENT_NODE) return;

        // Handle removals in Automerge
        for (const removed of mutation.removedNodes) {
          const removedId = this.#domToId.get(removed);
          if (!removedId) continue;

          const idx = parentNode.childNodes.findIndex((c) => getObjectId(c) === removedId);
          if (idx !== -1) {
            parentNode.childNodes.splice(idx, 1);
          }
        }

        // Handle additions in Automerge
        for (const added of addedNodes) {
          const serialized = this.#serializeNode(added);
          if (!serialized) continue;

          // Find insertion index based on DOM position
          const domChildren = Array.from(parentElement.childNodes);
          const domIndex = domChildren.indexOf(added as ChildNode);

          // Count mapped siblings before this position
          let amIndex = 0;
          for (let i = 0; i < domIndex; i++) {
            if (this.#domToId.has(domChildren[i])) {
              amIndex++;
            }
          }

          parentNode.childNodes.splice(amIndex, 0, serialized);
        }
      },
      { patchCallback },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    this.#initializeRepo();
  }

  override changedCallback(): void {
    this.#stopObserving();
    this.#initializeDocument();
  }

  override disconnectedCallback(): void {
    this.#stopObserving();
  }

  #initializeRepo(): void {
    const peerId = `peer-${Math.floor(Math.random() * 1_000_000)}` as PeerId;
    this.#networkAdapter = new WebSocketClientAdapter('wss://sync.automerge.org');
    this.#repo = new Repo({ peerId, network: [this.#networkAdapter] });
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
    const initialDoc = this.#serializeElement(this.ownerElement);
    this.#handle = this.#repo.create<DOMJElement>(initialDoc as any);

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
    if (!isNew) {
      // Rebuild DOM from Automerge
      this.ownerElement.replaceChildren();
      for (const child of doc.childNodes) {
        this.#hydrateAndMapSubtree(child, this.ownerElement);
      }
    } else {
      // Map existing DOM to Automerge IDs
      const domChildren = Array.from(this.ownerElement.childNodes);
      for (let i = 0; i < domChildren.length && i < doc.childNodes.length; i++) {
        this.#createMappingsForSubtree(domChildren[i], doc.childNodes[i]);
      }
    }

    // Map root element
    this.#storeMappingFromNode(this.ownerElement, doc);

    // Listen for remote changes
    this.#handle.on('change', ({ doc: updatedDoc, patches }) => {
      if (updatedDoc && !this.#isApplyingPatches) {
        this.#handlePatches(patches || [], updatedDoc, 'remote');
      }
    });

    this.#startObserving();
  }
}

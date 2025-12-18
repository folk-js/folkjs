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
import { CustomAttribute } from '@folkjs/dom/CustomAttribute';
import type { DOMJComment, DOMJElement, DOMJNode, DOMJText } from '@folkjs/labs/dom-json';

/** Navigate to a node in the document using a path */
function getNodeAtPath<T>(doc: Doc<T>, path: Prop[]): unknown {
  return path.reduce((current: any, key) => current?.[key], doc);
}

/** Get an Automerge node by its object ID */
function getNodeById(doc: Doc<DOMJElement>, id: ObjID): DOMJNode | null {
  const info = getBackend(doc).objInfo(id);
  return info?.path ? (getNodeAtPath(doc, info.path) as DOMJNode) : null;
}

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

const OBSERVER_OPTIONS: MutationObserverInit = {
  attributes: true,
  characterData: true,
  childList: true,
  subtree: true,
};

export class FolkSyncAttribute extends CustomAttribute {
  static override attributeName = 'folk-sync';

  #repo!: Repo;
  #handle!: DocHandle<DOMJElement>;
  #observer: MutationObserver | null = null;

  // Bidirectional ID mappings between DOM nodes and Automerge object IDs
  #domToId = new Map<Node, ObjID>();
  #idToDom = new Map<ObjID, Node>();

  // Prevents processing our own local changes as remote patches.
  // Needed because the 'change' event fires synchronously during handle.change().
  #isLocalChange = false;

  #storeMapping(domNode: Node, amNode: DOMJNode): void {
    const id = getObjectId(amNode);
    if (id) {
      this.#domToId.set(domNode, id);
      this.#idToDom.set(id, domNode);
    }
  }

  #removeMappingsRecursively(domNode: Node): void {
    const id = this.#domToId.get(domNode);
    if (id) {
      this.#domToId.delete(domNode);
      this.#idToDom.delete(id);
    }
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

  /** Resolve a patch path to get the target node(s) and classify the change type */
  #resolvePatch(
    path: Prop[],
    doc: Doc<DOMJElement>,
  ):
    | { kind: 'attribute'; domNode: Element; amNode: DOMJElement; attrName: string }
    | { kind: 'textContent'; domNode: Node; amNode: DOMJText | DOMJComment }
    | { kind: 'childNodes'; domParent: Element; amParent: DOMJElement; idx: number }
    | null {
    // textContent: path ends with 'textContent'
    if (path[path.length - 1] === 'textContent') {
      const amNode = getNodeAtPath(doc, path.slice(0, -1)) as DOMJText | DOMJComment | undefined;
      if (!amNode) return null;
      const domNode = this.#idToDom.get(getObjectId(amNode)!);
      if (!domNode) return null;
      return { kind: 'textContent', domNode, amNode };
    }

    // attribute: path ends with ['attributes', attrName]
    const attrIdx = path.lastIndexOf('attributes');
    if (attrIdx !== -1 && attrIdx === path.length - 2) {
      const amNode = getNodeAtPath(doc, path.slice(0, attrIdx)) as DOMJElement | undefined;
      if (!amNode) return null;
      const domNode = this.#idToDom.get(getObjectId(amNode)!) as Element | undefined;
      if (!domNode) return null;
      return { kind: 'attribute', domNode, amNode, attrName: path[attrIdx + 1] as string };
    }

    // childNodes: path contains 'childNodes', last element is index
    const childIdx = path.lastIndexOf('childNodes');
    if (childIdx !== -1 && typeof path[path.length - 1] === 'number') {
      const amParent = getNodeAtPath(doc, path.slice(0, childIdx)) as DOMJElement | undefined;
      if (!amParent || amParent.nodeType !== Node.ELEMENT_NODE) return null;
      const domParent = this.#idToDom.get(getObjectId(amParent)!) as Element | undefined;
      if (!domParent) return null;
      return { kind: 'childNodes', domParent, amParent, idx: path[path.length - 1] as number };
    }

    return null;
  }

  #serialize(node: Node): DOMJNode | null {
    switch (node.nodeType) {
      case Node.TEXT_NODE:
        return { nodeType: Node.TEXT_NODE, textContent: node.textContent || '' };
      case Node.COMMENT_NODE:
        return { nodeType: Node.COMMENT_NODE, textContent: node.textContent || '' };
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
      default:
        return null;
    }
  }

  /** Create DOM from Automerge node, mapping as we go */
  #hydrate(amNode: DOMJNode): Node {
    let dom: Node;
    switch (amNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const el = document.createElement(amNode.tagName);
        for (const [name, value] of Object.entries(amNode.attributes)) {
          el.setAttribute(name, value.val);
        }
        for (const child of amNode.childNodes) {
          el.appendChild(this.#hydrate(child));
        }
        dom = el;
        break;
      }
      case Node.TEXT_NODE: {
        dom = document.createTextNode(amNode.textContent);
        break;
      }
      case Node.COMMENT_NODE: {
        dom = document.createComment(amNode.textContent);
        break;
      }
      default:
        throw new Error(`Unknown node type: ${(amNode as any).nodeType}`);
    }
    this.#storeMapping(dom, amNode);
    return dom;
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
    const target = this.#resolvePatch(patch.path, doc);
    if (!target) return;

    switch (target.kind) {
      case 'attribute': {
        const value = target.amNode.attributes[target.attrName];
        if (value) target.domNode.setAttribute(target.attrName, value.val);
        else target.domNode.removeAttribute(target.attrName);
        return;
      }
      case 'textContent':
        target.domNode.textContent = target.amNode.textContent;
        return;
      case 'childNodes': {
        const { domParent, amParent, idx } = target;
        if (patch.action === 'insert') {
          const refNode = domParent.childNodes[idx] || null;
          for (let i = 0; i < patch.values.length; i++) {
            const amChild = amParent.childNodes[idx + i];
            if (!amChild) continue;
            const amChildId = getObjectId(amChild);
            if (amChildId && this.#idToDom.has(amChildId)) continue;
            domParent.insertBefore(this.#hydrate(amChild), refNode);
          }
        } else if (patch.action === 'del') {
          const count = patch.length ?? 1;
          for (let i = 0; i < count; i++) {
            const child = domParent.childNodes[idx];
            if (child) {
              this.#removeMappingsRecursively(child);
              domParent.removeChild(child);
            }
          }
        }
        return;
      }
    }
  }

  #stopObserving(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#domToId.clear();
    this.#idToDom.clear();
  }

  #handleAttributeMutation(mutation: MutationRecord): void {
    const targetId = this.#domToId.get(mutation.target);
    if (!targetId || !mutation.attributeName) return;

    const element = mutation.target as Element;
    const attrName = mutation.attributeName;
    const newValue = element.getAttribute(attrName);

    this.#applyLocalChange((doc) => {
      const node = getNodeById(doc, targetId);
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
      const node = getNodeById(doc, targetId);
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
      const parentNode = getNodeById(doc, parentId);
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
    // Re-syncing from parent is safe since #createMappingsRecursively is idempotent
    if (mutation.addedNodes.length > 0) {
      const doc = this.#handle.doc();
      const parentNode = doc && getNodeById(doc, parentId);
      if (parentNode) this.#createMappingsRecursively(parentElement, parentNode);
    }

    // Clean up mappings AFTER Automerge change (we needed IDs during the change)
    for (const removed of mutation.removedNodes) this.#removeMappingsRecursively(removed);
  }

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
    let doc: DOMJElement | undefined;

    // Try to find existing document
    if (this.value && isValidAutomergeUrl(this.value)) {
      this.#handle = await this.#repo.find<DOMJElement>(this.value);
      doc = this.#handle.doc();
      if (doc) {
        this.ownerElement.replaceChildren();
        for (const child of doc.childNodes) {
          this.ownerElement.appendChild(this.#hydrate(child));
        }
      }
    }

    // Create new document if needed
    if (!doc) {
      this.#handle = this.#repo.create<DOMJElement>(this.#serialize(this.ownerElement) as DOMJElement);
      await this.#handle.whenReady();
      if (!this.value) this.value = this.#handle.url;
      doc = this.#handle.doc();
      this.ownerElement.dispatchEvent(new DocChangeEvent(this.value));
    }

    if (!doc) return;

    this.#createMappingsRecursively(this.ownerElement, doc);
    this.#handle.on('change', ({ doc: updatedDoc, patches }) => {
      if (updatedDoc && !this.#isLocalChange) {
        this.#applyRemotePatches(patches || [], updatedDoc);
      }
    });
    this.#observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        switch (m.type) {
          case 'attributes':
            this.#handleAttributeMutation(m);
            break;
          case 'characterData':
            this.#handleCharacterDataMutation(m);
            break;
          case 'childList':
            this.#handleChildListMutation(m);
            break;
        }
      }
    });
    this.#observer.observe(this.ownerElement, OBSERVER_OPTIONS);
  }
}

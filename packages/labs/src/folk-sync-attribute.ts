import type { Doc, ObjID, Patch, Prop } from '@automerge/automerge';
import { getBackend } from '@automerge/automerge';
import {
  DocHandle,
  getObjectId,
  ImmutableString,
  isValidAutomergeUrl,
  Repo,
  WebSocketClientAdapter,
} from '@automerge/vanillajs';
import { CustomAttribute } from '@folkjs/dom/CustomAttribute';
import type { DOMJComment, DOMJElement, DOMJNode, DOMJText } from '@folkjs/labs/dom-json';
import { BiMap } from './BiMap';

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
  #handle: DocHandle<DOMJElement> | null = null;
  #observer: MutationObserver | null = null;
  #changeHandler: ((event: { doc: Doc<DOMJElement>; patches: Patch[] }) => void) | null = null;

  // Bidirectional mapping between DOM nodes and Automerge object IDs
  #nodeMapping = new BiMap<Node, ObjID>();

  // Prevents processing our own local changes as remote patches.
  // Needed because the 'change' event fires synchronously during handle.change().
  #isLocalChange = false;

  #storeMapping(domNode: Node, amNode: DOMJNode): void {
    const id = getObjectId(amNode);
    if (id) {
      this.#nodeMapping.set(domNode, id);
    }
  }

  #removeMappingsRecursively(domNode: Node): void {
    this.#nodeMapping.deleteByA(domNode);
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
    const last = path[path.length - 1];
    const secondLast = path.length >= 2 ? path[path.length - 2] : undefined;

    // textContent: path ends with 'textContent'
    if (last === 'textContent') {
      const amNode = getNodeAtPath(doc, path.slice(0, -1)) as DOMJText | DOMJComment | undefined;
      if (!amNode) return null;
      const domNode = this.#nodeMapping.getByB(getObjectId(amNode)!);
      if (!domNode) return null;
      return { kind: 'textContent', domNode, amNode };
    }

    // attribute: path ends with ['attributes', attrName]
    if (secondLast === 'attributes' && typeof last === 'string') {
      const amNode = getNodeAtPath(doc, path.slice(0, -2)) as DOMJElement | undefined;
      if (!amNode) return null;
      const domNode = this.#nodeMapping.getByB(getObjectId(amNode)!) as Element | undefined;
      if (!domNode) return null;
      return { kind: 'attribute', domNode, amNode, attrName: last };
    }

    // childNodes: path ends with ['childNodes', index]
    if (secondLast === 'childNodes' && typeof last === 'number') {
      const amParent = getNodeAtPath(doc, path.slice(0, -2)) as DOMJElement | undefined;
      if (!amParent || amParent.nodeType !== Node.ELEMENT_NODE) return null;
      const domParent = this.#nodeMapping.getByB(getObjectId(amParent)!) as Element | undefined;
      if (!domParent) return null;
      return { kind: 'childNodes', domParent, amParent, idx: last };
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
    if (!this.#handle) return;
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
            if (amChildId && this.#nodeMapping.hasB(amChildId)) continue;
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
    if (this.#handle && this.#changeHandler) {
      this.#handle.off('change', this.#changeHandler);
      this.#changeHandler = null;
    }
    this.#nodeMapping.clear();
  }

  #handleAttributeMutation(mutation: MutationRecord): void {
    const targetId = this.#nodeMapping.getByA(mutation.target);
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
    const targetId = this.#nodeMapping.getByA(mutation.target);
    if (!targetId) return;

    const newContent = mutation.target.textContent || '';

    this.#applyLocalChange((doc) => {
      const node = getNodeById(doc, targetId);
      if (!node || (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.COMMENT_NODE)) return;
      node.textContent = newContent;
    });
  }

  #handleChildListMutation(mutation: MutationRecord): void {
    const parentId = this.#nodeMapping.getByA(mutation.target);
    if (!parentId || (mutation.addedNodes.length === 0 && mutation.removedNodes.length === 0)) return;

    const parentElement = mutation.target as Element;
    const addedSet = new Set(mutation.addedNodes);

    // Collect IDs of removed nodes BEFORE clearing mappings (needed to find them in Automerge)
    const removedIds = new Map<Node, ObjID>();
    for (const removed of mutation.removedNodes) {
      const id = this.#nodeMapping.getByA(removed);
      if (id) removedIds.set(removed, id);
    }

    // Pre-compute DOM-to-Automerge index mapping in O(n) for all children
    // This avoids O(n²) when inserting multiple nodes
    const domChildren = parentElement.childNodes;
    const domNodeToAmIndex = new Map<Node, number>();
    let amIdx = 0;
    for (const child of domChildren) {
      if (this.#nodeMapping.hasA(child) || addedSet.has(child)) {
        domNodeToAmIndex.set(child, amIdx++);
      }
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

      // Add nodes to Automerge using pre-computed indices
      for (const added of mutation.addedNodes) {
        const serialized = this.#serialize(added);
        if (!serialized) continue;
        const insertIdx = domNodeToAmIndex.get(added) ?? 0;
        parentNode.childNodes.splice(insertIdx, 0, serialized);
      }
    });

    // Create mappings for added nodes (after change, AM IDs are assigned)
    // Re-syncing from parent is safe since #createMappingsRecursively is idempotent
    if (mutation.addedNodes.length > 0) {
      const doc = this.#handle?.doc();
      const parentNode = doc && getNodeById(doc, parentId);
      if (parentNode) this.#createMappingsRecursively(parentElement, parentNode);
    }

    // Clean up mappings AFTER Automerge change (we needed IDs during the change)
    for (const removed of mutation.removedNodes) this.#removeMappingsRecursively(removed);
  }

  override connectedCallback(): void {
    this.#repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
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
      try {
        this.#handle = await this.#repo.find<DOMJElement>(this.value);
        doc = this.#handle.doc();
        if (doc) {
          this.ownerElement.replaceChildren();
          for (const child of doc.childNodes) {
            this.ownerElement.appendChild(this.#hydrate(child));
          }
        }
      } catch (error) {
        console.error('[folk-sync] Failed to find document:', error);
      }
    }

    // Create new document if needed
    if (!doc) {
      try {
        this.#handle = this.#repo.create<DOMJElement>(this.#serialize(this.ownerElement) as DOMJElement);
        await this.#handle.whenReady();
        this.value = this.#handle.url;
        doc = this.#handle.doc();
        this.ownerElement.dispatchEvent(new DocChangeEvent(this.value));
      } catch (error) {
        console.error('[folk-sync] Failed to create document:', error);
        return;
      }
    }

    if (!doc || !this.#handle) return;

    this.#createMappingsRecursively(this.ownerElement, doc);
    this.#changeHandler = ({ doc: updatedDoc, patches }) => {
      if (updatedDoc && !this.#isLocalChange) {
        this.#applyRemotePatches(patches || [], updatedDoc);
      }
    };
    this.#handle.on('change', this.#changeHandler);
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

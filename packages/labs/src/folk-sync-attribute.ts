import type { Doc, DocHandleChangePayload, ObjID, Patch, Prop } from '@folkjs/collab/automerge';
import {
  DocHandle,
  getBackend,
  getObjectId,
  ImmutableString,
  isValidAutomergeUrl,
  Repo,
  WebSocketClientAdapter,
} from '@folkjs/collab/automerge';
import { CustomAttribute } from '@folkjs/dom/CustomAttribute';
import type * as HAST from 'hast';
import { BiMap } from './BiMap';

// DOM node union when we need to handle all node types
type DOMNode = Element | Text | Comment;

// HAST-based (HTML AST) types with Automerge ImmutableString for CRDT attribute values
interface SyncElement extends Omit<HAST.Element, 'properties' | 'children'> {
  properties: { [key: string]: ImmutableString };
  children: SyncNode[];
}
type SyncNode = SyncElement | HAST.Text | HAST.Comment;

/** Navigate to a node in the document using a path */
function getNodeAtPath<T>(doc: Doc<T>, path: Prop[]): unknown {
  return path.reduce((current: any, key) => current?.[key], doc);
}

/** Get an Automerge node by its object ID */
function getNodeById(doc: Doc<SyncElement>, id: ObjID): SyncNode | null {
  const info = getBackend(doc).objInfo(id);
  return info?.path ? (getNodeAtPath(doc, info.path) as SyncNode) : null;
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
  #handle: DocHandle<SyncElement> | null = null;
  #observer: MutationObserver | null = null;
  #changeHandler: ((payload: DocHandleChangePayload<SyncElement>) => void) | null = null;

  // Bidirectional mapping between DOM nodes and Automerge object IDs
  #nodeMapping = new BiMap<DOMNode, ObjID>();

  // Prevents processing our own local changes as remote patches.
  // Needed because automerge-repo doesn't yet pass through proper source info
  // (see TODO in DocHandle.ts line 252)
  #isLocalChange = false;

  #storeMapping(domNode: DOMNode, amNode: SyncNode): void {
    const id = getObjectId(amNode);
    if (id) {
      this.#nodeMapping.set(domNode, id);
    }
  }

  #removeMappingsRecursively(domNode: DOMNode): void {
    this.#nodeMapping.deleteByA(domNode);
    if (domNode.nodeType === Node.ELEMENT_NODE) {
      for (const child of domNode.childNodes) {
        this.#removeMappingsRecursively(child as DOMNode);
      }
    }
  }

  #createMappingsRecursively(domNode: DOMNode, amNode: SyncNode): void {
    this.#storeMapping(domNode, amNode);
    if (amNode.type === 'element' && domNode.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < domNode.childNodes.length && i < amNode.children.length; i++) {
        this.#createMappingsRecursively(domNode.childNodes[i] as DOMNode, amNode.children[i]);
      }
    }
  }

  /** Resolve a patch path to get the target node(s) and classify the change type */
  #resolvePatch(
    path: Prop[],
    doc: Doc<SyncElement>,
  ):
    | { kind: 'property'; domNode: Element; amNode: SyncElement; propName: string }
    | { kind: 'value'; domNode: Text | Comment; amNode: HAST.Text | HAST.Comment }
    | { kind: 'children'; domParent: Element; amParent: SyncElement; idx: number }
    | null {
    const last = path[path.length - 1];
    const secondLast = path.length >= 2 ? path[path.length - 2] : undefined;

    // value: path ends with 'value'
    if (last === 'value') {
      const amNode = getNodeAtPath(doc, path.slice(0, -1)) as HAST.Text | HAST.Comment | undefined;
      if (!amNode) return null;
      const domNode = this.#nodeMapping.getByB(getObjectId(amNode)!) as Text | Comment | undefined;
      if (!domNode) return null;
      return { kind: 'value', domNode, amNode };
    }

    // property: path ends with ['properties', propName]
    if (secondLast === 'properties' && typeof last === 'string') {
      const amNode = getNodeAtPath(doc, path.slice(0, -2)) as SyncElement | undefined;
      if (!amNode) return null;
      const domNode = this.#nodeMapping.getByB(getObjectId(amNode)!) as Element | undefined;
      if (!domNode) return null;
      return { kind: 'property', domNode, amNode, propName: last };
    }

    // children: path ends with ['children', index]
    if (secondLast === 'children' && typeof last === 'number') {
      const amParent = getNodeAtPath(doc, path.slice(0, -2)) as SyncElement | undefined;
      if (!amParent || amParent.type !== 'element') return null;
      const domParent = this.#nodeMapping.getByB(getObjectId(amParent)!) as Element | undefined;
      if (!domParent) return null;
      return { kind: 'children', domParent, amParent, idx: last };
    }

    return null;
  }

  #serialize(node: Node): SyncNode | null {
    switch (node.nodeType) {
      case Node.TEXT_NODE:
        return { type: 'text', value: node.textContent || '' };
      case Node.COMMENT_NODE:
        return { type: 'comment', value: node.textContent || '' };
      case Node.ELEMENT_NODE:
        return this.#serializeElement(node as Element);
      case Node.CDATA_SECTION_NODE:
      case Node.PROCESSING_INSTRUCTION_NODE:
      case Node.DOCUMENT_NODE:
      case Node.DOCUMENT_TYPE_NODE:
      case Node.DOCUMENT_FRAGMENT_NODE:
      default:
        return null;
    }
  }

  #serializeElement(element: Element): SyncElement {
    const properties: Record<string, ImmutableString> = {};
    for (const attr of element.attributes) {
      properties[attr.name] = new ImmutableString(attr.value);
    }
    const children: SyncNode[] = [];
    for (const child of element.childNodes) {
      const serialized = this.#serialize(child);
      if (serialized) children.push(serialized);
    }
    return { type: 'element', tagName: element.tagName.toLowerCase(), properties, children };
  }

  /** Create DOM from Automerge node, mapping as we go */
  #hydrate(amNode: SyncNode): DOMNode {
    let dom: DOMNode;
    switch (amNode.type) {
      case 'element': {
        const el = document.createElement(amNode.tagName);
        for (const [name, value] of Object.entries(amNode.properties)) {
          el.setAttribute(name, value.val);
        }
        for (const child of amNode.children) {
          el.appendChild(this.#hydrate(child));
        }
        dom = el;
        break;
      }
      case 'text': {
        dom = document.createTextNode(amNode.value);
        break;
      }
      case 'comment': {
        dom = document.createComment(amNode.value);
        break;
      }
      default:
        amNode satisfies never;
        throw new Error(`Unknown node type: ${(amNode as any).type}`);
    }
    this.#storeMapping(dom, amNode);
    return dom;
  }

  /** Apply a local DOM change to Automerge, preventing the change event from re-applying patches */
  #applyLocalChange(changeFn: (doc: SyncElement) => void): void {
    this.#isLocalChange = true;
    try {
      this.#handle?.change(changeFn);
    } finally {
      this.#isLocalChange = false;
    }
  }

  /**
   * Apply remote patches by reconciling DOM to match Automerge state.
   * We disconnect the observer during this operation because MutationObserver
   * callbacks are async (microtasks), so a flag-based approach doesn't work.
   */
  #applyRemotePatches(patches: Patch[], doc: Doc<SyncElement>): void {
    this.#observer?.disconnect();
    try {
      for (const patch of patches) {
        try {
          this.#applyRemotePatch(patch, doc);
        } catch (err) {
          console.error('[folk-sync] Failed to apply patch:', patch, err);
          // Continue with other patches even if one fails
        }
      }
    } finally {
      this.#observer?.observe(this.ownerElement, OBSERVER_OPTIONS);
    }
  }

  #applyRemotePatch(patch: Patch, doc: Doc<SyncElement>): void {
    const target = this.#resolvePatch(patch.path, doc);
    if (!target) return;

    switch (target.kind) {
      case 'property': {
        const value = target.amNode.properties[target.propName];
        if (value) target.domNode.setAttribute(target.propName, value.val);
        else target.domNode.removeAttribute(target.propName);
        break;
      }
      case 'value':
        target.domNode.textContent = target.amNode.value;
        break;
      case 'children': {
        const { domParent, amParent, idx } = target;
        if (patch.action === 'insert') {
          const refNode = domParent.childNodes[idx] || null;
          for (let i = 0; i < patch.values.length; i++) {
            const amChild = amParent.children[idx + i];
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
              this.#removeMappingsRecursively(child as DOMNode);
              domParent.removeChild(child);
            }
          }
        }
        break;
      }
      default:
        target satisfies never;
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
    // Attribute mutations always have Element targets - cast once at entry
    if (mutation.target.nodeType !== Node.ELEMENT_NODE) return;
    const element = mutation.target as Element;
    const targetId = this.#nodeMapping.getByA(element);
    if (!targetId || !mutation.attributeName) return;

    const attrName = mutation.attributeName;
    const newValue = element.getAttribute(attrName);

    this.#applyLocalChange((doc) => {
      const node = getNodeById(doc, targetId);
      if (!node || node.type !== 'element') return;

      if (newValue === null) {
        delete node.properties[attrName];
      } else {
        node.properties[attrName] = new ImmutableString(newValue);
      }
    });
  }

  #handleCharacterDataMutation(mutation: MutationRecord): void {
    const target = mutation.target as DOMNode;
    const targetId = this.#nodeMapping.getByA(target);
    if (!targetId) return;

    const newContent = target.textContent || '';

    this.#applyLocalChange((doc) => {
      const node = getNodeById(doc, targetId);
      if (!node) return;
      switch (node.type) {
        case 'text':
        case 'comment':
          node.value = newContent;
          break;
        case 'element':
          break;
        default:
          node satisfies never;
      }
    });
  }

  #handleChildListMutation(mutation: MutationRecord): void {
    // ChildList mutations always have Element targets - cast once at entry
    const parentElement = mutation.target as Element;
    const parentId = this.#nodeMapping.getByA(parentElement);
    if (!parentId || (mutation.addedNodes.length === 0 && mutation.removedNodes.length === 0)) return;
    const addedSet = new Set(mutation.addedNodes);

    // Collect IDs of removed nodes BEFORE clearing mappings (needed to find them in Automerge)
    const removedIds = new Map<Node, ObjID>();
    for (const removed of mutation.removedNodes) {
      const removedNode = removed as DOMNode;
      const id = this.#nodeMapping.getByA(removedNode);
      if (id) removedIds.set(removed, id);
    }

    // Pre-compute DOM-to-Automerge index mapping in O(n) for all children
    // This avoids O(n²) when inserting multiple nodes
    const domChildren = parentElement.childNodes;
    const domNodeToAmIndex = new Map<Node, number>();
    let amIdx = 0;
    for (const child of domChildren) {
      const childNode = child as DOMNode;
      if (this.#nodeMapping.hasA(childNode) || addedSet.has(child)) {
        domNodeToAmIndex.set(child, amIdx++);
      }
    }

    this.#applyLocalChange((doc) => {
      const parentNode = getNodeById(doc, parentId);
      if (!parentNode || parentNode.type !== 'element') return;

      // Remove nodes from Automerge
      for (const removed of mutation.removedNodes) {
        const removedId = removedIds.get(removed);
        if (!removedId) continue;
        const idx = parentNode.children.findIndex((c) => getObjectId(c) === removedId);
        if (idx !== -1) parentNode.children.splice(idx, 1);
      }

      // Add nodes to Automerge using pre-computed indices
      for (const added of mutation.addedNodes) {
        const serialized = this.#serialize(added);
        if (!serialized) continue;
        const insertIdx = domNodeToAmIndex.get(added) ?? 0;
        parentNode.children.splice(insertIdx, 0, serialized);
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
    for (const removed of mutation.removedNodes) {
      this.#removeMappingsRecursively(removed as DOMNode);
    }
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
    let doc: SyncElement | undefined;

    // Try to find existing document
    if (this.value && isValidAutomergeUrl(this.value)) {
      try {
        this.#handle = await this.#repo.find<SyncElement>(this.value);
        doc = this.#handle.doc();
        if (doc) {
          this.ownerElement.replaceChildren();
          for (const child of doc.children) {
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
        this.#handle = this.#repo.create<SyncElement>(this.#serializeElement(this.ownerElement));
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
        this.#applyRemotePatches(patches, updatedDoc);
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
          default:
            m.type satisfies never;
        }
      }
    });
    this.#observer.observe(this.ownerElement, OBSERVER_OPTIONS);
  }
}

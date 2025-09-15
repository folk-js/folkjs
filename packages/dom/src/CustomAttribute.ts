export class CustomAttribute<E extends Element = Element> {
  static attributeName = '';

  static define() {
    if (customAttributes.isDefined(this.attributeName)) return;

    customAttributes.define(this.attributeName, this);
  }

  readonly #ownerElement: E;
  get ownerElement() {
    return this.#ownerElement;
  }

  readonly #name;
  get name() {
    return this.#name;
  }

  #value;
  get value() {
    return this.#value;
  }

  set value(value) {
    this.#value = value;
    this.ownerElement.setAttribute(this.#name, value);
  }

  constructor(ownerElement: E, name: string, value: string) {
    this.#name = name;
    this.#value = value;
    this.#ownerElement = ownerElement;
  }

  connectedCallback() {}

  connectedMoveCallback() {}

  disconnectedCallback() {}

  changedCallback(oldValue: string | null, newValue: string) {}
}

const isNodeAnElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

// Rewritten from https://github.com/lume/custom-attributes
export class CustomAttributeRegistry {
  ownerDocument;

  #attrMap = new Map<string, typeof CustomAttribute>();

  #elementMap = new WeakMap<Element, Map<string, CustomAttribute>>();

  #observer: MutationObserver = new MutationObserver((mutations) => {
    // Track nodes we've already handled as moves to avoid double-processing
    const handledMoveNodes = new Set<Node>();

    mutations.forEach((m: MutationRecord) => {
      if (m.type === 'attributes') {
        if (this.#attrMap.has(m.attributeName!)) {
          this.#handleChange(m.attributeName!, m.target as Element, m.oldValue);
        }
      } else {
        const addNodes = new Set(m.addedNodes);
        const removedNodes = new Set(m.removedNodes);

        // Legacy Chrome: moveBefore operations show nodes in both addedNodes and removedNodes
        // within the same mutation record
        const movedNodes = addNodes.intersection(removedNodes);

        movedNodes.forEach((node) => {
          addNodes.delete(node);
          removedNodes.delete(node);
          handledMoveNodes.add(node);
        });

        // New Chrome: moveBefore operations create separate mutation records for removal and addition.
        // Check if removed nodes are still connected to detect moves.
        removedNodes.forEach((node) => {
          if (!isNodeAnElement(node)) return;

          if (node.isConnected) {
            // Node is removed but still connected - this indicates a moveBefore operation
            handledMoveNodes.add(node); // Mark as handled to avoid double-processing
            this.#elementMap.get(node)?.forEach((inst) => {
              if (inst.connectedMoveCallback !== undefined) {
                inst.connectedMoveCallback();
              } else {
                inst.disconnectedCallback?.();
                inst.connectedCallback?.();
              }
            });
          } else {
            // True removal - node is actually disconnected
            this.#elementMap.get(node)?.forEach((inst) => inst.disconnectedCallback?.());
            this.#elementMap.delete(node);
          }
        });

        // Handle legacy moved nodes (older Chrome versions)
        movedNodes.forEach((node) => {
          if (!isNodeAnElement(node)) return;

          this.#elementMap.get(node)?.forEach((inst) => {
            if (inst.connectedMoveCallback !== undefined) {
              inst.connectedMoveCallback();
            } else {
              inst.disconnectedCallback?.();
              inst.connectedCallback?.();
            }
          });
        });

        // Handle newly added nodes - skip nodes already processed as moves
        addNodes.forEach((node) => {
          if (!isNodeAnElement(node)) return;
          if (handledMoveNodes.has(node)) return; // Skip moved nodes

          for (const attr of node.attributes) {
            if (this.#getConstructor(attr.name)) this.#handleChange(attr.name, node, null);
          }

          // Possibly instantiate custom attributes that may be in the subtree of the connected element.
          this.#attrMap.forEach((_, attr) => this.#upgradeAttr(attr, node));
        });
      }
    });
  });

  constructor(ownerDocument: Document | ShadowRoot = document) {
    this.ownerDocument = ownerDocument;
  }

  define(attrName: string, Class: typeof CustomAttribute) {
    if (!attrName.includes('-')) throw new Error(`Custom attribute '${name}' must include a hyphen.`);

    this.#attrMap.set(attrName, Class);
    this.#upgradeAttr(attrName);
    this.#observer.disconnect();

    this.#observer.observe(this.ownerDocument, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: Array.from(this.#attrMap.keys()),
    });
  }

  isDefined(attrName: string): boolean {
    return this.#attrMap.has(attrName);
  }

  get(element: Element, attrName: string) {
    return this.#elementMap.get(element)?.get(attrName);
  }

  #getConstructor(attrName: string) {
    return this.#attrMap.get(attrName);
  }

  #upgradeAttr(name: string, node: Element | Document | ShadowRoot = this.ownerDocument) {
    node.querySelectorAll('[' + name + ']').forEach((element: Element) => this.#handleChange(name, element, null));
  }

  #handleChange(name: string, el: Element, oldVal: string | null) {
    let map = this.#elementMap.get(el);

    if (map === undefined) {
      this.#elementMap.set(el, (map = new Map()));
    }

    let inst = map.get(name);
    const newVal = el.getAttribute(name);

    if (inst === undefined) {
      const CustomAttributeConstructor = this.#getConstructor(name);

      if (newVal == null || CustomAttributeConstructor === undefined) {
        throw new Error(`Can't construct custom attribute '${name}'`);
      }

      inst = new CustomAttributeConstructor(el, name, newVal);
      map.set(name, inst);
      inst.connectedCallback?.();
      inst.changedCallback?.(null, newVal);
      return;
    } else if (newVal == null) {
      inst.disconnectedCallback?.();
      map.delete(name);
    } else if (newVal !== inst.value) {
      inst.value = newVal;
      if (oldVal == null) throw new Error('Not possible!');
      inst.changedCallback?.(oldVal, newVal);
    }
  }
}

// There are cases when multiple versions of this registry might be added to the page
// and we need to guarantee there is only a single registry created.
let customAttributes: CustomAttributeRegistry;

if ('__customAttributes' in window) {
  customAttributes = window.__customAttributes as CustomAttributeRegistry;
} else {
  (window as any).__customAttributes = customAttributes = new CustomAttributeRegistry();
}

export { customAttributes };

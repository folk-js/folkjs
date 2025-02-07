export class CustomAttribute {
  static attributeName = '';

  static define() {
    if (customElements.get(this.attributeName)) return;

    customAttributes.define(this.attributeName, this);
  }
  readonly #ownerElement;
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
  }

  constructor(ownerElement: Element, name: string, value: string) {
    if (!name.includes('-')) throw new Error(`Custom attribute '${name}' must include a hyphen.`);

    this.#name = name;
    this.#value = value;
    this.#ownerElement = ownerElement;
  }

  connectedCallback(): void {}

  disconnectedCallback(): void {}

  changedCallback(oldValue: string | null, newValue: string): void {}
}

const isNodeAnElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

// Rewritten from https://github.com/lume/custom-attributes
export class CustomAttributeRegistry {
  ownerDocument;

  #attrMap = new Map<string, typeof CustomAttribute>();

  #elementMap = new WeakMap<Element, Map<string, CustomAttribute>>();

  #observer: MutationObserver = new MutationObserver((mutations) => {
    mutations.forEach((m: MutationRecord) => {
      if (m.type === 'attributes') {
        const attr = this.#getConstructor(m.attributeName!);
        if (attr) this.#handleChange(m.attributeName!, m.target as Element, m.oldValue);
      } else {
        m.removedNodes.forEach((node) => {
          if (!isNodeAnElement(node)) return;

          this.#elementMap.get(node)?.forEach((inst) => inst.disconnectedCallback?.(), this);
          this.#elementMap.delete(node);
        });

        m.addedNodes.forEach((node) => {
          if (!isNodeAnElement(node)) return;

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
      inst.connectedCallback();
      inst.changedCallback(null, newVal);
      return;
    } else if (newVal == null) {
      inst.disconnectedCallback();
      map.delete(name);
    } else if (newVal !== inst.value) {
      inst.value = newVal;
      if (oldVal == null) throw new Error('Not possible!');
      inst.changedCallback(oldVal, newVal);
    }
  }
}

export const customAttributes = new CustomAttributeRegistry();

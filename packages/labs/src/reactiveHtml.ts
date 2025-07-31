let watcherStack: (() => void)[] = [];

export function reactive<T extends object>(obj: T): T {
  const listeners = new Map<string | symbol, Set<() => void>>();

  const notify = (prop: string | symbol) => {
    if (listeners.has(prop)) {
      for (const fn of listeners.get(prop)!) fn();
    }
  };

  const watch = (getter: () => any, cb: (v: any) => void) => {
    const run = () => {
      watcherStack.push(run);
      cb(getter());
      watcherStack.pop();
    };
    run();
  };

  return new Proxy(obj, {
    get(target, prop, receiver) {
      const watcher = watcherStack[watcherStack.length - 1];
      if (watcher) {
        if (!listeners.has(prop)) listeners.set(prop, new Set());
        listeners.get(prop)!.add(watcher);
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      const oldVal = Reflect.get(target, prop, receiver);
      const ok = Reflect.set(target, prop, value, receiver);
      if (ok && oldVal !== value) notify(prop);
      return ok;
    },
  }) as T & { __watch?: typeof watch };
}

export function watch(getter: () => any, cb: (v: any) => void) {
  const run = () => {
    watcherStack.push(run);
    cb(getter());
    watcherStack.pop();
  };
  run();
}

export function reactiveHTML(strings: TemplateStringsArray, ...values: any[]) {
  // Pass 1: Build HTML with holes, but track which holes are reactive
  const reactiveHoles = new Set<number>();

  let html = strings[0];
  for (let i = 0; i < values.length; i++) {
    html += `__HOLE_${i}__${strings[i + 1]}`;

    if (typeof values[i] === 'function') {
      reactiveHoles.add(i);
    }
  }

  // Parse the HTML
  const frag = document.createRange().createContextualFragment(html);
  const refs: any = { frag };

  // Extract refs
  frag.querySelectorAll('[ref]').forEach((el) => {
    refs[el.getAttribute('ref')!] = el;
    el.removeAttribute('ref');
  });

  // Pass 2: Process holes, but with cleaner logic knowing which are reactive

  // Handle attributes
  frag.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (!attr.value.includes('__HOLE_')) return;

      const holeRegex = /__HOLE_(\d+)__/g;
      const matches = [...attr.value.matchAll(holeRegex)];
      const hasReactive = matches.some((m) => reactiveHoles.has(parseInt(m[1], 10)));

      // Handle pure event handlers
      if (attr.name.startsWith('on') && matches.length === 1 && attr.value === matches[0][0]) {
        const holeIndex = parseInt(matches[0][1], 10);
        if (reactiveHoles.has(holeIndex)) {
          el.addEventListener(attr.name.slice(2), values[holeIndex] as EventListener);
          el.removeAttribute(attr.name);
          return;
        }
      }

      if (hasReactive) {
        // Set up reactive attribute
        watch(
          () => {
            let result = attr.value;
            matches.forEach((match) => {
              const holeIndex = parseInt(match[1], 10);
              const val = values[holeIndex];
              const resolved = typeof val === 'function' ? val() : val;
              result = result.replace(match[0], String(resolved ?? ''));
            });
            return result;
          },
          (newVal) => {
            if (newVal === '' || newVal === 'null' || newVal === 'undefined') {
              el.removeAttribute(attr.name);
            } else {
              el.setAttribute(attr.name, newVal);
            }
          },
        );
      } else {
        // All static - resolve immediately
        let result = attr.value;
        matches.forEach((match) => {
          const holeIndex = parseInt(match[1], 10);
          result = result.replace(match[0], String(values[holeIndex] ?? ''));
        });
        el.setAttribute(attr.name, result);
      }
    });
  });

  // Handle text nodes
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const nodeValue = textNode.nodeValue || '';
    if (!nodeValue.includes('__HOLE_')) continue;

    const holeRegex = /__HOLE_(\d+)__/g;
    const matches = [...nodeValue.matchAll(holeRegex)];
    const hasReactive = matches.some((m) => reactiveHoles.has(parseInt(m[1], 10)));

    if (hasReactive) {
      // Set up reactive text
      const original = nodeValue;
      watch(
        () => {
          let result = original;
          matches.forEach((match) => {
            const holeIndex = parseInt(match[1], 10);
            const val = values[holeIndex];
            const resolved = typeof val === 'function' ? val() : val;
            result = result.replace(match[0], String(resolved ?? ''));
          });
          return result;
        },
        (newText) => {
          textNode.nodeValue = newText;
        },
      );
    } else {
      // All static - resolve immediately
      let result = nodeValue;
      matches.forEach((match) => {
        const holeIndex = parseInt(match[1], 10);
        result = result.replace(match[0], String(values[holeIndex] ?? ''));
      });
      textNode.nodeValue = result;
    }
  }

  return refs;
}

export class MyCounter extends HTMLElement {
  state = reactive({ count: 0 });

  connectedCallback() {
    const { frag, reset } = reactiveHTML`
      <h1>Count: ${() => this.state.count}</h1>
      <button onclick=${() => this.state.count++}>Increment</button>
      <button onclick=${() => this.state.count--}>Decrement</button>
      <button ref="reset">Reset</button>
    `;

    this.attachShadow({ mode: 'open' }).appendChild(frag);

    reset.addEventListener('click', () => (this.state.count = 0));
  }
}

export class MyCounterReactive extends HTMLElement {
  state = reactive({ count: 0, step: 1 });

  connectedCallback() {
    const { frag } = reactiveHTML`
    <div>
    <h1>Count: ${() => this.state.count}</h1>
    <p>Double: ${() => this.state.count * 2}</p>
    <p>Status: ${() => (this.state.count % 2 === 0 ? 'Even' : 'Odd')}</p>
    <button onclick=${() => (this.state.count += this.state.step)}>+${() => this.state.step}</button>
    <button onclick=${() => (this.state.count -= this.state.step)}>- ${() => this.state.step}</button>
    <button onclick=${() => (this.state.count = 0)} >Reset</button>
    <label>
    Step:
    <input type="number" value=${() => this.state.step}
    oninput=${(e: Event) => (this.state.step = parseInt((e.target as HTMLInputElement).value) || 1)} />
    </label>
    </div>
    `;

    this.attachShadow({ mode: 'open' }).appendChild(frag);
  }
}
customElements.define('my-counter', MyCounter);
customElements.define('my-counter-2', MyCounterReactive);

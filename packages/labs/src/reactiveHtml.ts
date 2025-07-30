import { html3 } from '@folkjs/dom/tags';

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
  // Build HTML with hole sentinels
  let html = '';
  for (let i = 0; i < strings.length; i++) {
    html += strings[i];
    if (i < values.length) {
      html += `__HOLE_${i}__`;
    }
  }

  // Parse into a real DOM fragment
  const frag = document.createRange().createContextualFragment(html);
  const refs: any = { frag };

  // Handle refs (like html3)
  for (const el of frag.querySelectorAll<HTMLElement>(`[ref]`)) {
    const attrName = el.getAttribute('ref')!;
    refs[attrName] = el;
    el.removeAttribute('ref');
  }

  // Handle attributes with holes
  for (const el of frag.querySelectorAll<HTMLElement>('*')) {
    for (const attr of Array.from(el.attributes)) {
      const regex = /__HOLE_(\d+)__/g;
      let match: RegExpExecArray | null;
      let dynamic = false;

      while ((match = regex.exec(attr.value))) {
        const holeIndex = parseInt(match[1], 10);
        const val = values[holeIndex];

        if (typeof val === 'function') {
          dynamic = true;
          if (attr.name.startsWith('on')) {
            const eventName = attr.name.slice(2);
            el.addEventListener(eventName, val as EventListener);
            el.removeAttribute(attr.name);
          } else {
            watch(
              () => val(),
              (v: any) => {
                const newVal = attr.value.replace(regex, String(v ?? ''));
                if (v == null) el.removeAttribute(attr.name);
                else el.setAttribute(attr.name, newVal);
              },
            );
          }
        } else {
          attr.value = attr.value.replace(match[0], String(val));
        }
      }

      if (!dynamic && attr.value.includes('__HOLE_')) {
        // Clean up unmatched holes if any remain
        attr.value = attr.value.replace(/__HOLE_\d+__/g, '');
      }
    }
  }

  // Handle text nodes with holes
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const regex = /__HOLE_(\d+)__/g;
    let match: RegExpExecArray | null;

    if (!regex.test(textNode.nodeValue || '')) continue;
    const original = textNode.nodeValue!;

    watch(
      () => {
        let output = original;
        regex.lastIndex = 0;
        while ((match = regex.exec(original))) {
          const holeIndex = parseInt(match[1], 10);
          const val = values[holeIndex];
          output = output.replace(match[0], String(typeof val === 'function' ? val() : (val ?? '')));
        }
        return output;
      },
      (v) => {
        textNode.nodeValue = v;
      },
    );
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

customElements.define('my-counter', MyCounter);

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

export class MyCounterHtml3 extends HTMLElement {
  state = { count: 0, step: 1 };

  connectedCallback() {
    const { frag, countText, doubleText, statusText, incBtn, decBtn, resetBtn, stepInput } = html3(`
      <div>
        <h1 ref="countText"></h1>
        <p ref="doubleText"></p>
        <p ref="statusText"></p>
        <button ref="incBtn"></button>
        <button ref="decBtn"></button>
        <button ref="resetBtn">Reset</button>
        <label>
          Step:
          <input ref="stepInput" type="number" />
        </label>
      </div>
    `);

    this.attachShadow({ mode: 'open' }).appendChild(frag);

    const updateUI = () => {
      countText.textContent = `Count: ${this.state.count}`;
      doubleText.textContent = `Double: ${this.state.count * 2}`;
      statusText.textContent = `Status: ${this.state.count % 2 === 0 ? 'Even' : 'Odd'}`;
      incBtn.textContent = `+${this.state.step}`;
      decBtn.textContent = `-${this.state.step}`;
      stepInput.value = String(this.state.step);
    };

    updateUI();

    incBtn.addEventListener('click', () => {
      this.state.count += this.state.step;
      updateUI();
    });

    decBtn.addEventListener('click', () => {
      this.state.count -= this.state.step;
      updateUI();
    });

    resetBtn.addEventListener('click', () => {
      this.state.count = 0;
      updateUI();
    });

    stepInput.addEventListener('input', (e: Event) => {
      const val = parseInt((e.target as HTMLInputElement).value) || 1;
      this.state.step = val;
      updateUI();
    });
  }
}

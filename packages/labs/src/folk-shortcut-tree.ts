import { FolkElement } from '@folkjs/canvas';
import { css } from '@folkjs/dom/tags';

declare global {
  interface HTMLElementTagNameMap {
    'folk-shortcut-tree': FolkShortcutTree;
  }
}

export class FolkShortcutTree extends FolkElement {
  static override tagName = 'folk-shortcut-tree';

  static override styles = css`
    :host {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #1a1a1a;
      font-family: sans-serif;
      position: fixed;
      inset: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      perspective: 1000px;
      transform-style: preserve-3d;
    }

    .keyboard {
      background: #2a2a2a;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
    }

    .keyboard-row {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;
    }

    .keyboard-row:last-child {
      margin-bottom: 0;
    }

    kbd {
      background: #3a3a3a;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      user-select: none;
    }

    kbd.wide {
      width: 60px;
    }
    kbd.extra-wide {
      width: 86px;
    }
    kbd.space {
      width: 250px;
    }
    kbd.half-height {
      height: 20px;
    }

    kbd:hover {
      background: #4a4a4a;
    }

    kbd.available {
      background: #585e6f;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    /* Modifier-specific colors */
    kbd.cmd-available,
    kbd.modifier-active[data-modifier='cmd'] {
      background: #00a67e;
    }

    kbd.shift-available,
    kbd.modifier-active[data-modifier='shift'] {
      background: #e63946;
    }

    kbd.alt-available,
    kbd.modifier-active[data-modifier='alt'] {
      background: #4361ee;
    }

    kbd.ctrl-available,
    kbd.modifier-active[data-modifier='ctrl'] {
      background: #9d4edd;
    }

    /* Multi-modifier combinations - Active and Continuation */
    kbd[data-modifier-combo] {
      background: var(--gradient-pattern);
    }

    kbd.continuation-available[data-modifier-combo] {
      --alpha: 0.3;
      background: var(--gradient-pattern);
    }

    /* Define all possible two-modifier combinations */
    kbd[data-modifier-combo='cmd-shift'] {
      --gradient-pattern: repeating-linear-gradient(
        45deg,
        rgba(0, 166, 126, var(--alpha, 1)) 0px,
        rgba(0, 166, 126, var(--alpha, 1)) 8px,
        rgba(230, 57, 70, var(--alpha, 1)) 8px,
        rgba(230, 57, 70, var(--alpha, 1)) 16px
      );
    }

    kbd[data-modifier-combo='cmd-alt'] {
      --gradient-pattern: repeating-linear-gradient(
        45deg,
        rgba(0, 166, 126, var(--alpha, 1)) 0px,
        rgba(0, 166, 126, var(--alpha, 1)) 8px,
        rgba(67, 97, 238, var(--alpha, 1)) 8px,
        rgba(67, 97, 238, var(--alpha, 1)) 16px
      );
    }

    kbd[data-modifier-combo='cmd-ctrl'] {
      --gradient-pattern: repeating-linear-gradient(
        45deg,
        rgba(0, 166, 126, var(--alpha, 1)) 0px,
        rgba(0, 166, 126, var(--alpha, 1)) 8px,
        rgba(157, 78, 221, var(--alpha, 1)) 8px,
        rgba(157, 78, 221, var(--alpha, 1)) 16px
      );
    }

    kbd[data-modifier-combo='shift-alt'] {
      --gradient-pattern: repeating-linear-gradient(
        45deg,
        rgba(230, 57, 70, var(--alpha, 1)) 0px,
        rgba(230, 57, 70, var(--alpha, 1)) 8px,
        rgba(67, 97, 238, var(--alpha, 1)) 8px,
        rgba(67, 97, 238, var(--alpha, 1)) 16px
      );
    }

    kbd[data-modifier-combo='shift-ctrl'] {
      --gradient-pattern: repeating-linear-gradient(
        45deg,
        rgba(230, 57, 70, var(--alpha, 1)) 0px,
        rgba(230, 57, 70, var(--alpha, 1)) 8px,
        rgba(157, 78, 221, var(--alpha, 1)) 8px,
        rgba(157, 78, 221, var(--alpha, 1)) 16px
      );
    }

    kbd[data-modifier-combo='ctrl-shift'] {
      --gradient-pattern: repeating-linear-gradient(
        45deg,
        rgba(157, 78, 221, var(--alpha, 1)) 0px,
        rgba(157, 78, 221, var(--alpha, 1)) 8px,
        rgba(230, 57, 70, var(--alpha, 1)) 8px,
        rgba(230, 57, 70, var(--alpha, 1)) 16px
      );
    }

    kbd[data-modifier-combo='alt-ctrl'] {
      --gradient-pattern: repeating-linear-gradient(
        45deg,
        rgba(67, 97, 238, var(--alpha, 1)) 0px,
        rgba(67, 97, 238, var(--alpha, 1)) 8px,
        rgba(157, 78, 221, var(--alpha, 1)) 8px,
        rgba(157, 78, 221, var(--alpha, 1)) 16px
      );
    }

    .keyboard-arrows {
      display: grid;
      grid-template-columns: repeat(3, 40px);
      grid-template-rows: repeat(2, 20px);
      margin-left: 6px;
    }

    .arrow-up {
      grid-column: 2;
      grid-row: 1;
    }

    .arrow-left {
      grid-column: 1;
      grid-row: 2;
    }

    .arrow-down {
      grid-column: 2;
      grid-row: 2;
    }

    .arrow-right {
      grid-column: 3;
      grid-row: 2;
    }

    .action-tooltip {
      position: absolute;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      white-space: nowrap;
    }

    /* Add tree-specific styles */
    .tree-view {
      width: 800px;
      height: 800px;
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
    }

    .tree-container {
      position: absolute;
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .tree-view kbd {
      position: absolute;
      transform: translate(-50%, -50%);
      z-index: 1;
      background: #3a3a3a;
    }

    .tree-view kbd.context {
      background: #2a2a2a;
    }

    .tree-link {
      position: absolute;
      height: 2px;
      background: #3a3a3a;
      transform-origin: 0 50%;
      pointer-events: none;
      z-index: 0;
      transition: all 0.2s ease;
    }

    .tree-link.active {
      height: 3px;
    }

    .tree-link.partially-active {
      height: 2.5px;
    }

    /* View toggle styles */
    .view-toggle {
      z-index: 1000;
      position: fixed;
      top: 20px;
      right: 20px;
      background: #3a3a3a;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.2s;
    }

    .view-toggle:hover {
      background: #4a4a4a;
    }

    /* Container styles */
    :host {
      position: fixed;
      inset: 0;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .keyboard {
      position: relative;
      transform-origin: center;
      margin: auto;
      display: flex;
      flex-direction: column;
      background: #2a2a2a;
      padding: 24px;
      border-radius: 12px;
    }

    .tree-view {
      width: 800px;
      height: 800px;
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
    }

    .tree-container {
      position: absolute;
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  `;

  #keyboard = document.createElement('div');
  #treeContainer = document.createElement('div');

  // Change from object to array of shortcut definitions
  #shortcuts = [
    // No modifier shortcuts
    { key: 'f1', modifiers: [], action: 'Show Help' },
    { key: 'f2', modifiers: [], action: 'Rename Symbol' },
    { key: 'f3', modifiers: [], action: 'Find Next' },
    { key: 'f4', modifiers: [], action: 'Close Tab' },
    { key: 'f5', modifiers: [], action: 'Refresh' },
    { key: 'f6', modifiers: [], action: 'Focus Address Bar' },
    { key: 'f7', modifiers: [], action: 'Caret Browsing' },
    { key: 'f8', modifiers: [], action: 'Developer Mode' },
    { key: 'f9', modifiers: [], action: 'Toggle Sidebar' },
    { key: 'f10', modifiers: [], action: 'Menu Bar' },
    { key: 'f11', modifiers: [], action: 'Toggle Full Screen' },
    { key: 'f12', modifiers: [], action: 'Developer Tools' },
    { key: 'esc', modifiers: [], action: 'Exit / Cancel' },

    // Command shortcuts
    { key: 'z', modifiers: ['cmd'], action: 'Undo' },
    { key: 'c', modifiers: ['cmd'], action: 'Copy' },
    { key: 'v', modifiers: ['cmd'], action: 'Paste' },
    { key: 'x', modifiers: ['cmd'], action: 'Cut' },
    { key: 'a', modifiers: ['cmd'], action: 'Select All' },
    { key: 's', modifiers: ['cmd'], action: 'Save' },
    { key: 'f', modifiers: ['cmd'], action: 'Find' },
    { key: 'p', modifiers: ['cmd'], action: 'Print' },
    { key: 'n', modifiers: ['cmd'], action: 'New' },
    { key: 'w', modifiers: ['cmd'], action: 'Close' },

    // Command + Shift shortcuts
    { key: 'z', modifiers: ['cmd', 'shift'], action: 'Redo' },

    // Shift combinations
    { key: 'tab', modifiers: ['shift'], action: 'Focus Previous' },
    { key: 'space', modifiers: ['shift'], action: 'Select Text' },
    { key: '1', modifiers: ['shift'], action: 'Insert Exclamation' },
    { key: '2', modifiers: ['shift'], action: 'Insert At Symbol' },
    { key: '3', modifiers: ['shift'], action: 'Insert Hash' },
    { key: '4', modifiers: ['shift'], action: 'Insert Dollar' },
  ];

  // Track active modifier keys
  #activeModifiers = {
    cmd: false,
    shift: false,
    alt: false,
    ctrl: false,
  };

  // Add tooltip element reference
  #tooltip: HTMLDivElement | null = null;

  // Add view state tracking
  #currentView: 'keyboard' | 'tree' = 'keyboard';

  // Add toggle button
  #toggleButton = document.createElement('button');

  constructor() {
    super();
  }

  override connectedCallback() {
    super.connectedCallback();
    this.#setupViewToggle();
    this.#setupEventListeners();
    this.#createTreeContainer();
  }

  #setupViewToggle() {
    this.#toggleButton.className = 'view-toggle';
    this.#toggleButton.textContent = 'Toggle View (/)';
    this.#toggleButton.addEventListener('click', () => this.#toggleView());
    this.renderRoot.appendChild(this.#toggleButton);
  }

  async #toggleView() {
    if (this.#currentView === 'keyboard') {
      this.#keyboard.style.display = 'none';
      this.#treeContainer.style.display = 'block';
      this.#updateTreeView();
      this.#currentView = 'tree';
    } else {
      this.#treeContainer.style.display = 'none';
      this.#keyboard.style.display = 'flex';
      this.#currentView = 'keyboard';
    }
  }

  #createTreeContainer() {
    this.#treeContainer.className = 'tree-view';
    const container = document.createElement('div');
    container.className = 'tree-container';
    this.#treeContainer.appendChild(container);
    this.renderRoot.appendChild(this.#treeContainer);
  }

  #setupEventListeners() {
    // Keyboard events
    document.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();

      // Add view toggle shortcut
      if (key === '/' && e.target instanceof HTMLElement && !e.target.matches('input, textarea')) {
        e.preventDefault(); // Prevent "/" from being typed
        this.#toggleView();
        return;
      }

      const modMap = {
        control: 'ctrl',
        meta: 'cmd',
        alt: 'alt',
        shift: 'shift',
      } as const;
      const mod = modMap[key as keyof typeof modMap];
      if (mod) {
        this.#activeModifiers[mod as 'cmd' | 'shift' | 'alt' | 'ctrl'] = true;
        // Only update the active view
        if (this.#currentView === 'keyboard') {
          this.#updateKeyboardColors();
        } else {
          this.#updateTreeColors();
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      const modMap = {
        control: 'ctrl',
        meta: 'cmd',
        alt: 'alt',
        shift: 'shift',
      } as const;
      const mod = modMap[key as keyof typeof modMap];
      if (mod) {
        this.#activeModifiers[mod as 'cmd' | 'shift' | 'alt' | 'ctrl'] = false;
        // Only update the active view
        if (this.#currentView === 'keyboard') {
          this.#updateKeyboardColors();
        } else {
          this.#updateTreeColors();
        }
      }
    });
  }

  #updateKeyboardColors() {
    const activeModifiersList = Object.entries(this.#activeModifiers)
      .filter(([_, active]) => active)
      .map(([mod]) => mod)
      .sort();

    this.renderRoot.querySelectorAll('kbd').forEach((key) => {
      const keyName = this.#standardizeKeyName(key.textContent || '');

      // Handle modifier keys
      if (['cmd', 'shift', 'alt', 'ctrl'].includes(keyName)) {
        const modifier = keyName as 'cmd' | 'shift' | 'alt' | 'ctrl';
        if (this.#activeModifiers[modifier]) {
          this.#applyModifierStyles(key, [modifier], true, false);
        } else {
          this.#applyModifierStyles(key, [modifier], false, false);
        }
        return;
      }

      // Find matching shortcuts for this key
      const matchingShortcut = this.#shortcuts.find(
        (s) =>
          s.key === keyName &&
          s.modifiers.length === activeModifiersList.length &&
          JSON.stringify(s.modifiers.sort()) === JSON.stringify(activeModifiersList),
      );

      if (matchingShortcut) {
        this.#applyModifierStyles(key, matchingShortcut.modifiers, true, false);
      } else {
        key.style.background = '#3a3a3a';
      }
    });
  }

  // Helper methods
  #standardizeKeyName(keyText: string): string {
    const mapping = {
      '⌘': 'cmd',
      command: 'cmd',
      '⇧': 'shift',
      '⌥': 'alt',
      option: 'alt',
      '⌃': 'ctrl',
      control: 'ctrl',
    };
    return mapping[keyText.toLowerCase() as keyof typeof mapping] || keyText.toLowerCase();
  }

  #getAvailableShortcuts(): Set<string> {
    const activeModifiersArray = Object.entries(this.#activeModifiers)
      .filter(([_, active]) => active)
      .map(([mod]) => mod);
    const available = new Set<string>();

    this.#shortcuts.forEach((shortcut) => {
      const modifiers = shortcut.modifiers;
      if (
        modifiers.length === activeModifiersArray.length &&
        modifiers.every((mod) => activeModifiersArray.includes(mod))
      ) {
        available.add(shortcut.key.toLowerCase());
      }
    });

    return available;
  }

  override createRenderRoot() {
    const root = super.createRenderRoot();
    this.#keyboard.className = 'keyboard';
    root.appendChild(this.#keyboard);

    // Move keyboard layout building to after the keyboard is attached to the root
    this.#buildKeyboardLayout();

    return root;
  }

  #buildKeyboardLayout() {
    // Create keyboard rows and keys
    const rows = [
      ['esc', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', '•'],
      ['~', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '⌫'],
      ['tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
      ['caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'return'],
      ['⇧', '`', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', '⇧'],
      ['fn', '⌃', '⌥', '⌘', '', '⌘', '⌥', '↑', '←', '↓', '→'],
    ];

    rows.forEach((rowKeys) => {
      const row = document.createElement('div');
      row.className = 'keyboard-row';

      rowKeys.forEach((key) => {
        if (key === '') {
          const space = document.createElement('kbd');
          space.className = 'space';
          row.appendChild(space);
          return;
        }

        const kbd = document.createElement('kbd');
        kbd.textContent = key;

        // Add special classes and data attributes
        switch (key) {
          case 'esc':
          case 'tab':
          case '⌫':
          case 'return':
            kbd.className = 'wide';
            break;
          case 'caps':
          case '⇧':
            kbd.className = 'extra-wide';
            if (key === '⇧') kbd.dataset.modifier = 'shift';
            break;
          case '⌃':
            kbd.dataset.modifier = 'ctrl';
            break;
          case '⌥':
            kbd.dataset.modifier = 'alt';
            break;
          case '⌘':
            kbd.dataset.modifier = 'cmd';
            break;
        }

        // Add data-key-id attribute
        kbd.setAttribute('data-key-id', `${key}`);

        row.appendChild(kbd);
      });

      this.#keyboard.appendChild(row);
    });

    // Add tooltip listeners to all keys
    this.#keyboard.querySelectorAll('kbd').forEach((key) => {
      key.addEventListener('mouseover', (e) => this.#showTooltip(key, e));
      key.addEventListener('mouseout', () => this.#hideTooltip());
    });
  }

  #applyModifierStyles(
    element: HTMLElement,
    modifiers: string[],
    isActive = true,
    isPartiallyActive = false,
    isValid = false,
  ) {
    // Reset to default state
    element.style.background = '#3a3a3a';

    // For modifier keys when not pressed, show very dimmed color
    if (element.hasAttribute('data-modifier') && !isActive && !isPartiallyActive) {
      if (isValid) {
        const modifier = element.getAttribute('data-modifier');
        const color = this.#getModifierColor(modifier);
        element.style.background = color.replace('rgb', 'rgba').replace(')', ', 0.2)');
      }
      return;
    }

    // If not active or partially active and not valid, keep default color
    if (!isActive && !isPartiallyActive && !isValid) {
      return;
    }

    // Apply dimmed style for valid but inactive nodes
    if (!isActive && !isPartiallyActive && isValid) {
      if (modifiers.length === 0) {
        element.style.background = 'rgba(88, 94, 111, 0.3)';
      } else if (modifiers.length === 1) {
        const color = this.#getModifierColor(modifiers[0]);
        element.style.background = color.replace('rgb', 'rgba').replace(')', ', 0.2)');
      } else if (modifiers.length === 2) {
        const color1 = this.#getModifierColor(modifiers[0]);
        const color2 = this.#getModifierColor(modifiers[1]);
        element.style.background = `repeating-linear-gradient(45deg,
          ${color1.replace('rgb', 'rgba').replace(')', ', 0.2)')} 0px,
          ${color1.replace('rgb', 'rgba').replace(')', ', 0.2)')} 8px,
          ${color2.replace('rgb', 'rgba').replace(')', ', 0.2)')} 8px,
          ${color2.replace('rgb', 'rgba').replace(')', ', 0.2)')} 16px
        )`;
      }
      return;
    }

    // Apply full color for active nodes
    if (isActive) {
      if (modifiers.length === 0) {
        element.style.background = '#585e6f';
      } else if (modifiers.length === 1) {
        element.style.background = this.#getModifierColor(modifiers[0]);
      } else if (modifiers.length === 2) {
        const color1 = this.#getModifierColor(modifiers[0]);
        const color2 = this.#getModifierColor(modifiers[1]);
        element.style.background = `repeating-linear-gradient(45deg,
          ${color1} 0px,
          ${color1} 8px,
          ${color2} 8px,
          ${color2} 16px
        )`;
      }
    }
    // Apply partially active style
    else if (isPartiallyActive) {
      if (modifiers.length === 1) {
        const color = this.#getModifierColor(modifiers[0]);
        element.style.background = color.replace('rgb', 'rgba').replace(')', ', 0.3)');
      } else if (modifiers.length === 2) {
        const color1 = this.#getModifierColor(modifiers[0]);
        const color2 = this.#getModifierColor(modifiers[1]);
        element.style.background = `repeating-linear-gradient(45deg,
          ${color1.replace('rgb', 'rgba').replace(')', ', 0.3)')} 0px,
          ${color1.replace('rgb', 'rgba').replace(')', ', 0.3)')} 8px,
          ${color2.replace('rgb', 'rgba').replace(')', ', 0.3)')} 8px,
          ${color2.replace('rgb', 'rgba').replace(')', ', 0.3)')} 16px
        )`;
      }
    }
  }

  #getModifierColor(modifier: string | null): string {
    if (!modifier) return '#3a3a3a';

    const colors = {
      cmd: '#00a67e',
      shift: '#e63946',
      alt: '#4361ee',
      ctrl: '#9d4edd',
    };
    return colors[modifier as keyof typeof colors] || '#3a3a3a';
  }

  // Add tooltip functionality
  #showTooltip(key: HTMLElement, event: MouseEvent) {
    const keyName = this.#standardizeKeyName(key.textContent || '');
    const activeModifiers = Object.entries(this.#activeModifiers)
      .filter(([_, active]) => active)
      .map(([mod]) => mod)
      .sort();

    const shortcut = this.#shortcuts.find(
      (s) => s.key === keyName && JSON.stringify(s.modifiers.sort()) === JSON.stringify(activeModifiers),
    );

    if (
      shortcut &&
      activeModifiers.length === shortcut.modifiers.length &&
      shortcut.modifiers.every((mod) => activeModifiers.includes(mod))
    ) {
      if (!this.#tooltip) {
        this.#tooltip = document.createElement('div');
        this.#tooltip.className = 'action-tooltip';
        document.body.appendChild(this.#tooltip);
      }

      this.#tooltip.textContent = shortcut.action;
      this.#tooltip.style.left = `${event.pageX + 10}px`;
      this.#tooltip.style.top = `${event.pageY + 10}px`;
      this.#tooltip.style.display = 'block';
    }
  }

  #hideTooltip() {
    if (this.#tooltip) {
      this.#tooltip.style.display = 'none';
    }
  }

  #updateTreeView() {
    const container = this.#treeContainer.querySelector('.tree-container');
    if (!container) return;

    container.innerHTML = '';

    // Add context node at center
    const contextNode = document.createElement('kbd');
    contextNode.textContent = 'ctx';
    contextNode.className = 'context';
    contextNode.style.left = '400px';
    contextNode.style.top = '400px';
    container.appendChild(contextNode);

    // First, organize the shortcuts into a tree structure
    const tree = {
      modifiers: new Map(), // Map of modifier -> { children: [], leaves: 0 }
      combos: new Map(), // Map of combo -> { children: [], leaves: 0 }
      direct: new Set(), // Set of shortcuts with no modifiers
    };

    // Count leaves and organize nodes
    this.#shortcuts.forEach((shortcut) => {
      const { key, modifiers } = shortcut;
      if (modifiers.length === 0) {
        tree.direct.add(key);
      } else if (modifiers.length === 1) {
        if (!tree.modifiers.has(modifiers[0])) {
          tree.modifiers.set(modifiers[0], { children: [], leaves: 0 });
        }
        tree.modifiers.get(modifiers[0]).children.push(key);
        tree.modifiers.get(modifiers[0]).leaves++;
      } else if (modifiers.length > 1) {
        const comboKey = modifiers.sort().join('-');
        if (!tree.combos.has(comboKey)) {
          tree.combos.set(comboKey, { children: [], leaves: 0 });
        }
        tree.combos.get(comboKey).children.push(key);
        tree.combos.get(comboKey).leaves++;
      }
    });

    // Calculate total leaves for angle distribution
    const totalLeaves =
      Array.from(tree.modifiers.values()).reduce((sum, mod) => sum + mod.leaves, 0) +
      Array.from(tree.combos.values()).reduce((sum, combo) => sum + combo.leaves, 0) +
      tree.direct.size;

    // Place nodes using radial algorithm
    let currentAngle = 0;
    const TWO_PI = 2 * Math.PI;
    const baseRadius = 200;
    const actionRadius = 350;

    // Helper function to place nodes in an arc
    const placeNodesInArc = (
      startAngle: number,
      angleSize: number,
      nodes: string[],
      radius: number,
      parentX = 400,
      parentY = 400,
    ) => {
      const angleStep = angleSize / (nodes.length || 1);
      return nodes.map((node, index) => {
        const angle = startAngle + angleStep * (index + 0.5);
        const x = Math.cos(angle) * radius + 400;
        const y = Math.sin(angle) * radius + 400;
        return { node, x, y, angle };
      });
    };

    // Place direct shortcuts
    const directAngleSize = (tree.direct.size / totalLeaves) * TWO_PI;
    placeNodesInArc(currentAngle, directAngleSize, Array.from(tree.direct) as string[], actionRadius).forEach(
      ({ node, x, y }) => {
        const nodeEl = this.#createTreeNode('action', node, [], 0, 1);
        nodeEl.node.style.left = `${x}px`;
        nodeEl.node.style.top = `${y}px`;
        container.appendChild(nodeEl.node);
        container.appendChild(this.#createTreeLink(400, 400, x, y, []));
      },
    );
    currentAngle += directAngleSize;

    // Place modifier nodes and their children
    tree.modifiers.forEach((data, modifier) => {
      const modAngleSize = (data.leaves / totalLeaves) * TWO_PI;

      // Place modifier node
      const modX = Math.cos(currentAngle + modAngleSize / 2) * baseRadius + 400;
      const modY = Math.sin(currentAngle + modAngleSize / 2) * baseRadius + 400;
      const modNode = this.#createTreeNode('modifier', modifier, [modifier], 0, 1);
      modNode.node.style.left = `${modX}px`;
      modNode.node.style.top = `${modY}px`;
      container.appendChild(modNode.node);
      container.appendChild(this.#createTreeLink(400, 400, modX, modY, [modifier]));

      // Place children
      placeNodesInArc(currentAngle, modAngleSize, data.children, actionRadius, modX, modY).forEach(({ node, x, y }) => {
        const childNode = this.#createTreeNode('action', node, [modifier], 0, 2);
        childNode.node.style.left = `${x}px`;
        childNode.node.style.top = `${y}px`;
        container.appendChild(childNode.node);
        container.appendChild(this.#createTreeLink(modX, modY, x, y, [modifier]));
      });

      currentAngle += modAngleSize;
    });

    // Place combo nodes and their children
    tree.combos.forEach((data, combo) => {
      const comboAngleSize = (data.leaves / totalLeaves) * TWO_PI;
      const modifiers = combo.split('-');

      // Place combo node
      const comboX = Math.cos(currentAngle + comboAngleSize / 2) * baseRadius + 400;
      const comboY = Math.sin(currentAngle + comboAngleSize / 2) * baseRadius + 400;
      const comboNode = this.#createTreeNode('combo', combo, modifiers, 0, 1);
      comboNode.node.style.left = `${comboX}px`;
      comboNode.node.style.top = `${comboY}px`;
      container.appendChild(comboNode.node);
      container.appendChild(this.#createTreeLink(400, 400, comboX, comboY, modifiers));

      // Place children
      placeNodesInArc(currentAngle, comboAngleSize, data.children, actionRadius, comboX, comboY).forEach(
        ({ node, x, y }) => {
          const childNode = this.#createTreeNode('action', node, modifiers, 0, 2);
          childNode.node.style.left = `${x}px`;
          childNode.node.style.top = `${y}px`;
          container.appendChild(childNode.node);
          container.appendChild(this.#createTreeLink(comboX, comboY, x, y, modifiers));
        },
      );

      currentAngle += comboAngleSize;
    });
  }

  #createTreeNode(type: string, label: string, modifiers: string[], angle: number, level: number) {
    const node = document.createElement('kbd');
    node.textContent = label;

    // Set data-key-id consistently
    node.setAttribute('data-key-id', label);

    // For action nodes with no modifiers, use simple key-id format
    if (type === 'action' && modifiers.length === 0) {
      node.setAttribute('data-key-id', `${label}`);
    }

    if (modifiers.length > 1) {
      node.setAttribute('data-modifier-combo', modifiers.join(','));
    } else if (modifiers.length === 1) {
      node.setAttribute('data-modifier', modifiers[0]);
    } else if (type === 'context') {
      node.className = 'context';
    }

    // Store modifiers and type for activation logic
    if (modifiers.length > 0) {
      node.setAttribute('data-modifiers', JSON.stringify(modifiers));
    }
    node.setAttribute('data-node-type', type);

    node.classList.add('tree-node', `node-type-${type}`);

    if (modifiers.length > 1) {
      node.setAttribute('data-modifier-combo', modifiers.sort().join('-'));
    } else if (modifiers.length === 1) {
      node.setAttribute('data-modifier', modifiers[0]);
    }

    // For modifier nodes, set their own modifier attribute
    if (type === 'modifier') {
      node.setAttribute('data-modifier', label);
    }

    node.setAttribute('data-modifiers', JSON.stringify(modifiers.sort()));
    node.setAttribute('data-key-id', label);

    return { node };
  }

  #createTreeLink(x1: number, y1: number, x2: number, y2: number, modifiers: string[] = []) {
    const link = document.createElement('div');
    link.className = 'tree-link';
    if (modifiers.length > 0) {
      link.setAttribute('data-modifiers', JSON.stringify(modifiers));
    }

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    link.style.width = `${length}px`;
    link.style.left = `${x1}px`;
    link.style.top = `${y1}px`;
    link.style.transform = `rotate(${angle}deg)`;

    return link;
  }

  #updateTreeColors() {
    const activeModifiersList = Object.entries(this.#activeModifiers)
      .filter(([_, active]) => active)
      .map(([mod]) => mod)
      .sort();

    // Reset everything to default state
    this.#treeContainer.querySelectorAll('kbd').forEach((node) => {
      (node as HTMLElement).style.background = '#3a3a3a';
    });
    this.#treeContainer.querySelectorAll('.tree-link').forEach((link) => {
      (link as HTMLElement).style.background = '#3a3a3a';
    });

    // Simple rule: Only color things that EXACTLY match the current state
    this.#treeContainer.querySelectorAll('kbd').forEach((node) => {
      const nodeType = node.getAttribute('data-node-type');
      const nodeModifiers = JSON.parse(node.getAttribute('data-modifiers') || '[]');

      // Modifier nodes only light up when they're the only active modifier
      if (nodeType === 'modifier') {
        const modifier = node.getAttribute('data-modifier');
        if (activeModifiersList.length === 1 && activeModifiersList[0] === modifier) {
          (node as HTMLElement).style.background = this.#getModifierColor(modifier);
        }
        return;
      }

      // Everything else only lights up on exact modifier match
      if (JSON.stringify(nodeModifiers.sort()) === JSON.stringify(activeModifiersList)) {
        if (nodeModifiers.length === 1) {
          (node as HTMLElement).style.background = this.#getModifierColor(nodeModifiers[0]);
        } else if (nodeModifiers.length === 2) {
          const [mod1, mod2] = nodeModifiers;
          (node as HTMLElement).style.background = `repeating-linear-gradient(
                    45deg,
                    ${this.#getModifierColor(mod1)} 0px,
                    ${this.#getModifierColor(mod1)} 8px,
                    ${this.#getModifierColor(mod2)} 8px,
                    ${this.#getModifierColor(mod2)} 16px
                )`;
        }
      }
    });
  }
}

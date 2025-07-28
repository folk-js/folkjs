import { CustomAttribute, customAttributes } from '@folkjs/dom/CustomAttribute';
import { css } from '@folkjs/dom/tags';
import {
  CompletionRequest,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  MarkupKind,
  Position,
  type CompletionItem,
  type CompletionList,
} from 'vscode-languageserver-protocol';
import { LanguageClient } from './lsp/LanguageClient';

// Valid LSP languages
export const VALID_LSP_LANGUAGES = ['js', 'ts', 'json', 'css'] as const;
export type LSPLanguage = (typeof VALID_LSP_LANGUAGES)[number];

// Primitive for generating unique reference-based IDs
class RefID {
  static #refs = new WeakMap();
  static #counter = 0;

  static get(obj: object) {
    if (!this.#refs.has(obj)) {
      this.#refs.set(obj, this.#toLetters(this.#counter++));
    }
    return this.#refs.get(obj);
  }

  static #toLetters(num: number) {
    let result = '';
    while (num >= 0) {
      result = String.fromCharCode(97 + (num % 26)) + result;
      num = Math.floor(num / 26) - 1;
      if (num < 0) break;
    }
    return result;
  }
}

// TODOs
// incremental updates
//  - input event only tells us what text is added.
// Capabilities to look into
// - completionProvider
// - renameProvider
// - color provider
// - semanticTokensProvider
// - documentFormattingProvider
// - definitionProvider
// - codeActionProvider

// TODO: stop worker when there are no files for that language server
class LanguageServerPool {
  #urls = new Map<string, URL>();
  #workerCache = new Map<URL, Worker>();

  constructor() {
    this.setURL(new URL('./lsp/json.worker.js', import.meta.url), ['json']);
    this.setURL(new URL('./lsp/css.worker.js', import.meta.url), ['css']);
    this.setURL(new URL('./lsp/typescript.worker.js', import.meta.url), ['ts', 'js']);
    // this.setURL(new URL('./lsp/markdown.worker.js', import.meta.url), ['md']);
  }

  getWorker(language: string) {
    const url = this.#urls.get(language);

    if (url === undefined) throw new Error(`name '${language}' has no registered LSP.`);

    let worker = this.#workerCache.get(url);

    if (worker === undefined) {
      worker = new Worker(url, { type: 'module' });
      this.#workerCache.set(url, worker);
    }

    return worker;
  }

  setURL(workerURL: URL, languages: string[]) {
    for (const language of languages) {
      // Should we let someone override an existing language server.
      this.#urls.set(language, workerURL);
    }
  }
}

export class FolkLSPAttribute extends CustomAttribute<HTMLElement> {
  static override attributeName = 'folk-lsp';

  static override define() {
    if (!customAttributes.isDefined(this.attributeName)) {
      Object.defineProperty(Element.prototype, 'lsp', {
        get() {
          return customAttributes.get(this, FolkLSPAttribute.attributeName) as FolkLSPAttribute | undefined;
        },
      });
    }

    super.define();
  }

  static #highlightRegistry = {
    'folk-lsp-error': new Highlight(),
    'folk-lsp-warning': new Highlight(),
    'folk-lsp-info': new Highlight(),
    'folk-lsp-hint': new Highlight(),
  } as const;

  static #workers = new LanguageServerPool();

  static addLanguageServer(workerURL: URL, names: string[]) {
    this.#workers.setURL(workerURL, names);
  }

  static styles = css`
    @layer folk {
      ::highlight(folk-lsp-error) {
        text-decoration: underline;
        text-decoration-color: red;
        text-decoration-style: wavy;
        text-decoration-thickness: 1.5px;
        background-color: rgba(255, 0, 0, 0.1);
      }

      ::highlight(folk-lsp-warning) {
        text-decoration: underline;
        text-decoration-color: orange;
        text-decoration-style: wavy;
        text-decoration-thickness: 1.5px;
        background-color: rgba(255, 165, 0, 0.1);
      }

      ::highlight(folk-lsp-info) {
      }

      ::highlight(folk-lsp-hint) {
      }

      .folk-lsp-tooltip {
        position: fixed;
        background: #2d2d2d;
        color: #f0f0f0;
        padding: 8px;
        border-radius: 6px;
        font-size: 13px;
        max-width: 400px;
        z-index: 1000;
        pointer-events: none;
        font-family:
          'SF Pro Text',
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          sans-serif;
        display: none;
        flex-direction: column;
        gap: 8px;
        white-space: pre-line;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        border: 1px solid #404040;
        line-height: 1.4;
      }

      .folk-lsp-diagnostic-severity {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        vertical-align: top;
      }

      .folk-lsp-diagnostic-severity.error {
        background: #e74c3c;
        color: white;
      }

      .folk-lsp-diagnostic-severity.warning {
        background: #f39c12;
        color: white;
      }

      .folk-lsp-diagnostic-severity.info {
        background: #3498db;
        color: white;
      }

      .folk-lsp-diagnostic-severity.hint {
        background: #9b59b6;
        color: white;
      }

      /* Completion dropdown styles */
      .folk-lsp-completion {
        position: fixed;
        background: #2d2d2d;
        color: #f0f0f0;
        border-radius: 6px;
        font-size: 13px;
        max-width: 400px;
        max-height: 200px;
        z-index: 1001;
        font-family:
          'SF Pro Text',
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          sans-serif;
        display: none;
        flex-direction: column;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        border: 1px solid #404040;
        overflow: hidden;
      }

      .folk-lsp-completion-list {
        overflow-y: auto;
        max-height: 200px;
      }

      .folk-lsp-completion-item {
        padding: 8px 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        border-bottom: 1px solid #404040;
      }

      .folk-lsp-completion-item:last-child {
        border-bottom: none;
      }

      .folk-lsp-completion-item:hover,
      .folk-lsp-completion-item.selected {
        background: #3d3d3d;
      }

      .folk-lsp-completion-kind {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        min-width: 40px;
        text-align: center;
        flex-shrink: 0;
      }

      .folk-lsp-completion-kind.function {
        background: #9b59b6;
        color: white;
      }

      .folk-lsp-completion-kind.variable {
        background: #3498db;
        color: white;
      }

      .folk-lsp-completion-kind.class {
        background: #e74c3c;
        color: white;
      }

      .folk-lsp-completion-kind.interface {
        background: #f39c12;
        color: white;
      }

      .folk-lsp-completion-kind.property,
      .folk-lsp-completion-kind.field {
        background: #2ecc71;
        color: white;
      }

      .folk-lsp-completion-kind.method {
        background: #9b59b6;
        color: white;
      }

      .folk-lsp-completion-kind.keyword {
        background: #e67e22;
        color: white;
      }

      .folk-lsp-completion-kind.module {
        background: #34495e;
        color: white;
      }

      .folk-lsp-completion-item-label {
        font-weight: 500;
        flex-grow: 1;
      }

      .folk-lsp-completion-item-detail {
        font-size: 11px;
        color: #aaa;
        flex-shrink: 0;
      }
    }
  `;

  static {
    document.adoptedStyleSheets.push(this.styles);

    for (const [key, highlight] of Object.entries(this.#highlightRegistry)) {
      CSS.highlights.set(key, highlight);
    }
  }

  #fileVersion = 1;
  #languageClient: LanguageClient | undefined;

  get #fileUri() {
    const refId = RefID.get(this.ownerElement);
    const language = this.value || 'txt';
    const extension = (VALID_LSP_LANGUAGES as readonly string[]).includes(language) ? language : 'txt';
    return `${refId}.${extension}`;
  }
  #tooltip: HTMLElement | null = null;
  #completionDropdown: HTMLElement | null = null;
  #completionItems: CompletionItem[] = [];
  #selectedCompletionIndex = -1;
  #completionPosition: Position | null = null;
  #completionTriggerOffset = 0;
  #diagnosticRanges: Array<{ range: Range; diagnostic: Diagnostic }> = [];

  get #highlights() {
    return (this.constructor as typeof FolkLSPAttribute).#highlightRegistry;
  }

  override connectedCallback(): void {
    this.ownerElement.addEventListener('input', this.#onInput);
    this.ownerElement.addEventListener('keydown', this.#onKeyDown);
    this.ownerElement.addEventListener('mousemove', this.#onMouseMove);
    this.ownerElement.addEventListener('mouseleave', this.#hideTooltip);
    this.ownerElement.addEventListener('blur', this.#hideCompletion);
  }

  override async disconnectedCallback() {
    this.ownerElement.removeEventListener('input', this.#onInput);
    this.ownerElement.removeEventListener('keydown', this.#onKeyDown);
    this.ownerElement.removeEventListener('mousemove', this.#onMouseMove);
    this.ownerElement.removeEventListener('mouseleave', this.#hideTooltip);
    this.ownerElement.removeEventListener('blur', this.#hideCompletion);
    this.#hideTooltip();
    this.#hideCompletion();
    this.#languageClient?.stop();
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (this.#isCompletionVisible()) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.#selectNextCompletion();
          break;
        case 'ArrowUp':
          event.preventDefault();
          this.#selectPreviousCompletion();
          break;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          this.#insertSelectedCompletion();
          break;
        case 'Escape':
          event.preventDefault();
          this.#hideCompletion();
          break;
      }
    } else if (event.ctrlKey && event.key === ' ') {
      // Manual completion trigger
      event.preventDefault();
      this.#requestCompletion(true);
    }
  };

  #onInput = (event: Event) => {
    if (this.#languageClient === undefined) return;

    // TODO: this feels flaky... how to version properly?
    this.#fileVersion++;
    this.#languageClient.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: this.#fileUri,
        version: this.#fileVersion,
      },
      contentChanges: [
        {
          text: this.ownerElement.textContent ?? '',
        },
      ],
    });

    // Check if we should trigger completion based on input
    const shouldTriggerCompletion = this.#shouldTriggerCompletion(event as InputEvent);
    if (shouldTriggerCompletion) {
      this.#requestCompletion();
    } else if (this.#isCompletionVisible()) {
      // Update existing completion with new filter
      this.#filterExistingCompletions();
    }

    this.#requestDiagnostics();
  };

  #shouldTriggerCompletion(event: InputEvent): boolean {
    if (!event.data) return false;

    // Get language-specific trigger characters
    const language = this.value;
    const triggerChars = this.#getTriggerCharacters(language);

    return triggerChars.includes(event.data);
  }

  #getTriggerCharacters(language: string): string[] {
    switch (language) {
      case 'ts':
      case 'js':
        return ['.', ':', '>', '<'];
      case 'css':
        return ['-', ':', '@'];
      case 'json':
        return ['"', ':'];
      default:
        return [];
    }
  }

  #getSelectionPosition(): Position | null {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);

    const text = this.ownerElement.textContent || '';
    const offset = this.#getTextOffset(range);

    // Split text into lines and count up to offset to get line/char
    const lines = text.split('\n');
    let line = 0;
    let character = 0;
    let currentOffset = 0;

    for (const lineText of lines) {
      if (currentOffset + lineText.length >= offset) {
        character = offset - currentOffset;
        break;
      }
      currentOffset += lineText.length + 1; // +1 for newline
      line++;
    }

    return { line, character };
  }

  #getTextOffset(range: Range): number {
    const textNode = this.ownerElement.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return 0;

    // Calculate offset from start of text node
    const preRange = document.createRange();
    preRange.selectNodeContents(textNode);
    preRange.setEnd(range.startContainer, range.startOffset);

    return preRange.toString().length;
  }

  async #requestDiagnostics() {
    if (this.#languageClient === undefined) return;

    const diagnostics = (await this.#languageClient.sendRequest(DocumentDiagnosticRequest.type, {
      textDocument: {
        uri: this.#fileUri,
      },
    })) as unknown as Diagnostic[];

    this.#highlightDiagnostics(diagnostics);
  }

  #onMouseMove = (event: MouseEvent) => {
    const { clientX, clientY } = event;
    const result = this.#getDiagnosticsAtPosition(clientX, clientY);

    if (result.diagnostics.length > 0 && result.range) {
      this.#showTooltip(result.diagnostics, result.range);
    } else {
      this.#hideTooltip();
    }
  };

  #getDiagnosticsAtPosition(x: number, y: number): { diagnostics: Diagnostic[]; range: Range | null } {
    const hoveredDiagnostics: Diagnostic[] = [];
    let hoveredRange: Range | null = null;

    for (const { range, diagnostic } of this.#diagnosticRanges) {
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          hoveredDiagnostics.push(diagnostic);
          if (!hoveredRange) {
            hoveredRange = range; // Use the first range found
          }
          break; // Found this diagnostic, no need to check other rects
        }
      }
    }

    return { diagnostics: hoveredDiagnostics, range: hoveredRange };
  }

  #showTooltip(diagnostics: Diagnostic[], range: Range) {
    if (!this.#tooltip) {
      this.#tooltip = document.createElement('div');
      this.#tooltip.className = 'folk-lsp-tooltip';
      document.body.appendChild(this.#tooltip);
    }

    // Reset tooltip class
    this.#tooltip.className = 'folk-lsp-tooltip';

    // Create structured content with severity indicators
    const content = diagnostics
      .map((diagnostic) => {
        const severity = diagnostic.severity || 1;
        const severityName = this.#getSeverity(severity);

        return `<div class="folk-lsp-diagnostic-item"><span class="folk-lsp-diagnostic-severity ${severityName}">${severityName.toUpperCase()}</span>
        <span class="folk-lsp-diagnostic-message">${diagnostic.message}</span>
      </div>`;
      })
      .join('');

    this.#tooltip.innerHTML = content;

    // Position off-screen but visible for accurate measurement
    this.#tooltip.style.top = '-9999px';
    this.#tooltip.style.left = '-9999px';
    this.#tooltip.style.display = 'flex';

    const rect = range.getBoundingClientRect();
    const tooltipHeight = this.#tooltip.offsetHeight;
    const tooltipWidth = this.#tooltip.offsetWidth;
    const viewportWidth = window.innerWidth;

    let top = rect.top - tooltipHeight - 2;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;

    // Adjust if tooltip would go above viewport
    if (top < 2) {
      top = rect.bottom + 2; // Position below instead
    }

    // Adjust if tooltip would go off screen horizontally
    if (left < 2) {
      left = 2;
    } else if (left + tooltipWidth > viewportWidth - 2) {
      left = viewportWidth - tooltipWidth - 2;
    }

    // Apply final position
    this.#tooltip.style.top = `${top}px`;
    this.#tooltip.style.left = `${left}px`;
  }

  #getSeverity(severity: number): string {
    switch (severity) {
      case 1:
        return 'error';
      case 2:
        return 'warning';
      case 3:
        return 'info';
      case 4:
        return 'hint';
      default:
        return 'info';
    }
  }

  #hideTooltip() {
    if (this.#tooltip) {
      this.#tooltip.style.display = 'none';
    }
  }

  #highlightDiagnostics(diagnostics: Diagnostic[]) {
    for (const highlight of Object.values(this.#highlights)) {
      highlight.clear();
    }

    this.#hideTooltip();
    this.#diagnosticRanges = [];

    for (const diagnostic of diagnostics) {
      const { range } = diagnostic;
      const textNode = this.ownerElement.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

      // Split text into lines and count up to offset to get line/char
      const lines = textNode.nodeValue?.split('\n') || '';
      let lineCount = 0;
      let offset = 0;
      let startOffset = 0;
      let endOffset = 0;

      for (const lineText of lines) {
        if (range.start.line === lineCount) {
          startOffset = offset + range.start.character;
        }

        if (range.end.line === lineCount) {
          endOffset = offset + range.end.character;
        }

        lineCount += 1;
        offset += lineText.length + 1;
      }

      const domRange = new Range();

      try {
        domRange.setStart(textNode, startOffset);
        domRange.setEnd(textNode, endOffset);
        switch (diagnostic.severity) {
          case DiagnosticSeverity.Error:
            this.#highlights['folk-lsp-error'].add(domRange);
            break;
          case DiagnosticSeverity.Warning:
            this.#highlights['folk-lsp-warning'].add(domRange);
            break;
          case DiagnosticSeverity.Information:
            this.#highlights['folk-lsp-info'].add(domRange);
            break;
          case DiagnosticSeverity.Hint:
            this.#highlights['folk-lsp-hint'].add(domRange);
            break;
        }
        this.#diagnosticRanges.push({ range: domRange, diagnostic });
      } catch (e) {
        console.warn('Failed to set diagnostic highlight range:', e);
      }
    }
  }

  // Completion UI methods
  async #requestCompletion(manual = false) {
    if (this.#languageClient === undefined) return;

    const position = this.#getSelectionPosition();
    if (!position) return;

    try {
      const response = await this.#languageClient.sendRequest(CompletionRequest.type, {
        textDocument: {
          uri: this.#fileUri,
        },
        position,
      });

      let completionItems: CompletionItem[] = [];

      if (response) {
        if (Array.isArray(response)) {
          completionItems = response;
        } else if ('items' in response) {
          completionItems = (response as CompletionList).items;
        }
      }

      if (completionItems.length > 0 || manual) {
        this.#completionItems = completionItems;
        this.#completionPosition = position;
        this.#completionTriggerOffset = this.#getTextOffset(document.getSelection()!.getRangeAt(0));
        this.#showCompletion();
      } else {
        this.#hideCompletion();
      }
    } catch (error) {
      console.error('Completion request failed:', error);
      this.#hideCompletion();
    }
  }

  #showCompletion() {
    if (this.#completionItems.length === 0) return;

    if (!this.#completionDropdown) {
      this.#completionDropdown = document.createElement('div');
      this.#completionDropdown.className = 'folk-lsp-completion';
      document.body.appendChild(this.#completionDropdown);
    }

    this.#renderCompletionItems();
    this.#positionCompletion();
    this.#completionDropdown.style.display = 'flex';
    this.#selectedCompletionIndex = 0;
    this.#updateCompletionSelection();
  }

  #renderCompletionItems() {
    if (!this.#completionDropdown) return;

    const listElement = document.createElement('div');
    listElement.className = 'folk-lsp-completion-list';

    this.#completionItems.forEach((item, index) => {
      const itemElement = document.createElement('div');
      itemElement.className = 'folk-lsp-completion-item';
      itemElement.dataset.index = index.toString();

      const kindElement = document.createElement('span');
      const kindClass = this.#getCompletionKindClass(item.kind);
      kindElement.className = `folk-lsp-completion-kind ${kindClass}`;
      kindElement.textContent = kindClass;

      const labelElement = document.createElement('span');
      labelElement.className = 'folk-lsp-completion-item-label';
      labelElement.textContent = item.label;

      const detailElement = document.createElement('span');
      detailElement.className = 'folk-lsp-completion-item-detail';
      detailElement.textContent = item.detail || '';

      itemElement.appendChild(kindElement);
      itemElement.appendChild(labelElement);
      if (item.detail) {
        itemElement.appendChild(detailElement);
      }

      itemElement.addEventListener('click', () => {
        this.#selectedCompletionIndex = index;
        this.#insertSelectedCompletion();
      });

      listElement.appendChild(itemElement);
    });

    this.#completionDropdown.innerHTML = '';
    this.#completionDropdown.appendChild(listElement);
  }

  #positionCompletion() {
    if (!this.#completionDropdown || !this.#completionPosition) return;

    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const dropdownHeight = this.#completionDropdown.offsetHeight;
    const dropdownWidth = this.#completionDropdown.offsetWidth;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + 2;
    let left = rect.left;

    // Adjust if dropdown would go below viewport
    if (top + dropdownHeight > viewportHeight - 10) {
      top = rect.top - dropdownHeight - 2;
    }

    // Adjust if dropdown would go off screen horizontally
    if (left + dropdownWidth > viewportWidth - 10) {
      left = viewportWidth - dropdownWidth - 10;
    }

    this.#completionDropdown.style.top = `${Math.max(10, top)}px`;
    this.#completionDropdown.style.left = `${Math.max(10, left)}px`;
  }

  #hideCompletion = () => {
    if (this.#completionDropdown) {
      this.#completionDropdown.style.display = 'none';
    }
    this.#completionItems = [];
    this.#selectedCompletionIndex = -1;
    this.#completionPosition = null;
    this.#completionTriggerOffset = 0;
  };

  #isCompletionVisible(): boolean {
    return (
      this.#completionDropdown !== null &&
      this.#completionDropdown.style.display === 'flex' &&
      this.#completionItems.length > 0
    );
  }

  #selectNextCompletion() {
    if (this.#completionItems.length === 0) return;
    this.#selectedCompletionIndex = (this.#selectedCompletionIndex + 1) % this.#completionItems.length;
    this.#updateCompletionSelection();
  }

  #selectPreviousCompletion() {
    if (this.#completionItems.length === 0) return;
    this.#selectedCompletionIndex =
      this.#selectedCompletionIndex <= 0 ? this.#completionItems.length - 1 : this.#selectedCompletionIndex - 1;
    this.#updateCompletionSelection();
  }

  #updateCompletionSelection() {
    if (!this.#completionDropdown) return;

    const items = this.#completionDropdown.querySelectorAll('.folk-lsp-completion-item');
    items.forEach((item, index) => {
      item.classList.toggle('selected', index === this.#selectedCompletionIndex);
    });

    // Scroll selected item into view
    const selectedItem = items[this.#selectedCompletionIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }

  #insertSelectedCompletion() {
    if (this.#selectedCompletionIndex < 0 || this.#selectedCompletionIndex >= this.#completionItems.length) {
      this.#hideCompletion();
      return;
    }

    const item = this.#completionItems[this.#selectedCompletionIndex];
    const insertText = item.insertText || item.label;

    // Get current selection
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.#hideCompletion();
      return;
    }

    const range = selection.getRangeAt(0);
    const currentOffset = this.#getTextOffset(range);

    // Calculate the text to replace (from trigger point to current cursor)
    const textContent = this.ownerElement.textContent || '';
    const beforeTrigger = textContent.substring(0, this.#completionTriggerOffset);
    const afterCursor = textContent.substring(currentOffset);

    // Find the start of the word being completed
    const wordStart = this.#findWordStart(beforeTrigger);
    const wordToReplace = textContent.substring(wordStart, currentOffset);

    // Insert the completion
    const newText = textContent.substring(0, wordStart) + insertText + afterCursor;
    this.ownerElement.textContent = newText;

    // Set cursor position after inserted text
    const newCursorPos = wordStart + insertText.length;
    this.#setCursorPosition(newCursorPos);

    this.#hideCompletion();

    // Trigger input event to update language server
    this.ownerElement.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: insertText }));
  }

  #findWordStart(text: string): number {
    const wordBoundaryRegex = /[^a-zA-Z0-9_$]/;
    for (let i = text.length - 1; i >= 0; i--) {
      if (wordBoundaryRegex.test(text[i])) {
        return i + 1;
      }
    }
    return 0;
  }

  #setCursorPosition(offset: number) {
    const textNode = this.ownerElement.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

    const range = document.createRange();
    const selection = document.getSelection();

    try {
      range.setStart(textNode, Math.min(offset, textNode.textContent?.length || 0));
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch (e) {
      console.warn('Failed to set cursor position:', e);
    }
  }

  #filterExistingCompletions() {
    // For now, we'll just hide completions on text changes that aren't trigger characters
    // In a more sophisticated implementation, we could filter the existing completions
    // based on the current word being typed
    this.#hideCompletion();
  }

  #getCompletionKindClass(kind?: number): string {
    switch (kind) {
      case 3:
        return 'function'; // Function
      case 6:
        return 'variable'; // Variable
      case 7:
        return 'class'; // Class
      case 8:
        return 'interface'; // Interface
      case 5:
        return 'field'; // Field
      case 2:
        return 'method'; // Method
      case 10:
        return 'property'; // Property
      case 14:
        return 'keyword'; // Keyword
      case 9:
        return 'module'; // Module
      default:
        return 'text';
    }
  }

  #getWorker(language: string) {
    return (this.constructor as typeof FolkLSPAttribute).#workers.getWorker(language);
  }

  override async changedCallback(_oldLanguage: string, newLanguage: string) {
    await this.#languageClient?.stop();

    if (newLanguage === '') {
      if (this.ownerElement.localName === 'style') {
        newLanguage = 'css';
      } else if (this.ownerElement.localName === 'script') {
        if ((this.ownerElement as HTMLScriptElement).type === 'importmap') {
          newLanguage = 'json';
        } else {
          newLanguage = 'js';
        }
      } else {
        // we cant infer the new language so don't create a language client
        return;
      }
    }

    const worker = this.#getWorker(newLanguage);
    this.#languageClient = new LanguageClient(worker, {
      clientCapabilities: {
        textDocument: {
          documentHighlight: {
            dynamicRegistration: false,
          },
          publishDiagnostics: {
            relatedInformation: true,
          },
          completion: {
            // We send the completion context to the server
            contextSupport: true,
            completionItem: {
              snippetSupport: true,
              insertReplaceSupport: true,
              documentationFormat: [MarkupKind.PlainText, MarkupKind.Markdown],
              commitCharactersSupport: false,
            },
          },
        },
      },
      log: console.log,
    });

    await this.#languageClient.start();
    this.#languageClient.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: this.#fileUri,
        version: this.#fileVersion,
        languageId: this.value,
        text: this.ownerElement.textContent ?? '',
      },
    });

    // Request initial diagnostics now that server is fully initialized
    this.#requestDiagnostics();
  }
}

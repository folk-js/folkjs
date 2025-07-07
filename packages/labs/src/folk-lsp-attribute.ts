import { CustomAttribute, customAttributes } from '@folkjs/canvas';
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
} from 'vscode-languageserver-protocol';
import { LanguageClient } from './lsp/LanguageClient';

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

export class FolkLSPAttribute extends CustomAttribute {
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
        background: #333;
        color: white;
        padding: 8px;
        border-radius: 4px;
        font-size: 14px;
        max-width: 300px;
        z-index: 1000;
        pointer-events: none;
        font-family: sans-serif;
      }
    }
  `;

  static {
    document.adoptedStyleSheets.push(this.styles);

    for (const [key, highlight] of Object.entries(this.#highlightRegistry)) {
      CSS.highlights.set(key, highlight);
    }
  }

  #fileUri = 'folk://';
  #fileVersion = 1;
  #languageClient: LanguageClient | undefined;
  #activeTooltips = new Map<string, HTMLElement>();

  get #highlights() {
    return (this.constructor as typeof FolkLSPAttribute).#highlightRegistry;
  }

  override connectedCallback(): void {
    (this.ownerElement as HTMLElement).addEventListener('input', this.#onInput);
  }

  override async disconnectedCallback() {
    (this.ownerElement as HTMLElement).removeEventListener('input', this.#onInput);
    this.#languageClient?.stop();
  }

  #onInput = () => {
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
    this.#requestCompletion();
    this.#requestDiagnostics();
  };

  #getSelectionPosition(): Position | null {
    const selection = document.getSelection();
    if (!selection) {
      return null;
    }

    const range = selection.getRangeAt(0);

    // Get line and character offset from range
    const node = range.startContainer;
    const text = node.textContent || '';
    const offset = range.startOffset;

    // Split text into lines and count up to offset to get line/char
    const lines = text.split('\n');
    let line = 0;
    let character = 0;
    let currentOffset = 0;

    for (const lineText of lines) {
      if (currentOffset + lineText.length + 1 > offset) {
        character = offset - currentOffset;
        break;
      }
      currentOffset += lineText.length + 1;
      line++;
    }

    return { line, character };
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

  #getRangeKey(range: Range): string {
    const start = range.startOffset;
    const end = range.endOffset;
    return `${start}-${end}`;
  }

  #createTooltip(message: string, rect: DOMRect, range: Range) {
    const key = this.#getRangeKey(range);
    let tooltip = this.#activeTooltips.get(key);
    if (tooltip) {
      return; // Tooltip already exists for this range
    }

    tooltip = document.createElement('div');
    tooltip.className = 'folk-lsp-tooltip';
    tooltip.textContent = message;

    // Position tooltip above the highlight if there's room, otherwise below
    document.body.appendChild(tooltip);
    const tooltipHeight = tooltip.offsetHeight;
    const spaceAbove = rect.top;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;

    if (spaceAbove > tooltipHeight || spaceAbove > spaceBelow) {
      // Position above
      tooltip.style.top = `${rect.top - tooltipHeight - 5}px`;
    } else {
      // Position below
      tooltip.style.top = `${rect.bottom + 5}px`;
    }

    // Center horizontally over the highlight
    tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
    this.#activeTooltips.set(key, tooltip);
  }

  #removeTooltip(range: Range) {
    const key = this.#getRangeKey(range);
    const tooltip = this.#activeTooltips.get(key);
    if (tooltip) {
      tooltip.remove();
      this.#activeTooltips.delete(key);
    }
  }

  #removeAllTooltips() {
    for (const tooltip of this.#activeTooltips.values()) {
      tooltip.remove();
    }
    this.#activeTooltips.clear();
  }

  // TODO: fix the obvious memory leak here
  #setupTooltipListeners(range: Range, diagnostic: Diagnostic) {
    const rects = range.getClientRects();
    if (!rects.length) return;

    // Create a single rect that encompasses all the range's rects
    const boundingRect = range.getBoundingClientRect();
    const rangeKey = this.#getRangeKey(range);

    const checkMousePosition = (event: MouseEvent) => {
      const { clientX, clientY } = event;
      // Check if mouse is within any of the range's rectangles
      // TODO: use geo utils here
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return true;
        }
      }
      return false;
    };

    (this.ownerElement as HTMLElement).addEventListener('mousemove', (event) => {
      const isOverRange = checkMousePosition(event);

      if (isOverRange && !this.#activeTooltips.has(rangeKey)) {
        this.#createTooltip(diagnostic.message, boundingRect, range);
      } else if (!isOverRange && this.#activeTooltips.has(rangeKey)) {
        this.#removeTooltip(range);
      }
    });

    // Also remove tooltip when leaving the element entirely
    this.ownerElement.addEventListener('mouseleave', () => {
      this.#removeTooltip(range);
    });
  }

  #highlightDiagnostics(diagnostics: Diagnostic[]) {
    for (const highlight of Object.values(this.#highlights)) {
      highlight.clear();
    }

    this.#removeAllTooltips();

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
        console.log('[domRange]', domRange);
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
        this.#setupTooltipListeners(domRange, diagnostic);
      } catch (e) {
        console.warn('Failed to set diagnostic highlight range:', e);
      }
    }
  }

  // TODO: handle request
  async #requestCompletion() {
    if (this.#languageClient === undefined) return;

    const position = this.#getSelectionPosition();
    if (!position) return;

    const completions = await this.#languageClient.sendRequest(CompletionRequest.type, {
      textDocument: {
        uri: this.#fileUri,
      },
      position,
    });
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

    this.#languageClient.start();
    console.log('start', this.ownerElement);
    this.#languageClient.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: this.#fileUri,
        version: this.#fileVersion,
        languageId: this.value,
        text: this.ownerElement.textContent ?? '',
      },
    });
  }
}

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
  #diagnosticRanges: Array<{ range: Range; diagnostic: Diagnostic }> = [];

  get #highlights() {
    return (this.constructor as typeof FolkLSPAttribute).#highlightRegistry;
  }

  override connectedCallback(): void {
    this.ownerElement.addEventListener('input', this.#onInput);
    this.ownerElement.addEventListener('mousemove', this.#onMouseMove);
    this.ownerElement.addEventListener('mouseleave', this.#hideTooltip);
  }

  override async disconnectedCallback() {
    this.ownerElement.removeEventListener('input', this.#onInput);
    this.ownerElement.removeEventListener('mousemove', this.#onMouseMove);
    this.ownerElement.removeEventListener('mouseleave', this.#hideTooltip);
    this.#hideTooltip();
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

    console.log('[diagnostics]', diagnostics);

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
        this.#diagnosticRanges.push({ range: domRange, diagnostic });
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

    await this.#languageClient.start();
    console.log('start', this.ownerElement);
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

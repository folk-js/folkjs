import { css, CustomAttribute, customAttributes } from '@folkjs/canvas';
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

Object.defineProperty(Element.prototype, 'lsp', {
  get() {
    return customAttributes.get(this, FolkLSPAttribute.attributeName) as FolkLSPAttribute | undefined;
  },
});

type LSPLanguage = 'json' | 'js' | 'css' | 'html' | 'md' | 'plaintext';

export class FolkLSPAttribute extends CustomAttribute {
  static override attributeName = 'folk-lsp';

  static #highlightRegistry = {
    'folk-lsp-error': new Highlight(),
    'folk-lsp-warning': new Highlight(),
    'folk-lsp-info': new Highlight(),
    'folk-lsp-hint': new Highlight(),
  } as const;

  static styles = css`
    @layer folk {
      ::highlight(folk-lsp-error) {
        text-decoration: wavy underline red 1.5px;
        background-color: rgba(255, 0, 0, 0.1);
      }

      ::highlight(folk-lsp-warning) {
        text-decoration: wavy underline orange 1.5px;
        background-color: rgba(255, 165, 0, 0.1);
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

  #fileUri = 'folk://foobar';
  #fileVersion = 1;
  #language: LSPLanguage = 'plaintext';
  #worker: Worker;
  #languageClient: LanguageClient;
  #activeTooltips = new Map<string, HTMLElement>();

  get #highlights() {
    return (this.constructor as typeof FolkLSPAttribute).#highlightRegistry;
  }

  constructor(ownerElement: Element, name: string, value: LSPLanguage) {
    super(ownerElement, name, value);
    this.#language = value;
    this.#worker = new Worker(new URL('./lsp/json.worker.js', import.meta.url), { type: 'module' });
    this.#languageClient = new LanguageClient(this.#worker, {
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
  }

  override connectedCallback(): void {
    const el = this.ownerElement as HTMLElement;
    this.#languageClient.start();
    this.#languageClient.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: this.#fileUri,
        version: this.#fileVersion,
        languageId: this.#language,
        text: el.textContent ?? '',
      },
    });
    (this.ownerElement as HTMLElement).addEventListener('input', (e) => {
      // TODO: this feels flaky... how to version properly?
      this.#fileVersion++;
      this.#languageClient.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: {
          uri: this.#fileUri,
          version: this.#fileVersion,
        },
        contentChanges: [
          {
            text: el.textContent ?? '',
          },
        ],
      });
      this.#requestCompletion();
      this.#requestDiagnostics();
    });
  }

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
    const position = this.#getSelectionPosition();
    if (!position) {
      return;
    }

    const completions = await this.#languageClient.sendRequest(CompletionRequest.type, {
      textDocument: {
        uri: this.#fileUri,
      },
      position,
    });
  }

  // TODO: Handle languages changes and auto detection and plaintext, and loading other workers
  override changedCallback(_oldLanguage: string, _newLanguage: string): void {}

  override async disconnectedCallback() {
    try {
      await this.#languageClient.stop();
    } finally {
      this.#worker.terminate();
    }
  }
}

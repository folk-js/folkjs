import { css, CustomAttribute, customAttributes } from '@folkjs/canvas';
import {
  CompletionRequest,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  MarkupKind,
  Position,
  type DocumentDiagnosticReport,
} from 'vscode-languageserver-protocol';
import { LanguageClient } from './lsp/LanguageClient';

// TODOs
// add HTML, CSS, JS work
// hover tooltip thingy
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
        background-color: green;
        color: red;
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
    })) as unknown as any[];

    this.#highlightDiagnostics(diagnostics);
  }

  // TODO: handle multiple lines
  #highlightDiagnostics(diagnostics: any[]) {
    // Clear existing highlights
    for (const highlight of Object.values(this.#highlights)) {
      highlight.clear();
    }

    // Process each diagnostic
    for (const diagnostic of diagnostics) {
      const { range } = diagnostic;
      const textNode = this.ownerElement.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
      const domRange = new Range();
      // Set the range
      try {
        domRange.setStart(textNode, range.start.character);
        domRange.setEnd(textNode, range.end.character);
        this.#highlights['folk-lsp-error'].add(domRange);
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

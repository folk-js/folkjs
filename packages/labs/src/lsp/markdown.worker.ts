// Simple JSON LS in Web Worker that provides completion and hover.
// Includes a schema for `tsconfig.json`.
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  CancellationToken,
  CompletionRequest,
  createProtocolConnection,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  HoverRequest,
  InitializeRequest,
  TextDocumentSyncKind,
  type InitializeResult,
} from 'vscode-languageserver-protocol/browser';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  createLanguageService,
  LogLevel,
  type FileStat,
  type ISlug,
  type ITextDocument,
  type Token,
} from 'vscode-markdown-languageservice';
import type { URI } from 'vscode-uri';

const markdownService = createLanguageService({
  workspace: {
    workspaceFolders: [],
    onDidChangeMarkdownDocument() {
      throw new Error('Function not implemented.');
    },
    onDidCreateMarkdownDocument() {
      throw new Error('Function not implemented.');
    },
    onDidDeleteMarkdownDocument() {
      throw new Error('Function not implemented.');
    },
    getAllMarkdownDocuments(): Promise<Iterable<ITextDocument>> {
      throw new Error('Function not implemented.');
    },
    hasMarkdownDocument(resource: URI): boolean {
      throw new Error('Function not implemented.');
    },
    openMarkdownDocument(resource: URI): Promise<ITextDocument | undefined> {
      throw new Error('Function not implemented.');
    },
    stat(resource: URI): Promise<FileStat | undefined> {
      throw new Error('Function not implemented.');
    },
    readDirectory(resource: URI): Promise<Iterable<readonly [string, FileStat]>> {
      throw new Error('Function not implemented.');
    },
  },
  parser: {
    slugifier: {
      fromHeading(headingText: string): ISlug {
        throw new Error('Function not implemented.');
      },
      fromFragment(fragmentText: string): ISlug {
        throw new Error('Function not implemented.');
      },
      createBuilder(): { add(headingText: string): ISlug } {
        throw new Error('Function not implemented.');
      },
    },
    tokenize: function (document: ITextDocument): Promise<Token[]> {
      throw new Error('Function not implemented.');
    },
  },
  logger: {
    level: LogLevel.Off,
    log: function (level: LogLevel, message: string, data?: Record<string, unknown>): void {
      throw new Error('Function not implemented.');
    },
  },
});

const docs: Map<string, TextDocument> = new Map();

const worker: Worker = self as any;
const conn = createProtocolConnection(new BrowserMessageReader(worker), new BrowserMessageWriter(worker));
conn.onRequest(InitializeRequest.type, (_params): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: {
        // triggerCharacters: ['"', ':'],
      },
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
      hoverProvider: true,
    },
  };
});

// ------ NOTIFICATIONS ------

conn.onNotification(DidOpenTextDocumentNotification.type, ({ textDocument: { uri, languageId, version, text } }) => {
  docs.set(uri, TextDocument.create(uri, languageId, version, text));
});
conn.onNotification(DidChangeTextDocumentNotification.type, ({ textDocument, contentChanges }) => {
  const doc = docs.get(textDocument.uri);
  if (doc) {
    docs.set(textDocument.uri, TextDocument.update(doc, contentChanges, textDocument.version || 0));
  }
});

// ------ REQUESTS ------

conn.onRequest(CompletionRequest.method, async ({ textDocument, position }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc) return null;

  const completions = markdownService.getCompletionItems(doc, position, {}, CancellationToken.None);
  return completions;
});
conn.onRequest(HoverRequest.method, async ({ textDocument, position }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc) return null;

  return markdownService.getHover(doc, position, CancellationToken.None);
});
conn.onRequest(DocumentDiagnosticRequest.method, async ({ textDocument }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc) return null;
  return markdownService.computeDiagnostics(
    doc,
    {
      validateReferences: undefined,
      validateFragmentLinks: undefined,
      validateFileLinks: undefined,
      validateMarkdownFileLinkFragments: undefined,
      validateUnusedLinkDefinitions: undefined,
      validateDuplicateLinkDefinitions: undefined,
      ignoreLinks: [],
    },
    CancellationToken.None,
  );
});
conn.listen();

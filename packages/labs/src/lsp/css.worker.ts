// Simple JSON LS in Web Worker that provides completion and hover.
// Includes a schema for `tsconfig.json`.
import { getCSSLanguageService, TextDocument } from 'vscode-css-languageservice';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  CompletionRequest,
  createProtocolConnection,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  HoverRequest,
  InitializeRequest,
  type InitializeResult,
  TextDocumentSyncKind,
} from 'vscode-languageserver-protocol/browser';

const cssService = getCSSLanguageService({});
cssService.configure({});

// TODO: use a map
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

  const completions = cssService.doComplete(doc, position, cssService.parseStylesheet(doc));
  return completions;
});
conn.onRequest(HoverRequest.method, async ({ textDocument, position }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc) return null;

  return cssService.doHover(doc, position, cssService.parseStylesheet(doc));
});
conn.onRequest(DocumentDiagnosticRequest.method, async ({ textDocument }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc) return null;
  return cssService.doValidation(doc, cssService.parseStylesheet(doc));
});
conn.listen();

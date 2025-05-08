// Simple JSON LS in Web Worker that provides completion and hover.
// Includes a schema for `tsconfig.json`.
import { getLanguageService, TextDocument } from 'vscode-html-languageservice';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  CompletionRequest,
  createProtocolConnection,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  HoverRequest,
  InitializeRequest,
  type InitializeResult,
  TextDocumentSyncKind,
} from 'vscode-languageserver-protocol/browser';

const htmlService = getLanguageService({});

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

  const completions = htmlService.doComplete(doc, position, htmlService.parseHTMLDocument(doc));
  return completions;
});
conn.onRequest(HoverRequest.method, async ({ textDocument, position }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc) return null;

  return htmlService.doHover(doc, position, htmlService.parseHTMLDocument(doc));
});

conn.listen();

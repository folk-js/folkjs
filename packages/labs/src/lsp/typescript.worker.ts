// Simple TypeScript LS in Web Worker that provides completion, hover, and diagnostics.
import {
  createSystem,
  createVirtualTypeScriptEnvironment,
  knownLibFilesForCompilerOptions,
  type LZString,
  type VirtualTypeScriptEnvironment,
} from '@typescript/vfs';
import ts, { type CompilerOptions } from 'typescript';
import { TextDocument } from 'vscode-json-languageservice';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  CompletionItemKind,
  CompletionRequest,
  createProtocolConnection,
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  HoverRequest,
  InitializeRequest,
  type InitializeResult,
  MarkupKind,
  TextDocumentSyncKind,
} from 'vscode-languageserver-protocol/browser';

const TS_VERSION = '5.8.3';

// State management like the other workers
const docs: Map<string, TextDocument> = new Map();
let tsEnv: VirtualTypeScriptEnvironment | null = null;
let isInitialized = false;
let libFsMap: Map<string, string> | null = null;

const compilerOptions: CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  checkJs: true,
  strict: false,
  noImplicitAny: false,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  skipLibCheck: true,
  lib: ['ES2020', 'DOM'],
};

// Convert LSP URI to simple file path for TypeScript VFS
function uriToFilePath(uri: string): string {
  return uri.replace(/^[^:]+:\/\//, '');
}

// Initialize TypeScript environment with lib files
async function initializeTypeScript() {
  // Load lib files once and cache them
  libFsMap = await createDefaultMapFromCDN(compilerOptions, TS_VERSION, false, ts);

  // Create initial environment
  updateTypeScriptEnvironment();
  isInitialized = true;
}

// Update TypeScript environment synchronously
function updateTypeScriptEnvironment() {
  if (!libFsMap) return;

  // Create new fsMap with cached lib files + current user files
  const fsMap = new Map(libFsMap);

  for (const [uri, doc] of docs) {
    const filePath = uriToFilePath(uri);
    fsMap.set(filePath, doc.getText());
  }

  // Recreate environment
  const system = createSystem(fsMap);
  const userFiles = Array.from(docs.keys()).map(uriToFilePath);
  tsEnv = createVirtualTypeScriptEnvironment(system, userFiles, ts, compilerOptions);
}

function positionToOffset(text: string, position: { line: number; character: number }): number {
  const lines = text.split('\n');
  let offset = 0;

  for (let i = 0; i < position.line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  return offset + position.character;
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  const lines = text.split('\n');
  let currentOffset = 0;

  for (let line = 0; line < lines.length; line++) {
    const lineLength = lines[line].length;
    if (currentOffset + lineLength >= offset) {
      return { line, character: offset - currentOffset };
    }
    currentOffset += lineLength + 1; // +1 for newline
  }

  return { line: lines.length - 1, character: lines[lines.length - 1]?.length || 0 };
}

function mapCompletionItemKind(tsKind: string): CompletionItemKind {
  switch (tsKind) {
    case ts.ScriptElementKind.functionElement:
      return CompletionItemKind.Function;
    case ts.ScriptElementKind.variableElement:
      return CompletionItemKind.Variable;
    case ts.ScriptElementKind.memberVariableElement:
      return CompletionItemKind.Field;
    case ts.ScriptElementKind.keyword:
      return CompletionItemKind.Keyword;
    case ts.ScriptElementKind.classElement:
      return CompletionItemKind.Class;
    case ts.ScriptElementKind.interfaceElement:
      return CompletionItemKind.Interface;
    case ts.ScriptElementKind.moduleElement:
      return CompletionItemKind.Module;
    case ts.ScriptElementKind.memberFunctionElement:
      return CompletionItemKind.Method;
    case ts.ScriptElementKind.memberGetAccessorElement:
    case ts.ScriptElementKind.memberSetAccessorElement:
      return CompletionItemKind.Property;
    default:
      return CompletionItemKind.Text;
  }
}

function mapDiagnosticSeverity(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return DiagnosticSeverity.Error;
    case ts.DiagnosticCategory.Warning:
      return DiagnosticSeverity.Warning;
    case ts.DiagnosticCategory.Suggestion:
      return DiagnosticSeverity.Hint;
    case ts.DiagnosticCategory.Message:
      return DiagnosticSeverity.Information;
    default:
      return DiagnosticSeverity.Information;
  }
}

const worker: Worker = self as any;
const conn = createProtocolConnection(new BrowserMessageReader(worker), new BrowserMessageWriter(worker));

conn.onRequest(InitializeRequest.type, async (_params): Promise<InitializeResult> => {
  try {
    await initializeTypeScript();
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: {
          triggerCharacters: ['.', '::', '->', '<'],
        },
        diagnosticProvider: {
          interFileDependencies: false,
          workspaceDiagnostics: false,
        },
        hoverProvider: true,
      },
    };
  } catch (error) {
    console.error('Failed to initialize TypeScript:', error);
    throw error;
  }
});

// ------ NOTIFICATIONS ------

conn.onNotification(DidOpenTextDocumentNotification.type, ({ textDocument: { uri, languageId, version, text } }) => {
  docs.set(uri, TextDocument.create(uri, languageId, version, text));
  if (isInitialized) {
    updateTypeScriptEnvironment();
  }
});

conn.onNotification(DidChangeTextDocumentNotification.type, ({ textDocument, contentChanges }) => {
  const doc = docs.get(textDocument.uri);
  if (doc) {
    const updatedDoc = TextDocument.update(doc, contentChanges, textDocument.version || 0);
    docs.set(textDocument.uri, updatedDoc);
    if (isInitialized) {
      updateTypeScriptEnvironment();
    }
  }
});

// ------ REQUESTS ------

conn.onRequest(CompletionRequest.method, async ({ textDocument, position }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc || !tsEnv || !isInitialized) return null;

  try {
    const text = doc.getText();
    const offset = positionToOffset(text, position);
    const filePath = uriToFilePath(textDocument.uri);
    const completions = tsEnv.languageService.getCompletionsAtPosition(filePath, offset, {});

    if (!completions) return null;

    return {
      isIncomplete: false,
      items: completions.entries.map((entry: any) => ({
        label: entry.name,
        kind: mapCompletionItemKind(entry.kind),
        detail: entry.kindModifiers,
        documentation: entry.documentation
          ? {
              kind: MarkupKind.PlainText,
              value: entry.documentation,
            }
          : undefined,
        insertText: entry.insertText || entry.name,
      })),
    };
  } catch (error) {
    console.error('Completion error:', error);
    return null;
  }
});

conn.onRequest(HoverRequest.method, async ({ textDocument, position }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc || !tsEnv || !isInitialized) return null;

  try {
    const offset = positionToOffset(doc.getText(), position);
    const filePath = uriToFilePath(textDocument.uri);
    const quickInfo = tsEnv.languageService.getQuickInfoAtPosition(filePath, offset);

    if (!quickInfo) return null;

    return {
      contents: {
        kind: MarkupKind.PlainText,
        value: ts.displayPartsToString(quickInfo.displayParts),
      },
      range: {
        start: offsetToPosition(doc.getText(), quickInfo.textSpan.start),
        end: offsetToPosition(doc.getText(), quickInfo.textSpan.start + quickInfo.textSpan.length),
      },
    };
  } catch (error) {
    console.error('Hover error:', error);
    return null;
  }
});

conn.onRequest(DocumentDiagnosticRequest.method, async ({ textDocument }) => {
  const doc = docs.get(textDocument.uri);
  if (!doc || !tsEnv || !isInitialized) return [];

  try {
    const filePath = uriToFilePath(textDocument.uri);
    const syntacticDiagnostics = tsEnv.languageService.getSyntacticDiagnostics(filePath);
    const semanticDiagnostics = tsEnv.languageService.getSemanticDiagnostics(filePath);

    const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];

    return allDiagnostics.map((diag: any) => ({
      range: {
        start: offsetToPosition(doc.getText(), diag.start || 0),
        end: offsetToPosition(doc.getText(), (diag.start || 0) + (diag.length || 0)),
      },
      severity: mapDiagnosticSeverity(diag.category),
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      source: 'typescript',
    }));
  } catch (error) {
    console.error('Diagnostics error:', error);
    return [];
  }
});

conn.listen();

// Simple IndexedDB wrapper for Web Worker compatibility
class IndexedDBStorage {
  private dbName = 'typescript-lib-cache';
  private dbVersion = 1;
  private storeName = 'libs';

  async getItem(key: string): Promise<string | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result?.value || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('IndexedDB getItem failed:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.put({ key, value });

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.warn('IndexedDB setItem failed:', error);
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.delete(key);

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.warn('IndexedDB removeItem failed:', error);
    }
  }

  async getAllKeys(): Promise<string[]> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('IndexedDB getAllKeys failed:', error);
      return [];
    }
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
    });
  }
}

/**
 * Create a virtual FS Map with the lib files from a particular TypeScript
 * version based on the target, Always includes dom ATM.
 *
 * Note: We don't use the original knownLibFilesForCompilerOptions function as-is because
 * it includes legacy files (lib.core.d.ts, lib.es7.d.ts, etc.) that no longer exist
 * in modern TypeScript distributions, causing 404 errors. We filter these out manually.
 *
 * @param options The compiler target, which dictates the libs to set up
 * @param version the versions of TypeScript which are supported
 * @param cache should the values be stored in IndexedDB (Web Worker compatible)
 * @param ts a copy of the typescript import
 * @param lzstring an optional copy of the lz-string import
 * @param fetcher an optional replacement for the global fetch function (tests mainly)
 * @param storer an optional replacement for the storage interface (tests mainly)
 */
export const createDefaultMapFromCDN = (
  options: CompilerOptions,
  version: string,
  cache: boolean,
  ts: typeof import('typescript'),
  lzstring?: LZString,
  fetcher?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
  }>,
  storer?: any, // Changed from LocalStorageLike since we're using IndexedDB
) => {
  const fetchlike = fetcher || fetch!;
  const fsMap = new Map<string, string>();

  // Get all lib files from TypeScript's built-in function
  const allFiles = knownLibFilesForCompilerOptions(options, ts);

  // Filter out legacy/missing files that cause 404s in modern TypeScript distributions
  const missingFiles = new Set([
    'lib.core.d.ts', // Legacy core lib (replaced by lib.es5.d.ts)
    'lib.core.es6.d.ts', // Legacy ES6 core lib
    'lib.core.es7.d.ts', // Legacy ES7 core lib
    'lib.es7.d.ts', // Legacy ES7 alias (use lib.es2016.d.ts)
  ]);

  const files = allFiles.filter((file) => !missingFiles.has(file));

  console.log(
    `Filtered TypeScript lib files: ${allFiles.length} → ${files.length} (removed ${allFiles.length - files.length} legacy files)`,
  );

  const prefix = `https://playgroundcdn.typescriptlang.org/cdn/${version}/typescript/lib/`;

  function zip(str: string) {
    return lzstring ? lzstring.compressToUTF16(str) : str;
  }

  function unzip(str: string) {
    return lzstring ? lzstring.decompressFromUTF16(str) : str;
  }

  // Map the known libs to a fetch promise, then return the contents
  function uncached() {
    return Promise.all(
      files.map((lib) =>
        fetchlike(prefix + lib)
          .then((resp: any) => {
            if (!resp.ok) {
              console.warn(`Failed to fetch ${lib}: HTTP ${resp.status}`);
              return null;
            }
            return resp.text();
          })
          .catch((error: any) => {
            console.warn(`Error fetching ${lib}:`, error);
            return null;
          }),
      ),
    ).then((contents) => {
      let loaded = 0;
      contents.forEach((text: string, index: number) => {
        if (text) {
          fsMap.set('/' + files[index], text);
          loaded++;
        }
      });
      console.log(`Loaded ${loaded}/${files.length} TypeScript lib files from CDN`);
    });
  }

  // IndexedDB-aware version of the lib files (Web Worker compatible)
  async function cached() {
    const storelike = storer || new IndexedDBStorage();

    // Clean up old versions from cache
    try {
      const keys = await storelike.getAllKeys();
      const cleanupPromises = keys
        .filter((key: string) => key.startsWith('ts-lib-') && !key.startsWith('ts-lib-' + version))
        .map((key: string) => storelike.removeItem(key));

      await Promise.all(cleanupPromises);
      if (cleanupPromises.length > 0) {
        console.log(`Cleaned up ${cleanupPromises.length} old cached lib files`);
      }
    } catch (error) {
      console.warn('Failed to clean up old cache entries:', error);
    }

    const results = await Promise.all(
      files.map(async (lib) => {
        const cacheKey = `ts-lib-${version}-${lib}`;

        try {
          const cachedContent = await storelike.getItem(cacheKey);

          if (cachedContent) {
            return unzip(cachedContent);
          }

          // Not in cache, fetch from CDN
          const response = await fetchlike(prefix + lib);
          if (!response.ok) {
            console.warn(`Failed to fetch ${lib}: HTTP ${response.status}`);
            return null;
          }

          const text = await response.text();

          // Store in cache (fire and forget)
          storelike.setItem(cacheKey, zip(text)).catch((error: any) => console.warn(`Failed to cache ${lib}:`, error));

          return text;
        } catch (error) {
          console.warn(`Error processing ${lib}:`, error);
          return null;
        }
      }),
    );

    let loaded = 0;
    let fromCache = 0;

    results.forEach((text: string | null, index: number) => {
      if (text) {
        const name = '/' + files[index];
        fsMap.set(name, text);
        loaded++;

        // Check if this was likely from cache (very fast response)
        // This is just for logging - not 100% accurate but gives a good indication
      }
    });

    console.log(`Loaded ${loaded}/${files.length} TypeScript lib files (with IndexedDB caching)`);
  }

  const func = cache ? cached : uncached;
  return func().then(() => fsMap);
};

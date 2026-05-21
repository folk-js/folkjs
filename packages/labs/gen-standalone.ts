/**
 * Generates src/standalone/*.ts files from src/ source files.
 *
 * A standalone file is generated for every exported class that:
 *   - Descends from HTMLElement (with an explicit non-empty static tagName) or
 *     ReactiveElement (explicit or auto-named tagName), or
 *     CustomAttribute (with an explicit non-empty static attributeName).
 *   - Lives in a file that does not contain `// @standalone-ignore`.
 *
 * Auto-naming mirrors ReactiveElement.define():
 *   FolkFoo → folk-foo  (PascalCase → kebab-case, drop leading dash)
 *
 * Run from packages/labs/:
 *   node --experimental-strip-types gen-standalone.ts
 */

import ts from 'typescript';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const SRC_DIR = 'src';
const STANDALONE_DIR = 'src/standalone';

// Directories to skip when walking the source tree
const SRC_SKIP_DIRS = new Set(['standalone', '__tests__', '__benchmarks__', 'node_modules']);

// External base types — terminate the ancestry walk
const REACTIVE_ELEMENT_ROOTS = new Set(['ReactiveElement', 'LitElement']);
const HTML_ELEMENT_ROOTS = new Set(['HTMLElement', 'SVGElement', 'MathMLElement']);
const CUSTOM_ATTRIBUTE_ROOTS = new Set(['CustomAttribute']);

type Ancestry = 'reactiveElement' | 'htmlElement' | 'customAttribute' | 'other';

interface ClassInfo {
  name: string;
  relPath: string;
  extendsName: string | null;
  /** undefined = property not declared on this class; '' = declared empty */
  ownTagName: string | undefined;
  ownAttributeName: string | undefined;
  hasStaticDefine: boolean;
  isExported: boolean;
}

// ── file walking ────────────────────────────────────────────────────────────

async function walk(dir: string, skip = new Set<string>()): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(full, skip)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.glsl.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ── AST helpers ─────────────────────────────────────────────────────────────

function getOwnStaticString(cls: ts.ClassDeclaration, propName: string): string | undefined {
  for (const member of cls.members) {
    if (
      ts.isPropertyDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      member.name.text === propName &&
      member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
    ) {
      return member.initializer && ts.isStringLiteral(member.initializer)
        ? member.initializer.text
        : '';
    }
  }
  return undefined;
}

function hasOwnStaticDefine(cls: ts.ClassDeclaration): boolean {
  return cls.members.some(
    (m) =>
      ts.isMethodDeclaration(m) &&
      ts.isIdentifier(m.name) &&
      m.name.text === 'define' &&
      (m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword) ?? false),
  );
}

function parseFile(
  content: string,
  relPath: string,
): { classes: ClassInfo[]; ignore: boolean } {
  const ignore = content.includes('// @standalone-ignore');
  const sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.ESNext, true);
  const classes: ClassInfo[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const isExported =
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const heritage = node.heritageClauses?.find(
        (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
      );
      const extendsExpr = heritage?.types[0]?.expression;
      const extendsName =
        extendsExpr && ts.isIdentifier(extendsExpr) ? extendsExpr.text : null;

      classes.push({
        name: node.name.text,
        relPath,
        extendsName,
        ownTagName: getOwnStaticString(node, 'tagName'),
        ownAttributeName: getOwnStaticString(node, 'attributeName'),
        hasStaticDefine: hasOwnStaticDefine(node),
        isExported,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return { classes, ignore };
}

// ── ancestry resolution ─────────────────────────────────────────────────────

function resolveAncestry(
  name: string,
  classMap: Map<string, ClassInfo>,
  seen = new Set<string>(),
): Ancestry {
  if (seen.has(name)) return 'other';
  seen.add(name);
  if (REACTIVE_ELEMENT_ROOTS.has(name)) return 'reactiveElement';
  if (HTML_ELEMENT_ROOTS.has(name)) return 'htmlElement';
  if (CUSTOM_ATTRIBUTE_ROOTS.has(name)) return 'customAttribute';
  const info = classMap.get(name);
  if (!info?.extendsName) return 'other';
  return resolveAncestry(info.extendsName, classMap, seen);
}

/** Walk the in-package ancestry chain to check if static define() is available. */
function resolveHasDefine(
  name: string,
  classMap: Map<string, ClassInfo>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const info = classMap.get(name);
  if (!info) return false;
  if (info.hasStaticDefine) return true;
  if (!info.extendsName) return false;
  return resolveHasDefine(info.extendsName, classMap, seen);
}

// ── tag name derivation (mirrors ReactiveElement.define()) ──────────────────

function deriveTagName(className: string): string {
  return className
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .slice(1);
}

// ── import path calculation ─────────────────────────────────────────────────
// The standalone file lives at src/standalone/{relPath}.
// To import the source at src/{relPath}, go up (depth of relPath segments) dirs.

function importPathFor(relPath: string): string {
  const depth = relPath.split('/').length;
  return '../'.repeat(depth) + relPath.replace(/\.ts$/, '');
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const srcDir = join(import.meta.dirname, SRC_DIR);
  const standaloneDir = join(import.meta.dirname, STANDALONE_DIR);

  const files = await walk(srcDir, SRC_SKIP_DIRS);

  // Pass 1: parse every source file, build global class map
  const classMap = new Map<string, ClassInfo>();
  const fileData = new Map<string, { classes: ClassInfo[]; ignore: boolean }>();

  for (const file of files) {
    const relPath = relative(srcDir, file);
    const content = await readFile(file, 'utf8');
    const data = parseFile(content, relPath);
    fileData.set(relPath, data);
    for (const cls of data.classes) classMap.set(cls.name, cls);
  }

  // Pass 2: determine which classes belong in each standalone
  const toGenerate = new Map<string, string[]>(); // relPath → ordered class names

  for (const [relPath, { classes, ignore }] of fileData) {
    if (ignore) continue;
    const entries: string[] = [];

    for (const cls of classes) {
      if (!cls.isExported) continue;
      const ancestry = resolveAncestry(cls.name, classMap);

      if (ancestry === 'customAttribute') {
        // Must have an explicit non-empty attributeName
        if (cls.ownAttributeName) entries.push(cls.name);
      } else if (ancestry === 'reactiveElement') {
        // Explicit non-empty tagName, or auto-named from class name (including tagName = '')
        const tag =
          cls.ownTagName !== undefined && cls.ownTagName !== ''
            ? cls.ownTagName
            : deriveTagName(cls.name);
        if (tag.includes('-')) entries.push(cls.name);
      } else if (ancestry === 'htmlElement') {
        // No auto-naming for direct HTMLElement subclasses — must be explicit, non-empty,
        // and have static define() available (own or inherited within the package).
        if (cls.ownTagName) {
          if (resolveHasDefine(cls.name, classMap)) {
            entries.push(cls.name);
          } else {
            console.warn(
              `  skipped  ${cls.name} in ${relPath}: HTMLElement subclass with tagName but no static define()`,
            );
          }
        }
      }
    }

    if (entries.length > 0) toGenerate.set(relPath, entries);
  }

  // Pass 3: write standalone files, clean up orphans
  const generated = new Set<string>();

  for (const [relPath, names] of toGenerate) {
    const importPath = importPathFor(relPath);
    const content = [
      `import { ${names.join(', ')} } from '${importPath}';`,
      '',
      ...names.map((n) => `${n}.define();`),
      '',
      `export { ${names.join(', ')} };`,
      '',
    ].join('\n');

    const outPath = join(standaloneDir, relPath);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, content);
    generated.add(relPath);
    console.log(`  generated standalone/${relPath}`);
  }

  // Remove standalone files that no longer have a source
  const existingStandalones = await walk(standaloneDir);
  let removed = 0;
  for (const file of existingStandalones) {
    const relPath = relative(standaloneDir, file);
    if (!generated.has(relPath)) {
      await rm(file);
      console.log(`  removed  standalone/${relPath}`);
      removed++;
    }
  }

  console.log(`\n${generated.size} generated, ${removed} removed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

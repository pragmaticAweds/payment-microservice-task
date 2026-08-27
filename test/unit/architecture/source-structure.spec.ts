import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const SOURCE_ROOT = resolve(process.cwd(), 'src');
const DEFINITION_DIRECTORY_NAMES = new Set([
  'constants',
  'interfaces',
  'types',
]);
const MAX_DEFINITION_FILE_LINES = 250;

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path);
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function relativeSourcePath(path: string): string {
  return relative(SOURCE_ROOT, path).split(sep).join('/');
}

function isStaticConstant(initializer: ts.Expression | undefined): boolean {
  return (
    initializer !== undefined &&
    !ts.isArrowFunction(initializer) &&
    !ts.isFunctionExpression(initializer)
  );
}

describe('production source structure', () => {
  it('keeps definitions in concern-owned companion files', () => {
    const violations: string[] = [];

    for (const filePath of collectTypeScriptFiles(SOURCE_ROOT)) {
      const source = readFileSync(filePath, 'utf8');
      const relativePath = relativeSourcePath(filePath);
      const pathSegments = relativePath.split('/');
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
      );

      if (
        pathSegments.length === 1 &&
        /^app(?:[.-])/u.test(pathSegments[0] ?? '')
      ) {
        violations.push(
          `${relativePath}: app concern file outside the app parent folder`,
        );
      }

      for (const directoryName of pathSegments.slice(0, -1)) {
        if (DEFINITION_DIRECTORY_NAMES.has(directoryName)) {
          violations.push(
            `${relativePath}: generic definition directory "${directoryName}"`,
          );
        }
      }

      if (
        (relativePath.endsWith('.types.ts') ||
          relativePath.endsWith('.constants.ts')) &&
        source.split(/\r?\n/u).length > MAX_DEFINITION_FILE_LINES
      ) {
        violations.push(
          `${relativePath}: definition file exceeds ${MAX_DEFINITION_FILE_LINES} lines`,
        );
      }

      for (const statement of sourceFile.statements) {
        if (ts.isEnumDeclaration(statement)) {
          violations.push(`${relativePath}: enum ${statement.name.text}`);
        }

        if (
          (ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement)) &&
          !relativePath.endsWith('.types.ts')
        ) {
          violations.push(
            `${relativePath}: type declaration outside *.types.ts`,
          );
        }

        if (!ts.isVariableStatement(statement)) {
          continue;
        }

        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            /^[A-Z][A-Z0-9_]+$/u.test(declaration.name.text) &&
            isStaticConstant(declaration.initializer) &&
            !relativePath.endsWith('.constants.ts')
          ) {
            violations.push(
              `${relativePath}: static constant ${declaration.name.text} outside *.constants.ts`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

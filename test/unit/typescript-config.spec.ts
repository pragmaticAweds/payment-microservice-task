import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface TypeScriptConfig {
  compilerOptions?: {
    types?: string[];
  };
}

describe('TypeScript test configuration', () => {
  it('declares Node and Jest globals for editors and the compiler', () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), 'tsconfig.json'), 'utf8'),
    ) as TypeScriptConfig;

    expect(config.compilerOptions?.types).toEqual(['node', 'jest']);
  });
});

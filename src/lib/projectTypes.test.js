import { describe, it, expect } from 'vitest';
import { editorOptionsFromTsconfig } from './projectTypes';

describe('editorOptionsFromTsconfig', () => {
  it('reads the options the editor needs from tsconfig (JSONC)', () => {
    const text = `{
      // Next.js style config
      "compilerOptions": {
        "strict": true,
        "jsx": "preserve", /* Next keeps JSX */
        "paths": { "@/*": ["./*"] },
        "lib": ["dom"],
      },
      "include": ["**/*.ts", "url://not-a-comment"],
    }`;
    expect(editorOptionsFromTsconfig(text)).toEqual({
      strict: true,
      jsx: 1,
      paths: { '@/*': ['./*'] },
      baseUrl: 'file:///',
    });
  });

  it('maps react-jsx and drops unknown jsx values', () => {
    expect(editorOptionsFromTsconfig('{"compilerOptions":{"jsx":"react-jsx"}}')).toEqual({ jsx: 4 });
    expect(editorOptionsFromTsconfig('{"compilerOptions":{"jsx":"weird"}}')).toEqual({});
  });

  it('ignores missing or invalid configs', () => {
    expect(editorOptionsFromTsconfig(undefined)).toEqual({});
    expect(editorOptionsFromTsconfig('{ nope')).toEqual({});
    expect(editorOptionsFromTsconfig('{}')).toEqual({});
  });
});

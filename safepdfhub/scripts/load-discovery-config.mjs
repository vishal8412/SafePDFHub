import { readFile } from 'node:fs/promises';
import ts from 'typescript';

/** Load trusted, self-contained TS configuration on the supported Node build hosts. */
export async function loadDiscoveryConfig(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

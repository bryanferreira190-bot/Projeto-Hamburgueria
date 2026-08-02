import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * O package.json deste pacote declara "type": "module", entao o Node trataria
 * TODO .js como ESM — inclusive a saida CommonJS. Este arquivo marca a pasta
 * dist/cjs como CommonJS, isolando-a dessa regra.
 */
writeFileSync(
  resolve(import.meta.dirname, '../dist/cjs/package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);

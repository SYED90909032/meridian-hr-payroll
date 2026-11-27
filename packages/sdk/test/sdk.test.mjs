import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const generated = new URL('../src/generated.ts', import.meta.url);
test('generated SDK is reproducible', () => {
  const before = fs.readFileSync(generated, 'utf8');
  execFileSync(process.execPath, ['generate.mjs'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
  assert.equal(fs.readFileSync(generated, 'utf8'), before);
});

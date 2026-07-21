import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const adaptersDir = path.resolve(testDir, '../../contentScripts/nav/platforms');

test('all platform adapters expose only the shared data contract', async () => {
  const files = (await readdir(adaptersDir))
    .filter((file) => file.endsWith('.js'))
    .sort();

  assert.equal(files.length, 17);

  for (const file of files) {
    const moduleUrl = pathToFileURL(path.join(adaptersDir, file)).href;
    const { default: adapter } = await import(moduleUrl);
    const keys = Object.keys(adapter).sort();
    const allowedKeys = ['extractText', 'itemSel', 'listSel', 'textSel'];

    assert.deepEqual(
      keys.filter((key) => !allowedKeys.includes(key)),
      [],
      `${file} has unsupported adapter fields`
    );
    assert.equal(typeof adapter.itemSel, 'string', `${file} itemSel`);
    assert.ok(adapter.itemSel.length > 0, `${file} itemSel is empty`);
    assert.equal(typeof adapter.listSel, 'string', `${file} listSel`);
    assert.ok(adapter.listSel.length > 0, `${file} listSel is empty`);
    assert.ok(
      adapter.textSel === null || typeof adapter.textSel === 'string',
      `${file} textSel must be a string or null`
    );
    if ('extractText' in adapter) {
      assert.equal(typeof adapter.extractText, 'function', `${file} extractText`);
    }
    assert.equal('navId' in adapter, false, `${file} must not define navId`);
    assert.equal('activeColor' in adapter, false, `${file} must not define activeColor`);
  }
});

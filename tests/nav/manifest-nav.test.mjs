/**
 * Manifest-resident nav injection contract.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const manifestUrl = new URL('../../manifest.json', import.meta.url);

const expectedMatches = [
  '*://yuanbao.tencent.com/*',
  '*://chat.deepseek.com/*',
  '*://chatgpt.com/*',
  '*://claude.ai/*',
  '*://www.doubao.com/*',
  '*://chatglm.cn/*',
  '*://aistudio.google.com/*',
  '*://qianwen.com/*',
  '*://grok.com/*',
  '*://www.notion.so/*',
  '*://chat.z.ai/*',
  '*://www.kimi.com/*',
  '*://coder.qwen.ai/*',
  '*://www.coze.cn/*',
  '*://aistudio.xiaomimimo.com/*',
];

test('manifest injects one document-idle nav entry for every supported host', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const navEntries = manifest.content_scripts.filter((entry) =>
    (entry.js || []).includes('contentScripts/nav/entry.js')
  );

  assert.equal(navEntries.length, 1);
  assert.equal(navEntries[0].run_at, 'document_idle');
  assert.equal(navEntries[0].all_frames, false);
  assert.deepEqual(navEntries[0].matches, expectedMatches);
  assert.deepEqual(
    navEntries[0].js,
    ['contentScripts/nav/entry.js']
  );
});

test('background script selection does not inject nav modules', async () => {
  const module = await import('../../backgroudtask/platformScriptFiles.js');
  const { getPlatformScriptFiles } = module;

  assert.deepEqual(Object.keys(module), ['getPlatformScriptFiles']);
  assert.deepEqual(getPlatformScriptFiles('yuanbao'), [
    'contentScripts/yuanbao.js',
  ]);
  assert.deepEqual(getPlatformScriptFiles('unknown-platform'), [
    'contentScripts/unknown-platform.js',
  ]);
});

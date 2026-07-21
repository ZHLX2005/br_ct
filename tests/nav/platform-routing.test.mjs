import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPlatformIdByUrl } from '../../config/platformConfig.js';

test('routes Xiaomi by origin and path while ignoring SPA hash routes', () => {
  assert.equal(
    getPlatformIdByUrl('https://aistudio.xiaomimimo.com/#/c'),
    'xiaomi'
  );
  assert.equal(
    getPlatformIdByUrl('https://aistudio.xiaomimimo.com/#/d'),
    'xiaomi'
  );
  assert.equal(
    getPlatformIdByUrl('https://aistudio.xiaomimimo.com/other#/chat/123'),
    'xiaomi'
  );
});

test('requires a path-segment boundary instead of matching path prefixes', () => {
  assert.equal(getPlatformIdByUrl('https://www.notion.so/chat'), 'notionai');
  assert.equal(getPlatformIdByUrl('https://www.notion.so/chat/abc'), 'notionai');
  assert.equal(getPlatformIdByUrl('https://www.notion.so/chat-foo'), null);
  assert.equal(getPlatformIdByUrl('https://example.com/?next=https://www.notion.so/chat'), null);
});

test('returns null for invalid or cross-origin URLs', () => {
  assert.equal(getPlatformIdByUrl('not a valid url'), null);
  assert.equal(getPlatformIdByUrl(''), null);
  assert.equal(getPlatformIdByUrl('https://evil.example/chatgpt.com'), null);
});

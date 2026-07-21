import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMarkdown } from '../../contentScripts/nav/export.js';

test('buildMarkdown produces correct frontmatter and body', () => {
  const records = [
    { fullText: '帮我写一个 React hook' },
    { fullText: '以下是用 useRef 加 touch 事件实现' },
  ];
  const meta = {
    platformId: 'chatgpt',
    platformName: 'ChatGPT',
    sourceUrl: 'https://chatgpt.com/c/67abc123',
    messageCount: 2,
    skippedCount: 0,
  };

  const md = buildMarkdown(records, meta);

  // Frontmatter fields
  assert.match(md, /^---\n/);                         // starts with ---
  assert.match(md, /platform: chatgpt/);
  assert.match(md, /platformName: ChatGPT/);
  assert.match(md, /sourceUrl: https:\/\/chatgpt\.com\/c\/67abc123/);
  assert.match(md, /messageCount: 2/);
  assert.match(md, /skippedCount: 0/);
  assert.match(md, /exportedAt:/);

  // Body
  assert.match(md, /# 会话消息/);
  assert.match(md, /1\. 帮我写一个 React hook/);
  assert.match(md, /2\. 以下是用 useRef 加 touch 事件实现/);
});

test('buildMarkdown handles empty records', () => {
  const md = buildMarkdown([], { platformId: 'test', platformName: 'Test', sourceUrl: '', messageCount: 0, skippedCount: 0 });
  assert.match(md, /messageCount: 0/);
  assert.match(md, /# 会话消息/);
  assert.equal(md.split('\n').filter(l => /^\d+\./.test(l)).length, 0);
});

test('buildMarkdown uses platformId as fallback when platformName is missing', () => {
  const md = buildMarkdown([{ fullText: 'hi' }], { platformId: 'deepseek', sourceUrl: 'https://chat.deepseek.com/', messageCount: 1, skippedCount: 0 });
  assert.match(md, /platform: deepseek/);
});

test('buildMarkdown preserves code blocks and markdown syntax', () => {
  const records = [{ fullText: '```js\nconsole.log("hello")\n```\n\n$E=mc^2$' }];
  const md = buildMarkdown(records, { platformId: 't', sourceUrl: '', messageCount: 1, skippedCount: 0 });
  assert.match(md, /```js/);
  assert.match(md, /\$E=mc\^2\$/);
});

test('buildMarkdown handles image-only message as text placeholder', () => {
  const records = [{ fullText: undefined }];
  const meta = { platformId: 't', sourceUrl: '', messageCount: 0, skippedCount: 1 };
  const md = buildMarkdown(records, meta);
  assert.match(md, /skippedCount: 1/);
});

import { strict as assert } from 'node:assert';
import { parseTemplate, composeTemplate, applyPromptTemplate } from './promptsCore.js';

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
};

test('parseTemplate 拆分 body/good_eg/bad_eg/image_info', () => {
  const tpl = `你好\ngood_eg:\n[以下是推荐的示例 — good_eg = good example]\n好例\nbad_eg:\n[以下是不推荐的、应避免的反例 — bad_eg = bad example]\n坏例`;
  const r = parseTemplate(tpl);
  assert.strictEqual(r.body, '你好');
  assert.strictEqual(r.good_eg, '好例');
  assert.strictEqual(r.bad_eg, '坏例');
});

test('applyPromptTemplate 替换 %s', () => {
  const r = applyPromptTemplate('Hi %s', { userMessage: 'world' });
  assert.strictEqual(r, 'Hi world');
});

test('applyPromptTemplate 替换 %v', () => {
  const r = applyPromptTemplate('ctx=%v msg=%s', { userMessage: 'u', extractedText: 'page' });
  assert.strictEqual(r, 'ctx=page msg=u');
});

test('applyPromptTemplate 替换 %i', () => {
  const r = applyPromptTemplate('img=%i msg=%s', { userMessage: 'u', imageInfo: 'OCR' });
  assert.strictEqual(r, 'img=OCR msg=u');
});

test('applyPromptTemplate 无占位符时 userMessage 兜底前置', () => {
  const r = applyPromptTemplate('just body', { userMessage: 'hi' });
  assert.strictEqual(r, 'hi just body');
});

test('applyPromptTemplate 空模板直接返回 userMessage', () => {
  assert.strictEqual(applyPromptTemplate('', { userMessage: 'x' }), 'x');
  assert.strictEqual(applyPromptTemplate(null, { userMessage: 'x' }), 'x');
});

test('applyPromptTemplate 模板含 good_eg 时拼 header + 系统注释', () => {
  const tpl = `body\ngood_eg:\n[good note]\nA`;
  const r = applyPromptTemplate(tpl, { userMessage: 'u' });
  assert.ok(r.includes('[Good Examples'));
  assert.ok(r.includes('good_eg = good example'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

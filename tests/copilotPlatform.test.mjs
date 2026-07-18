import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(rootDir, 'config', 'platformConfig.js');
const scriptMapPath = join(rootDir, 'backgroudtask', 'platformScriptFiles.js');
const contentScriptPath = join(rootDir, 'contentScripts', 'copilot.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed++;
  }
}

console.log('\nCopilot 平台接入契约测试');

test('注册 Copilot 平台元数据', () => {
  const source = readFileSync(configPath, 'utf8');
  assert.match(source, /copilot\s*:\s*\{/);
  assert.match(source, /name\s*:\s*['"]Copilot['"]/);
  assert.match(source, /url\s*:\s*['"]https:\/\/copilot\.microsoft\.com\/['"]/);
  assert.match(source, /defaultVisible\s*:\s*true/);
});

test('显式映射 Copilot 内容脚本', () => {
  const source = readFileSync(scriptMapPath, 'utf8');
  assert.match(
    source,
    /platform\s*===\s*['"]copilot['"][\s\S]*?return\s*\[\s*['"]contentScripts\/copilot\.js['"]\s*\]/
  );
});

test('Copilot 内容脚本由平台模板生成', () => {
  assert.ok(existsSync(contentScriptPath), 'contentScripts/copilot.js 尚未创建');
  const source = readFileSync(contentScriptPath, 'utf8');
  assert.match(source, /name\s*:\s*['"]Copilot['"]/);
  assert.match(source, /hostname\s*:\s*['"]copilot\.microsoft\.com['"]/);
  assert.match(source, /inputMode\s*:\s*['"]nativeSetter['"]/);
  assert.match(source, /chrome\.runtime\.onMessage\.addListener/);
});

test('使用稳定属性定位输入框和发送按钮', () => {
  assert.ok(existsSync(contentScriptPath), 'contentScripts/copilot.js 尚未创建');
  const source = readFileSync(contentScriptPath, 'utf8');
  assert.match(source, /textarea#userInput\[data-testid=["']composer-input["']\]/);
  assert.match(source, /button\[data-testid=["']submit-button["']\]/);
});

test('输入事件不模拟 Enter，避免与按钮点击重复发送', () => {
  const source = readFileSync(contentScriptPath, 'utf8');
  const triggerInputEvents = source.match(
    /function triggerInputEvents\(element\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(triggerInputEvents, '未找到 triggerInputEvents 函数');
  assert.doesNotMatch(triggerInputEvents[1], /KeyboardEvent/);
});

test('重复注入时只注册一个消息监听器', () => {
  const source = readFileSync(contentScriptPath, 'utf8');
  assert.match(source, /window\.__copilotContentScriptInjected/);
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);

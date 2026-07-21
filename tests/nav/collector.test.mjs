import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { collectRecords } from '../../contentScripts/nav/core/collector.js';
import { FakeElement, installBrowserGlobals, resetBrowserGlobals } from './fake-dom.mjs';

afterEach(() => resetBrowserGlobals());

test('collectRecords returns both truncated text and fullText', () => {
  const { document } = installBrowserGlobals();
  const el = new FakeElement('div');
  el.innerText = 'a'.repeat(200);
  document.setQuerySelectorAll('.msg', [el]);

  const { records, skippedCount } = collectRecords({ itemSel: '.msg', textSel: null });
  assert.equal(records.length, 1);
  assert.equal(skippedCount, 0);
  assert.equal(records[0].text.length, 60);           // truncated
  assert.equal(records[0].fullText.length, 200);       // full
  assert.equal(records[0].el, el);
});

test('collectRecords skips empty text and increments skippedCount', () => {
  const { document } = installBrowserGlobals();
  const el1 = new FakeElement('div');
  el1.innerText = 'hello';
  const el2 = new FakeElement('div');
  el2.innerText = '   ';
  const el3 = new FakeElement('div');
  el3.innerText = 'world';
  document.setQuerySelectorAll('.msg', [el1, el2, el3]);

  const { records, skippedCount } = collectRecords({ itemSel: '.msg', textSel: null });
  assert.equal(records.length, 2);
  assert.equal(skippedCount, 1);
  assert.equal(records[0].fullText, 'hello');
  assert.equal(records[1].fullText, 'world');
});

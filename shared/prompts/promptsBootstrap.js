/**
 * Compile-time hardcoded fallback for the prompts store.
 *
 * The 8 groups are imported from popup/main/prompts/groups/*.js and each item
 * is wrapped with a `group` field so downstream consumers can identify which
 * group an item belongs to without relying on the surrounding object key.
 *
 * This module exists so promptsStore can seed its in-memory cache before the
 * native host is reachable. Disk loading via loadAllPrompts() will overwrite
 * this seed when the prompts dir is accessible.
 *
 * @module shared/prompts/promptsBootstrap
 */

import code_gen from '../../popup/main/prompts/groups/code_gen.js';
import analyze_plan from '../../popup/main/prompts/groups/analyze_plan.js';
import custom_design from '../../popup/main/prompts/groups/custom_design.js';
import read from '../../popup/main/prompts/groups/read.js';
import search from '../../popup/main/prompts/groups/search.js';
import other from '../../popup/main/prompts/groups/other.js';
import xxxx_ask from '../../popup/main/prompts/groups/xxxx_ask.js';
import xxxx_trans from '../../popup/main/prompts/groups/xxxx_trans.js';

/**
 * Wrap a raw group array with the group name on every item.
 * Returns a fresh array; the input array is not mutated.
 *
 * @param {string} group Group key.
 * @param {Array<{label: string, alias: string, template: string}>} items
 * @returns {Array<{group: string, label: string, alias: string, template: string}>}
 */
function wrap(group, items) {
  return items.map((it) => ({
    group,
    label: it.label,
    alias: it.alias,
    template: it.template,
  }));
}

/**
 * Build the bootstrap prompt map. Called once at module load.
 * The returned object is frozen at the top level so callers cannot mutate
 * the group keys by accident. Item arrays are still mutable; downstream
 * code must treat them as read-only (matching getCurrentPrompts contract).
 *
 * @returns {{[group: string]: Array<{group: string, label: string, alias: string, template: string}>}}
 */
export function getBootstrapPrompts() {
  return Object.freeze({
    code_gen: wrap('code_gen', code_gen),
    analyze_plan: wrap('analyze_plan', analyze_plan),
    custom_design: wrap('custom_design', custom_design),
    read: wrap('read', read),
    search: wrap('search', search),
    other: wrap('other', other),
    xxxx_ask: wrap('xxxx_ask', xxxx_ask),
    xxxx_trans: wrap('xxxx_trans', xxxx_trans),
  });
}

---
name: hide-scrollbar-reference
description: Reference — WebKit 滚动条隐藏技术完整指南。覆盖共享 CSS vs 页面独有 CSS 的作用域选择（:has(.page-container) 锚点 vs 直接 html/body）、max-height + overflow-y 根因修复、典型案例（options iframe 子页面、popup 下拉）。原 hide-scrollbar skill 归档版本。
---

# Hide Scrollbar（参考文档）

> 本文档为历史独立 skill `hide-scrollbar` 的归档版本，已沉淀为 `options-style-standards` 的 ref。阅读时机：处理 options/popup/iframe 子页面或任何溢出页面的滚动条隐藏问题。

## Overview
Hide the visible WebKit scrollbar on a page's scroll container while keeping it scrollable. `::-webkit-scrollbar { width: 0; height: 0 }` only hides it visually — the mouse wheel / trackpad still scrolls, so content does not become unreachable.

The selector you wrap it in depends on **whether the stylesheet is shared**:

- **Shared stylesheet** (loaded by both an outer shell and iframe subpages): scope to the subpage only with a `:has(.page-container)` anchor, so the shell keeps its own scrollbars.
- **Page-only stylesheet** (loaded by exactly one page, e.g. a popup): scope directly to `html`/`body` — no guard needed, simpler.

## Decision: which selector to use

Ask: *Is this CSS file loaded anywhere besides the page I want to fix?*

| Situation | Selector | Why |
|---|---|---|
| Options shell + iframe subpages, one shared `.css` | `html:has(.page-container)`, `body:has(.page-container)` | Prevents the rule from leaking into the shell's sidebar/wrapper scrollbars |
| Standalone page, CSS only loaded here (popup, single HTML) | `html`, `body` | No leak risk; the `:has()` guard would be dead weight |

The safest shared-shell anchor in this repo is `.page-container`, because the iframe subpages already use it.

## Core Pattern A — shared stylesheet (options iframe)

Put the rule in the shared stylesheet, scoped to subpages only:

```css
html:has(.page-container)::-webkit-scrollbar,
body:has(.page-container)::-webkit-scrollbar {
  width: 0;
  height: 0;
}

html:has(.page-container)::-webkit-scrollbar-track,
body:has(.page-container)::-webkit-scrollbar-track,
html:has(.page-container)::-webkit-scrollbar-thumb,
body:has(.page-container)::-webkit-scrollbar-thumb {
  background: transparent;
  opacity: 0;
}
```

## Core Pattern B — page-only stylesheet (standalone popup)

Scope directly to `html`/`body`. Confirm first (grep the `href`/`src`) that nothing else loads this file:

```css
html::-webkit-scrollbar,
body::-webkit-scrollbar {
  width: 0;
  height: 0;
}

html::-webkit-scrollbar-track,
body::-webkit-scrollbar-track,
html::-webkit-scrollbar-thumb,
body::-webkit-scrollbar-thumb {
  background: transparent;
  opacity: 0;
}
```

## Always pair it with the root-cause fix

Hiding the scrollbar is the cosmetic half. Find **which element actually overflows** and constrain it so its content scrolls internally instead of pushing the page taller:

```css
.<overflowing-element> {
  max-height: 300px;   /* cap so it stops growing into the page */
  overflow-y: auto;    /* content beyond the cap scrolls inside */
}
```

Typical offenders: an absolutely-positioned dropdown with an inner `min-height` and no `max-height`; a panel whose height is content-driven. Pairing `max-height` + `overflow-y: auto` with the hidden page scrollbar is what actually removes the overflow — the hidden scrollbar alone just covers it up.

## Case Studies

### Case 1 — Options iframe subpages (shared CSS)
Outer options shell loads `options/options.css`; iframe subpages load the same file and render `.page-container`. Apply **Pattern A** in `options/options.css`. Shell sidebar/wrapper scrollbars stay intact; only the iframe page scrollbar hides.

### Case 2 — `popup/main` prompt dropdown (page-only CSS) ✅ this session
**Symptom:** expanding the prompt-optimizer dropdown made the popup page taller than the viewport → a page scrollbar appeared.
**Root cause:** `.custom-select-options` is `position: absolute`, its inner `.two-column-container` has `min-height: 300px`, and the dropdown had **no `max-height`** → it grew unbounded downward past the viewport bottom.
**Fix in `popup/main/main.css`** (loaded only by `popup/main/main.html`, so Pattern B applies — no `:has()` guard):
1. `.custom-select-options { max-height: 300px; overflow-y: auto; }` — overflow now scrolls inside the dropdown (root cause).
2. `html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }` — hides any residual page scrollbar; wheel still scrolls.
**Verified working** by the user.

## Quick Reference
- Shared CSS → `:has(.page-container)` anchor; page-only CSS → direct `html`/`body`.
- Keep the rule in the stylesheet the target page actually loads.
- Do NOT apply the rule to the outer shell's wrapper directly.
- If a subpage scrolls inside a different container, add the same pattern to that container instead.
- Always pair with `max-height` + `overflow-y: auto` on the overflowing element.

## Common Mistakes
- **Name implied only options** — the old `options-hide-scrollbar` name was too narrow; hiding scrollbars is a general technique that applies to popups, dialogs, and any overflowing page, not just options iframes.
- **Scoping only `body` on a shared stylesheet** — leaks into the shell. Use the `:has(.page-container)` anchor when the CSS is shared.
- **Adding the `:has()` guard on a page-only stylesheet** — dead weight; scope directly to `html`/`body` when the file isn't loaded elsewhere.
- **Hiding the scrollbar and stopping there** — find the overflowing element and cap it (`max-height` + `overflow-y: auto`), or content beyond the fold relies on wheel-scroll alone.
- **Putting the rule on `.main-content` / the wrapper** in the outer shell — that changes the wrapper, not the iframe page scrollbar.
- **Hiding the scrollbar on the wrong element** — the rule must match the element that actually scrolls.
- **Forgetting that `width: 0` and `height: 0` are enough** to hide the scrollbar visually; the rest (track/thumb transparent) is belt-and-suspenders.

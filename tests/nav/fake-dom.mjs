class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  _names() {
    return new Set(this.element.className.split(/\s+/).filter(Boolean));
  }

  contains(name) {
    return this._names().has(name);
  }

  add(name) {
    const names = this._names();
    names.add(name);
    this.element.className = Array.from(names).join(' ');
  }

  remove(name) {
    const names = this._names();
    names.delete(name);
    this.element.className = Array.from(names).join(' ');
  }

  toggle(name, force) {
    const names = this._names();
    const shouldAdd = force === undefined ? !names.has(name) : Boolean(force);
    if (shouldAdd) names.add(name);
    else names.delete(name);
    this.element.className = Array.from(names).join(' ');
    return shouldAdd;
  }
}

export class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.innerText = '';
    this.children = [];
    this.parentNode = null;
    this.scrollCalls = [];
    this.rect = { top: 0, bottom: 100, height: 100 };
    this.offsetHeight = 100;
    this.listeners = new Map();
    this.queryOne = new Map();
    this.queryMany = new Map();
    this.classList = new FakeClassList(this);
    this.style = {};
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) return child;
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  get lastChild() {
    return this.children[this.children.length - 1] || null;
  }

  replaceChildren(...children) {
    while (this.children.length > 0) {
      const child = this.children[this.children.length - 1];
      this.removeChild(child);
    }
    children.forEach((child) => this.appendChild(child));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    const event = { type: 'click', target: this, stopPropagation() {} };
    (this.listeners.get('click') || []).forEach((listener) => listener(event));
  }

  pointerEvent(type, options = {}) {
    const event = { type, pointerId: 1, target: this, ...options, preventDefault() {} };
    (this.listeners.get(type) || []).forEach((listener) => {
      listener(event);
    });
  }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  setQuerySelector(selector, element) {
    this.queryOne.set(selector, element);
  }

  setQuerySelectorAll(selector, elements) {
    this.queryMany.set(selector, elements);
  }

  querySelector(selector) {
    if (this.queryOne.has(selector)) return this.queryOne.get(selector);
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (this.queryMany.has(selector)) return this.queryMany.get(selector);
    const matches = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  scrollIntoView(options) {
    this.scrollCalls.push(options);
  }

  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement('head');
    this.body = new FakeElement('body');
    this.documentElement = { clientHeight: 1000, clientWidth: 1024 };
    this.queryOne = new Map();
    this.queryMany = new Map();
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    const visit = (node) => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this.head) || visit(this.body);
  }

  setQuerySelector(selector, element) {
    this.queryOne.set(selector, element);
  }

  setQuerySelectorAll(selector, elements) {
    this.queryMany.set(selector, elements);
  }

  querySelector(selector) {
    if (this.queryOne.has(selector)) return this.queryOne.get(selector);
    return this.body.querySelector(selector) || this.head.querySelector(selector);
  }

  querySelectorAll(selector) {
    if (this.queryMany.has(selector)) return this.queryMany.get(selector);
    return [
      ...this.body.querySelectorAll(selector),
      ...this.head.querySelectorAll(selector),
    ];
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.disconnected = false;
  }

  observe(target, options) {
    this.targets.push({ target, options });
  }

  disconnect() {
    this.disconnected = true;
    this.targets = [];
  }
}

class FakeIntersectionObserver extends FakeMutationObserver {}

export function installBrowserGlobals() {
  const document = new FakeDocument();
  const windowListeners = new Map();
  const window = {
    innerHeight: 1000,
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
  };

  globalThis.document = document;
  globalThis.window = window;
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.IntersectionObserver = FakeIntersectionObserver;

  return { document, window, windowListeners };
}

export function resetBrowserGlobals() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.MutationObserver;
  delete globalThis.IntersectionObserver;
}
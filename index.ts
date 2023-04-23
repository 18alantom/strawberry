type Complex = object | Function;
type Meta = { __sb_prefix: string; __sb_dependencies?: boolean };
type Reactive<T extends any> = T extends Complex ? T & Meta : never;
type Watcher = (newValue: unknown) => unknown;
type HandlerFunction = (
  newValue: unknown,
  el: Element,
  key: string,
  isDelete: boolean
) => unknown;
type HandlerMap = Record<string, HandlerFunction>;
type BasicAttrs = 'mark' | 'child' | 'if' | 'plc';

const dependencyRegex = /\w+(\??[.]\w+)+/g;

let globalData: null | Reactive<{}> = null;
let globalPrefix = 'sb-';

const attr = (k: BasicAttrs) => globalPrefix + k;

function reactive<T>(obj: T, prefix: string): T | Reactive<T> {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  type K = keyof T;
  for (const prop of Object.keys(obj)) {
    const newprefix = getKey(prop, prefix);
    const value = obj[prop as K];
    obj[prop as K] = reactive(value, newprefix);
  }

  Object.defineProperty(obj, '__sb_prefix', {
    value: prefix,
    enumerable: false,
  });

  return new Proxy(obj, ReactivityHandler) as Reactive<T>;
}

class ReactivityHandler implements ProxyHandler<Reactive<object>> {
  static watchers: Record<string, Watcher[]> = {};
  static dependents: Record<string, { key: string; computed: Function }[]> = {};

  static get(
    target: Reactive<object>,
    prop: string | symbol,
    receiver: any
  ): any {
    if (prop === '__parent') {
      return getParent(target);
    }

    const value = Reflect.get(target, prop, receiver);
    if (value?.__sb_dependencies) {
      return value();
    }

    return value;
  }

  static set(
    target: Reactive<object>,
    prop: string | symbol,
    value: any,
    receiver: any
  ): boolean {
    if (typeof prop === 'symbol') {
      return Reflect.set(target, prop, value, receiver);
    }

    const key = getKey(prop, target.__sb_prefix);
    const reactiveValue = reactive(value, key);
    if (typeof value === 'function') {
      this.updateDependents(value, key);
    }

    const success = Reflect.set(target, prop, reactiveValue, receiver);
    this.update(value, key, false);
    if (Array.isArray(target) && /\d+/.test(prop)) {
      this.syncTree(target, prop, value);
    }

    this.updateDependencies(key);
    return success;
  }

  static updateDependencies(key: string) {
    const dependents = Object.keys(this.dependents)
      .filter((k) => k === key || key.startsWith(k + '.'))
      .map((k) => this.dependents[k] ?? [])
      .flat();

    for (const dep of dependents) {
      this.update(dep.computed, dep.key, false);
    }
  }

  static deleteProperty(
    target: Reactive<object>,
    prop: string | symbol
  ): boolean {
    if (typeof prop === 'symbol') {
      return Reflect.deleteProperty(target, prop);
    }

    const key = getKey(prop, target.__sb_prefix);
    const success = Reflect.deleteProperty(target, prop);
    this.update(undefined, key, true);
    for (const dep of this.dependents[key] ?? []) {
      this.update(dep.computed, dep.key, false);
    }

    for (const k of Object.keys(this.dependents)) {
      this.dependents[k] =
        this.dependents[k]?.filter((d) => d.key !== key) ?? [];
    }

    return success;
  }

  static syncTree(target: Reactive<any[]>, prop: string, value: any) {
    // TODO: Fix and Complete this function
    const prefix = target.__sb_prefix;
    const els = document.querySelectorAll(`[${attr('mark')}="${prefix}"]`);

    const key = getKey(prop, prefix);
    for (const el of els) {
      const ch = el.querySelector(`[${attr('mark')}="${key}"]`);
      if (ch !== null) {
        continue;
      }

      const childTag = el.getAttribute(attr('child'));
      if (!childTag) {
        continue;
      }

      const child = getChild(childTag, key, value);
      el.appendChild(child);
    }
  }

  static update(newValue: unknown, key: string, isDelete: boolean) {
    if (typeof newValue === 'function') {
      newValue = newValue();
    }

    if (newValue instanceof Promise) {
      (newValue as Promise<unknown>).then((v: unknown) =>
        this.update(v, key, false)
      );
      return;
    }

    this.callWatchers(newValue, key);
    this.callHandlers(newValue, key, isDelete);
  }

  static callWatchers(newValue: unknown, key: string) {
    for (const k of Object.keys(this.watchers)) {
      if (key === k) {
        this.watchers[k]?.forEach((cb) => cb(newValue));
      } else if (key.startsWith(k + '.') && globalData !== null) {
        const value = getValue(k, globalData);
        this.watchers[k]?.forEach((cb) => cb(value));
      }
    }
  }

  static callHandlers(newValue: unknown, key: string, isDelete: boolean) {
    for (const attrSuffix in this.handlers) {
      const handler = this.handlers[attrSuffix]!;
      const els = document.querySelectorAll(
        `[${globalPrefix + attrSuffix}='${key}']`
      );
      els.forEach((el) => handler(newValue, el, key, isDelete));
    }
  }

  static updateDependents(value: Function, key: string) {
    Object.defineProperty(value, '__sb_dependencies', {
      value: false,
      enumerable: false,
      writable: true,
    });

    for (const matches of value.toString().matchAll(dependencyRegex)) {
      const dep = matches[0]?.replace('?.', '.');
      if (!dep) {
        continue;
      }

      const sidx = dep.indexOf('.') + 1;
      const dkey = dep.slice(sidx);

      this.dependents[dkey] ??= [];
      this.dependents[dkey]!.push({ key, computed: value });
      (value as Reactive<Function>).__sb_dependencies = true;
    }
  }

  static handlers: HandlerMap = {
    mark,
    if: (value, el, key) => {
      const isshow = Boolean(value);
      const istemplate = el instanceof HTMLTemplateElement;
      if (isshow && istemplate) {
        const child = el.children[0] ?? el.content.children[0];
        if (!child) {
          return;
        }
        child.setAttribute(attr('if'), key);
        el.replaceWith(child);
      }

      if (!isshow && !istemplate) {
        const temp = document.createElement('template');
        temp.appendChild(el.cloneNode(true));
        temp.setAttribute(attr('if'), key);
        el.replaceWith(temp);
      }
    },
  };
}

function mark(value: unknown, el: Element, key: string, isDelete: boolean) {
  if (isDelete) {
    remove(el);
  }

  if (Array.isArray(value)) {
    return array(value, el, key);
  } else if (typeof value === 'object' && value !== null) {
    return object(value, el, key);
  }

  return text(value, el, key);
}

function remove(el: Element) {
  const isPlc = el.getAttribute(attr('plc')) === '1';
  const parent = el.parentElement;
  if (!isPlc || !(el instanceof HTMLElement) || !parent) {
    return el.remove();
  }

  if (el.getAttribute(attr('mark')) === parent.getAttribute(attr('mark'))) {
    return parent.remove();
  }

  el.remove();
}

function text(value: unknown, el: Element, key: string) {
  if (el instanceof HTMLElement && value !== undefined) {
    el.innerText = String(value);
  }
  el.setAttribute(attr('mark'), key);
}

function array(value: any[], el: Element, key: string) {
  const childTag = el.getAttribute(attr('child'));
  if (!childTag) {
    console.error('marked el with array value has no child', value, el, key);
    return;
  }

  const children = value.map((item, i) =>
    getChild(childTag, getKey(String(i), key), item)
  );

  el.setAttribute(attr('mark'), key);
  el.replaceChildren(...children);
}

function object(value: object, el: Element, key: string) {
  const childTag = el.getAttribute(attr('child'));
  if (!childTag) {
    return setSlots(el, key, value);
  }

  const child = getChild(childTag, key, value);
  child.setAttribute(attr('mark'), key);
  el.replaceWith(child);
}

function getChild(tag: string, prefix: string, value: any): HTMLElement {
  const el = document.createElement(tag);
  setSlots(el, prefix, value);
  return el;
}

function setSlots(el: Element, prefix: string, value: any): void {
  const slots = el.shadowRoot?.querySelectorAll('slot');
  if (!slots?.length) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      value = undefined;
    }

    return mark(value, el, prefix, false);
  }

  el.replaceChildren();
  for (const slot of slots) {
    const childTag = slot.getAttribute(attr('child'));
    const childEl = document.createElement(childTag ?? 'span');

    let childVal = value;
    let childKey = prefix;

    const sname = slot.getAttribute('name');
    if (sname) {
      childVal = value?.[sname];
      childKey = getKey(sname, prefix);
      childEl.setAttribute('slot', sname);
    }

    if (!childTag) {
      childEl.setAttribute(attr('plc'), '1');
    }

    mark(childVal, childEl, childKey, false);
    el.appendChild(childEl);
  }
  el.setAttribute(attr('mark'), prefix);
}

function getKey(prop: string, prefix: string) {
  return prefix === '' ? prop : prefix + '.' + prop;
}

function getValue(key: string, value: any) {
  for (const k of key.split('.')) {
    const tval = typeof value;
    if (value === null || (tval !== 'function' && tval !== 'object')) {
      return undefined;
    }

    value = Reflect.get(value, k);
  }

  return value;
}

function getParent(target: Reactive<object>) {
  const key = target.__sb_prefix;
  if (!key) {
    return undefined;
  }

  const li = key.lastIndexOf('.');
  if (li === -1) {
    return globalData;
  }

  return getValue(key.slice(0, li), globalData);
}

/**
 * External API Code
 */
export function init(config?: { prefix?: string; handlers?: HandlerMap }) {
  globalData ??= reactive({}, '') as {} & Meta;
  globalPrefix = config?.prefix ?? globalPrefix;

  if (config?.handlers) {
    ReactivityHandler.handlers = {
      ...ReactivityHandler.handlers,
      ...config.handlers,
    };
  }

  register();
  return globalData;
}

export function register() {
  for (const template of document.getElementsByTagName('template')) {
    const tagName = template.getAttribute('name');
    if (!tagName || !!customElements.get(tagName)) {
      continue;
    }

    const elConstructor = class extends HTMLElement {
      constructor() {
        super();
        const element = template.content.children[0]?.cloneNode(true);
        if (element) {
          this.attachShadow({ mode: 'open' }).appendChild(element);
        }
      }
    };
    customElements.define(tagName, elConstructor);
  }
}

export function watch(key: string, watcher: Watcher) {
  ReactivityHandler.watchers[key] ??= [];
  ReactivityHandler.watchers[key]!.push(watcher);
}

export function unwatch(key?: string, watcher?: Watcher) {
  if (!key) {
    ReactivityHandler.watchers = {};
    return;
  }

  if (!watcher) {
    delete ReactivityHandler.watchers[key];
    return;
  }

  const watchers = ReactivityHandler.watchers[key] ?? [];
  ReactivityHandler.watchers[key] = watchers.filter((w) => w !== watcher);
}

/**
 * TODO:
 * - [ ] Create example test apps
 * - [ ] builtin handlers
 *   - [?] input v-model (two way binding?)
 *   - [?] style
 * - [?] Cache computed
 * - [-] Check array changes
 *   - [ ] shift, unshift, reverse
 *   - [ ] cannot redefine property __sb_prefix
 * - [ ] sync[node]: refresh UI, such as after page load
 *   - [ ] walk tree and cross check values and marks
 * - [ ] Initialization: values are set after page loads
 * - [ ] Review the code, take note of implementation and hacks
 * - [ ] Update Subtree after display
 * - [ ] Sync newly inserted nodes with other handlers
 * - [ ] Add copyright message into the built file
 */

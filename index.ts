type Complex = object | Function;
type Meta = { __sb_prefix: string; __sb_dependencies?: number };
type Reactive<T extends any> = T extends Complex ? T & Meta : never;
type Watcher = (newValue: unknown) => unknown;
type HandlerFunction = (
  newValue: unknown,
  el: Element,
  key: string,
  isDelete: boolean
) => unknown;
type HandlerMap = Record<string, HandlerFunction>;
type BasicAttrs = 'mark' | 'child' | 'if';

const dependencyRegex = /\w+(\??[.]\w+)+/g;

let globalData: null | Reactive<{}> = null;
let globalPrefix = 'sb-';

function attr(key: BasicAttrs) {
  return globalPrefix + key;
}

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
      this.setDependencyCount(value, key);
    }

    const success = Reflect.set(target, prop, reactiveValue, receiver);
    this.update(value, key, false);
    if (Array.isArray(target) && /\d+/.test(prop)) {
      this.syncTree(target, prop, value);
    }

    for (const dep of this.dependents[key] ?? []) {
      this.update(dep.computed, dep.key, false);
    }

    this.updateDependencies(key);
    return success;
  }

  static updateDependencies(key: string) {
    const dependents = Object.keys(this.dependents)
      .filter((k) => k.startsWith(key))
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

    for (const watcher of this.watchers?.[key] ?? []) {
      watcher(newValue);
    }

    this.callHandlers(newValue, key, isDelete);
    if (!newValue || typeof newValue !== 'object') {
      return;
    }

    for (const prop in newValue) {
      const value = newValue[prop as keyof typeof newValue];
      const newKey = getKey(prop, key);
      this.update(value, newKey, false);
    }
  }

  static callHandlers(newValue: unknown, key: string, isDelete: boolean) {
    for (const attrSuffix in this.handlers) {
      const handler = this.handlers[attrSuffix]!;
      const attrName = globalPrefix + attrSuffix;
      const query = `[${attrName}='${key}']`;
      const els = document.querySelectorAll(query);

      for (const el of els) {
        handler(newValue, el, key, isDelete);
      }
    }
  }

  static setDependencyCount(value: Function, key: string) {
    const fstring = value.toString();
    Object.defineProperty(value, '__sb_dependencies', {
      value: 0,
      enumerable: false,
      writable: true,
    });

    for (const matches of fstring.matchAll(dependencyRegex)) {
      const dep = matches[0]?.replace('?.', '.');
      if (!dep) {
        continue;
      }

      const sidx = dep.indexOf('.') + 1;
      const dkey = dep.slice(sidx);

      this.dependents[dkey] ??= [];
      this.dependents[dkey]!.push({ key, computed: value });
      (value as Reactive<Function>).__sb_dependencies! += 1;
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
    return el.remove();
  }

  const isObject = typeof value === 'object' && value !== null;
  if (isObject && Array.isArray(value)) {
    return array(value, el, key);
  } else if (isObject) {
    return object(value, el, key);
  }

  return text(value, el, key);
}

function text(value: unknown, el: Element, key: string) {
  let stringVal = String(value == null ? '' : value);
  if (el instanceof HTMLElement) {
    el.innerText = stringVal;
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
    console.error('marked el with array value has no child', value, el, key);
    return;
  }

  const child = getChild(childTag, key, value);
  child.setAttribute(attr('mark'), key);
  el.replaceWith(child);
}

function getChild(tag: string, prefix: string, value: any): HTMLElement {
  const el = document.createElement(tag);
  const slots = el.shadowRoot?.querySelectorAll('slot');
  if (
    !slots?.length ||
    (slots.length === 1 && !slots[0]?.hasAttribute('name'))
  ) {
    mark(value, el, prefix, false);
    return el;
  }

  for (const slot of slots) {
    const sname = slot.getAttribute('name');
    if (!sname) {
      continue;
    }

    const childTag = slot.getAttribute(attr('child')) ?? 'span';
    const child = document.createElement(childTag);
    mark(value?.[sname], child, getKey(sname, prefix), false);

    child.setAttribute('slot', sname);
    el.appendChild(child);
  }

  return el;
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
  if (globalData === null) {
    globalData = reactive({}, '') as {} & Meta;
  }

  if (config?.prefix) {
    globalPrefix = config.prefix;
  }

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

    customElements.define(
      tagName,
      class extends HTMLElement {
        constructor() {
          super();
          const element = template.content.children[0]?.cloneNode(true);
          if (!element) {
            return;
          }
          this.attachShadow({ mode: 'open' }).appendChild(element);
        }
      }
    );
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
 * - [?] data can be nested [{v:[{},{x:99}]}] changes should be targeted
 * - [ ] builtin handlers
 *  - [?] input v-model (two way binding?)
 *  - [?] style
 * - [?] Cache computed
 * - [-] Watch array changes
 * - [ ] sync[node]: refresh UI, such as after page load
 * - [ ] Initialization: values are set after page loads
 * - [ ] Todo App and async
 * - [ ] Review the code, take note of implementation and hacks
 * - [ ] Update Subtree after display
 * - [ ] Remove esbuild as a devdep
 * - [ ] Sync newly inserted nodes with other handlers
 */

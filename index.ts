type Primitive = boolean | symbol | string | number | bigint | undefined;
type Complex = object | Function;
type Meta = { __sb_prefix: string; __sb_dependencies?: number };
type Reactive<T extends any> = T extends Complex ? T & Meta : never;
type Watcher = (newValue: unknown) => unknown;
type HandlerFunction = (newValue: unknown, el: Element, key: string) => unknown;
type HandlerMap = Record<string, HandlerFunction>;
type BasicAttrs = 'inner' | 'loop' | 'template';

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

    console.log('get', prop, value);
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
    this.update(value, key);
    for (const dep of this.dependents[key] ?? []) {
      this.update(dep.computed, dep.key);
    }

    console.log('set', key, prop, value);
    return success;
  }

  static update(newValue: unknown, key: string) {
    if (typeof newValue === 'function') {
      newValue = newValue();
    }

    if (newValue instanceof Promise) {
      (newValue as Promise<unknown>).then((v: unknown) => this.update(v, key));
      return;
    }

    for (const watcher of this.watchers?.[key] ?? []) {
      watcher(newValue);
    }

    this.callHandlers(newValue, key);

    if (!newValue || typeof newValue !== 'object') {
      return;
    }

    for (const prop in newValue) {
      const value = newValue[prop as keyof typeof newValue];
      const newKey = getKey(prop, key);
      this.update(value, newKey);
    }
  }

  static callHandlers(newValue: unknown, key: string) {
    for (const attrSuffix in this.handlers) {
      const handler = this.handlers[attrSuffix];
      const attrName = globalPrefix + attrSuffix;
      const query = `[${attrName}='${key}']`;
      const els = document.querySelectorAll(query);

      for (const el of els) {
        handler(newValue, el, key);
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
      this.dependents[dkey].push({ key, computed: value });
      (value as Reactive<Function>).__sb_dependencies! += 1;
    }
  }

  static handlers: HandlerMap = {
    inner: (value, el) =>
      el instanceof HTMLElement ? (el.innerText = String(value)) : null,
    loop: (value, el, key) => {
      const childTag = el.getAttribute(attr('template'));
      if (!childTag || !Array.isArray(value)) {
        return;
      }

      const children = value.map((item, i) => {
        const child = document.createElement(childTag);
        const ckey = getKey(String(i), key);
        child.setAttribute(attr('inner'), ckey);
        child.innerText = item;
        return child;
      });

      el.replaceChildren(...children);
    },
  };
}

function getKey(prop: string, prefix: string) {
  if (prefix === '') {
    return prop;
  }

  return prefix + '.' + prop;
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
function init(config?: { prefix?: string; handlers?: HandlerMap }) {
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

  registerComponents();
  return { data: globalData, watch, unwatch };
}

function registerComponents() {
  for (const template of document.getElementsByTagName('template')) {
    const tagName = template.getAttribute('name');
    if (!tagName) {
      continue;
    }

    customElements.define(
      tagName,
      class extends HTMLElement {
        constructor() {
          super();
          const element = template.content.children[0].cloneNode(true);
          this.attachShadow({ mode: 'open' }).appendChild(element);
        }
      }
    );
  }
}

function watch(key: string, watcher: Watcher) {
  ReactivityHandler.watchers[key] ??= [];
  ReactivityHandler.watchers[key].push(watcher);
}

function unwatch(key: string, watcher?: Watcher) {
  if (!watcher) {
    delete ReactivityHandler.watchers[key];
    return;
  }

  const watchers = ReactivityHandler.watchers[key] ?? [];
  ReactivityHandler.watchers[key] = watchers.filter((w) => w !== watcher);
}

window.init = init;

/**
 * TODO:
 * - [ ] Improve Updations
 *  - changing a list item should not replace all elements
 *  - following are not handled: item delete, size grow, size shrink
 *  - data can be nested [{v:[{},{x:99}]}] changes should be targeted
 * - [ ] builtin handlers
 *  - [x] innerText
 *  - [ ] loops v-for
 *  - [ ] templates
 *  - [ ] input v-model (two way binding?)
 *  - [ ] conditionals v-if
 *  - [ ] style
 * - [ ] Sync: refresh UI, such as after page load
 * - [ ] Watch array changes
 * - [ ] Initialization: values are set after page loads
 * - [ ] Todo App and async
 * - [x] Custom handlers
 * - [x] Custom prefix
 * - [x] Composiblity templates and slots
 * - [?] Cache computed
 * - [x] Computed Values
 */

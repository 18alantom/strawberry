type Primitive = boolean | symbol | string | number | bigint | undefined;
type Complex = object | Function;
type Meta = { __sb_prefix: string; __sb_dependencies?: number };
type Reactive<T extends any> = T extends Complex ? T & Meta : never;
type Watcher = (newValue: unknown) => unknown;
type HandlerFunction = (value: unknown, el: Element) => unknown;
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
      this.applyDependencies(value, key);
    }

    const success = Reflect.set(target, prop, reactiveValue, receiver);
    this.update(value, key);
    this.updateDependencies(key, target);
    console.log('set', key, prop, value);
    return success;
  }

  static update(newValue: unknown, key: string) {
    if (typeof newValue === 'function') {
      newValue = newValue();
    }

    // Trigger Watchers
    for (const watcher of this.watchers?.[key] ?? []) {
      watcher(newValue);
    }

    this.callHandlers(newValue, key);

    // Set innerText
    if (newValue === null) {
      return;
    }

    if (Array.isArray(newValue)) {
      this.updateArrays(newValue, key);
    }

    if (typeof newValue === 'object' && Object.keys(newValue)) {
      this.updateObjects(newValue, key);
    }
  }

  static callHandlers(newValue: unknown, key: string) {
    for (const attrSuffix in this.handlers) {
      const handler = this.handlers[attrSuffix];
      const attrName = globalPrefix + attrSuffix;
      const query = `[${attrName}='${key}']`;
      const els = document.querySelectorAll(query);

      for (const el of els) {
        handler(newValue, el);
      }
    }
  }

  static updateArrays(newValue: any[], key: string) {
    const loopQuery = `[${attr('loop')}='${key}']`;
    for (const el of document.querySelectorAll(loopQuery)) {
      const childTag = el.getAttribute(attr('template'));
      if (!childTag) {
        continue;
      }

      const children = newValue.map((item, i) => {
        const child = document.createElement(childTag);
        const ckey = getKey(String(i), key);
        child.setAttribute(attr('inner'), ckey);
        child.innerText = item;
        return child;
      });

      el.replaceChildren(...children);
    }
  }

  static updateObjects<O extends object>(newValue: O, key: string) {
    for (const prop in newValue) {
      const value = newValue[prop as keyof O];
      const newKey = getKey(prop, key);
      this.update(value, newKey);
    }
  }

  static updateDependencies(key: string, target: any) {
    const deps = this.dependents[key] ?? [];
    for (const { key, computed } of deps) {
      this.update(computed, key);
    }
  }

  static applyDependencies(value: Function, key: string) {
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
 * - [ ] Watch array changes
 * - [ ] Initialization: values are set after page loads
 * - [ ] Todo App and async
 * - [x] Custom handlers
 * - [x] Custom prefix
 * - [x] Composiblity templates and slots
 * - [?] Cache computed
 * - [x] Computed Values
 */

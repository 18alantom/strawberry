type Primitive = boolean | symbol | string | number | bigint | undefined;
type Complex = object | Function;

type R = { __sb_prefix: string; __sb_dependencies?: number };
type Reactive<T> = T extends Complex ? T & R : never;

type Watcher = (newValue: unknown) => unknown;

const attr = {
  innerText: 'sb-inner',
} as const;
const dependencyRegex = /\w+(\??[.]\w+)+/g;

function reactive<T extends any>(obj: T, prefix: string): T | Reactive<T> {
  if (obj && typeof obj === 'object') {
    return proxy(obj, prefix);
  }

  return obj;
}

function proxy<O extends Function | object>(
  obj: O,
  prefix: string
): Reactive<O> {
  type K = keyof O;

  for (const prop of Object.keys(obj)) {
    const newprefix = ReactivityHandler.getKey(prop, prefix);
    const value = obj[prop as K];
    obj[prop as K] = reactive(value, newprefix) as O[K];
  }

  Object.defineProperty(obj, '__sb_prefix', {
    value: prefix,
    enumerable: false,
  });

  return new Proxy(obj, ReactivityHandler) as Reactive<O>;
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

    const key = this.getKey(prop, target.__sb_prefix);
    const reactiveValue = reactive(value, key);
    if (typeof value === 'function') {
      this.handleComputed(value, key);
    }

    const success = Reflect.set(target, prop, reactiveValue, receiver);
    this.update(key, value);
    this.updateDependencies(key, target);
    return success;
  }

  static update(key: string, newValue: unknown) {
    for (const watcher of this.watchers?.[key] ?? []) {
      watcher(newValue);
    }

    if (typeof newValue === 'function') {
      newValue = newValue();
    }

    const query = `[${attr.innerText}='${key}']`;
    for (const el of document.querySelectorAll(query)) {
      // @ts-ignore
      el.innerText = String(newValue);
    }
  }

  static updateDependencies(key: string, target: any) {
    const deps = this.dependents[key] ?? [];
    for (const { key, computed } of deps) {
      this.update(key, computed);
    }
  }

  static handleComputed(value: Function, key: string) {
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

  static getKey(prop: string, prefix: string) {
    if (prefix === '') {
      return prop;
    }

    return prefix + '.' + prop;
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

function init(initData: object = {}) {
  const data = reactive(initData, '');

  createComponents();
  document.addEventListener('DOMContentLoaded', () => {
    setInitialValues(data);
  });

  return data;
}

function createComponents() {
  for (const template of document.getElementsByTagName('template')) {
    const name = template.getAttribute('name');
    if (!name) {
      continue;
    }

    createComponent(name, template);
  }
}

function setInitialValues(data: unknown) {
  for (const el of document.querySelectorAll(`[${attr.innerText}]`)) {
    const key = el.getAttribute(attr.innerText);
    data;
    // TODO: Complete this function
  }
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

function createComponent(name: string, template: HTMLTemplateElement) {
  const element = template.content.children[0].cloneNode(true);
  const component = class extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'open' });
      shadow.appendChild(element);
    }
  };

  customElements.define(name, component);
}

window.init = init;
window.watch = watch;
window.unwatch = unwatch;

/**
 * TODO:
 * - [ ] Loops v-for
 * - [ ] Conditionals v-if
 * - [ ] Styling
 * - [ ] Input Elements (two way binding)
 * - [ ] Initialization: values are set after page loads
 * - [ ] Variable prefix
 * - [ ] Todo App and async
 * - [x] Composiblity templates and slots
 * - [?] Cache computed
 * - [x] Computed Values
 */

type Primitive = boolean | symbol | string | number | bigint | undefined;
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
type BasicAttrs = 'text' | 'list' | 'template' | 'if';

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
      this.syncList(target, prop, value);
    }

    for (const dep of this.dependents[key] ?? []) {
      this.update(dep.computed, dep.key, false);
    }

    return success;
  }

  static syncList(target: Reactive<any[]>, prop: string, value: any) {
    const prefix = target.__sb_prefix;
    const query = `[${attr('list')}="${prefix}"]`;
    const key = getKey(prop, prefix);
    const els = document.querySelectorAll(query);

    for (const el of els) {
      const ch = el.querySelectorAll(`[${attr('text')}="${key}"]`);
      if (ch.length) {
        continue;
      }

      const childTag = el.getAttribute(attr('template'));
      if (!childTag) {
        continue;
      }

      const child = getChild(childTag, key, value);
      el.appendChild(child);
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

    return success;
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

      /**
        TODO: Fix dependency selection
        const dsplits = dkey.split('.');
        for (let i = 0; i < dsplits.length; i++) {
          const sdkey = dsplits.slice(0, i + 1).join('.');
          console.log('sdk', sdkey);
        }
       */

      this.dependents[dkey] ??= [];
      this.dependents[dkey]!.push({ key, computed: value });
      (value as Reactive<Function>).__sb_dependencies! += 1;
    }
  }

  static handlers: HandlerMap = {
    text: (value, el, _, isDelete) => {
      if (isDelete) {
        return el.remove();
      }

      el instanceof HTMLElement ? (el.innerText = String(value)) : null;
    },
    list: (value, el, key, isDelete) => {
      if (isDelete) {
        return el.remove();
      }

      const childTag = el.getAttribute(attr('template'));
      if (!childTag || !Array.isArray(value)) {
        return;
      }

      const children = value.map((item, i) => {
        return getChild(childTag, getKey(String(i), key), item);
      });

      el.replaceChildren(...children);
    },
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

function getChild(tag: string, prefix: string, value: any) {
  const child = document.createElement(tag);
  child.setAttribute(attr('text'), prefix);
  child.innerText = value;
  return child;
}

function _getChild(tag: string, prefix: string, value: any) {
  // TODO: Check for sb-list sb-object
  const child = document.createElement(tag);
  const slots = child.shadowRoot?.querySelectorAll('slot');
  if (
    !slots ||
    !slots.length ||
    (slots.length === 1 && !slots[0]?.getAttribute('name'))
  ) {
    child.setAttribute(attr('text'), prefix);
    child.innerText = value;
    return child;
  }

  for (const slot of slots) {
    const sname = slot.getAttribute('name');
    if (!sname) {
      continue;
    }

    const key = getKey(sname, prefix);
    const svalue = value?.[sname] ?? '';
    const templateName = slot.getAttribute(attr('template'));
    let schild: HTMLElement;
    if (templateName) {
      schild = _getChild(templateName, svalue, key);
    } else {
      schild = document.createElement('span');
      schild.innerText = svalue;
      schild.setAttribute(attr('text'), key);
    }
    schild.setAttribute('slot', sname);
    child.appendChild(schild);
  }

  return child;
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
  return globalData;
}

function registerComponents() {
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

function watch(key: string, watcher: Watcher) {
  ReactivityHandler.watchers[key] ??= [];
  ReactivityHandler.watchers[key]!.push(watcher);
}

function unwatch(key: string, watcher?: Watcher) {
  if (!watcher) {
    delete ReactivityHandler.watchers[key];
    return;
  }

  const watchers = ReactivityHandler.watchers[key] ?? [];
  ReactivityHandler.watchers[key] = watchers.filter((w) => w !== watcher);
}

init.watch = watch;
init.unwatch = unwatch;
init.register = registerComponents;
// @ts-ignore
window.sb = init;

/**
 * TODO:
 * - [ ] Improve Updations
 *  - [x] changing a list item should not replace all elements
 *  - [x] following are not handled: item delete, push, pop
 *  - [ ] data can be nested [{v:[{},{x:99}]}] changes should be targeted
 * - [ ] builtin handlers
 *  - [ ] lists v-for
 *  - [ ] templates
 *  - [ ] input v-model (two way binding?)
 *  - [ ] style
 *  - [x] conditionals v-if
 *  - [x] innerText
 * - [ ] Sync: refresh UI, such as after page load
 * - [ ] Watch array changes
 * - [ ] Initialization: values are set after page loads
 * - [ ] Todo App and async
 * - [x] Custom handlers
 * - [x] Custom prefix
 * - [x] Composiblity templates and slots
 * - [?] Cache computed
 * - [x] Computed Values
 * - [ ] Review the code, take note of implementation and hacks
 * - [ ] Update Subtree after display
 * - [ ] Remove esbuild as a devdep
 */

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
type Config = { prefix?: string; handlers?: HandlerMap };
export function init(config?: Config) {
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

export async function load(files: string | string[]) {
  if (typeof files === 'string') {
    files = [files];
  }

  for (const file of files) {
    const root = document.createElement('div');
    const html = await fetch(file)
      .then((r) => r.text())
      .catch((e) => console.error(e));
    if (typeof html !== 'string') {
      continue;
    }

    root.innerHTML = html;
    register(root);
  }
}

export function register(rootElement?: HTMLElement) {
  let root = rootElement ?? document;
  for (const template of root.getElementsByTagName('template')) {
    const tagName = template.getAttribute('name');
    if (!tagName || !!customElements.get(tagName)) {
      return;
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
 * - [ ] Don't use shadow dom for templates?
 * - [ ] Cache computed?
 * - [ ] Cache el references?
 * - [ ] Check array changes: shift, unshift, reverse
 * - [ ] cannot redefine property __sb_prefix
 * - [ ] sync[node]: refresh UI, such as after page load
 * - [ ] walk sub-trees and cross check values and marks
 * - [ ] Initialization: values are set after page loads
 * - [ ] Review the code, take note of implementation and hacks
 * - [ ] Update Subtree after display
 * - [ ] Sync newly inserted nodes with other handlers
 * - [ ] Remove the need for `sb.register`
 * - [ ] Allow preset values to be loaded as el is inserted
 */

/**
# Notes

TODO: Move these elsewhere maybe

## Performance Numbers

All times are in ms. `performance.mark` is neutered for sec hence low res.
  
divs:    1_000
|             append | min:    1.900 | max:    3.600 | avg:    2.800 |
|     getElementById | min:    0.000 | max:    0.100 | avg:    0.025 |
|   querySelectorAll | min:    0.000 | max:    0.100 | avg:    0.025 |
|             remove | min:    0.700 | max:    1.200 | avg:    0.875 |

divs:   10_000
|             append | min:   23.000 | max:   27.500 | avg:   24.650 |
|     getElementById | min:    0.000 | max:    0.000 | avg:    0.000 |
|   querySelectorAll | min:    0.100 | max:    0.200 | avg:    0.125 |
|             remove | min:    9.700 | max:   14.300 | avg:   12.175 |

divs:   10_000 (With body MutationObserver)
|             append | min:   35.800 | max:   49.400 | avg:   40.125 |
|     getElementById | min:    0.000 | max:    0.100 | avg:    0.025 |
|   querySelectorAll | min:    0.200 | max:    0.300 | avg:    0.250 |
|             remove | min:   29.400 | max:   34.700 | avg:   32.975 |

divs:   10_000 (With body MutationObserver disconnected)
|             append | min:   14.900 | max:   22.900 | avg:   16.975 |
|     getElementById | min:    0.000 | max:    0.000 | avg:    0.000 |
|   querySelectorAll | min:    0.200 | max:    0.300 | avg:    0.225 |
|             remove | min:    5.000 | max:    6.900 | avg:    5.725 |

divs:  100_000
|             append | min:  284.000 | max:  328.700 | avg:  310.500 |
|     getElementById | min:    0.000 | max:    0.100 | avg:    0.025 |
|   querySelectorAll | min:    1.300 | max:    1.400 | avg:    1.325 |
|             remove | min:  107.800 | max:  140.200 | avg:  123.900 |

divs:  100_000 (With body MutationObserver)
|             append | min:  509.800 | max:  578.700 | avg:  556.625 |
|     getElementById | min:    0.000 | max:    0.100 | avg:    0.025 |
|   querySelectorAll | min:    3.400 | max:    4.400 | avg:    3.925 |
|             remove | min:  353.000 | max:  437.700 | avg:  403.125 |

divs:  100_000 (With body MutationObserver disconnected)
|             append | min:  290.400 | max:  360.200 | avg:  317.175 |
|     getElementById | min:    0.000 | max:    0.100 | avg:    0.050 |
|   querySelectorAll | min:    1.200 | max:    1.400 | avg:    1.300 |
|             remove | min:  108.200 | max:  120.300 | avg:  115.925 |

divs: 1_000_000
|             append | min: 1250.500 | max: 1360.500 | avg: 1311.200 |
|     getElementById | min:    0.000 | max:    0.100 | avg:    0.025 |
|   querySelectorAll | min:   12.300 | max:   15.500 | avg:   13.875 |
|             remove | min:  508.900 | max:  608.200 | avg:  539.450 |
*/

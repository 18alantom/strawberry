type Complex = object | Function;
type Meta = { __sb_prefix: string; __sb_dependencies?: boolean };
type Reactive<T extends any> = T extends Complex ? T & Meta : never;
type Watcher = (newValue: unknown) => unknown;
type Directive = (
  el: Element, // The element to which the directive has been applied.
  value: unknown, // The updated value.
  key: string, // Period '.' delimited key that points to the value in the global data object.
  isDelete: boolean, // Whether the value was deleted `delete data.prop`.
  parent: Reactive<object>, // The parent object to which the value belongs (actual object not its proxy).
  prop: string // property of the parent which points to the value, `parent[prop] ≈ value`
) => unknown;
type DirectiveMap = Record<string, Directive>;
type BasicAttrs = 'mark' | 'child' | 'if' | 'plc';

const dependencyRegex = /\w+(\??[.]\w+)+/g;

let globalDefer: null | Parameters<typeof ReactivityHandler.callDirectives>[] =
  null;
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
  static dependents: Record<
    string,
    {
      key: string;
      computed: Function;
      parent: Reactive<object>;
      prop: string;
    }[]
  > = {};

  static get(
    target: Reactive<object>,
    prop: string | symbol,
    receiver: unknown
  ): unknown {
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
    value: unknown,
    receiver: unknown
  ): boolean {
    if (typeof prop === 'symbol') {
      return Reflect.set(target, prop, value, receiver);
    }

    const key = getKey(prop, target.__sb_prefix);
    const reactiveValue = reactive(value, key);
    if (typeof value === 'function') {
      this.setDependents(value, key, target, prop);
    }

    const success = Reflect.set(target, prop, reactiveValue, receiver);
    this.update(value, key, false, target, prop);
    this.updateComputed(key);
    return success;
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
    this.update(undefined, key, true, target, prop);
    for (const dep of this.dependents[key] ?? []) {
      this.update(dep.computed, dep.key, false, dep.parent, dep.prop);
    }

    for (const k of Object.keys(this.dependents)) {
      this.dependents[k] =
        this.dependents[k]?.filter((d) => d.key !== key) ?? [];
    }

    return success;
  }

  /**
   * Stores the list of dependencies the computed value is dependent on.
   *
   * @param value function for the computed value
   * @param key period '.' joined key that points to the value in the global reactive data object
   * @param parent object to which `value` belongs (not the proxy of the object). undefined if dependency
   * @param prop property of the parent which points to the value, parent[prop] ≈ value. undefined if dependency
   */
  static setDependents(
    value: Function,
    key: string,
    parent: Reactive<object>,
    prop: string
  ) {
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
      let root = dkey;
      if (root.includes('.')) {
        root = root.slice(0, root.indexOf('.'));
      }

      if (!globalData?.hasOwnProperty(root)) {
        continue;
      }

      this.dependents[dkey] ??= [];
      this.dependents[dkey]!.push({ key, computed: value, parent, prop });
      (value as Reactive<Function>).__sb_dependencies = true;
    }
  }

  /**
   * Called when a computed value's dependent is changed.
   *
   * @param key period '.' separated key to the computed value's dep, used to track the computed value
   */
  static updateComputed(key: string) {
    const dependents = Object.keys(this.dependents)
      .filter(
        (k) => k === key || k.startsWith(key + '.') || key.startsWith(k + '.')
      )
      .flatMap((k) => this.dependents[k] ?? []);

    for (const dep of dependents) {
      this.update(dep.computed, dep.key, false, dep.parent, dep.prop);
    }
  }

  /**
   * `update` calls the watchers and directive functions with the value so that changes
   * to the object can be propagated
   *
   * @param value new value that is set, if deleted then `undefined`
   * @param key period '.' joined key that points to the value in the global reactive data object
   * @param isDelete whether the value is being deleted (only if being called from deleteProperty)
   * @param parent object to which `value` belongs (actual object, not the proxy)
   * @param prop property of the parent which points to the value, `parent[prop] ≈ value`
   */
  static update(
    value: unknown,
    key: string,
    isDelete: boolean,
    parent: Reactive<object>,
    prop: string
  ) {
    if (typeof value === 'function') {
      value = value();
    }

    if (value instanceof Promise) {
      (value as Promise<unknown>).then((v: unknown) =>
        this.update(v, key, false, parent, prop)
      );
      return;
    }

    this.callWatchers(value, key);
    this.callDirectives(value, key, isDelete, parent, prop);
  }

  static callWatchers(value: unknown, key: string) {
    for (const k of Object.keys(this.watchers)) {
      if (key === k) {
        this.watchers[k]?.forEach((cb) => cb(value));
      } else if (key.startsWith(k + '.') && globalData !== null) {
        const value = getValue(k, globalData);
        this.watchers[k]?.forEach((cb) => cb(value));
      }
    }
  }

  static callDirectives(
    value: unknown,
    key: string,
    isDelete: boolean,
    parent: Reactive<object>,
    prop: string
  ) {
    if (globalDefer) {
      globalDefer.push([value, key, isDelete, parent, prop]);
      return;
    }

    const isArray = Array.isArray(parent);
    if (isArray && /\d+/.test(prop)) {
      appendChildNode(parent, prop, value);
    }

    if (isArray && prop === 'length') {
      sortChildNodes(parent);
    }

    for (const attrSuffix in this.directives) {
      const directive = this.directives[attrSuffix]!;
      const els = document.querySelectorAll(
        `[${globalPrefix + attrSuffix}='${key}']`
      );
      els.forEach((el) => directive(el, value, key, isDelete, parent, prop));
    }
  }

  static directives: DirectiveMap = {
    mark,
    if: (el, value, key) => {
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

// @ts-ignore
window.rh = ReactivityHandler;

function mark(el: Element, value: unknown, key: string, isDelete: boolean) {
  if (isDelete) {
    remove(el);
  }

  if (Array.isArray(value)) {
    return array(el, value, key);
  } else if (typeof value === 'object' && value !== null) {
    return object(el, value, key);
  }

  return text(el, value, key);
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

function text(el: Element, value: unknown, key: string) {
  if (el instanceof HTMLElement && value !== undefined) {
    el.innerText = `${value}`;
  }
  el.setAttribute(attr('mark'), key);
}

function array(el: Element, value: unknown[], key: string) {
  const childTag = el.getAttribute(attr('child'));
  if (!childTag) {
    console.warn('marked el with array value has no child', value, el, key);
    return;
  }

  const children = value.map((item, i) =>
    getChild(childTag, getKey(String(i), key), item)
  );

  el.setAttribute(attr('mark'), key);
  el.replaceChildren(...children);
}

function appendChildNode(
  target: Reactive<unknown[]>,
  prop: string,
  value: unknown
) {
  /**
   * Called only when an array element is updated,
   * i.e. prop is a digit, such as when push, splice, etc are called.
   *
   * When an item is pushed to an Array, the DOM element that maps to that
   * item does not exist.
   *
   * This function appends a child for the pushed item.
   */
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

function sortChildNodes(target: Reactive<unknown[]>) {
  /**
   * Called only when length prop of an array is set.
   *
   * Length is the last property to be set after an array shape
   * has been altered by using methods such as push, splice, etc.
   *
   * This sorts the DOM nodes to match the data array since updates
   * (get, set sequence) don't always happen in the right order such
   * when using splice. So the sorting must take place after the update.
   */
  const prefix = target.__sb_prefix;
  const els = document.querySelectorAll(`[${attr('mark')}="${prefix}"]`);
  for (const el of els) {
    const children = [...el.children];
    children
      .sort((a, b) => {
        const am = a.getAttribute(attr('mark'));
        const bm = b.getAttribute(attr('mark'));
        if (!am || !bm) {
          return 0;
        }

        const ams = am.split('.');
        const bms = bm.split('.');

        const amIdx = +(ams[ams.length - 1] ?? 0);
        const bmIdx = +(bms[bms.length - 1] ?? 0);

        return amIdx - bmIdx;
      })
      .forEach((ch) => el.appendChild(ch));
  }
}

function object(el: Element, value: object, key: string) {
  const childTag = el.getAttribute(attr('child'));
  if (!childTag) {
    return setSlots(el, key, value);
  }

  const child = getChild(childTag, key, value);
  child.setAttribute(attr('mark'), key);
  el.replaceWith(child);
}

function getChild(tag: string, prefix: string, value: unknown): HTMLElement {
  const el = document.createElement(tag);
  setSlots(el, prefix, value);
  return el;
}

function setSlots(el: Element, prefix: string, value: unknown): void {
  const slots = el.shadowRoot?.querySelectorAll('slot');
  if (!slots?.length) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      value = undefined;
    }

    return mark(el, value, prefix, false);
  }

  el.replaceChildren();
  for (const slot of slots) {
    const childTag = slot.getAttribute(attr('child'));
    const childEl = document.createElement(childTag ?? 'span');

    let childVal = value;
    let childKey = prefix;

    const sname = slot.getAttribute('name');
    if (sname) {
      childVal = (value as Record<string, unknown>)?.[sname];
      childKey = getKey(sname, prefix);
      childEl.setAttribute('slot', sname);
    }

    if (!childTag) {
      childEl.setAttribute(attr('plc'), '1');
    }

    mark(childEl, childVal, childKey, false);
    el.appendChild(childEl);
  }
  el.setAttribute(attr('mark'), prefix);
}

function getKey(prop: string, prefix: string) {
  return prefix === '' ? prop : prefix + '.' + prop;
}

function getValue(key: string, value: unknown) {
  for (const k of key.split('.')) {
    const tval = typeof value;
    if (value === null || (tval !== 'function' && tval !== 'object')) {
      return undefined;
    }

    value = Reflect.get(value as object, k);
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

/**
 * Initializes strawberry and returns the reactive data object.
 */
export function init(config?: { prefix?: string; directives?: DirectiveMap }) {
  globalData ??= reactive({}, '') as {} & Meta;
  globalPrefix = config?.prefix ?? globalPrefix;

  if (
    document.currentScript?.parentElement instanceof HTMLHeadElement &&
    document.readyState === 'loading' &&
    globalDefer === null
  ) {
    globalDefer = [];
  }

  if (config?.directives) {
    ReactivityHandler.directives = {
      ...ReactivityHandler.directives,
      ...config.directives,
    };
  }

  registerTemplates();
  document.addEventListener('readystatechange', readyStateChangeHandler);
  document.addEventListener('DOMContentLoaded', executeDefered);

  return globalData;
}

function readyStateChangeHandler() {
  if (document.readyState === 'interactive') {
    registerTemplates();
  }
}

export function executeDefered() {
  const deferQueue = globalDefer ?? [];
  globalDefer = null; // Needs to be set before calling directives else recursion
  deferQueue.forEach((params) => ReactivityHandler.callDirectives(...params));
}

/**
 * Loads templates from external files. Relative paths
 * should be provided for loading.
 */
export async function load(files: string | string[]) {
  if (typeof files === 'string') {
    files = [files];
  }

  for (const file of files) {
    const html = await fetch(file)
      .then((r) => r.text())
      .catch((e) => console.error(e));
    if (typeof html !== 'string') {
      continue;
    }

    register(html);
  }
}

/**
 * Registers templates. It can be used to register custom components during
 * runtime, i.e. after DOM has loaded. Else `sb.init` and `sb.load` should be
 * sufficient.
 *
 * `sb.load` calls this to register templates after fetching them. It can be used
 * in few different ways.
 *
 * 1. Without any passing args.
 *    ```javascript
 *       sb.register();
 *    ```
 *    This will register all the elements in html document if they haven't been registered
 *
 * 2. Passing the root element that contains the templates
 *    ```javascript
 *       sb.register(rootElement);
 *    ````
 *    This will register all the templates found inside the root element.
 *
 * 3. Using it as a tag function:
 *    ```javascript
 *       sb.register`
 *         <template name="colored-p">
 *           <p style="font-family: sans-serif; color: ${color};">
 *             <slot />
 *           </p>
 *         </template>`;
 *    ```
 *    This allows for dynamically creating templates with interpolated
 *    values and expressions.
 *
 * 4. Passing it the template as a string. Functionally, it is the same
 *    as using it as a tagged function
 *    ```javascript
 *       sb.register(`<template name="colored-p">
 *           <p style="font-family: sans-serif; color: ${color};">
 *             <slot />
 *           </p>
 *         </template>`);
 *    ```
 */

export function register(root: string[], ...args: unknown[]): void;
export function register(root: HTMLElement): void;
export function register(template: string): void;
export function register(
  root?: string | HTMLElement | string[],
  ...args: unknown[]
): void {
  if (Array.isArray(root)) {
    root = stitchTemplate(root, ...args);
  }

  if (typeof root === 'string') {
    root = wrapInDiv(root);
  }

  registerTemplates(root);
}

function registerTemplates(rootElement?: HTMLElement) {
  let root = rootElement ?? document;
  for (const template of root.getElementsByTagName('template')) {
    registerComponent(template);
  }
}

function stitchTemplate(arr: string[], ...args: unknown[]): string {
  let stitched: string = arr[0] ?? '';
  for (let i = 1, length = arr.length; i < length; i++) {
    stitched += args[i - 1];
    stitched += arr[i];
  }
  return stitched;
}

function wrapInDiv(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function registerComponent(template: HTMLTemplateElement) {
  const name = template.getAttribute('name')?.toLowerCase();
  if (!name || !!customElements.get(name)) {
    return;
  }

  const constructor = class extends HTMLElement {
    constructor() {
      super();
      const shadowRoot = this.attachShadow({ mode: 'open' });
      for (const ch of template.content.children) {
        if (!ch) {
          continue;
        }

        shadowRoot.appendChild(ch.cloneNode(true));
      }
    }
  };

  customElements.define(name, constructor);
}

/**
 * Sets watchers for a given key. Key is a dot separated string
 * for a value in side the reactive data object.
 *
 * For example:
 *
 * ```javascript
 * data = {
 *   a: {
 *     b: [
 *       'value',
 *     ]
 *   }
 * }
 * ```
 *
 * For example to the key to watch changes to the string 'value'
 * would be `a.b.0`.
 *
 * Watcher is a function that receives the newValue that is set.
 * watchers should not alter the reactive data object. If a dependent
 * value is required then a `computed` value should be used.
 */
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

# Scratch Space

TODO:
- [ ] Buffer updates during load
- [?] Change use of Records to Map (execution order of watchers, directives, computed)
- [ ] Cache computed?
- [ ] Check array changes: shift, unshift, reverse
- [ ] cannot redefine property __sb_prefix
- [ ] sync[node]: refresh UI, such as after page load
- [ ] walk sub-trees and cross check values and marks
- [ ] Initialization: values are set after page loads
- [ ] Update Subtree after display
- [ ] Sync newly inserted nodes with other directives
- [ ] Review the code, take note of implementation and hacks
- [^] Cache el references? (might not be required, 10ms for 1_000_000 divs querySelectorAll)
- [x] Remove the need for `sb.register`
- [x] Update sb register so that this can be done:
     ```
      - [x] sb.register`<template name="new-p"><p><slot/></p></template>`;
      - [x] sb.register(`<template name="new-p"><p><slot/></p></template>`);
      - [x] sb.register('new-p', `<p><slot/></p>`);
     ```

Priority
- [x] Sync Tree
- [ ] Buffer DOM Updates when loading using a Defer Queue.
- [ ] Nested lists.
- [ ] Check Speed:
  - [ ] Cache Computed values until dependencies update.
  - [ ] Cache Element refereneces.

Ideally one should be able to init strawberry in the head element
set properties to `data.prop = value` in script tags in the 
loading readyState

For DOMUpdates if readyState is loading then updates to the dom
can be pushed to the defer queue and then flushed when ready state changes
to interactive

And this all should be set using DOMContentLoaded.
  

  
How to Handle Nested Lists or Nested Objects?

One solution is, instead of mentioning sb-child for the child, such as this:
```html
  <div sb-mark="list" sb-child="plum-p"></div>
```
Keep the child inside the element

```html
  <div sb-mark="list">
    <plum-p></plum-p>
  </div>
``` 
Maybe add an sb-child to explicitly mark the the element as a child.

```html
  <div sb-mark="list">
    <plum-p sb-child></plum-p>
  </div>
``` 

# Notes

TODO: Move these elsewhere maybe

## UI Update Defer

If `sb.init` is called inside the head element. Then all directive execution
is deferred, i.e. all UI updates such as when an RDO prop is set and the appropriate
UI is updated is deferred.
  
These are then executed when the DOM content loads, i.e. on DOMContentLoaded.

```html
<!-- This P will be set. -->
<p sb-mark="message"></p>
<script>
  data.message = "Hello, World!"
</script>


<!-- This P will be set only if `sb.init` is called inside head. -->
<p sb-mark="message"></p>
```

If the `sb.init` is not placed in the head tag then all directives are executed
immediately. In such a case it is better to place the setting of the RDO values after
the `body` tag so that the appropriate elements are found.


## The Reactive Data Object

The value received when `sb.init` is the reactive data object.

```javascript
const data = sb.init();
```
Think of this as an object that holds data that is meant to be
rendered. You can set any kind of value to this object, but Strawberry
listens to changes to only the following type of objects

## Handling of Computed

Dependencies of a computed function are checked by converting the
function into a string and searching for '.' or '?.' separated values.

A variable in computed is considered as a dependency only if it has been
defined before setting the computed.

This is incorrect:
```javascript
data.b = () => data.a + 10;
data.a = 10;
```

This is correct:
```javascript
data.a = 10;
data.b = () => data.a + 10;
```

## HTMLTemplateElement based Components

Components use the ShadowDOM, regular DOM based components are not used
because:

1. They don't work as expected.
2. They don't provide encapsulation.

### Registration

Components are auto registered twice:
1. Immediately when `sb.init` is called. This will register all the templates 
   defined before the script tag containing `sb.init` but not after.
2. After document has been loaded, i.e. when `readyState` changes to "interactive"
   this will load all of the components defined in the html file.
     
External components can be registered using `sb.load`, example:

```javascript
sb.load('templates.html');
```

or to load multiple templates:

```javascript
sb.load(['templates-one.html', 'templates-two.html]);
```

Externally definied components are loaded async, so if you want to run code after
the external components have been definied you can run it in a module script tag.


```html
<script type="module">
  await sb.load('templates.html');
</script>
```

**Note**: script tags inside externally definied templates will not be executed.
This is a security detail.

### Styling

Template based components grant encasulation on styling:
```html 
<template name="blue-h1">
  <h1><slot /></h1>
  <style>
    h1 {
      color: blue;
    }
  </style>
</template>
```

In the above html, the style element is scoped only to the component `<blue-h1>`
and this styling is not applied to other regular `<h1>` elements outside the
template.

### Script

Scripts inside a template execute in the global context by default. 

```html 
<template name="blue-h1">
  <h1 style="color: blue"><slot /></h1>
  <script>
    console.log('Hello, World!');
  </script>
</template>
```

Execution takes place when the component is being rendered. For example when
the following HTML is encountered by the parser:
  
```html
<blue-h1>Hello, World!</blue-h1>
```
 
The script is **not** executed whent the `<template>` HTML is parsed or
when the component is registered.


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

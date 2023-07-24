const sbPrefix = Symbol('@sb/prefix');

type Complex = object | Function;
type Prefixed<T extends any> = T extends Complex ? T & Meta : never;
type Meta = { [sbPrefix]: string };
type Watcher = (newValue: unknown) => unknown;
type DirectiveParams = {
  el: Element; // The element to which the directive has been applied.
  value: unknown; // The updated value.
  key: string; // Period '.' delimited key that points to the value in the global data object.
  isDelete: boolean; // Whether the value was deleted `delete data.prop`.
  parent: Prefixed<object>; // The parent object to which the value belongs (the proxied object, unless isDelete).
  prop: string; // Property of the parent which points to the value, `parent[prop] ≈ value`
  param: string | undefined; // If directive is a parametric directive, `param` is passed
};
type Directive = (params: DirectiveParams) => void;
type BasicAttrs = 'mark' | 'if' | 'ifnot';
type ComputedList = {
  key: string;
  computed: Prefixed<Function>;
  parent: Prefixed<object>;
  prop: string;
}[];

type SyncConfig = {
  directive: string;
  el: Element;
  skipConditionals?: boolean | undefined;
  skipMark?: boolean | undefined;
};

const DONT_CALL = Symbol('@sb/dontcall');

let globalData: null | Prefixed<{}> = null;
let globalPrefix = 'sb-';
const globalWatchers = new Map<string, Watcher[]>();
const globalDirectives = new Map<
  string,
  { cb: Directive; isParametric?: boolean }
>([
  [
    'mark',
    {
      cb: ({ el, value, isDelete }) => {
        if (isDelete) {
          return remove(el);
        }

        if (!(el instanceof HTMLElement)) {
          return;
        }

        if (typeof value === 'object' && value !== null) {
          value = JSON.stringify(value);
        }

        const stringValue = typeof value === 'string' ? value : String(value);
        el.innerText = stringValue;
      },
    },
  ],
  ['if', { cb: ({ el, value, key }) => ifOrIfNot(el, value, key, 'if') }],
  ['ifnot', { cb: ({ el, value, key }) => ifOrIfNot(el, value, key, 'ifnot') }],
]);

/**
 * Object used to maintain computed values
 * - `isEvaluating`: set to true when evaluating a computed function
 * - `set`: used to keep track of dependencies when evaluating a computed function
 * - `map`: keeps track of dependencies keyed by dependents
 */
const globalDeps = {
  isEvaluating: false,
  set: new Set<string>(),
  map: new Map<string, ComputedList>(),
};

const attr = (k: BasicAttrs) => globalPrefix + k;

function reactive<T>(
  obj: T,
  prefix: string,
  parent?: Prefixed<object>,
  prop?: string
): T | Prefixed<T> {
  if (obj === null) {
    return obj;
  }

  const isObject = typeof obj === 'object';
  const isFunction = typeof obj === 'function';
  if (isFunction && parent) {
    obj = (obj as Function).bind(parent);
  }

  if (isObject || isFunction) {
    Object.defineProperty(obj, sbPrefix, {
      value: prefix,
      enumerable: false,
      writable: true,
    });
  }

  if (isFunction && prop && parent) {
    setDependents(obj as Prefixed<Function>, prefix, parent, prop);
    return obj;
  }

  if (!isObject) {
    return obj;
  }

  type K = keyof T;
  const proxied = new Proxy(obj as object, ReactivityHandler) as Prefixed<T>;
  for (const prop of Object.keys(obj as object)) {
    const newprefix = getKey(prop, prefix);
    const value = obj[prop as K];
    obj[prop as K] = reactive(value, newprefix, proxied, prop);
  }

  return proxied;
}

class ReactivityHandler implements ProxyHandler<Prefixed<object>> {
  static get(
    target: Prefixed<object>,
    prop: string | symbol,
    receiver: Prefixed<object>
  ): unknown {
    if (
      globalDeps.isEvaluating &&
      typeof prop === 'string' &&
      Object.getOwnPropertyDescriptor(target, prop)?.enumerable
    ) {
      globalDeps.set.add(getKey(prop, target[sbPrefix]));
    }

    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function' && value[sbPrefix]) {
      const computed = value();
      if (computed instanceof Promise) {
        return computed.then((v) => proxyComputed(v));
      }
      return proxyComputed(computed);
    }

    return value;
  }

  static set(
    target: Prefixed<object>,
    prop: string | symbol,
    value: unknown,
    receiver: Prefixed<object>
  ): boolean {
    if (typeof prop === 'symbol') {
      return Reflect.set(target, prop, value, receiver);
    }

    const key = getKey(prop, target[sbPrefix]);
    const reactiveValue = reactive(value, key, receiver, prop);
    const success = Reflect.set(target, prop, reactiveValue, receiver);
    this.update(reactiveValue, key, false, receiver, prop);
    this.updateComputed(key);
    return success;
  }

  static deleteProperty(
    target: Prefixed<object>,
    prop: string | symbol
  ): boolean {
    if (typeof prop === 'symbol') {
      return Reflect.deleteProperty(target, prop);
    }

    const key = getKey(prop, target[sbPrefix]);
    const success = Reflect.deleteProperty(target, prop);
    this.update(undefined, key, true, target, prop);

    globalDeps.map.delete(key);
    for (const k of globalDeps.map.keys()) {
      const filtered =
        globalDeps.map.get(k)?.filter((d) => d.key !== key) ?? [];
      globalDeps.map.set(k, filtered);
    }

    return success;
  }

  static defineProperty(
    target: Prefixed<object>,
    prop: string | symbol,
    descriptor: PropertyDescriptor
  ): boolean {
    if (
      prop === sbPrefix &&
      sbPrefix in target &&
      /\.\d+$/.test(descriptor.value)
    ) {
      return Reflect.set(target, prop, descriptor.value);
    }

    return Reflect.defineProperty(target, prop, descriptor);
  }

  /**
   * Called when a computed value's dependent is changed.
   *
   * @param key period '.' separated key to the computed value's dep, used to track the computed value
   */
  static updateComputed(key: string) {
    const dependentNames = [...globalDeps.map.keys()]
      .filter(
        (k) => k === key || k.startsWith(key + '.') || key.startsWith(k + '.')
      )
      .flatMap((k) => globalDeps.map.get(k) ?? []);

    const executed = new Set<Function>();
    for (const dep of dependentNames) {
      if (executed.has(dep.computed)) {
        continue;
      }

      this.update(dep.computed, dep.key, false, dep.parent, dep.prop);
      executed.add(dep.computed);
    }
  }

  /**
   * `update` calls the watchers and directive functions with the value so that changes
   * to the object can be propagated
   *
   * @param value new value that is set, if deleted then `undefined`
   * @param key period '.' joined key that points to the value in the global reactive object
   * @param isDelete whether the value is being deleted (only if being called from deleteProperty)
   * @param parent object to which `value` belongs (actual object, not the proxy)
   * @param prop property of the parent which points to the value, `parent[prop] ≈ value`
   * @param syncConfig object used to sync a single node on insertion from if | ifnot
   */
  static update(
    value: unknown,
    key: string,
    isDelete: boolean,
    parent: Prefixed<object>,
    prop: string,
    syncConfig?: SyncConfig
  ) {
    if (typeof value === 'function' && !value.hasOwnProperty(DONT_CALL)) {
      value = runComputed(value, key, parent, prop);
    }

    if (value instanceof Promise) {
      (value as Promise<unknown>).then((v: unknown) =>
        this.update(v, key, false, parent, prop, syncConfig)
      );
      return;
    }

    if (!syncConfig) {
      this.callWatchers(value, key);
    }
    this.callDirectives(
      value,
      key,
      isDelete,
      parent,
      prop,
      undefined,
      undefined,
      syncConfig
    );
  }

  static callWatchers(value: unknown, key: string) {
    for (const k of globalWatchers.keys()) {
      if (key === k) {
        globalWatchers.get(k)?.forEach((cb) => cb(value));
      } else if (key.startsWith(k + '.') && globalData !== null) {
        const { value } = getValue(k);
        globalWatchers.get(k)?.forEach((cb) => cb(value));
      }
    }
  }

  static callDirectives(
    value: unknown,
    key: string,
    isDelete: boolean,
    parent: Prefixed<object>,
    prop: string,
    searchRoot?: Element | Document,
    skipUpdateArrayElements?: boolean,
    syncConfig?: SyncConfig
  ): void {
    const isParentArray = Array.isArray(parent);
    if (
      isParentArray &&
      /^\d+$/.test(prop) &&
      !skipUpdateArrayElements &&
      syncConfig?.skipMark !== true
    ) {
      updateArrayItemElement(key, prop, value, parent);
    } else if (isParentArray && prop === 'length') {
      sortArrayItemElements(parent);
    }

    const isRDO = isPrefixedObject(value);
    if (isRDO && Array.isArray(value) && syncConfig?.skipMark !== true) {
      const placeholderKey = `${key}.#`;
      const rootQuery = `[${attr('mark')}="${placeholderKey}"]`;
      const elsArray: Element[][] = [];

      /**
       * if skipMark is not true and el is present
       * the node being synced has not yet been inserted
       * into the DOM, i.e. isConnected=false hence
       * query selector must run on the parent.
       */
      let target: Document | Element = document;
      if (syncConfig?.el.parentElement) {
        target = syncConfig.el.parentElement;
      }

      for (const plc of target.querySelectorAll(rootQuery)) {
        const els = initializeArrayElements(plc, placeholderKey, value);
        elsArray.push(els);
      }

      /**
       * Set values to the newly initialized elements
       */
      for (const els of elsArray) {
        for (const i in value) {
          this.callDirectives(
            value[i],
            getKey(i, key),
            isDelete,
            value,
            i,
            els[i],
            true
          );
        }
      }
    } else if (isRDO) {
      for (const k in value) {
        this.callDirectives(
          value[k as unknown as keyof typeof value],
          getKey(k, key),
          isDelete,
          value,
          k,
          searchRoot
        );
      }
    }

    if (isRDO) {
      return;
    }

    if (syncConfig) {
      const { el, directive: attrSuffix } = syncConfig;
      const { cb, isParametric } = globalDirectives.get(attrSuffix) ?? {};
      const param = getParam(el, globalPrefix + attrSuffix, !!isParametric);
      cb?.({ el: el, value, key, isDelete, parent, prop, param });
      return;
    }

    searchRoot ??= document;
    for (const [attrSuffix, directive] of globalDirectives.entries()) {
      const { cb, isParametric } = directive;
      const attrName = globalPrefix + attrSuffix;
      let query: string;
      if (isParametric) {
        query = `[${attrName}^='${key}:']`;
      } else {
        query = `[${attrName}='${key}']`;
      }

      searchRoot.querySelectorAll(query).forEach((el) => {
        const param = getParam(el, attrName, !!isParametric);
        cb({ el, value, key, isDelete, parent, prop, param });
      });

      if (
        searchRoot instanceof Element &&
        searchRoot.getAttribute(attrName) === key
      ) {
        const param = getParam(searchRoot, attrName, !!isParametric);
        cb({ el: searchRoot, value, key, isDelete, parent, prop, param });
      }
    }
  }
}

function ifOrIfNot(
  el: Element,
  value: unknown,
  key: string,
  type: 'if' | 'ifnot'
) {
  const isShow = type === 'if' ? !!value : !value;
  const isTemplate = el instanceof HTMLTemplateElement;

  if (isShow && isTemplate) {
    const child = el.content.firstElementChild;
    if (!child) {
      return;
    }

    child.setAttribute(attr(type), key);
    syncNode(child, true);
    el.replaceWith(child);
  }

  if (!isShow && !isTemplate) {
    const temp = document.createElement('template');
    temp.content.appendChild(el.cloneNode(true));
    temp.setAttribute(attr(type), key);
    const mark = el.getAttribute(attr('mark'));
    if (mark) {
      temp.setAttribute(attr('mark'), mark);
    }
    el.replaceWith(temp);
  }
}

/**
 * Called from conditionals when it evaluates to true and an elemen
 * is inserted into the DOM. Function calls `update` with `syncConfig`
 * to trigger only the directives found on the node being synced.
 * @param el Element to be synced
 * @param isSyncRoot Whether `el` is the root node from where the sync begins
 */
function syncNode(el: Element, isSyncRoot: boolean) {
  for (const ch of el.children) {
    syncNode(ch, false);
  }

  syncDirectives(el, isSyncRoot);
}

function syncClone(clone: Element) {
  for (const ch of clone.children) {
    syncClone(ch);
  }

  syncDirectives(clone, false, true);
}

function syncDirectives(
  el: Element,
  skipConditionals?: boolean,
  skipMark?: boolean
) {
  for (const [name, { isParametric }] of globalDirectives.entries()) {
    if (
      (skipMark && name === 'mark') ||
      (skipConditionals && (name === 'if' || name === 'ifnot'))
    ) {
      continue;
    }

    let key = el.getAttribute(globalPrefix + name);
    if (isParametric) {
      key = key?.split(':')[0] ?? null;
    }

    if (key?.endsWith('.#')) {
      key = key.slice(0, -2);
    }

    if (key === null) {
      continue;
    }

    const { value, parent, prop } = getValue(key);
    if (!parent) {
      continue;
    }

    ReactivityHandler.update(value, key, false, parent, prop, {
      directive: name,
      el,
      skipConditionals,
      skipMark,
    });
  }
}

/**
 * Stores the list of dependencies the computed value is dependent on.
 *
 * @param value function for the computed value
 * @param key period '.' joined key that points to the value in the global reactive object
 * @param parent object to which `value` belongs (not the proxy of the object). undefined if dependency
 * @param prop property of the parent which points to the value, parent[prop] ≈ value. undefined if dependency
 */
function setDependents(
  value: Prefixed<Function>,
  key: string,
  parent: Prefixed<object>,
  prop: string
) {
  /**
   * Capture dependencies in `globalDeps.set`. The set is updated
   * in the `get` trap of the proxy.
   */
  globalDeps.isEvaluating = true;
  globalDeps.set.clear();
  value();
  globalDeps.isEvaluating = false;

  const dependent = {
    key,
    computed: value,
    parent,
    prop,
  };

  for (const dep of globalDeps.set) {
    const computedList = globalDeps.map.get(dep) ?? [];
    computedList.push(dependent);
    if (!globalDeps.map.has(dep)) {
      globalDeps.map.set(dep, computedList);
    }
  }
}

/**
 * @param key prefixed key (eg: "list.3")
 * @param idx index of the newly pushed element (eg: "3")
 * @param item array[idx] to prevent repeat get
 * @param array array into which the value is pushed
 */
function updateArrayItemElement(
  key: string,
  idx: string,
  item: unknown,
  array: Prefixed<unknown[]>
) {
  /**
   * Called only when an array element is updated,
   * i.e. prop is a digit, such as when push, splice, etc are called.
   *
   * When an item is pushed to an Array, the DOM element that maps to that
   * item does not exist.
   *
   * This function inserts the child element before the template.
   */
  const arrayItems = document.querySelectorAll(`[${attr('mark')}="${key}"]`);
  if (arrayItems.length && !isPrefixedObject(item)) {
    /**
     * For primitive items just updating the innerText
     * suffices, no need to replace the element.
     */
    return;
  }

  const prefix = array[sbPrefix];
  const placeholderKey = key.replace(/\d+$/, '#');
  let itemReplaced: boolean = false;

  /**
   * Loop runs if the array item already exists, so if a value is
   * "pushed" into an array, this won't update the element array
   * because the array item doesn't already exist.
   */
  for (const item of arrayItems) {
    let placeholder = item.nextElementSibling;
    while (placeholder) {
      if (placeholder.getAttribute(attr('mark')) === placeholderKey) {
        break;
      }
      placeholder = placeholder.nextElementSibling;
    }

    let clone: Node | null | undefined;
    if (placeholder instanceof HTMLTemplateElement) {
      clone = placeholder.content.firstElementChild?.cloneNode(true);
    } else if (placeholder?.getAttribute(attr('mark')) === placeholderKey) {
      /**
       * possible no-op: unconcealed placeholder should not exist
       * if the array had elements when the outer function was called
       */
      clone = placeholder?.cloneNode(true);
    } else {
      continue;
    }

    if (!(clone instanceof Element)) {
      continue;
    }

    initializeClone(idx, prefix, placeholderKey, clone);
    item.replaceWith(clone);
    syncClone(clone);
    itemReplaced ||= true;
  }

  if (itemReplaced) {
    return;
  }

  const templates = document.querySelectorAll(
    `[${attr('mark')}="${placeholderKey}"]`
  );

  for (const template of templates) {
    if (!(template instanceof HTMLTemplateElement)) {
      continue;
    }

    const clone = template.content.firstElementChild?.cloneNode(true);
    if (!(clone instanceof Element)) {
      continue;
    }

    initializeClone(idx, prefix, placeholderKey, clone);
    template.before(clone);
    syncClone(clone);
  }
}

function sortArrayItemElements(array: Prefixed<unknown[]>): void {
  /**
   * Called only when length prop of an array is set.
   *
   * Length is the last property to be set after an array shape
   * has been altered by using methods such as push, splice, etc.
   *
   * This sorts the DOM nodes to match the data array since updates
   * (get, set sequence) don't always happen in the right order such as
   * when using splice. So sorting must take place after the update.
   */
  const templateKey = getKey('#', array[sbPrefix]);
  const templates = document.querySelectorAll(
    `[${attr('mark')}="${templateKey}"]`
  );

  for (const template of templates) {
    const items: Element[] = [];

    /**
     * populate the items array with item elements
     * items array is populated in the reverse order
     */
    let prev = template.previousElementSibling;
    let isSorted = true;
    let lastIdx: number = -1;
    while (prev) {
      const curr = prev;
      prev = curr.previousElementSibling;

      const key = curr?.getAttribute(attr('mark'));
      if (!key) {
        continue;
      }

      if (key === templateKey) {
        break;
      }

      if (key.replace(/\d+$/, '#') === templateKey) {
        items.push(curr);
        if (!isSorted) {
          continue;
        }

        const idx = Number(key.slice(key.lastIndexOf('.') + 1) ?? -1);
        if (lastIdx !== -1 && lastIdx !== idx + 1) {
          isSorted = false;
        }
        lastIdx = idx;
      }
    }

    if (isSorted) {
      return;
    }

    /**
     * reverse the unsorted array to get it in the same order
     * as the DOM, and create a sortedArray.
     */
    const sortedItems = [...items].sort((a, b) => {
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
    });

    /**
     * Replace the unsorted items by the sorted items.
     */
    sortedItems.forEach((item) => template.before(item));
  }
}

function initializeArrayElements(
  plc: Element,
  placeholderKey: string,
  array: unknown[]
): Element[] {
  /**
   * 1. Delete Previous Array Elements
   *
   * When a new list is set previous list item elements should be
   * deleted. Empty list deletes all items, but keeps the placeholder.
   *
   * When a array is updated a child element is prepended before the
   * placeholder element.
   */
  let prev = plc.previousElementSibling;
  while (prev) {
    const curr = prev;
    prev = curr.previousElementSibling;

    const key = curr?.getAttribute(attr('mark'));
    if (!key) {
      continue;
    }

    if (key !== placeholderKey && key.replace(/\d+$/, '#') === placeholderKey) {
      curr?.remove();
    } else {
      break;
    }
  }

  /**
   * 2. Get Placeholder and Template from `plc`
   *
   * `plc` can be either a concealed element,
   * i.e. the `template`:
   * ```html
   * <template sb-mark="list.#">
   *   <!-- ONLY one child -->
   *   <li></li>
   * </template>
   * ```
   * Or a rendered element, i.e. the `placeholder`:
   * ```html
   * <li sb-mark="list.#">zero</li>
   * ```
   *
   * `template` is maintained at the end of a list
   * of elements and contains the `placeholder`.
   *
   * `placeholder` is cloned to create list elements.
   */
  let template: HTMLTemplateElement;
  let placeholder: Element | null;
  if (plc instanceof HTMLTemplateElement) {
    template = plc;
    placeholder = plc.content.firstElementChild;
    placeholder?.setAttribute(attr('mark'), placeholderKey);
  } else {
    placeholder = plc;
    template = document.createElement('template');
    template.content.appendChild(plc.cloneNode(true));
    template.setAttribute(attr('mark'), placeholderKey);
    plc.replaceWith(template);
  }

  if (placeholder === null) {
    console.warn(`empty template found for ${placeholderKey}`);
    return [];
  }

  /**
   * For each array item, insert a child element before the
   * template
   */
  const prefix = placeholderKey.slice(0, -2); // remove '.#' loop indicator
  const arrayElements: Element[] = [];
  for (const idx in array) {
    if (Number.isNaN(+idx)) {
      continue;
    }

    const clone = placeholder.cloneNode(true);
    if (!(clone instanceof Element)) {
      continue;
    }

    initializeClone(idx, prefix, placeholderKey, clone);
    template.before(clone);
    syncClone(clone);
    arrayElements.push(clone);
  }

  return arrayElements;
}

/**
 * @param idx index of `item` in `array` eg: "0"
 * @param prefix item element key prefix i.e. placholder key without ".#"
 * @param placeholderKey key set on the placeholder element eg: "list.#"
 * @param clone clone of the placeholder item
 */
function initializeClone(
  idx: string,
  prefix: string,
  placeholderKey: string,
  clone: Element
): void {
  const key = getKey(idx, prefix);

  /**
   * Change directive keys from placeholder keys
   * eg `"users.#.name"` to actual keys eg `"users.0.name"`
   */
  for (const attrSuffix of globalDirectives.keys()) {
    const attrName = globalPrefix + attrSuffix;
    /**
     * Change clone's directive keys
     */
    setKey(clone, attrName, key, placeholderKey);

    /**
     * Change clone's children's directive keys
     */
    clone.querySelectorAll(`[${attrName}]`).forEach((ch) => {
      setKey(ch, attrName, key, placeholderKey);
    });
  }
}

function setKey(
  el: Element,
  attrName: string,
  key: string,
  placeholderKey: string
) {
  const pkey = el.getAttribute(attrName);
  if (pkey?.startsWith(placeholderKey)) {
    const newPkey = key + pkey.slice(placeholderKey.length);
    el.setAttribute(attrName, newPkey);
  }
}

function remove(el: Element) {
  const parent = el.parentElement;

  if (!(el instanceof HTMLElement) || !parent) {
    return el.remove();
  }

  if (el.getAttribute(attr('mark')) === parent.getAttribute(attr('mark'))) {
    return parent.remove();
  }

  el.remove();
}

function isPrefixedObject(value: unknown): value is Prefixed<object> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return sbPrefix in value;
}

function getKey(prop: string, prefix: string) {
  return prefix === '' ? prop : prefix + '.' + prop;
}

function getParam(el: Element, attrName: string, isParametric: boolean) {
  let value;
  if (!isParametric || !(value = el.getAttribute(attrName))) {
    return undefined;
  }

  return value.slice(value.indexOf(':') + 1);
}

/**
 * Function gets a value from the `globalData` object when passed a '.' separated
 * key. Also returns the `parent` object containing the `value` and the `prop` of
 * the value in the parent object.
 *
 * @param key period '.' separated key to a value in the reactive `globalData`
 */
function getValue(key: string) {
  let parent = globalData;
  let value: unknown = undefined;
  let prop: string = '';

  if (parent === null) {
    return { parent, value, prop };
  }

  const parts = key.split('.').reverse();
  while (parts.length) {
    prop = parts.pop() ?? '';
    value = Reflect.get(parent, prop);
    if (!parts.length || typeof value !== 'object' || value === null) {
      break;
    } else {
      parent = value as Prefixed<object>;
    }
  }

  return { parent, value, prop };
}

function runComputed(
  computed: Function,
  key: string,
  parent: Prefixed<object>,
  prop: string
) {
  const value = computed();
  if (value instanceof Promise) {
    return value.then((v) => proxyComputed(v, key, parent, prop));
  }

  return proxyComputed(value, key, parent, prop);
}

function proxyComputed(
  value: any,
  key?: string,
  parent?: Prefixed<object>,
  prop?: string
) {
  if (typeof value === 'function') {
    value[DONT_CALL] = true;
    return value;
  }

  if (key === undefined || parent === undefined || prop === undefined) {
    return clone(value);
  }

  return reactive(clone(value), key, parent, prop);
}

function clone<T>(target: T): T {
  if (typeof target !== 'object' || target === null) {
    return target;
  }

  const cl = Array.isArray(target) ? [] : {};
  for (const key in target) {
    // @ts-ignore
    cl[key] = clone(target[key]);
  }

  return cl as T;
}

/**
 * External API Code
 */

/**
 * Used to override the global prefix value.
 * @param value string value for the prefix eg: 'data-sb'
 */
export function prefix(value: string = 'sb'): void {
  if (!value.endsWith('-')) {
    value = value + '-';
  }
  globalPrefix = value;
}

/**
 * Used to register a directive.
 * @param name name of the directive
 * @param cb the directive callback
 * @param isParametric whether the directive is a parametric directive
 */
export function directive(
  name: string,
  cb: Directive,
  isParametric: boolean = false
): void {
  if (!globalDirectives.has(name)) {
    globalDirectives.set(name, { cb, isParametric });
  }
}

/**
 * Initializes strawberry and returns the reactive object.
 */
export function init(): Meta {
  globalData ??= reactive({}, '') as {} & Meta;

  registerTemplates();
  document.addEventListener('readystatechange', readyStateChangeHandler);

  return globalData;
}

function readyStateChangeHandler() {
  if (document.readyState === 'interactive') {
    registerTemplates();
  }
}

/**
 * Loads templates from external files. Relative paths
 * should be provided for loading.
 */
export async function load(files: string | string[]): Promise<void> {
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
  for (let i = 1; i < arr.length; i++) {
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
      for (const style of document.getElementsByTagName('style')) {
        shadowRoot.appendChild(style.cloneNode(true));
      }

      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        shadowRoot.appendChild(link.cloneNode(true));
      }

      for (const ch of template.content.childNodes) {
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
 * for a value in side the reactive object.
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
 * watchers should not alter the reactive object. If a dependent
 * value is required then a `computed` value should be used.
 */
export function watch(key: string, watcher: Watcher): void {
  const watchers = globalWatchers.get(key) ?? [];
  watchers.push(watcher);
  if (!globalWatchers.has(key)) {
    globalWatchers.set(key, watchers);
  }
}

export function unwatch(key?: string, watcher?: Watcher): void {
  if (!key && !watcher) {
    globalWatchers.clear();
    return;
  }

  if (!watcher && key) {
    globalWatchers.delete(key);
    return;
  }

  let watcherList:
    | [string, Watcher[]][]
    | ReturnType<(typeof globalWatchers)['entries']>;
  if (key) {
    watcherList = [[key, globalWatchers.get(key) ?? []]];
  } else {
    watcherList = globalWatchers.entries();
  }

  for (const [key, watchers] of watcherList) {
    const filtered = watchers.filter((w) => w !== watcher);
    globalWatchers.set(key, filtered);
  }
}

/**

# Scratch Space

TODO:
- [ ] Remove need to apply names on slot elements (if slot names are mark names).
- [ ] Review the code, take note of implementation and hacks
- [ ] DOM Thrashing?
- [ ] Performance
  - [ ] Cache computed
  - [^] Cache el references? (might not be required, 10ms for 1_000_000 divs querySelectorAll)



# Notes

TODO: Move these elsewhere maybe

## Tech Debt: Set Trap UI Update Logic

Right now the code for set is a bit convoluted. It was written after a
single pass over the problem statement, while plugging unwanted behaviour
with some bandaid code.

Updations on set have a few complexities:
1. Value set can be an array: the elements of the array need to be inserted
  after being cloned from the placeholder.
2. Value set can be an item (in an array): the marked element corresponding to
  the item might not exist in the DOM, in this case the element needs to be
  inserted after being cloned from the placeholder and then the DOM elements
  need to be sorted because the item could have been inserted by use of splice.
3. Value set is an if[not]==true element: the element needs to be removed from
  the container template and inserted into the DOM.

All of the three issues are unlike regular sets in which the element already
exists and is in sync. In all of the above examples, the elements need to
first be inserted and then be synced across all the directives.
  
To do this `syncNode` and `syncClone` functions are being used. Both of them
recursively call the `update` function because it handles `computed` values.
  
- `syncNode` runs before inserting the element (due to being evaled in `if[not]`)
- `syncClone` runs after inserting the element (due to needing eval of `if[not]`)
  
Evaluating whether the element is to be displayed or not should be done before it
is inserted into the DOM.
  
All of this convoluted code can be improved by refactoring to separate _insert,sync_ 
and _set_ logic from one another.
  
Another point to note is that objects being set also recursively call.


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

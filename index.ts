type Primitive = boolean | symbol | string | number | bigint | undefined;
type Complex = object | Function;

type R = { __prefix: string };
type Reactive<T> = T extends Complex ? T & R : never;

function reactive<T extends Primitive | Complex>(
  obj: T,
  prefix: string
): T | Reactive<T> {
  if (obj == null) {
    return obj;
  }

  if (typeof obj === 'function') {
    return _makeReactive(obj, prefix);
  }

  if (typeof obj === 'object') {
    return _makeReactive(obj, prefix);
  }

  return obj;
}

function _makeReactive<O extends Function | object>(
  obj: O,
  prefix: string
): Reactive<O> {
  type K = keyof O;

  for (const key of Object.keys(obj)) {
    if (typeof key === 'symbol') {
      continue;
    }

    const value = obj[key as K] as Primitive | Complex;
    const newprefix = prefix === '' ? key : prefix + '.' + key;

    obj[key as K] = reactive(value, newprefix) as O[K];
  }

  Object.defineProperty(obj, '__prefix', { value: prefix, enumerable: false });
  return new Proxy(obj, ReactivityHandler) as Reactive<O>;
}

type Watcher = (newValue: unknown) => unknown;
class ReactivityHandler implements ProxyHandler<Reactive<object>> {
  static watchers: Record<string, Watcher[]> = {};

  static set(
    target: Reactive<object>,
    prop: string | symbol,
    value: any,
    receiver: any
  ): boolean {
    if (typeof prop === 'symbol') {
      return Reflect.set(target, prop, value, receiver);
    }

    const key = target.__prefix === '' ? prop : target.__prefix + '.' + prop;
    const reactiveValue = reactive(value, key);

    console.log('set', { target, prop, key, value, receiver });
    this.update(key, value);
    return Reflect.set(target, prop, reactiveValue, receiver);
  }

  static update(key: string, newValue: unknown) {
    for (const watcher of this.watchers?.[key] ?? []) {
      watcher(newValue);
    }

    const query = `[key='${key}']`;
    for (const el of document.querySelectorAll(query)) {
      el.innerHTML = String(newValue);
    }
  }

  static watch(key: string, watcher: Watcher) {
    this.watchers[key] ??= [];
    this.watchers[key].push(watcher);
  }
}

// @ts-ignore
window.data = reactive({}, '');

// @ts-ignore
window.watch = ReactivityHandler.watch.bind(ReactivityHandler);

/**
 * TODO:
 * - Input Elements (two way binding)
 * - Composiblity
 * - Computed Values
 * - Arrays
 */

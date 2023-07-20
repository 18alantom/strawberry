# Strawberry API

This page lists the available strawberry directives and exported methods.

1. **Directives**: set on elements `<tag sb-directive="key"></tag>`
   1. [`sb-mark`](#sb-mark): mark element as reactive.
   2. [`sb-if`](#sb-if): render element if data is truthy.
   3. [`sb-ifnot`](#sb-ifnot): render element if data is falsy.
2. **Methods**: called from the global `sb` object.
   1. [`init`](#init): initialize strawberry.
   2. [`directive`](#directive): register a custom directive.
   3. [`watch`](#watch): watch data for changes.
   4. [`unwatch`](#unwatch): stop watching data for changes.
   5. [`register`](#register): register custom components.
   6. [`load`](#load): load components from external files.
   7. [`prefix`](#prefix): change prefix `"sb"` to a custom value.

## Directives

Note this section is mentioned only completeness. for a more detailed
information on the items in this section check out the documentation on
[reactivity](./reactivity/README.md).

### `sb-mark`

[Detailed documentation](./reactivity/mark.md)

Used to mark an element with a key which will allow the element to be updated
when the respective data changes.

```html
<p sb-mark="message">...</p>
<script>
  data.message = 'Hello, World';
</script>
```

### `sb-if`

[Detailed documentation](./reactivity/conditionals.md)

Used to render an element when the respective data value is truthy.

```html
<p sb-if="show">Hello, World!</p>
<script>
  data.show = true;
</script>
```

### `sb-ifnot`

[Detailed documentation](./reactivity/conditionals.md)

Used to render an element when the respective data value is falsy.

```html
<p sb-ifnot="show">Hello, World!</p>
<script>
  data.show = false;
</script>
```

## Methods

If strawberry has been loaded correctly then all the methods mentioned in this
section should be available on the global `sb` object.

### `init`

```typescript
function init(): ReactiveObject;
```

> **Info**
>
> `ReactiveObject` is not a specific type, it is an object that looks like a
> regular JavaScript object but has reactive properties. For details check the
> [Reactive Values](./reactivity/reactive_values.md) page.

Used to initialize strawberry. Calling it does the following things:

- Returns a reactive object which is used to store all [reactive data](./reactivity/README.md) in a Strawberry app.
- Registers defined components.

```html
<p sb-mark="message"></p>
<script>
  const data = sb.init();
  data.message = 'Hello, World!';
</script>
```

When `sb.init` is called all templates elements with a name attribute are
registered. Strawberry checks for component templates once again after the
document is done loading, so it's alright to call `sb.init` in the `<head>`
element of a document.

> **Info**
>
> Calling `sb.init` will always return the same reactive object so there is no
> point in calling it multiple times. If you want to register components after
> loading you should instead use `sb.register` or `sb.load`.

### `directive`

[Detailed documentation](./reactivity/directives.md)

```typescript
function directive(
  name: string,
  cb: Directive,
  isParametric: value = false
): void;

type Directive = (params: {
  el: Element; // The element to which the directive has been applied.
  value: unknown; // The updated value.
  key: string; // Period '.' delimited key that points to the value in the global data object.
  isDelete: boolean; // Whether the value was deleted `delete data.prop`.
  parent: Prefixed<object>; // The parent object to which the value belongs (the proxied object, unless isDelete).
  prop: string; // Property of the parent which points to the value, `parent[prop] ≈ value`
  param: string | undefined; // If directive is a parametric directive, `param` is passed
}) => void;
```

- `name`: the name of the directive being registered
- `cb`: the directive callback function
- `isParametric`: whether the directive is a parametric directive

Used to register a custom directive. For example here is a two way bind directive:

```html
<script>
  sb.directive('bind', ({ el, value, parent, prop }) => {
    el.value = value;
    el.oninput ??= (e) => {
      parent[prop] = e.target.value;
    };
  });
</script>
<input type="text" sb-bind="message" />
```

### `watch`

```typescript
function watch(key: string, watcher: Watcher): void;
type Watcher = (newValue: unknown) => any;
```

- `key`: dot separated string for a value in the reactive object
- `watcher`: function that is called when watched value changes, it receives the `newValue` that is set

Used to set watcher function that is called when a watched value or its child
value changes. For example:

```javascript
data.a = { b: '' };

sb.watch('a.b', (v) => console.log(`b changed to: ${v}`));
sb.watch('a', (v) => console.log(`a changed to: ${v}`));

data.a.b = 'Hello, World';

// b changed to: Hello, World
// a changed to: [object Object]
```

Note: in the above example even the second watcher is triggered because `b` is a
property (child value) of `a`.

> **Warning**
>
> Watchers should not alter the reactive object. If a dependent value is
> required then a [`computed`](./reactivity/computed.md) value should be used.

### `unwatch`

```typescript
function unwatch(key?: string, watcher?: Watcher): void;
```

- `key`: key from which watchers are to be removed.
- `watcher`: specific watcher which is to be removed.

Used to remove watchers. Watchers are removed depending on the args passed:

- Only `key`: all watchers registered under the passed `key` are removed.
- Only `watcher`: `watcher` is removed from all keys.
- Both: `watcher` found registered with `key` is removed.
- Neither: all watchers are removed.

Example:

```javascript
sb.unwatch('a.b');
```

### `register`

```typescript
function register(): void;
function register(parentElement: HTMLElement): void;
function register(template: string): void;
function register(templateString: string[], ...args: unknown): void;
```

Used to register custom components in Strawberry. These components can be
defined dynamically after a document has completed loading.

It can be called in multiple ways:

1.  **Without args**: This will register all the components found in html
    document.

    ```javascript
    sb.register();
    ```

2.  **Passing the parent element**: This will register all the components found
    inside the passed `parentElement`.

    ```javascript
    sb.register(parentElement);
    ```

3.  **As a tag function**: This allows for dynamically creating templates with
    interpolated values and expressions.

    ```javascript
    sb.register`
         <template name="colored-p">
           <p style="font-family: sans-serif; color: ${color};">
             <slot />
           </p>
         </template>`;
    ```

4.  **Passing the component string**: Functionally, it is the same as using it
    as a tagged function.
    ```javascript
    sb.register(`<template name="colored-p">
           <p style="font-family: sans-serif; color: ${color};">
             <slot />
           </p>
         </template>`);
    ```

> **Warning**
>
> Once an element has been registered by a particular name, it cannot be
> re-registered, `sb-register` will skip over registered elements and only
> register the ones that have not been registered.

> **Info**
>
> If your components have been defined statically before the document finished
> loading (i.e. before `document.readyState` becomes `"interactive"`) then you
> don't need to call `sb.register`.

### `load`

```typescript
function load(files: string | string[]): Promise<void>;
```

- `files`: Path to a single file from the calling folder or a list of files.

Used to load components from external files. For example if you have the
following folder structure:

```
.
├── index.html
└── components.html
```

Where `index.html` is your main HTML file that will be served, and
`components.html` contains your templates. You can load the components in
`index.html` using `sb.load` like so:

```javascript
sb.load('components.html');
```

### `prefix`

```typescript
function prefix(value: string = 'sb'): void;
```

- `value`: value to use for prefix, defaults to `'sb'`

Used to override the default (`'sb'`) prefix for directives, for example
if you want to use data attributes to manage directives you can do this:

```html
<script>
  sb.prefix('data-sb');
</script>
<p data-sb-mark="message"></p>
```

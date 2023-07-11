# Directives

The crux of Strawberry is reactivity which is easily described as:
_When my data changes do `x`_

In Strawberry things (i.e. `x`) are done by using **directives**. For example:

- `sb-mark` is a directive that sets the inner text of an element when the value in the RDO changes.
- `sb-if` is a directive that inserts or removes an element depending on the truthy-ness of the value.

Directives can be used to extend the functionality of strawberry.

## Directive is a function

You can add all sorts of additional functionality to Strawberry by using
directives. A directive is a function with the following signature:

```typescript
type Directive = (params: DirectiveParams) => void;

type DirectiveParams = {
  // Element on which the directive has been set.
  el: Element;

  // Updated value.
  value: unknown;

  // Period '.' delimited key of the value in the RDO.
  key: string;

  // Whether the value was deleted `delete data.prop`.
  isDelete: boolean;

  // Parent object to which the value belongs (the proxied object).
  parent: Record<string, unknown>;

  // Property of the parent which points to the value `parent[prop] ≈ value`
  prop: string;
};
```

## Directive is called on data change

A directive function is called whenever the value of the mentioned key changes
in the RDO.

For example, in `sb-mark="form.title"`, `form.title` is the key of a value in
the RDO i.e. `data.form.title` and when this is set or changes or is deleted,
the directive is called.

## Directives can be registered using `sb.directive`

```typescript
sb.directive(
  // Name of the directive
  name: string,

  // The callback function of the directive
  cb: Directive,

  // Whether the directive is parametric
  isParametric: boolean
): void;
```

To register a directive, you can use the `sb.directive` function.

```javascript
sb.directive('somedirective', () => {
  /* ... */
});
```

This can now be used like so:

```html
<p sb-somedirective="value"></p>
<script>
  data.value = '...';
</script>
```

## Two-way binding using a directive

Let's implement _two-way binding_ by using directives.

<summary>
<detail> What is <em>two-way binding</em>?</detail>

In short, _two-way binding_ is a binding between data and a some input element, so:

1. When the data value changes, the value in the input should change.
2. When the input value changes, it should update the data value.

For example:

```html
<input type="text" for="name" />
<script>
  data.name = '';
</script>
```

When user changes the value in `input[for="name"]` the value of `data.name`
should change, and when we change the value of `data.name` the value of `input[for="name"]`
should change.

</summary>

For this we'll write a simple directive called bind:

```javascript
sb.directive('bind', ({ el, value, parent, prop }) => {
  el.value = value;
  el.oninput ??= (e) => {
    parent[prop] = e.target.value;
  };
});
```

Let's go over what's happening here:

### 1. Setting the input value

```javascript
el.value = value;
```

Since the directive is called only when the value in the RDO changes, we can
directly use this value, stored in the `value` arg to set the input elements
[value](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/text#value).

### 2. Setting the data value

```javascript
el.oninput ??= (e) => {
  parent[prop] = e.target.value;
};
```

Since the directive can be called multiple times, we want to add an `oninput`
listener to the `inputElement` only once (Hence the `??=` which checks if a
value is set before setting it).

And in the input listener, we set the data value, here `parent` is the RDO that
contains `value`, i.e. `parent[prop] === value` and since `parent` is an RDO
setting a value to it will trigger changes related to `parent[prop]`

### Using the bind directive

Once, it has been defined, you can use it like so:

```html
<p>Hello, <span sb-mark="name"></span></p>
<input type="text" sb-bind="name" />

<script>
  data.name = 'Fyo';
</script>
```

Now if you update `input`, the value in the `span` will change too. And if you
update `data.name` both the `input` and the `span` values will change.

> **Warning**
>
> The`parent` arg passed to a directive is the reactive object. So setting a
> value on it without checks can cause recursion.
>
> In the `bind` example above since `parent[prop]` is set inside the input
> listener, recursion does not take place.

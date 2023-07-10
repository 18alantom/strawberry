# Conditionals

This page is about the details of Strawberry's conditional directives `sb-if`
and `sb-ifnot`. If you haven't checked the [Getting Started](../getting_started.md)
and the [Reactivity](./README.md) pages, I'd suggest doing so first.

## Conditional Rendering

When you want to show or hide an element on the basis of some data value, you
can use one of Strawberry's conditional directives `sb-if` and `sb-ifnot`.

```html
<div sb-if="hasMessage">
  <p>You have a message.</p>
</div>

<script>
  data.hasMessage = true;
</script>
```

In the above example the `<div>` element will be rendered cause
`data.hasMessage` is set to `true`.

An element with an `sb-if` or `sb-ifnot` can have two default states:

- **Visible default state**: element is visible until value is set.
- **Hidden default state**: element is hidden until the value is set.

_Note: in the example shown, the `<div>` element has a visible default state._

## Hidden default state

In the example below, the `<div>` element has a visible default state.

```html
<div sb-if="hasMessage">
  <p>You have a message.</p>
</div>

<script>
  data.hasMessage = false;
</script>
```

Due to this, the `<div>` element will be rendered until the value of
`data.hasMessage` has been evaluated. Which in this case is `false`, this may be
undesirable behaviour and you can avoid this by wrapping the element in a
`<template>` tag:

```html
<template sb-if="hasMessage">
  <div>
    <p>You have a message.</p>
  </div>
</template>

<script>
  data.hasMessage = false;
</script>
```

Now the element will not be rendered until `data.hasMessage` is set to `true`.

## Conditionally Rendering Lists

Lists can be conditionally rendered in two ways:

1. Directive placed on parent.
2. Directive placed on the list item.

When the directive is **placed on the parent**, for example:

```html
<div sb-if="show">
  <p sb-mark="list.#"></p>
</div>

<script>
  data.show = true;
  data.list = ['a', 'b'];
</script>
```

Setting the value of `data.show` will hide or render the the `<div>` element and
all its children with it.

If you want to hide only certain children, you can place the directive on the list item instead:

```html
<div sb-mark="list.#">
  <p sb-mark="list.#.value" sb-ifnot="list.#.hide"></p>
</div>

<script>
  data.list = [
    { value: 'a', hide: false },
    { value: 'b', hide: true },
  ];
</script>
```

Now you can hide specific list items like so:

```javascript
data.list[0].hide = true;
```

# Reactivity

Reactivity is the crux of Strawberry, for a quick brief on what reactivity is
consider the following example:

```html
<p sb-mark="message">...</p>
<script>
  data.message = 'Hello, World';
</script>
```

In the above example, when `data.message` is updated the inner text of the `<p>`
element is also updated. This is due to Strawberry's reactivity, i.e.
_when the data updates, update the UI_.

Reactive depends on two things, what data is set/updated, and how the UI is to
be updated. The reactivity section of the documentation has been divided as
such:

- **What data is set/updated**
  1. [Reactive Values](./reactive_values.md)
  2. [Computed](./computed.md)
- **How the UI is to be updated**
  1. [Mark (`sb-if`)](./mark.md)
  2. [Conditionals (`sb-if`, `sb-ifnot`)](./mark.md)
  3. [Directives](./directives.md)

## Setting and updating the data

For a piece of data to be considered reactive, it should be set on Strawberry's
reactive object:

```javascript
const data = sb.init();
```

The object `data` that is returned on initialization is a reactive object. This
means that any value that is set on `data` will update the appropriate UI.

Data works with the following types of values:

1. Regular objects. [documentation](reactive_values.md#objects-and-arrays)
2. Regular arrays for loops. [documentation](reactive_values.md#objects-and-arrays)
3. Functions used for computed values. [documentation](computed.md)

## Updating the UI

There are a couple of ways Strawberry updates the UI on data change:

- `sb-mark`: used for setting content of an element. [documentation](mark.md)
- `sb-if`: used for adding or removing an element if the value is _truthy_. [documentation](conditionals.md)
- `sb-ifnot`: used for adding or removing an element if the value is _falsy_. [documentation](conditionals.md)

All three of the above are called _directives_, you can add custom directives to
Strawberry, check the [documentation](directives.md).

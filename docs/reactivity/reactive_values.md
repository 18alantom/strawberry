# Reactive Values

This page is about values that can be set on the reactive object.
If you haven't checked the [Getting Started](../getting_started.md)
and the [Reactivity](./README.md) pages, I'd suggest doing so first.

**Index**

1. [The Reactive Object](#the-reactive-object)
2. [Objects and Arrays](#objects-and-arrays)
3. [Functions](#functions)
4. [Directive keys](#directive-keys)

## The Reactive Object

The value received when `sb.init` is the reactive object.

```javascript
const data = sb.init();
```

Think of this as an object that holds data that is meant to be rendered. You can
set any kind of value to this object, but Strawberry listens to changes to only
the following type of objects

Three kinds of values can be set on reactive objects:

1. Primitive values: `strings`, `numbers`, `booleans`, `bigints`, `undefined`, `null`
2. Objects: arrays i.e. `[]` and regular objects `{}`.
3. Functions

Out of the above three only the primitive values are directly rendered. If the
value passed is not a string then it is passed through the `String` function.

> **Warning**
>
> Strawberry might work with other types of values too, but it has not been
> tested.

## Objects and Arrays

**Objects** are treated as containers of primitive values. They are not directly
rendered, if you want to render an object you will have to provide its string
representation instead.

However deep a primitive value is nested inside an object it can be used to set
the `innerText` of a marked element.

```html
<p sb-mark="a.b.c"></p>
<script>
  data.a = {
    b: {
      c: 'Hello, World!',
    },
  };
</script>
```

**Arrays** serve a special purpose, they are used to loop elements, i.e. for
each item of an array an element can be inserted into the DOM. These are marked
using special keys that end in `'.#'`.

```html
<div>
  <p sb-mark="list.#"></p>
</div>
<script>
  data.list = ['a', 'b', 'c'];
</script>
```

For more details on looping check the page on `sb-mark` and loops [here](./mark.md#loops).

## Functions

**Functions** set on the reactive object are treated as computed values.

```html
<p sb-mark="nameUpper"></p>

<script>
  data.name = 'lin';
  data.nameUpper = () => data.name.toUpperCase();

  typeof data.nameUpper === 'string'; // evaluates to true
</script>
```

For more details on this check the page on computed values [here](./computed.md).

## Directive keys

The format used to mark an element is `sb-mark="KEY"`, in the above example the
value of `KEY` is `message`.

This `KEY` is used to point to a data value inside the reactive object, for
nested objects it is a sequence of `'.'` separated property names. For
example:

```javascript
data.obj = {
  a: {
    b: {
      c: 22, // key: "obj.a.b.c"
      d: [
        { a: 0 }, // key: "obj.a.b.d.0.a"
        { b: 1 }, // key: "obj.a.b.d.1.b"
        {
          c: [
            'x', // key: "obj.a.b.d.2.c.0"
            'y', // key: "obj.a.b.d.2.c.1"
          ],
        },
      ],
    },
  },
};
```

# Mark

This page is about the details of Strawberry's main directive `sb-mark`. If you
haven't checked the [Getting Started](../getting_started.md) and the
[Reactivity](./README.md) pages, I'd suggest doing so first.

The `sb-mark` directive has three uses:

1. [Mark](#updating-an-element-with-sb-mark) an element for its `innerText` to be updated when some data updates.
2. [Looping](#looping) an element for items in a array.
3. [Deleting](#deleting-values) an element.

## Updating an element with `sb-mark`

The `sb-mark` directive is used to mark any element for update when some data
changes. For example:

```html
<p sb-mark="message">...</p>
<script>
  const data = sb.init();
  data.message = 'Hello, World!';
</script>
```

In the above example `sb-mark` is used to mark the `<p>` element to be updated
when the value of `data.message` updates.

You can mark elements with nested values using `'.'` separated property names:

```html
<div>
  <h1 sb-mark="user.name"></h1>
  <p sb-mark="user.things.0"></p>
</div>

<script>
  data.user = {
    name: 'Lin', // key: "user.name"
    things: ['Strawberry'], // key: "user.things.0"
  };
</script>
```

## Looping

The second use of mark is by using it to mark an element to be looped over for
each item in an array. This is done by using a special placeholder key, i.e. a
key that ends in a `".#"`.

Consider the following example:

```html
<div>
  <p sb-mark="list.#"></p>
</div>

<script>
  data.list = ['one', 'two'];
</script>
```

This will render the following HTML:

```html
<div>
  <p sb-mark="list.0">one</p>
  <p sb-mark="list.1">two</p>
</div>
```

> **Warning**
>
> Properties before `.#` should always be a JavaScript array.

### Updating lists

Lists can be updated by either updating the value of an item in the array or by
changing the shape of the array. Strawberry supports both of these operations.

Updating values of an array item is done by simply reassigning the value of an
array item:

```javascript
data.list[0] = 'ONE';
data.list[1] = 'TWO';
```

doing so will update the marked elements to reflect the new values.

You can alter the shape of the array by using regular array operations to such
as `push`, `pop`, `splice`, etc.

```javascript
data.push('THREE');
data.unshift('ZERO');
```

and Strawberry will grow or shrink the list of array elements as required.

### Looping over list of objects

You can also loop over lists of objects:

```html
<div sb-mark="users.#">
  <h1 sb-mark="users.#.name"></h1>
  <p sb-mark="users.#.age"></p>
</div>

<script>
  data.users = [{ name: 'Lin', age: 33 }];
</script>
```

### Nested Loops

Since each `'#'` in a key denotes a loop you can nest loops like so:

```html
<p sb-mark="matrix.#">
  <span sb-mark="matrix.#.#"></span>
</p>

<script>
  data.matrix = [
    [0, 1],
    [2, 3],
  ];
</script>
```

## Deleting values

Deleting values from the reactive object by using the JavaScript `delete`
keyword will cause the marked elements to be removed from the DOM. Resetting the
value will not bring back the element. For example:

```html
<div>
  <p sb-mark="message">...</p>
</div>

<script>
  delete data.message;
</script>
```

will result in an empty div:

```html
<div></div>
```

If removing elements from the DOM is not what you intend to happen, you can instead:

- Set an empty value eg: `data.message = ''`
- Use CSS, eg setting the `display` property of the element to `none`

> **Note**: **Deleting Arrays**
>
> When arrays are deleted the list elements are not deleted. You can instead set
> the list variable to an empty list: `data.list = []`.
>
> Array items on the other hand can be deleted `delete data.list[0]` but this is
> not recommended as it will lead to incorrect sequences of keys, instead use 
> array operations such as `splice`, `pop`, or `shift`.

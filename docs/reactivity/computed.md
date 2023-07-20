# Computed

Computed values are values that have been calculated from other values. Consider this example:

```javascript
let a = 10;
let b = 20;

const c = () => a + b;
```

Here, `c` is a function that returns a computed value. The function has two
variable dependencies `a` and `b` i.e. when either of them change, the value of
`c()` also changes.

**Index**

1. [Computed values are functions](#computed-values-are-functions)
2. [Elements can be marked by computed values](#elements-can-be-marked-by-computed-values)
3. [Computed functions can use `this`](#computed-functions-can-use-this)
4. [Functions can be returned from computed functions](#function-can-be-returned-from-computed-functions)
5. [Computed functions can be async](#computed-functions-can-be-async)
6. [Additional points regarding computed](#additional-points-regarding-computed)

## Computed values are functions

In Strawberry computed values are obtained by setting functions on the reactive object:

```javascript
// data is the reactive object
const data = sb.init();

data.a = 10;
data.b = 20;

data.c => () => data.a + data.b;
```

After setting a function for a computed value, you don't need to call it to get
the value:

```javascript
data.c === 30; // evaluates to true
```

You can update the function for the computed value by setting a new value to the
property:

```javascript
data.c => () => (data. a + data.b) / 10;

data.c === 3; // evaluates to true
```

> **Warning**
>
> Dependencies of a computed value should be defined before the computed value
> is defined. Else the computed value will not be evaluated properly and you
> might end up with incorrect values.

## Elements can be marked by computed values

Say you have an element marked by a computed value:

```html
<p sb-mark="c">0</p>

<script>
  data.a = 10;
  data.c = () => data.a + 10;
</script>
```

The element is updated when you:

1. Set the computed value's function.
2. update a dependency of the computed value.

In the above example setting `data.c` will update the inner text of the `<p>`
element to `'20'`. Similarly if you update the dependency `data.a`, eg
`data.a = 5` the inner text will again be updated, in this case to `"15"`.

## Computed functions can use `this`

Up until now the computed functions have directly accessed the `data` object. You
can instead use `this` to access the reactive object that contains the computed
function:

```javascript
data.a = 10;
data.c = function () {
  return this.a + 10;
};
```

> **Warning**
>
> This is not possible using arrow functions (i.e `() => {}`) because they can't
> be bound to their own `this` value. So you need to use regular functions for
> `this`.

The benefit of this is you can:

1. Reuse functions
2. Not have to rely on long value access expressions

For example:

```javascript
data.users = [];
function isOldEnough() {
  return this.age > 30;
}

function addUser(name, age) {
  data.users.push({ name, age, isOldEnough });
}

addUsers('Flo', 28);
addUsers('Max', 55);

data.users[0].isOldEnough; // false
data.users[1].isOldEnough; // true
```

## Function can be returned from computed functions

If your computed function returns a function then it is returned as it is, i.e.
without being called like a computed value.

```javascript
function onClickHandler() {
  /* event listener logic*/
}

data.handler = () => onClickHandler;

typeof data.handler === 'function'; // evaluates to true
```

This is useful for associating a function with an element. For instance by
creating a custom directive to assign event listeners to elements.

## Computed functions can be `async`

If your computed function depends on pulling data from some async source you
can use an `async` function instead:

```javascript
data.item = 'Matchbox';
data.isInStock = async () => {
  const quantity = await getStockQuantity(data.item);
  return quantity > 0;
};
```

In the above example when `data.item` is updated, the function `isInStock` is
called and when the returned `Promise` is resolved all the directives marked
using `"isInStock"` are evaluated with the resolved value.

> **Note**
>
> Accessing `data.isInStock` will still return a `Promise` that will have to be
> awaited.

## Additional points regarding computed

**Note**: you don't need to know this stuff, but if you find that computed is not
functioning as expected then these points will help in debugging the issue.

- Computed values won't update if computed dependencies are deleted.
- Accessing computed values with missing or incorrect dependencies (e.g after
  deleting or after reassigning a dependency) may result in an error or
  unexpected values.
- Computed functions are executed once when set to evaluate dependencies.
- If a codeblock in a computed function has a dependency, and that block is not
  executed when the computed function called, the dependency is not counted.

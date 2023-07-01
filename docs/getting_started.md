# Getting Started

Let's start with a simple example, I'll explain what's going on after I show you the code.

```html
<!-- 1. Link Strawberry -->
<head>
  <script src="https://unpkg.com/sberry@0.0.1-alpha.0/dist/sb.min.js"></script>
</head>

<!-- 2. Define a Component -->
<template name="cool-button">
  <button
    style="
        padding: 0.5rem 1rem;
        border: 2px solid black;
        border-radius: 0px;
        box-shadow: 4px 4px 0px gray;
      "
  >
    <slot />
  </button>
</template>

<!-- 3. Initialize Strawberry -->
<script>
  const data = sb.init();
  data.counter = 0;
</script>

<!-- 4. Use the Component -->
<body>
  <cool-button sb-mark="message" onclick="data.counter += 1">
    loading...
  </cool-button>
</body>

<!-- 5. Update the Component -->
<script>
  data.message = () => `Clicked ${data.counter} times`;
</script>
```

In the above example we are rendering a button component called `cool-button`
which on clicking increments `counter` and which updates the button's
`innerText`.

I have added comments that to mark sections of the code above, I'll explain what's going on in each of them:

**1. Link Strawberry**

```html
<head>
  <script src="sb.min.js"></script>
</head>
```

This loads and runs the
[`sb.min.js`](https://github.com/18alantom/strawberry/blob/main/dist/sb.min.js)
file. On doing this, the `sb` object becomes available in the global scope.

**2. Define Component**

```html
<template name="cool-button">
  <button
    style="
        padding: 0.5rem 1rem;
        border: 2px solid black;
        border-radius: 0px;
        box-shadow: 4px 4px 0px gray;
      "
  >
    <slot />
  </button>
</template>
```

This defines a component inside a `template` tag with the
name attribute deciding what the component will be called. The component
defined is a button component with some styling added to it.

**3. Initialize Strawberry**

```html
<script>
  const data = sb.init();
  data.counter = 0;
</script>
```

This calls `sb.init` to do two things:

1. register our defined components (i.e. `cool-button`).
2. get the reactive object `data` which updates UI when its values change.

Along with that we are also initializing `data.counter` with the value `0`.

**4. Use the Component**

```html
<body>
  <cool-button sb-mark="message" onclick="data.counter += 1">
    loading...
  </cool-button>
</body>
```

Use the `cool-button` component to display a button. Here two things are going on:

1. `sb-mark="message"`: this attribute means "whenever `data.message` changes,
   update the `innerText` of this component.""
2. `onclick="data.counter += 1"`: this is an inline function that increments
   `data.counter` that was defined in section 3. (_Note: you can also use some other way of adding an event listener, I've used this for brevity_)

**5. Update the Component**

```html
<script>
  data.message = () => `Clicked ${data.counter} times`;
</script>
```

This finally just defines what the `message` from `sb-mark="message"` is. Here
the message is a function that depends on `data.counter`, i.e. it is a _computed property_.

Which means whenever `data.counter` changes the value of message changes too.

Now whenever you click on the `cool-button`, the following things happen

1. `counter` increments.
2. `data.counter` is re-run because it depends on `counter`.
3. the value of `data.counter` is used to set the `innerText` of `cool-button`.

_Note: since `data.message` is a computed property, the following is true:_

```javascript
typeof data.message === 'string';
```

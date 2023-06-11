This project doesn't have a concrete road map. It's in the experimental stage
right now. This `md` is just a list of problems whose solutions haven't been
implemented or even figured out.

For a few of these, I haven't decided whether they are problems Strawberry
should be solving. In keeping with the theme of simplicity, there are ways
around the problems, but they might feel convoluted.

Ultimately this framework should feel intuitive and simple even if it is at the
cost of not being able to do _everything_.

**Terminology**:

- Reactive Data Object (RDO): the object received when `sb.init` is called, when
  props of this object are updated, the UI updates.

**List**

- [ ] [Setting `sb-*` props for Strawberry inserted elements](#setting-sb--props-for-strawberry-inserted-elements)
- [ ] [Directives for Strawberry Created Elements](#directives-for-strawberry-created-elements)
- [ ] [Logic Encapsulation in Templates](#logic-encapsulation-in-templates)
- [ ] [Interactive Elements in Templates](#interactive-elements-in-templates)
- [ ] [Animating `sb-if`](#animating-sb-if)
- [x] [Two-way Binding](#skip-two-way-binding) (SKIP)
- [x] [Nested Components](#done-nested-components)
- [x] [Defer Directives](#done-defer-ui-updates)

# Setting `sb-*` props for Strawberry inserted elements

**Problem** if I have a list of `a` elements which is added by strawberry

```html
<!-- Invalid strawberry but gets the point across -->
<div sb-mark="links" sb-child="a"></div>
<script>
  data.a = [{ name: 'Example', link: 'example.com' }];
</script>
```

there is no way to set the `href` attribute.

A **Solution** to this is to have a directive that sets attributes. This along
with the nested components is a solution.

```html
<div sb-mark="links" sb-child="a">
  <a sb-mark="links.#.name" sb-attr-href="links.#.link"></a>
</div>
<script>
  data.a = [{ name: 'Example', link: 'example.com' }];
</script>
```

# Directives for Strawberry Created Elements

**Problem** is when an element is created and inserted by strawberry, there is
no way to init the properties of that element.

This is more of a enhancement than an issue, should strawberry even do this.

# Logic Encapsulation in Templates

**Problem** is that scripts inside templates run in the global context. And if
the template is external, they don't run.

This means that templates can't have logic ascribed to them.

# Interactive Elements in Templates

**Problem** is that templates can have multiple interactive elements, inputs,
buttons, etc. But accessing these elements requires traversing the Shadow DOM.

# Animating `sb-if`

**Problem** is that when `sb-if` causes a elements to be removed it's done using
`el.replaceWith` which is not animatable.

# `[DONE]` Defer UI updates

**Problem** is that currently when an RDO prop is set in a regular `script` tag

```html
<script>
  const data = sb.init();
  data.prop = 'value';
</script>
```

only the elements before the script with the apt `sb-mark` are updated.
Downstream elements are not updated.

**Desired behavior** is that all elements are updated. Irrespective of the
where the script is loaded.

A **solution** is that when RDO props are set inside the `head` tag, the updates
are deferred until the ready state changes to `"interactive"`. This happens only
after the DOM has been parsed but before all assets have been fetched.

# `[DONE]` Nested Components

[PR #9](https://github.com/18alantom/strawberry/pull/9)

**Problem** is that currently `sb-mark` on plain elements don't support nesting.
For instance say I have a nested list:

```javascript
data.list = [
  [1, 2],
  ['a', 'b', 'c'],
];
```

Where I want the outer list items to be rendered in a `ul` and the inner ones
in an `li`.

```html
<section>
  <ul>
    <li>1</li>
    <li>2</li>
  </ul>
  <ul>
    <li>a</li>
    <li>b</li>
    <li>c</li>
  </ul>
</section>
```

if the number of items in the outer list or inner list were fixed, it is
possible to create templates with digit slot names:

```html
<!-- If the inner list has a fixed number of items -->
<template name="example-list">
  <ul>
    <li>
      <slot name="0"></slot>
    </li>
    <li>
      <slot name="1"></slot>
    </li>
  </ul>
</template>
```

or just by using `sb-child`:

```html
<!-- If the outer list has a fixed number of items -->
<ul sb-mark="list.0" sb-child="li"></ul>
<ul sb-mark="list.1" sb-child="li"></ul>
```

But for nested lists with a varying number of items it is not possible without
using JavaScript. This is without even considering the nesting depth.

A **solution** is to allow `sb-mark` items to have children that define the
shape of the child:

```html
<section sb-mark="list">
  <!-- ul used for the outer list -->
  <ul>
    <!-- li used for the inner list -->
    <li></li>
  </ul>
</section>
```

This has the added advantage that the markup can be filled with placeholder data
until the actual data loads. And to indicate that these are `sb-child` elements,
they can be marked like so:

```html
<section sb-mark="list">
  <ul sb-mark="list.#">
    <li sb-mark="list.#.#">loading...</li>
  </ul>
</section>
```

_Note: this prevents `"#"` from being used as a valid RDO prop name._

# `[SKIP]` Two-way Binding

**Problem** is `sb-mark` can't be used on input elements to change their
value when the RDO prop changes, or vice versa.

**Solution** is writing a new directive for this:

```javascript
const data = sb.init({
  directives: {
    bind({ el, value, parent, prop }) {
      el.value = value;
      el.oninput ??= (e) => {
        parent[prop] = e.target.value;
      };
    },
  },
});
```

This is trivial, but the question is

1. Should this be in strawberry?
2. Should this be incorporated into `sb-mark` when element is an input element?

Probably not considering, two way binding can be:

- lazy: i.e. using a `change` listener
- delayed: assignment takes place only after a time

So, instead of inserting the batteries—in the spirit of simplicity—this probably won't be added in.

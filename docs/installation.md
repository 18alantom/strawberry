# Installation

There are a couple of ways you can setup Strawberry

## Strawberry Starter

The quickest way to get started is to run this command:

```bash
curl -so- https://raw.githubusercontent.com/18alantom/strawberry/main/setup.sh | bash
```

This will run a [tiny bash script](https://github.com/18alantom/strawberry/blob/main/setup.sh) that sets up a simple starter page using Strawberry.

## Self Setup

If you want to add the functionality of Strawberry to an existing `html` document. You do two things:

Add a link to Strawberry to you html's `head` tag:

```html
<script src="https://unpkg.com/sberry@0.0.2-alpha.0/dist/sb.min.js"></script>
```

Or you can download [this file](https://raw.githubusercontent.com/18alantom/strawberry/main/dist/sb.min.js) and add a `script:src` that links to the copy.

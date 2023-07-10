#!/bin/bash

if [ -d "sb-starter" ]; then
  echo "Folder sb-starter already exists. Exiting."
  exit 1
fi

mkdir sb-starter
cd sb-starter

curl -so sb.min.js https://unpkg.com/sberry@0.0.2-alpha.0/dist/sb.min.js
index_html=$(cat <<EOF
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Strawberry App</title>
    <script src="sb.min.js"></script>
  </head>

  <style>
    body {
      background: hsla(43, 58%, 95%, 1);
      height: 100vh;
      width: 100vw;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  </style>

  <!-- Template Definitions -->
  <template name="sb-block">
    <div
      style="
        padding: 1rem;
        background-color: hsla(43, 58%, 92%, 1);
        border: 2px solid hsla(17, 48%, 16%, 1);
        box-shadow: -4px 4px 0px rgba(0, 0, 0, 0.25);
      "
    >
      <slot />
    </div>
  </template>
  <template name="sb-h1">
    <h1
      style="
        margin: 0;
        font-family: sans-serif;
        font-weight: bold;
        width: fit-content;
        color: hsla(6, 64%, 59%, 1);
      "
    >
      <slot />
    </h1>
  </template>

  <!-- Initialize Strawberry -->
  <script>
    const data = sb.init();
  </script>

  <!-- HTML Body -->
  <body>
    <!-- Use defined components -->
    <sb-block>
      <sb-h1 sb-mark="message">Hello, World!</sb-h1>
    </sb-block>

    <!-- Update Component -->
    <script>
      data.message = 'Hello, Strawberry! 🍓';
    </script>
  </body>
</html>
EOF
)

echo "$index_html" > index.html
cd ..
echo "sb-starter setup completed
open sb-starter/index.html and start coding :)"
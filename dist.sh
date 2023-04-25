#!/bin/bash

# file is run through pre-commit
# to create dist/sb.min.js
# which is a minified JavaScript file
# transpiled from index.ts
# for distribution purposes

rm -rf dist
mkdir dist

version=$(cat package.json | grep '"version"' | cut -d'"' -f4)
file_path="dist/sb.min.js"
file_header="/* Strawberry $version
 * Copyright (c) 2023-present, Alan Tom (18alantom)
 * MIT License
 * This is a generated file. Do not edit.*/"

echo "$file_header" >> "$file_path"
node_modules/.bin/esbuild . --bundle --minify --format=iife --global-name=sb >> "$file_path"

size=$(wc -c < $file_path)
gzsize=$(gzip -c $file_path | wc -c)

kb=$(echo "scale=3; $size / 1024" | bc)
gzkb=$(echo "scale=3; $gzsize / 1024" | bc)

echo "dist/sb.min.js is ${kb}KB and gzipped ${gzkb}KB"
if [ "$1" = "--size" ]; then
  git checkout "$file_path"
else
  git add "$file_path"
fi


#!/bin/bash

# This file runs on yarn build. It converts index.ts to
# minified javascript sb.min.js and adds the copyright
# header file.
#
# Finally it prints the normal and gzipped sizes of the file.

rm -rf dist
mkdir dist

version=$(cat package.json | grep '"version"' | cut -d'"' -f4)
file_path="dist/sb.min.js"
file_path_esm="dist/sb.min.esm.js"

file_header="/* Strawberry $version
 * Copyright (c) 2023-present, Alan Tom (18alantom)
 * MIT License
 * This is a generated file. Do not edit.*/"

echo "$file_header" >> "$file_path"
echo "$file_header" >> "$file_path_esm"

node_modules/.bin/esbuild ./index.ts --bundle --minify --format=iife --global-name=sb >> "$file_path"
node_modules/.bin/esbuild ./index.ts --bundle --minify --format=esm >> "$file_path_esm"

print_done() {
  size=$(wc -c < $1)
  gzsize=$(gzip -c $1 | wc -c)

  kb=$(echo "scale=3; $size / 1024" | bc)
  gzkb=$(echo "scale=3; $gzsize / 1024" | bc)

  path=$(printf "%-18s" $1)
  echo "$path :: size: ${kb}KB, gzip: ${gzkb}KB"
}

print_done $file_path
print_done $file_path_esm
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
file_header="/* Strawberry $version
 * Copyright (c) 2023-present, Alan Tom (18alantom)
 * MIT License
 * This is a generated file. Do not edit.*/"

echo "$file_header" >> "$file_path"
node_modules/.bin/esbuild ./index.ts --bundle --minify --format=iife --global-name=sb >> "$file_path"

size=$(wc -c < $file_path)
gzsize=$(gzip -c $file_path | wc -c)

kb=$(echo "scale=3; $size / 1024" | bc)
gzkb=$(echo "scale=3; $gzsize / 1024" | bc)

echo "dist/sb.min.js is ${kb}KB and gzipped ${gzkb}KB"

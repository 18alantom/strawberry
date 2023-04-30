#!/bin/bash

# abort on errors
set -e

cd website
git init
git add -A
git commit -m 'publish website'
git push -f git@github.com:18alantom/strawberry.git main:gh-pages

rm -rf .git
cd -
#!/bin/bash

# This script is used to publish the website
# since the website depends on all local links
# it first pulls the dependencies.
# 
# After that it asks whether to publish the website
# if yes then it pushes the contents of `./website`
# to the `gh-pages` branch of this repo.

# abort on errors
set -e

cd website

curl -so sb.min.js https://unpkg.com/sberry@0.0.1-alpha.0/dist/sb.min.js
curl -so highlight.min.js https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js


# Ask whether to publish the website
read -p "Publish the website? [y/n]: " choice
if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
  git init
  git add -A
  git commit -m 'publish website'
  git push -f git@github.com:18alantom/strawberry.git main:gh-pages

  rm -rf .git
fi


cd -
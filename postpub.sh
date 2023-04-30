#!/bin/bash

# Construct URL for latest
version=$(cat package.json | grep '"version"' | cut -d'"' -f4)
cdn_url="https://unpkg.com/sberry@$version/dist/sb.min.js"

# Replace all old URLs with latest
grep -rlE  --exclude-dir=node_modules "https://unpkg.com/sberry@[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?" . \
| xargs sed -i '' -Ee "s#https://unpkg\.com/sberry@[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?/dist/sb\.min\.js#$cdn_url#g"


git add .

# URLS
echo "CDN URLs have been updated to $cdn_url\nverify and commit"
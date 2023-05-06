#!/bin/bash

# This script is used to update the unpkg URL after
# a new version of strawberry has been released.
#
# This link is used in a couple of files such as
# - website/index.html for the script:src tag
# - setup.sh for pulling sb.min.js from unpkg
# - pubwebsite.sh for updating the inventory example's version
# - **/README.md for the same reasons as above

# Construct URL for latest
version=$(cat package.json | grep '"version"' | cut -d'"' -f4)
cdn_url="https://unpkg.com/sberry@$version/dist/sb.min.js"

# Replace all old URLs with latest
grep -rlE  --exclude-dir=node_modules "https://unpkg.com/sberry@[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?" . \
| xargs sed -i '' -Ee "s#https://unpkg\.com/sberry@[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?/dist/sb\.min\.js#$cdn_url#g"


git add .

# URLS
echo "CDN URLs have been updated to $cdn_url\nverify and commit"
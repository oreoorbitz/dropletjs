#!/bin/sh
set -e
cd "$(dirname "$0")"
# macOS needs -undefined dynamic_lookup, Linux uses -shared. Use node include via nvm path if /usr/include/node missing
INCLUDE="/usr/include/node"
if [ ! -d "$INCLUDE" ]; then
  # try nvm current node include
  NODE_INC="$(node -e "console.log(require('path').join(require('path').dirname(process.execPath),'..','include','node'))" 2>/dev/null)"
  if [ -d "$NODE_INC" ]; then INCLUDE="$NODE_INC"; fi
fi
if [ "$(uname)" = "Darwin" ]; then
  g++ -undefined dynamic_lookup -shared -fPIC -O3 -std=c++17 -I"$INCLUDE" tokenizer.cpp -o tokenizer.node
else
  g++ -shared -fPIC -O3 -std=c++17 -I"$INCLUDE" tokenizer.cpp -o tokenizer.node
fi
echo "built $(ls -la tokenizer.node)"

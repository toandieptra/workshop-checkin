#!/bin/sh
echo "=== welcome page ==="
F=/app/.next/static/chunks/app/welcome/page-d213671850ebc4c8.js
grep -oE '.{0,80}ws[s]?://[^"]{1,120}' "$F" | head -5
echo
echo "=== checkin page ==="
F=/app/.next/static/chunks/app/checkin/page-188c49aae437ab06.js
grep -oE '.{0,80}ws[s]?://[^"]{1,120}' "$F" | head -5
echo
echo "=== admin ==="
for f in /app/.next/static/chunks/app/admin/page-*.js /app/.next/static/chunks/app/admin/layout-*.js; do
  echo "--- $f ---"
  grep -oE '.{0,50}ws[s]?://[^"]{1,120}' "$f" | head -3
done

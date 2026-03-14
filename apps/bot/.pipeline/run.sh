#!/bin/sh
exec npx tsx "$(dirname "$0")/run.ts" "$@"

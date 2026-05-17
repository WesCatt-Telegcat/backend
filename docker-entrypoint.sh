#!/bin/sh
set -e

attempt=1
max_attempts="${DB_WAIT_MAX_ATTEMPTS:-30}"

until npx prisma db push; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Prisma db push failed after ${attempt} attempts."
    exit 1
  fi

  echo "Database is not ready yet. Retry ${attempt}/${max_attempts} in 3s..."
  attempt=$((attempt + 1))
  sleep 3
done

exec node dist/src/main.js

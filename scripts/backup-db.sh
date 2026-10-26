#!/usr/bin/env bash
set -Eeuo pipefail

# Keep backups outside the web root. DATABASE_URL must be supplied by the service environment.
: "${DATABASE_URL:?DATABASE_URL is required}"
backup_dir="${BACKUP_DIR:-/home/harnet/backups/digital-store}"
retention="${BACKUP_RETENTION:-14}"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/digital-store-$timestamp.dump"
umask 077
pg_dump --format=custom --file="$target" "$DATABASE_URL"
find "$backup_dir" -maxdepth 1 -type f -name 'digital-store-*.dump' -printf '%T@ %p\n' | sort -nr | tail -n +$((retention + 1)) | cut -d' ' -f2- | while IFS= read -r old_backup; do rm -f -- "$old_backup"; done
printf 'Backup created: %s\n' "$target"

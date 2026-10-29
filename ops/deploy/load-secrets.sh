#!/bin/sh
# AGPL-3.0-only. Source this before starting the unmodified backend.
# Files contain lowercase hex, optionally followed by ONE LF. Never log values.
set -eu

read_hex_secret() (
    secret_name=$1
    min_length=$2
    max_length=$3
    secret_file=${VTT_SECRETS_DIR:-/run/secrets}/$secret_name
    fail() { printf 'Invalid or unreadable secret file: %s\n' "$secret_name" >&2; exit 1; }
    test -f "$secret_file" && test -r "$secret_file" || fail
    byte_count=$(wc -c < "$secret_file") || fail
    test "$byte_count" -ge "$min_length" && test "$byte_count" -le "$((max_length + 1))" || fail
    invalid_count=$(LC_ALL=C tr -d '0123456789abcdef\n' < "$secret_file" | wc -c) || fail
    test "$invalid_count" -eq 0 || fail
    newline_count=$(LC_ALL=C tr -cd '\n' < "$secret_file" | wc -c) || fail
    test "$newline_count" -le 1 || fail
    if test "$newline_count" -eq 1; then
        last_byte=$(tail -c 1 "$secret_file" | od -An -tx1 | tr -d ' ') || fail
        test "$last_byte" = 0a || fail
    fi
    value=$(cat "$secret_file") || fail
    test "${#value}" -ge "$min_length" && test "${#value}" -le "$max_length" || fail
    printf '%s' "$value"
)

# These two identifiers become URL components; reject punctuation/whitespace.
DATABASE_USER=${DATABASE_USER:-vtt}
DATABASE_NAME=${DATABASE_NAME:-vtt}
for identifier in "$DATABASE_USER" "$DATABASE_NAME"; do
    case "$identifier" in ''|[!a-z_]*|*[!a-z0-9_]*) echo 'Invalid database identifier' >&2; exit 1 ;; esac
    test "${#identifier}" -le 63 || { echo 'Database identifier too long' >&2; exit 1; }
done
database_password=$(read_hex_secret database_password 32 128) || exit 1
SESSION_SECRET=$(read_hex_secret session_secret 64 64) || exit 1
SETUP_TOKEN=$(read_hex_secret setup_token 64 64) || exit 1
DATABASE_URL="postgresql://$DATABASE_USER:$database_password@database:5432/$DATABASE_NAME"
export DATABASE_URL SESSION_SECRET SETUP_TOKEN
unset database_password identifier

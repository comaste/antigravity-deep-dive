#!/bin/bash
set -euo pipefail

readonly KEYCHAIN_SERVICE="dev.kexi.notion-box-search"
readonly OP_VAULT="${OP_VAULT:-gr4p5pppcegvlhgustjrcocd5a}"
readonly OP_ITEM="${OP_ITEM:-t4pry4hmbshvyomayodaluy4gi}"

readonly -a SECRET_KEYS=(
    "GEMINI_API_KEY"
    "NOTION_API_KEY"
    "NOTION_CLIENT_ID"
    "NOTION_CLIENT_SECRET"
    "BOX_CLIENT_ID"
    "BOX_CLIENT_SECRET"
    "BOX_DEVELOPER_TOKEN"
)

sync_single_secret() {
    local secret_key="$1"
    local op_ref="op://${OP_VAULT}/${OP_ITEM}/${secret_key}"
    local secret_value=""

    secret_value="$(op read "$op_ref" 2>/dev/null)" || {
        echo "Skipped ${secret_key} (not found at ${op_ref})"
        return 0
    }

    if [[ -z "$secret_value" ]]; then
        echo "Skipped ${secret_key} (empty value at ${op_ref})"
        return 0
    fi

    security add-generic-password \
        -U \
        -s "$KEYCHAIN_SERVICE" \
        -a "$secret_key" \
        -w "$secret_value"

    echo "Synced ${secret_key} -> macOS Keychain (service: ${KEYCHAIN_SERVICE})"
}

main() {
    if ! command -v op >/dev/null 2>&1; then
        echo "Error: 1Password CLI (op) is not installed or not in PATH." >&2
        exit 1
    fi

    if ! command -v security >/dev/null 2>&1; then
        echo "Error: macOS security command is not available." >&2
        exit 1
    fi

    for key in "${SECRET_KEYS[@]}"; do
        sync_single_secret "$key"
    done
}

main "$@"

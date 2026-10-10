# Normalize legacy env overrides before stage receipts and CLI requests are built.
# Only exact IDs covered by Google's 3.7 -> 3.8 Flash redirect are migrated.
migrate_deprecated_gemini_model_vars() {
    local model_variable
    for model_variable in "$@"; do
        case "${!model_variable-}" in
            gemini-3.7-flash|models/gemini-3.7-flash)
                printf -v "$model_variable" '%s' 'gemini-3.8-flash'
                ;;
        esac
    done
}

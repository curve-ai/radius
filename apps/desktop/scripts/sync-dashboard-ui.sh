#!/usr/bin/env bash

set -euo pipefail

source_dir="${1:-}"
if [[ -z "${source_dir}" || ! -f "${source_dir}/components.json" ]]; then
  echo "Usage: $0 /absolute/path/to/source_frontend" >&2
  exit 1
fi

desktop_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
renderer_dir="${desktop_dir}/src/renderer"

shared_files=(
  "app/globals.css"
  "styles/utils.css"
)

normalize_file() {
  perl -0pi -e 's/[ \t]+(?=\n)//g; s/\n+\z/\n/' "$1"
}

adapt_ui_file() {
  local filename="$1"
  local path="$2"

  case "${filename}" in
    "popover.tsx")
      perl -0pi -e 's/border p-4 shadow-md outline-hidden/border p-1 shadow-md outline-hidden/' "${path}"
      ;;
    "tooltip.tsx")
      perl -0pi -e 's/border px-3 py-1\.5 text-sm shadow-md/border p-1 text-sm shadow-md/' "${path}"
      ;;
  esac
}

adapted_source_ui() {
  local filename="$1"
  local path="$2"

  case "${filename}" in
    "popover.tsx")
      perl -0pe 's/border p-4 shadow-md outline-hidden/border p-1 shadow-md outline-hidden/' "${path}"
      ;;
    "tooltip.tsx")
      perl -0pe 's/border px-3 py-1\.5 text-sm shadow-md/border p-1 text-sm shadow-md/' "${path}"
      ;;
    *)
      cat "${path}"
      ;;
  esac
}

ui_files=(
  "action-tool-panel.tsx"
  "alert.tsx"
  "avatar.tsx"
  "badge.tsx"
  "button.tsx"
  "card.tsx"
  "dialog.tsx"
  "input.tsx"
  "motion-features.ts"
  "motion.ts"
  "popover.tsx"
  "separator.tsx"
  "sheet.tsx"
  "shortcut-tooltip.tsx"
  "sidebar.tsx"
  "skeleton.tsx"
  "switch.tsx"
  "table.tsx"
  "tooltip.tsx"
)

for relative_path in "${shared_files[@]}"; do
  mkdir -p "${renderer_dir}/$(dirname "${relative_path}")"
  cp "${source_dir}/${relative_path}" "${renderer_dir}/${relative_path}"
  normalize_file "${renderer_dir}/${relative_path}"
done

mkdir -p "${renderer_dir}/src/components/ui"
for filename in "${ui_files[@]}"; do
  cp \
    "${source_dir}/components/ui/${filename}" \
    "${renderer_dir}/src/components/ui/${filename}"
  perl -pi -e 's#\@/#\@renderer/#g' \
    "${renderer_dir}/src/components/ui/${filename}"
  adapt_ui_file \
    "${filename}" \
    "${renderer_dir}/src/components/ui/${filename}"
done

for relative_path in "${shared_files[@]}"; do
  diff -q \
    <(perl -0pe 's/[ \t]+(?=\n)//g; s/\n+\z/\n/' "${source_dir}/${relative_path}") \
    "${renderer_dir}/${relative_path}"
done
for filename in "${ui_files[@]}"; do
  diff -q \
    <(adapted_source_ui \
      "${filename}" \
      "${source_dir}/components/ui/${filename}") \
    <(sed 's#@renderer/#@/#g' "${renderer_dir}/src/components/ui/${filename}")
done

echo "Copied 2 shared style files and ${#ui_files[@]} UI primitives from the source dashboard."

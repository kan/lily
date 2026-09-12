<script setup lang="ts">
/**
 * ツールバーのアイコン。
 *
 * 1 ファイルに閉じてあるのは、`stroke="currentColor"` と大きさの指定を
 * 揃えるため。増えるときはここに足す。
 */
defineProps<{ name: keyof typeof PATHS }>();

const PATHS = {
  bold: '<path d="M6 4h6a4 4 0 0 1 0 8H6zM6 12h7a4 4 0 0 1 0 8H6z"/>',
  italic: '<path d="M15 4h-5M14 20H9M15 4 9 20"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  code: '<path d="m9 18-6-6 6-6M15 6l6 6-6 6"/>',
  block: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 13h7"/>',
  quote: '<path d="M7 7H4v6h5V9M18 7h-3v6h5V9"/><path d="M9 13c0 3-2 4-4 4M20 13c0 3-2 4-4 4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-6 6"/>',
  'ordered-list': '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 4h1v4M3 8h3"/><path d="M3 14h3l-3 4h3"/>',
  table: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M9 10v9M15 10v9"/>',
  rule: '<path d="M4 12h16"/>',
  footnote: '<path d="M5 5h9M5 10h9M5 15h6"/><path d="M17 5v6M15 7l2-2 2 2"/>',
  more: '<path d="m6 9 6 6 6-6"/>',
} as const;
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="PATHS[name]"
  />
</template>

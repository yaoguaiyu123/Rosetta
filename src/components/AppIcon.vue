<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
const paths: Record<string, string> = {
  book: 'M12 6c-2-2-6-2-9-1v14c3-1 7-1 9 1m0-14c2-2 6-2 9-1v14c-3-1-7-1-9 1V6',
  file: 'M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h6',
  left: 'm14 6-6 6 6 6', right: 'm10 6 6 6-6 6',
  minus: 'M5 12h14', plus: 'M5 12h14M12 5v14',
  fit: 'M8 4H4v16h4M16 4h4v16h-4M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  panel: 'M3 4h18v16H3V4m12 0v16',
  outline: 'M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01',
  tint: 'M12 3 5 12a7 7 0 0 0 14 0L12 3m-7 10h14',
  translate: 'M3 5h11M8 3v2m-3 3c1 4 4 6 8 8m-2-8c-1 4-4 6-8 8m12-5 5 10m-5-10-5 10m2-4h6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  check: 'm5 12 4 4L19 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="app-icon"><path :d="paths[name] ?? paths.file" /></svg>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  defaultExpanded,
  findCurrentRow,
  flattenOutline,
  type FlatOutlineRow,
  type OutlineNode
} from '../lib/outline'

const props = defineProps<{ tree: OutlineNode[]; currentPage: number }>()
const emit = defineEmits<{ (e: 'goto', page: number): void }>()

/** 展开的节点 id */
const expanded = ref<Set<string>>(new Set())

watch(
  () => props.tree,
  (tree) => {
    // 换文档时重置展开状态：默认展开顶层分组
    expanded.value = defaultExpanded(tree)
  },
  { immediate: true }
)

const rows = computed(() => flattenOutline(props.tree, expanded.value))
const currentId = computed(() => findCurrentRow(rows.value, props.currentPage))

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function activate(row: FlatOutlineRow) {
  if (row.node.page !== null) emit('goto', row.node.page)
  if (row.hasChildren) toggle(row.node.id)
}
</script>

<template>
  <aside class="outline">
    <div class="outline__head">
      <span>目录</span>
      <span v-if="tree.length" class="tag">{{ rows.length }} 项</span>
    </div>

    <div v-if="tree.length === 0" class="outline__empty">
      <p>这份 PDF 没有内置目录。</p>
      <p>扫描件和不少论文都不带书签。</p>
    </div>

    <div v-else class="outline__body">
      <div
        v-for="row in rows"
        :key="row.node.id"
        class="outline__row"
        :class="{
          'outline__row--on': row.node.id === currentId,
          'outline__row--group': row.node.page === null
        }"
        :style="{ paddingLeft: `${8 + row.depth * 15}px` }"
        :title="row.node.title"
        @click="activate(row)"
      >
        <span
          v-if="row.hasChildren"
          class="outline__chev"
          :class="{ 'outline__chev--open': row.expanded }"
          @click.stop="toggle(row.node.id)"
          >›</span
        >
        <span v-else class="outline__chev outline__chev--leaf" />
        <span class="outline__title">{{ row.node.title }}</span>
        <span v-if="row.node.page !== null" class="outline__page">{{ row.node.page }}</span>
      </div>
    </div>
  </aside>
</template>

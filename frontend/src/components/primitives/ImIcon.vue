<script setup lang="ts">
import { computed } from 'vue';
import { IM_ICONS, type ImIconDef, type ImIconName } from '../../ui/figma-icons';

/**
 * Figma 切图统一渲染件：单色部分吃外层 color（currentColor），
 * brand/onbrand 两类 path 走宿主主题透传变量，暗色自动跟随。
 */
const props = defineProps<{
  name: ImIconName;
  /** 渲染尺寸（px），缺省 16 */
  size?: number;
}>();

// 显式宽化为 ImIconDef，避免 as const 字面量联合缺可选键导致的访问报错
const icon = computed<ImIconDef>(() => IM_ICONS[props.name]);
</script>

<template>
  <svg
    class="im-icon"
    :viewBox="icon.viewBox"
    :width="size ?? 16"
    :height="size ?? 16"
    :style="{ width: `${size ?? 16}px`, height: `${size ?? 16}px` }"
    fill="none"
    aria-hidden="true"
  >
    <path
      v-for="(path, index) in icon.paths"
      :key="index"
      :d="path.d"
      :transform="path.transform"
      :fill-rule="path.fillRule"
      :clip-rule="path.fillRule"
      :class="path.cls && `im-icon__${path.cls}`"
      :fill="path.stroke ? 'none' : 'currentColor'"
      :stroke="path.stroke ? 'currentColor' : undefined"
      :stroke-width="path.stroke"
      :stroke-linecap="path.stroke ? 'round' : undefined"
    />
  </svg>
</template>

<style scoped>
.im-icon { display: block; flex: 0 0 auto; }
/* brand/onbrand 上色由 tokens 壳提供的语义变量决定，不写死 HEX */
.im-icon__brand { fill: var(--im-uikit-brand, #0877f4); }
.im-icon__onbrand { fill: var(--im-uikit-bg-shell, #fff); }
.im-icon path[class] { color: inherit; }
</style>

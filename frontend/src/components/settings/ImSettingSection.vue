<script setup lang="ts">
withDefaults(defineProps<{
  title?: string;
  description?: string;
  divided?: boolean;
}>(), {
  title: undefined,
  description: undefined,
  divided: true
});
</script>

<template>
  <section :class="['im-setting-section', { 'im-setting-section--divided': divided }]">
    <header v-if="title || description || $slots.title || $slots.actions" class="im-setting-section__header">
      <div class="im-setting-section__heading">
        <h3 v-if="title || $slots.title" class="im-setting-section__title">
          <slot name="title">{{ title }}</slot>
        </h3>
        <p v-if="description" class="im-setting-section__description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="im-setting-section__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="im-setting-section__content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
/* Figma 设置浮层：分组内容坐在白色圆角卡上（底=浮层 #f5f5f5） */
.im-setting-section {
  box-sizing: border-box;
  padding: 6px 16px;
}
.im-setting-section--divided { border-bottom: 0; }
.im-setting-section__header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  padding: 0 4px;
}
.im-setting-section__heading { min-width: 0; }
.im-setting-section__title,
.im-setting-section__description { margin: 0; }
.im-setting-section__title {
  color: var(--im-uikit-text-secondary, #666);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}
.im-setting-section__description {
  margin-top: 4px;
  color: var(--im-uikit-text-tertiary, #999);
  font-size: 12px;
  line-height: 18px;
}
.im-setting-section__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.im-setting-section__content {
  min-width: 0;
  border-radius: var(--im-uikit-radius-md, 8px);
  padding: 4px 12px;
  background: var(--im-uikit-bg-bubble, #fff);
}
</style>

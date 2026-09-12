<script setup lang="ts">
import { route } from './router.ts';
import PostEditor from './views/PostEditor.vue';
import PostList from './views/PostList.vue';
import SiteSettings from './views/SiteSettings.vue';
</script>

<template>
  <div class="wrap">
    <PostList v-if="route.name === 'list'" />
    <SiteSettings v-else-if="route.name === 'settings'" />
    <PostEditor
      v-else
      :key="route.publicId ?? 'new'"
      :public-id="route.publicId"
    />
  </div>
</template>

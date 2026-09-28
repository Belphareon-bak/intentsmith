// Vue 3 + Vite Scaffold (v90)
// ══════════════════════════════════════════════════════════════════════════════

export const vueAppScaffold = {
  id: 'vue-app',
  name: 'Vue Application',
  description: 'Vue 3 + Vite with TypeScript, Pinia state management, and Vue Router',
  tags: ['vue', 'vuejs', 'typescript', 'frontend'],
  stack: ['Vue 3', 'Vite', 'TypeScript', 'Pinia'],
  complexity: 'SIMPLE',

  files: [
    {
      path: 'package.json',
      type: 'config',
      template: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "pinia": "^2.1.0",
    "vue": "^3.4.0",
    "vue-router": "^4.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "vue-tsc": "^1.8.0"
  }
}`,
    },
    {
      path: 'src/App.vue',
      type: 'code',
      template: `<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <div class="app">
    <header>
      <nav>
        <h1>{{PROJECT_NAME}}</h1>
        <router-link to="/">Home</router-link>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  font-family: system-ui, sans-serif;
}
header {
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  padding: 0.75rem 1rem;
}
nav {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 1rem;
}
nav h1 {
  font-size: 1.25rem;
  font-weight: bold;
}
main {
  max-width: 72rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}
</style>`,
    },
    {
      path: 'src/main.ts',
      type: 'code',
      template: `import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Home from './views/Home.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
  ],
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');`,
    },
    {
      path: 'src/views/Home.vue',
      type: 'code',
      template: `<script setup lang="ts">
import { useCounterStore } from '../stores/counter';

const counter = useCounterStore();
</script>

<template>
  <div>
    <h2>Welcome</h2>
    <p>Your Vue app is ready.</p>
    <p>Counter: {{ counter.count }}</p>
    <button @click="counter.increment()">+1</button>
  </div>
</template>`,
    },
    {
      path: 'src/stores/counter.ts',
      type: 'code',
      template: `import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useCounterStore = defineStore('counter', () => {
  const count = ref(0);

  function increment() {
    count.value++;
  }

  return { count, increment };
});`,
    },
    {
      path: 'vite.config.ts',
      type: 'config',
      template: `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: { port: 5173 },
});`,
    },
  ],

  postSetup: [
    'npm install',
    'npm run dev',
  ],
};

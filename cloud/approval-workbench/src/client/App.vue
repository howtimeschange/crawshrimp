<script setup lang="ts">
const status = 'Cloud approval workbench scaffold'
</script>

<template>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">Crawshrimp</p>
      <h1>{{ status }}</h1>
      <p>Task 1 placeholder for build verification.</p>
    </section>
  </main>
</template>

<style scoped>
.shell {
  display: grid;
  min-height: 100vh;
  place-items: center;
  margin: 0;
  background: #f6f7f9;
  color: #172033;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.panel {
  width: min(32rem, calc(100vw - 2rem));
  border: 1px solid #d9dee7;
  border-radius: 8px;
  padding: 2rem;
  background: #ffffff;
}

.eyebrow {
  margin: 0 0 0.75rem;
  color: #576176;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 0.75rem;
  font-size: 1.75rem;
  line-height: 1.2;
}

p {
  margin: 0;
}
</style>

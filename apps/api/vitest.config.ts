import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los tests de fechas asumen el calendario chileno; fijar la TZ evita
    // falsos rojos/verdes según la máquina (el prod corre TZ=America/Santiago).
    env: { TZ: 'America/Santiago' },
  },
});

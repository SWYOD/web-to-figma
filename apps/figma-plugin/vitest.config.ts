import { defineConfig } from 'vitest/config'

// Отдельный конфиг от vite.config.ts: тот задаёт root: 'src/ui' для сборки UI
// плагина (single-file HTML), что ломает discovery тестов по всему пакету.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts']
  }
})

import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // 'ws' опционально require()-ит нативные биндинги (bufferutil/utf-8-validate)
    // для ускорения фрейминга — при инлайне Rollup'ом в main-бандл их
    // CJS-интероп ломается ("bufferUtil2.unmask is not a function"). Остальные
    // зависимости (включая ESM-only 'nanoid') остаются инлайн — main-процесс
    // electron-vite собирает в CJS, а require() чистого ESM-пакета в CJS падает
    // (ERR_REQUIRE_ESM); инлайн Rollup'ом эту проблему не имеет.
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['ws']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // Явно IPv4 loopback: без этого Vite биндится на то, во что резолвится
    // голое "localhost" в Node на этой машине -- здесь это оказался ::1-only,
    // а Electron's loadURL('http://localhost:5173') бьёт в 127.0.0.1 и ловит
    // ECONNREFUSED (не race, а стабильный mismatch адресных семейств).
    server: { host: '127.0.0.1' },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})

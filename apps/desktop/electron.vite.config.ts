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
    // 'sharp' (используется в @web-to-figma/asset-engine для WebP→PNG,
    // см. fetchAsset.ts) — нативный N-API модуль, .node-биндинг физически
    // нельзя заинлайнить в один JS-файл; должен остаться require()'ом из
    // реального node_modules (см. package.json build.asarUnpack). Живой баг
    // при первой сборке инсталлятора: electron-builder в pnpm-монорепе не
    // подтягивал транзитивный `optionalDependencies` пакет sharp'а с самим
    // нативным бинарником (`@img/sharp-win32-x64`) — в упакованный
    // `app.asar.unpacked` попадал только чистый JS sharp, без .node-файла,
    // require() в проде упал бы. Фикс — `@img/sharp-win32-x64` объявлен
    // ПРЯМОЙ зависимостью в package.json (не только транзитивно через
    // sharp), тогда electron-builder видит его в графе и копирует. При
    // сборке под mac аналогично понадобится `@img/sharp-darwin-x64`/`-arm64`.
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['ws', 'sharp']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // Отдельный, СИЛЬНО урезанный preload для вкладок встроенного
          // браузера (см. main/browser.ts newTab — оба контроллера, main и
          // референс) — по запросу пользователя добавляет гугловское
          // автодополнение прямо на статичную стартовую страницу
          // (main/startPage.ts, обычный data: URL без доступа к основному
          // window.api). Собирается в отдельный файл, а не расширяет
          // index.ts — тот полный API никогда не должен доставаться
          // произвольным сайтам, которые пользователь открывает в этом же
          // браузере.
          browserTab: resolve(__dirname, 'src/preload/browserTab.ts')
        }
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

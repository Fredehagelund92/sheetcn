import { resolve } from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The workspace packages are bundled from source, so the playground needs no
// package build first.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sheetcn/core": resolve(
        import.meta.dirname,
        "../../packages/core/src/index.ts"
      ),
      "@sheetcn/react": resolve(
        import.meta.dirname,
        "../../packages/react/src/index.ts"
      ),
    },
  },
})

// Dev server for browser tests that must never reach the real platform:
// rewrites the sync ENDPOINT to an address nothing listens on.
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import base from '../vite.config'

const deadEndpoint: Plugin = {
  name: 'dead-endpoint',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith('/src/sync.ts')) return null
    return code.replace("'https://id.devondoes.dev/api/mise'", "'http://127.0.0.1:9/api/mise'")
  },
}

export default mergeConfig(base, defineConfig({ plugins: [deadEndpoint], server: { port: 5174, strictPort: true } }))

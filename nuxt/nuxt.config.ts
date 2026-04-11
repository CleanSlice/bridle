import { fileURLToPath } from 'url'
const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  alias: {
    '#bridle': currentDir,
  },
  components: [
    { path: `${currentDir}/components`, pathPrefix: false },
  ],
})

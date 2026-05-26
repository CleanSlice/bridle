import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import HeroDemo from './components/HeroDemo.vue'
import BridleEmbed from './components/BridleEmbed.vue'
import './cleanslice.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h(HeroDemo),
    })
  },
  enhanceApp({ app }) {
    // Globally registered so any markdown page can drop
    // `<BridleEmbed ... />` to render a live inline chat.
    app.component('BridleEmbed', BridleEmbed)
  },
}

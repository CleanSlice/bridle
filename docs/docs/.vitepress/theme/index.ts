import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import HeroDemo from './components/HeroDemo.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h(HeroDemo),
    })
  },
}

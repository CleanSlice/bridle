import { defineConfig } from 'vitepress'

export default defineConfig({
  srcDir: '.',
  appearance: 'dark',
  title: 'Bridle',
  description: 'Embed an AI agent chat into any website with a single <script> tag.',
  // Disabled — DigitalOcean Static Sites doesn't strip `.html` from URLs the
  // way Netlify/Vercel do, so `cleanUrls: true` plus a direct browser hit on
  // `/embed/npm` returned 404 (only SPA navigation from another page worked,
  // because Vue Router handled the mapping client-side). With this off,
  // internal links include `.html` and every URL works on direct load.
  cleanUrls: false,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#0070f3' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Bridle — embeddable AI chat' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Drop a single <script> tag into any site to talk to your agent.',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://bridle.cleanslice.org' }],
    // Floating chat bubble on every docs page. Public agent — origin is
    // whitelisted on the hub so no JWT is needed. The SDK auto-mounts into
    // document.body, so SPA navigation between docs pages keeps the chat
    // and its connection alive (the element lives outside Vue's tree).
    [
      'script',
      {
        src: '/sdk/latest.js',
        'data-api-url': 'https://api.ranch.cleanslice.org',
        'data-agent-id': 'agent-74c579f3-4700-4531-84f6-f8a621f98fa3',
        'data-mode': 'floating',
        'data-title': 'Ask Bridle',
        'data-placeholder': 'Ask about embedding, the protocol, deploy…',
        'data-theme': 'cleanslice',
        defer: '',
      },
    ],
  ],

  sitemap: {
    hostname: 'https://bridle.cleanslice.org',
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Examples', link: '/examples/basic' },
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Embed', link: '/embed/script-tag' },
      { text: 'Protocol', link: '/protocol/overview' },
      { text: 'Deploy', link: '/deploy/hub' },
      {
        text: 'Resources',
        items: [
          { text: 'SDK on npm', link: 'https://www.npmjs.com/package/@cleanslice/bridle' },
          { text: 'GitHub', link: 'https://github.com/CleanSlice/bridle' },
          { text: 'CleanSlice', link: 'https://cleanslice.org' },
        ],
      },
    ],

    sidebar: {
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: '01 · Basic', link: '/examples/basic' },
            { text: '02 · Inline', link: '/examples/inline' },
            { text: '03 · Styles', link: '/examples/styles' },
            { text: '04 · Authenticator', link: '/examples/authenticator' },
          ],
        },
      ],
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: 'How It Works', link: '/guide/concepts' },
          ],
        },
      ],
      '/embed/': [
        {
          text: 'Embed',
          items: [
            { text: 'Script Tag', link: '/embed/script-tag' },
            { text: 'NPM (Bundler)', link: '/embed/npm' },
            { text: 'Headless Client', link: '/embed/headless' },
            { text: 'Theming', link: '/embed/theming' },
          ],
        },
      ],
      '/protocol/': [
        {
          text: 'Protocol',
          items: [
            { text: 'Overview', link: '/protocol/overview' },
            { text: 'Authentication', link: '/protocol/authentication' },
            { text: 'Message Parts', link: '/protocol/parts' },
            { text: 'Streaming', link: '/protocol/streaming' },
            { text: 'WebSocket Events', link: '/protocol/websocket' },
            { text: 'HTTP API', link: '/protocol/http' },
          ],
        },
      ],
      '/deploy/': [
        {
          text: 'Deploy',
          items: [
            { text: 'Hub Server', link: '/deploy/hub' },
            { text: 'Agent Runtime', link: '/deploy/runtime' },
            { text: 'SDK Hosting', link: '/deploy/sdk' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/CleanSlice/bridle' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Built with CleanSlice',
    },

    outline: {
      level: [2, 3],
    },

    editLink: {
      pattern: 'https://github.com/CleanSlice/bridle/edit/main/docs/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})

# 03 · Styles

Three layers of customization, smallest blast radius first:

1. **`theme`** — pick a built-in palette (`default` or `cleanslice`).
2. **`themeVars`** — override any `--bridle-*` CSS custom property.
3. **`customCss`** — inject CSS into the shadow root for internal classes that variables can't reach.

## Snippet

```js
Bridle.init({
  apiUrl,
  agentId,
  token,
  mode: 'inline',
  mount: '#chat-styled',
  title: 'Helper',
  theme: 'cleanslice',
  colorMode: 'light',
  themeVars: {
    '--bridle-primary': '#6366f1',
    '--bridle-radius': '14px',
  },
  customCss: `
    .bridle__panel {
      border: 1px solid #c7d2fe;
      box-shadow: 0 8px 24px rgba(99, 102, 241, 0.18);
      border-radius: 14px;
    }
  `,
})
```

## Live demo

<BridleEmbed
  title="Helper"
  theme="cleanslice"
  color-mode="light"
  :theme-vars="{ '--bridle-primary': '#6366f1', '--bridle-radius': '14px' }"
  custom-css=".bridle__panel { border: 1px solid #c7d2fe; box-shadow: 0 8px 24px rgba(99, 102, 241, 0.18); border-radius: 14px; }"
/>

## How they layer

| Layer | Reaches | Use when |
|-------|---------|----------|
| `theme` | Picks the base palette | You want a coherent starting point |
| `themeVars` | Anything bound to `--bridle-*` | Recolor / re-radius — most cases |
| `customCss` | Internal classes inside shadow DOM (`.bridle__panel`, `.bridle__bubble`, …) | Variables aren't enough — you need to restyle an internal element |

CSS custom properties cross the shadow boundary; ordinary host-page CSS does not. That's why `customCss` is injected **into** the shadow root via a `<style>` tag — host stylesheets simply cannot reach those internals from outside.

## `colorMode`

| Value | Behavior |
|-------|----------|
| `'auto'` (default) | Follows the host page: `<html class="dark">` first, then `prefers-color-scheme` |
| `'light'` | Forces light |
| `'dark'` | Forces dark |

## External stylesheet

For larger overrides, ship a real `.css` file and load it into the shadow root:

```js
Bridle.init({
  apiUrl, agentId, token,
  mode: 'inline',
  mount: '#chat',
  stylesheets: ['/css/bridle-overrides.css'], // or comma-separated for many
})
```

## Next

Full variable list and theming patterns — [Embed → Theming](/embed/theming).

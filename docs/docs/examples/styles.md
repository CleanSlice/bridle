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

## Styling image attachments

The paperclip button, the staged-thumbnail strip and the drag-over overlay (all on by default since v0.9.0) expose their own classes — restyle them through the same `customCss` channel:

```js
Bridle.init({
  apiUrl, agentId, token,
  mode: 'inline',
  mount: '#chat-styled',
  customCss: `
    .bridle__attach { border-color: #6366f1; color: #6366f1; }
    .bridle__attachments { background: #eef2ff; }
    .bridle__attachment { border-color: #c7d2fe; }
    .bridle__drop-overlay { background: rgba(99, 102, 241, 0.18); border-color: #6366f1; }
    .bridle__drop-hint { color: #4338ca; }
    .bridle__msg-image { max-width: 280px; }
  `,
})
```

Full class reference — [Theming › Internal classes you can target](/embed/theming#internal-classes-you-can-target).

## Next

Full variable list and theming patterns — [Embed → Theming](/embed/theming).

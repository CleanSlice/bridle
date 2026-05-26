# 02 · Inline

Mount the chat inside a specific container instead of the floating bubble. Useful for support pages, dashboard panels, or anywhere the chat should be part of the page flow.

## Snippet

```js
Bridle.init({
  apiUrl,
  agentId,
  token,
  mode: 'inline',
  mount: '#chat-inline',
  title: 'Support',
})
```

The container's size defines the chat's size:

```html
<div id="chat-inline" style="height: 520px"></div>
```

## Live demo

<BridleEmbed title="Support chat" />

## What changes vs. floating

| Option | Floating (default) | Inline |
|--------|--------------------|--------|
| `mode` | `'floating'` | `'inline'` |
| `mount` | `<body>` | your container selector |
| Position | fixed bottom-right | flows with the page |
| FAB | yes (toggles panel) | no — chat is always open |
| Height | `560px` / clamped to viewport | `100%` of the container, min `480px` |

## Why call `init()` instead of using `<script data-*>`

Auto-mount is one widget per script tag. The programmatic form lets you:

- Mount **multiple widgets** on the same page (one `init()` call each).
- Pass a **function for `token`** (see [Authenticator](/examples/authenticator)).
- Wire **`onReady` / `onMessage` / `onError`** callbacks.

The `data-mode="inline"` / `data-mount` attributes work too — pick whichever fits your loading order.

## Next

- [Styles](/examples/styles) — theme, CSS variables, custom CSS in the shadow root.
- [Embed → Theming](/embed/theming) — full reference for visual customization.

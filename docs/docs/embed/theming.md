# Theming

The chat widget uses **Shadow DOM** for style isolation. Override appearance via CSS custom properties — they pierce the shadow boundary cleanly.

## CSS variables

| Variable | Default (light) | Default (dark) | Purpose |
|----------|-----------------|----------------|---------|
| `--bridle-primary` | `#0070f3` | `#0070f3` | Brand color (FAB, send button, user bubbles) |
| `--bridle-primary-fg` | `#ffffff` | `#ffffff` | Foreground on primary |
| `--bridle-bg` | `#ffffff` | `#0f172a` | Panel background |
| `--bridle-fg` | `#111827` | `#f1f5f9` | Body text |
| `--bridle-muted` | `#6b7280` | `#94a3b8` | Secondary text |
| `--bridle-bubble-bg` | `#f3f4f6` | `#1e293b` | Assistant bubble background |
| `--bridle-border` | `#e5e7eb` | `#334155` | Borders, dividers |
| `--bridle-radius` | `14px` | `14px` | Panel + bubble corner radius |
| `--bridle-shadow` | `0 12px 32px rgba(0,0,0,.16)` | `0 12px 32px rgba(0,0,0,.16)` | Panel/FAB shadow |
| `--bridle-z` | `2147483600` | `2147483600` | z-index of the floating panel |
| `--bridle-font` | system stack | system stack | Font family |

The widget switches to its dark palette automatically when `prefers-color-scheme: dark`. Explicit overrides win.

## Override via CSS

The simplest approach — target the custom element directly:

```css
bridle-chat {
  --bridle-primary: #ec4899;       /* hot pink */
  --bridle-primary-fg: #ffffff;
  --bridle-radius: 8px;
  --bridle-font: 'Inter', sans-serif;
}
```

Place this in your site's regular stylesheet. The variables propagate through the shadow boundary.

## Override via the `theme` option

When using `init()` programmatically, pass a `theme` map. Keys can include or omit the leading `--`:

```ts
init({
  apiUrl,
  agentId,
  token,
  theme: {
    '--bridle-primary': '#0070f3',
    'bridle-radius': '8px',          // also accepted
    'bridle-bubble-bg': '#f0f9ff',
  },
})
```

These set `style="..."` on the `<bridle-chat>` element, so they win over external CSS without requiring `!important`.

## Override via `data-*` (script tag)

Drop-in embeds can ship overrides via two attributes:

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="agent-abc-123"
  data-stylesheet="/css/bridle-overrides.css"
></script>
```

| Attribute | Description |
|-----------|-------------|
| `data-custom-css` | Inline CSS string injected into the shadow root |
| `data-stylesheet` | One URL, or several comma-separated URLs, loaded as `<link rel="stylesheet">` inside the shadow root |

See [Overriding internal classes](#overriding-internal-classes) below for what these unlock.

## Overriding internal classes

CSS variables cover the design tokens (colors, radius, shadow, font). To restyle the actual class rules — `.bridle__panel`, `.bridle__bubble`, `.bridle__header`, etc. — you need to inject CSS **inside** the shadow root. Host-page CSS can't reach those selectors.

`init()` accepts two options:

```ts
init({
  apiUrl,
  agentId,
  token,
  // Inline CSS — appended as <style> inside the shadow root.
  customCss: `
    .bridle__panel {
      border-radius: 5px;
      box-shadow: 0 2px 6px #00000029;
      border: 1px solid #C5D5FF;
    }
    .bridle__bubble {
      font-size: 13px;
    }
  `,
  // External file(s) — appended as <link rel="stylesheet"> inside the shadow root.
  stylesheets: ['/css/bridle-overrides.css'],
})
```

Drop-in equivalent:

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="agent-abc-123"
  data-stylesheet="/css/bridle-overrides.css, /css/bridle-typography.css"
></script>
```

Cascade order: your overrides are appended **after** the component's own `<style>`, so equal-specificity rules win without `!important`.

### Internal classes you can target

| Class | What it is |
|-------|------------|
| `.bridle__panel` | The chat panel (floating window or inline container) |
| `.bridle__header` | Header row with title and close button |
| `.bridle__messages` | Scrollable message list |
| `.bridle__bubble` | A single message bubble (assistant or user) |
| `.bridle__bubble--md` | Assistant bubble with rendered Markdown |
| `.bridle__msg--user` / `.bridle__msg--assistant` | Bubble wrapper per role |
| `.bridle__input` | Footer composer (textarea + send button) |
| `.bridle__fab` | Floating action button (floating mode only) |
| `.bridle__typing` | Three-dot typing indicator |
| `.bridle__banner--error` | Connection-error banner |

These class names are part of the SDK's public surface — they won't be renamed without a major-version bump.

## Match a specific brand

A few common combos as a starting point:

```css
/* GitHub-ish */
bridle-chat {
  --bridle-primary: #2da44e;
  --bridle-radius: 6px;
}

/* Vercel-ish */
bridle-chat {
  --bridle-primary: #000000;
  --bridle-primary-fg: #ffffff;
  --bridle-radius: 8px;
}

/* Stripe-ish */
bridle-chat {
  --bridle-primary: #635bff;
  --bridle-radius: 10px;
}
```

## Positioning the floating bubble

The widget defaults to bottom-right at `right: 20px; bottom: 20px`. To move it, target the host element:

```css
bridle-chat {
  /* widget itself is fixed-positioned in floating mode — set inset on the host */
  right: auto;
  left: 20px;       /* bottom-left */
  bottom: 100px;    /* avoid covering an existing UI element */
}
```

## Custom FAB icon

The floating button in the bottom-right corner ships with a built-in chat-bubble glyph. To swap it for your own, pass `fabIcon` — any URL the browser can render in `<img>` works (`.svg`, `.png`, `.webp`, or a `data:` URI). The container stays 56×56 with the brand background (`--bridle-primary`); only the glyph changes.

```ts
init({
  apiUrl,
  agentId,
  token,
  fabIcon: '/icons/chat.svg',
})
```

Drop-in equivalent via `data-fab-icon`:

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="agent-abc-123"
  data-token="<jwt>"
  data-fab-icon="/icons/chat.svg"
></script>
```

### Inline SVG via `data:` URI

Skips the extra HTTP request and lets you bake the color into the SVG itself (`currentColor` is not honored from an `<img>` `src`). Encode `#` as `%23`:

```ts
init({
  apiUrl,
  agentId,
  token,
  fabIcon:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' " +
    "viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' " +
    "stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M12 2L2 7l10 5 10-5-10-5z'/>" +
    "<path d='M2 17l10 5 10-5'/>" +
    "<path d='M2 12l10 5 10-5'/>" +
    "</svg>",
})
```

### Resizing the button

The FAB is 56×56 by default and the icon inside is 24×24. To enlarge both, target the internal classes via [`customCss`](#overriding-internal-classes):

```ts
init({
  apiUrl, agentId, token,
  fabIcon: '/icons/chat.svg',
  customCss: `
    .bridle__fab { width: 64px; height: 64px; }
    .bridle__fab-icon { width: 28px; height: 28px; }
  `,
})
```

## Sizing in inline mode

In `mode: 'inline'`, the widget fills its mount container. Set the dimensions on the parent:

```html
<div id="chat" style="width: 380px; height: 600px;"></div>
<script src=".../sdk/latest.js"
        data-mode="inline"
        data-mount="#chat"
        data-agent-id="..."
        data-token="..."></script>
```

## Custom font

The widget inherits the font from `--bridle-font`. To use Inter or a custom font:

```html
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">

<style>
  bridle-chat { --bridle-font: 'Inter', sans-serif; }
</style>
```

The font itself must be loaded by the host page — Shadow DOM doesn't fetch web fonts on its own.

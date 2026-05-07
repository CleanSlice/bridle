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

Not directly. Theme via CSS or programmatic `init()`. The drop-in script intentionally keeps `data-*` minimal.

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

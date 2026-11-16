# SDK Auto-Popup (Proactive Teaser) — Design

**Date:** 2026-08-04
**Status:** Approved
**Scope:** `sdk/` only. Integrations (Skyhunter etc.) are follow-up tasks.

## Problem

The floating widget (`mode: 'floating'`) renders a FAB in the corner, but stays
silent until the visitor clicks it. Competitors (reference: Autodesk Assistant)
show a proactive greeting card above the closed FAB — title, message, close
button — which measurably increases engagement. The SDK has `greeting` /
`greetingDelay`, but those render *inside* the opened panel; there is no
pre-open teaser. Integrators must be able to disable the teaser entirely.

## Decision

Add the teaser natively to the SDK custom element (approach chosen over
(a) reusing `greeting` for both roles — conflates in-chat copy with teaser
copy — and (b) leaving it to each integrator site — duplicated work,
inconsistent UX).

## API

Three new `IBridleInitOptions` fields, mirrored as attributes on
`<bridle-chat>` and as `data-*` attributes for script-tag embeds:

| init option | element attribute | data-attr | type | default |
|---|---|---|---|---|
| `popup` | `popup` | `data-popup` | `string` | — (absent ⇒ feature off) |
| `popupTitle` | `popup-title` | `data-popup-title` | `string` | — |
| `popupDelay` | `popup-delay` | `data-popup-delay` | `number` (ms) | `3000` |

- `popup` is the enable switch: no text ⇒ no teaser. This is the "flexible
  off-switch" requirement.
- `popup` body renders markdown through the same `marked` + `DOMPurify`
  pipeline as chat messages.
- Floating mode only. In `mode: 'inline'` the options are ignored.
- `popupDelay` accepts `number | string` on the prop (attributes arrive as
  strings), same coercion pattern as `greetingDelay`.

## Behavior

Show the teaser when ALL hold, `popupDelay` ms after mount:

1. `mode === 'floating'` and the panel is closed (`!isOpen`);
2. `popup` text is non-empty;
3. localStorage flag `bridle:popup-dismissed:<agentId>` is absent.

Transitions:

- Click on the card body → open the panel + set the flag + hide teaser.
- Click on the ✕ button → hide teaser + set the flag.
- Panel opened by any other path (FAB click, `defaultOpen`, programmatic
  `open()`) → set the flag and never show; if the timer is pending, cancel it.
- `Escape` while the teaser is visible → same as ✕.

Persistence: dismissal is permanent per agent (localStorage). Storage
unavailable (privacy mode) ⇒ swallow the error and show the teaser anyway —
same try/catch convention as the existing `bridle:anon:<agentId>` key. The
flag is scoped per `agentId` so two widgets on one origin don't interfere.

## Markup & styling

New block inside the `.bridle--floating` root, sibling of `.bridle__fab`:

```html
<div class="bridle__popup" role="status" aria-live="polite">
  <button class="bridle__popup-close" aria-label="Dismiss">✕</button>
  <div class="bridle__popup-title">👋 Hi, I'm Assistant!</div>
  <div class="bridle__popup-body"><!-- sanitized markdown --></div>
</div>
```

- Absolutely positioned above the FAB, right-aligned with it; max-width
  ~300px; card look (radius, shadow, border) built from existing `--bridle-*`
  custom properties so themes, `themeVars`, and `customCss` keep working with
  zero changes.
- Enter animation: fade + short upward slide (CSS only, `prefers-reduced-motion`
  respected).
- Clickable body gets `cursor: pointer` and hover affordance; the ✕ button
  stops propagation so it doesn't open the panel.

## Error handling

- Markdown sanitization identical to message rendering (no new sink).
- All storage reads/writes wrapped in try/catch.
- Timer cleared on unmount (`onBeforeUnmount`), mirroring `greetingTimer`.

## Testing & verification

The SDK has no unit-test harness; verification is:

1. `npm run typecheck` (vue-tsc) and `npm run build` in `sdk/`;
2. manual pass via `example/index.html` — extend the example with
   `data-popup*` attributes;
3. manual checks: shows after delay; body click opens chat; ✕ dismisses;
   reload after dismiss ⇒ stays hidden; `defaultOpen` ⇒ never shows;
   inline mode ⇒ never shows.

## Docs & release

- Document the options in `sdk/README.md` (init options table + script-tag
  attrs) and in the example.
- Version: minor bump to `0.14.0` in `sdk/package.json`.
- Release: push tag `sdk-v0.14.0` after merge (CI verifies tag ↔ version and
  publishes to npm). Tag is pushed only after explicit user confirmation.

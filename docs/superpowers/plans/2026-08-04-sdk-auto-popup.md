# SDK Auto-Popup (Proactive Teaser) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dismissible proactive teaser card ("auto-popup") above the closed floating FAB, configurable via `popup` / `popupTitle` / `popupDelay` init options and `data-popup*` script-tag attributes.

**Architecture:** The teaser renders inside the existing `<bridle-chat>` custom element (shadow DOM), as a sibling of `.bridle__fab` in the `.bridle--floating` container. Behavior follows the existing `greeting` conventions: string-coercible props, timers cancelled on unmount, localStorage guarded by try/catch. Dismissal is permanent per agent via `bridle:popup-dismissed:<agentId>`.

**Tech Stack:** Vue 3 custom element (`defineCustomElement`), TypeScript, Vite build, `marked` + `DOMPurify` for markdown. No unit-test harness exists in `sdk/` — verification is `vue-tsc` typecheck, Vite build, and a manual pass via the example page.

**Spec:** `docs/superpowers/specs/2026-08-04-sdk-auto-popup-design.md` (approved).

## Global Constraints

- Work in repo `/Users/maksymtmk/my-knowledge/bridle`, branch `feat/sdk-auto-popup` (already created).
- Floating mode only: in `mode: 'inline'` the options are ignored.
- `popup` absent/empty ⇒ feature fully off (this is the off-switch requirement).
- `popupDelay` default is exactly `3000` ms; `0` means "show immediately".
- localStorage key is exactly `bridle:popup-dismissed:<agentId>`; all storage access wrapped in try/catch (privacy-mode convention of the existing `bridle:anon:` key).
- Markdown in `popup` must go through the existing `renderMarkdown()` (marked + DOMPurify) — no new sanitization path.
- Styling uses existing `--bridle-*` custom properties only; no hardcoded colors.
- Version bump: `sdk/package.json` `0.13.3` → `0.14.0`. Do NOT push the `sdk-v0.14.0` tag — that happens after merge, on explicit user confirmation.
- Verification commands run from `sdk/`: `npm run typecheck` and `npm run build`.

---

### Task 1: Public API plumbing — types + `init()` + `autoMount()`

**Files:**
- Modify: `sdk/src/types.ts` (insert after `greetingDelay?: number`, line ~179)
- Modify: `sdk/src/index.ts` (attribute mapping ~line 117, `autoMount()` ~line 228)

**Interfaces:**
- Consumes: existing `IBridleInitOptions`, `init()`, `autoMount()`.
- Produces: `IBridleInitOptions.popup?: string`, `popupTitle?: string`, `popupDelay?: number`; element attributes `popup`, `popup-title`, `popup-delay`; data-attrs `data-popup`, `data-popup-title`, `data-popup-delay`. Task 2's component props must match these attribute names.

- [ ] **Step 1: Install SDK deps (fresh clone has no node_modules)**

Run: `cd /Users/maksymtmk/my-knowledge/bridle/sdk && npm install`
Expected: installs from `package-lock.json` without errors.

- [ ] **Step 2: Add the three options to `IBridleInitOptions`**

In `sdk/src/types.ts`, directly after the `greetingDelay?: number` member (line ~179), insert:

```ts
  /**
   * Text of the proactive teaser card shown above the closed floating FAB
   * (auto-popup), inviting the visitor to chat. Markdown is supported.
   * Absent/empty ⇒ the teaser is disabled. Floating mode only. Dismissing
   * it (✕) or opening the chat is remembered per agent in localStorage
   * (`bridle:popup-dismissed:<agentId>`) and the teaser never re-appears.
   */
  popup?: string
  /** Bold headline above the `popup` text, e.g. "👋 Hi, I'm Assistant!". */
  popupTitle?: string
  /**
   * Milliseconds after mount before the teaser appears. Default: 3000.
   * Set to 0 to show immediately.
   */
  popupDelay?: number
```

- [ ] **Step 3: Map options to element attributes in `init()`**

In `sdk/src/index.ts`, directly after the `greeting-delay` block (lines 114–117):

```ts
  if (opts.greeting) el.setAttribute('greeting', opts.greeting)
  if (opts.greetingDelay !== undefined) {
    el.setAttribute('greeting-delay', String(opts.greetingDelay))
  }
```

add:

```ts
  if (opts.popup) el.setAttribute('popup', opts.popup)
  if (opts.popupTitle) el.setAttribute('popup-title', opts.popupTitle)
  if (opts.popupDelay !== undefined) {
    el.setAttribute('popup-delay', String(opts.popupDelay))
  }
```

- [ ] **Step 4: Parse the data-attrs in `autoMount()`**

In the same file, inside the `init({...})` call of `autoMount()`, directly after `greetingDelay: ds.greetingDelay ? Number(ds.greetingDelay) : undefined,` (line ~228), add:

```ts
    popup: ds.popup,
    popupTitle: ds.popupTitle,
    popupDelay: ds.popupDelay ? Number(ds.popupDelay) : undefined,
```

(dataset camelCases automatically: `data-popup-title` → `ds.popupTitle`.)

- [ ] **Step 5: Typecheck**

Run: `cd /Users/maksymtmk/my-knowledge/bridle/sdk && npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/maksymtmk/my-knowledge/bridle
git add sdk/src/types.ts sdk/src/index.ts
git commit -m "feat(sdk): popup/popupTitle/popupDelay init options + data-attrs"
```

---

### Task 2: Teaser behavior, markup and styles in the component

**Files:**
- Modify: `sdk/src/BridleChat.ce.vue`
  - props block (~line 112, after `greetingDelay`)
  - state refs (~line 172, after `greetingTimer`)
  - functions (after `cancelGreetingTimer`, ~line 730)
  - `onDocKeydown` (~line 849)
  - `onMounted` / `onBeforeUnmount` (~lines 911–931)
  - template (~line 948, before the FAB button)
  - styles (~line 1507, after `.bridle__fab-icon`)

**Interfaces:**
- Consumes: attributes `popup`, `popup-title`, `popup-delay` from Task 1; existing `isOpen`, `toggle()`, `renderMarkdown()`, `coerceBool` conventions.
- Produces: shadow-DOM classes `.bridle__popup`, `.bridle__popup-card`, `.bridle__popup-title`, `.bridle__popup-body`, `.bridle__popup-close` (documented restyle surface for `customCss`); localStorage key `bridle:popup-dismissed:<agentId>`.

- [ ] **Step 1: Add props**

In the `defineProps` block, directly after the `greetingDelay?: number | string` member (line ~112), insert:

```ts
    /**
     * Text of the proactive teaser card shown above the closed floating
     * FAB (auto-popup). Markdown is supported. Empty/absent ⇒ disabled.
     * Floating mode only. Dismissal (✕ or opening the chat) is remembered
     * per agent in localStorage and the teaser never re-appears.
     */
    popup?: string
    /** Bold headline above the `popup` text. */
    popupTitle?: string
    /**
     * Milliseconds after mount before the teaser appears. Default: 3000.
     * Attributes arrive as strings, hence `number | string`.
     */
    popupDelay?: number | string
```

No new entries in `withDefaults` — all three are optional with in-code fallbacks.

- [ ] **Step 2: Add state**

After the `let greetingTimer: ReturnType<typeof setTimeout> | null = null` line (~172), insert:

```ts
// Pre-open teaser (auto-popup). Timer is one-shot; every exit path
// (open, dismiss, unmount) cancels it so the card can't resurface.
const popupVisible = ref(false)
let popupTimer: ReturnType<typeof setTimeout> | null = null
```

- [ ] **Step 3: Add behavior functions**

Directly after `cancelGreetingTimer()` (line ~730), insert:

```ts
const POPUP_DISMISSED_PREFIX = 'bridle:popup-dismissed:'

function isPopupDismissed(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return (
      window.localStorage.getItem(POPUP_DISMISSED_PREFIX + props.agentId) === '1'
    )
  } catch {
    // Storage disabled (privacy mode) — treat as not dismissed so the
    // teaser still shows; we just can't remember the dismissal.
    return false
  }
}

function markPopupDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(POPUP_DISMISSED_PREFIX + props.agentId, '1')
  } catch {
    // Best-effort — same convention as the `bridle:anon:` key.
  }
}

function cancelPopupTimer(): void {
  if (popupTimer) {
    clearTimeout(popupTimer)
    popupTimer = null
  }
}

// Schedule the teaser once from onMounted. Floating mode only, closed
// panel only, and never after a remembered dismissal.
function maybeShowPopup(): void {
  if (props.mode !== 'floating') return
  if (isOpen.value) return
  const text = props.popup?.trim()
  if (!text) return
  if (isPopupDismissed()) return

  const raw =
    typeof props.popupDelay === 'string' ? Number(props.popupDelay) : props.popupDelay
  const delay = Number.isFinite(raw) && raw !== undefined ? Math.max(0, raw as number) : 3000

  popupTimer = setTimeout(() => {
    popupTimer = null
    if (isOpen.value) return
    popupVisible.value = true
  }, delay)
}

function dismissPopup(): void {
  cancelPopupTimer()
  popupVisible.value = false
  markPopupDismissed()
}

function onPopupClick(): void {
  dismissPopup()
  if (!isOpen.value) toggle()
}
```

- [ ] **Step 4: Dismiss when the panel opens by any path**

Near the other watchers (e.g. directly after the `watch(() => [props.theme, props.colorMode], ...)` block, line ~909), add:

```ts
// Opening the chat by ANY path (FAB, defaultOpen, programmatic open())
// counts as engagement: hide the teaser and remember the dismissal.
watch(isOpen, (open) => {
  if (!open) return
  if (!props.popup?.trim()) return
  dismissPopup()
})
```

- [ ] **Step 5: Escape hides the teaser**

Replace the existing `onDocKeydown` (lines ~849–853):

```ts
function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menuOpen.value) {
    menuOpen.value = false
  }
}
```

with:

```ts
function onDocKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (menuOpen.value) menuOpen.value = false
  if (popupVisible.value) dismissPopup()
}
```

- [ ] **Step 6: Wire lifecycle**

In `onMounted` (line ~911), after the `if (!props.apiUrl || !props.agentId) return` guard and before `await connect()`, add one line:

```ts
  maybeShowPopup()
```

In `onBeforeUnmount` (line ~922), after `cancelGreetingTimer()`, add one line:

```ts
  cancelPopupTimer()
```

- [ ] **Step 7: Template**

In the template, inside the root `<div :class="['bridle', ...]">` (line 948), directly BEFORE the `<button v-if="mode === 'floating'" class="bridle__fab" ...>` block, insert:

```html
    <div
      v-if="mode === 'floating' && popupVisible && !isOpen"
      class="bridle__popup"
      role="status"
    >
      <button
        type="button"
        class="bridle__popup-close"
        aria-label="Dismiss"
        @click.stop="dismissPopup"
      >
        ×
      </button>
      <div
        class="bridle__popup-card"
        role="button"
        tabindex="0"
        @click="onPopupClick"
        @keydown.enter.prevent="onPopupClick"
        @keydown.space.prevent="onPopupClick"
      >
        <div v-if="popupTitle" class="bridle__popup-title">{{ popupTitle }}</div>
        <div class="bridle__popup-body" v-html="renderMarkdown(popup ?? '')" />
      </div>
    </div>
```

- [ ] **Step 8: Styles**

After the `.bridle__fab-icon` rule (line ~1507), insert:

```css
/* ---- Pre-open teaser (auto-popup) ---- */
.bridle__popup {
  position: absolute;
  bottom: 68px;
  right: 0;
  width: max-content;
  max-width: min(300px, calc(100vw - 40px));
  background: var(--bridle-bg-elv);
  color: var(--bridle-fg);
  border: 1px solid var(--bridle-border);
  border-radius: var(--bridle-radius);
  box-shadow: var(--bridle-shadow);
  padding: 12px 14px;
  animation: bridle-popup-in 0.25s ease-out both;
}
@media (prefers-reduced-motion: reduce) {
  .bridle__popup { animation: none; }
}
@keyframes bridle-popup-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.bridle__popup-card { cursor: pointer; }
.bridle__popup-card:focus-visible {
  outline: 2px solid var(--bridle-focus-ring);
  outline-offset: 2px;
  border-radius: 6px;
}
.bridle__popup-title {
  font-weight: 600;
  font-size: 14px;
  padding-right: 20px;
}
.bridle__popup-body {
  font-size: 13px;
  color: var(--bridle-muted);
}
.bridle__popup-title + .bridle__popup-body { margin-top: 4px; }
.bridle__popup-body :first-child { margin-top: 0; }
.bridle__popup-body :last-child { margin-bottom: 0; }
.bridle__popup-close {
  position: absolute;
  top: 6px;
  right: 8px;
  background: transparent;
  border: 0;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--bridle-muted);
  padding: 2px 4px;
  border-radius: 4px;
}
.bridle__popup-close:hover { background: var(--bridle-bubble-bg); }
```

- [ ] **Step 9: Typecheck + build**

Run: `cd /Users/maksymtmk/my-knowledge/bridle/sdk && npm run typecheck && npm run build`
Expected: both exit 0. Build emits `dist/bridle.js`, `dist/bridle.mjs`, and regenerated `dist/*.d.ts` including the three new options.

- [ ] **Step 10: Commit**

```bash
cd /Users/maksymtmk/my-knowledge/bridle
git add sdk/src/BridleChat.ce.vue
git commit -m "feat(sdk): proactive auto-popup teaser above the floating FAB"
```

---

### Task 3: Example page + README docs

**Files:**
- Modify: `example/index.html` (feature list ~line 31, basic sample code block ~lines 50–64; if the page contains a LIVE `<script ... data-agent-id>` embed further down, add the same three attributes there too)
- Modify: `sdk/README.md` (data-attrs table ~line 20, new section after "Programmatic init")

**Interfaces:**
- Consumes: attribute names from Task 1 (`data-popup`, `data-popup-title`, `data-popup-delay`); class names from Task 2 (for the customCss note).
- Produces: user-facing docs only, no code surface.

- [ ] **Step 1: Update the example feature list**

In `example/index.html`, in the "recently added" list (lines ~31–34), add a first entry:

```html
          <code>data-popup</code> (v0.14.0) ·
```

- [ ] **Step 2: Extend the basic sample**

In the same file, inside the basic `<pre><code>` sample (after the `data-greeting-delay="2500"` line, ~line 64), add:

```
  data-popup="Have a question? I can compare plans or book a demo."
  data-popup-title="👋 Hi, I'm the Bridle assistant!"
  data-popup-delay="2000"
```

If the page also contains a live `<script>` embed with `data-agent-id` (search for `data-agent-id` outside `<pre>` blocks), add the same three attributes to it so the demo actually shows the teaser.

- [ ] **Step 3: Document the data-attrs in the README table**

In `sdk/README.md`, append to the "Available `data-*` attributes" table (after the `data-stylesheet` row, ~line 30):

```markdown
| `data-popup` | off | Proactive teaser card above the closed FAB. Setting a text enables it; markdown supported |
| `data-popup-title` | optional | Bold headline of the teaser |
| `data-popup-delay` | `3000` | Milliseconds after load before the teaser appears; `0` = immediately |
```

- [ ] **Step 4: Add an "Auto-popup" section**

In `sdk/README.md`, after the "Programmatic init" section (before "Headless client"), insert:

````markdown
## Auto-popup (proactive teaser)

In floating mode the widget can show a small dismissible card above the
closed bubble inviting the visitor to chat:

```js
init({
  agentId: 'agent-…',
  popup: 'Have a question? I can compare plans or book a demo.',
  popupTitle: "👋 Hi, I'm the assistant!",
  popupDelay: 2000, // ms, default 3000
})
```

Omit `popup` to disable the teaser entirely. Clicking the card opens the
chat; the ✕ button (or Escape) dismisses it. Either way the choice is
remembered per agent in `localStorage` (`bridle:popup-dismissed:<agentId>`)
and the teaser never re-appears for that visitor. Restyle it via
`customCss` targeting `.bridle__popup`, `.bridle__popup-title`,
`.bridle__popup-body`, `.bridle__popup-close`.
````

- [ ] **Step 5: Commit**

```bash
cd /Users/maksymtmk/my-knowledge/bridle
git add example/index.html sdk/README.md
git commit -m "docs(sdk): document auto-popup options in README and example"
```

---

### Task 4: Version bump + final verification

**Files:**
- Modify: `sdk/package.json` (`"version": "0.13.3"` → `"0.14.0"`)

**Interfaces:**
- Consumes: everything above.
- Produces: release-ready branch; tag `sdk-v0.14.0` is NOT pushed here.

- [ ] **Step 1: Bump the version**

In `sdk/package.json` change:

```json
  "version": "0.13.3",
```

to:

```json
  "version": "0.14.0",
```

- [ ] **Step 2: Full check**

Run: `cd /Users/maksymtmk/my-knowledge/bridle/sdk && npm run typecheck && npm run build`
Expected: exit 0; `dist/types.d.ts` (or `dist/index.d.ts`) now contains `popup?: string`, `popupTitle?: string`, `popupDelay?: number`. Verify with:

Run: `grep -n "popupDelay" /Users/maksymtmk/my-knowledge/bridle/sdk/dist/*.d.ts`
Expected: at least one match.

- [ ] **Step 3: Manual smoke checklist (browser, best-effort)**

Serve the built bundle with a minimal page (the teaser shows even while the socket is still failing to connect, so no hub is needed):

```bash
cd /Users/maksymtmk/my-knowledge/bridle/sdk/dist && python3 -m http.server 4173
```

Write the test page into the session scratchpad directory (not `/tmp`) as `popup-smoke.html`, then open it in a browser:

```html
<script
  src="http://localhost:4173/bridle.js"
  data-api-url="http://localhost:9999"
  data-agent-id="smoke-test"
  data-popup="Have a question? Ask me anything."
  data-popup-title="👋 Hi there!"
  data-popup-delay="1000"></script>
```

Checks:
1. Teaser appears ~1s after load, above the FAB.
2. Click on the card body → panel opens, teaser gone.
3. Reload → teaser does NOT re-appear (localStorage flag set).
4. `localStorage.removeItem('bridle:popup-dismissed:smoke-test')`, reload, dismiss via ✕ → teaser gone; reload → still gone.
5. With `data-mode="inline"` and a `data-mount` target the teaser never shows.

If no browser is available in the environment, state that explicitly in the report instead of claiming the checks passed.

- [ ] **Step 4: Commit**

```bash
cd /Users/maksymtmk/my-knowledge/bridle
git add sdk/package.json
git commit -m "chore(sdk): bump version to 0.14.0"
```

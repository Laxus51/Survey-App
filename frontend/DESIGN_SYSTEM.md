# Survey App — Design System

Single source of truth for frontend visual/UI decisions. This is a **global foundation** document — it does not decide the layout of any individual page. Read this before designing or building any page or component.

Guiding question this document answers: **"Before I design a new page/component, what visual rules must I follow?"**

---

## 1. Design Philosophy

This is not a generic CRUD dashboard. It is **a mobile field-survey capture application that happens to have a dashboard.** Primary users are surveyors on phones in the field, often with poor/no connectivity, sometimes in direct sunlight, sometimes wearing gloves.

Priority order for every design decision, highest first:

1. Field usability
2. Mobile ergonomics
3. Readability
4. Fast scanning
5. Clear capture workflow
6. Clear offline/sync status
7. Low cognitive load
8. Reliability/confidence
9. Professional GIS/surveying feel

This is deliberately **not** a marketing site and not a "startup flashy" product. Every visual choice should either help complete a task or communicate state (especially offline/sync state) — not add visual interest for its own sake. Predictable and low-surprise beats novel. Desktop aesthetics do not dictate the mobile experience; desktop is a secondary/tertiary concern, not the composition target.

---

## 2. Theme

**daisyUI's `corporate` theme, light mode only.** This is a deliberate, product-wide decision — not a placeholder.

- Configured as the **only** theme (`themes: corporate --default` in daisyUI's config — see §3). There is currently no second theme compiled into the app at all.
- Applied via `data-theme="corporate"` on `<html>` in `index.html`.
- **No dark mode.** No toggle, no OS-driven auto-switching. The project previously had a `prefers-color-scheme: dark` block in `index.css` that swapped a set of legacy CSS variables — this has been **removed**, and `color-scheme` is now `light` everywhere, specifically so it can't silently fight the corporate theme once new components are built alongside the still-present legacy CSS.
- If dark mode is wanted later, that's a deliberate, separate future decision requiring its own sign-off — not something to reintroduce incidentally while building a page.

---

## 3. Technology / Tooling

| Tool | Version | Configured where |
|---|---|---|
| Tailwind CSS | v4 (CSS-first config, no `tailwind.config.js`) | `@import "tailwindcss";` in `src/index.css`, wired into the build via the `@tailwindcss/vite` plugin in `vite.config.ts` |
| daisyUI | v5 | `@plugin "daisyui" { themes: corporate --default; }` in `src/index.css` |
| lucide-react | latest | Imported per-component, no central re-export wrapper needed |

**Rules:**
- Build new UI with Tailwind utility classes and daisyUI components. Do not hand-write large blocks of custom CSS for new work.
- `App.css` (the existing hand-written stylesheet) is **left in place, mostly untouched** — it powers the current functional-skeleton pages (Dashboard/New Survey/Survey Details), which have not been redesigned yet. Do not add new rules to it. Do not delete a page's rules until that specific page is actually redesigned in its own task (Login's rules were removed once Login was redesigned, following exactly this pattern).
- Tailwind config lives entirely in `src/index.css` (CSS-first, per Tailwind v4). There is intentionally no `tailwind.config.js` / `tailwind.config.ts`.
- **Never add a new plain CSS rule outside a Tailwind utility class or the existing `legacy-base` layer.** `index.css` and `App.css` both wrap their pre-Tailwind styling in `@layer legacy-base`, registered *before* Tailwind's own layers so it's deliberately the lowest-priority one. This isn't cosmetic organization — per the CSS Cascade Layers spec, a plain/unlayered rule always overrides *any* layered rule, regardless of specificity or where it appears in the file. Before this was fixed, the old unlayered `button`/`h1` styles were silently and permanently overriding daisyUI's `.btn-primary` background and Tailwind's `text-primary` on the redesigned Login page — not because of a wrong class choice, but because unlayered CSS had an unbeatable structural advantage. If new hand-written CSS is ever genuinely needed, it must go inside `legacy-base` (or an equivalent layer declared just as early) — never as a bare, unlayered rule, or this exact bug returns.
- **The mirror-image case — deliberately overriding a daisyUI component default — needs the opposite placement.** `index.css` also declares `@layer overrides` at the very end of the file (after `@plugin "daisyui"`), which makes it the *highest*-priority layer, specifically so a handful of narrow, intentional component overrides (currently: recoloring `.input`'s focus ring to `primary`, §11) can beat daisyUI's own layer instead of losing to it the way `legacy-base` intentionally does. Keep `overrides` for exactly this kind of small, documented, one-property tweak — it is not a general-purpose escape hatch for hand-written CSS, which still belongs in Tailwind utility classes per the rule above.

---

## 4. Typography

No custom webfont. The existing system-font stack is kept and wired as Tailwind's default sans token (`@theme { --font-sans: system-ui, "Segoe UI", Roboto, sans-serif; }` in `index.css`) — covers native rendering on Windows (Segoe UI) and Android (Roboto), which matters for a device-diverse field app.

| Role | Classes | Notes |
|---|---|---|
| App/page title | `text-2xl font-semibold` | Moderate, not oversized |
| Section heading | `text-lg font-semibold` | |
| Subsection heading | `text-base font-semibold` | |
| Body text | `text-base` | Never smaller for primary content — also avoids iOS Safari's auto-zoom-on-focus for inputs under 16px |
| Secondary / muted text | `text-sm text-base-content/60` | Opacity modifier on the theme's own content color, not a hardcoded gray |
| Labels | `text-sm font-medium` | |
| Helper text | `text-xs text-base-content/60` | |
| Error text | `text-sm text-error` | |
| Badge/status text | inherit from daisyUI `.badge` | Don't hand-style; see §12 |
| Button text | inherit from daisyUI `.btn` | Don't hand-style |

General rules: moderate font weights (`font-medium`/`font-semibold`; avoid `font-bold` except rare emphasis), comfortable line height (`leading-relaxed` for paragraph copy), clear size hierarchy without huge headings.

---

## 5. Colors

**Never hardcode hex/rgb/arbitrary colors in new components.** Use daisyUI semantic tokens exclusively:

- `primary` — main action color (primary buttons, active/selected states, links)
- `secondary` — secondary emphasis
- `accent` — tertiary highlight, used sparingly
- `neutral` — dark surfaces (rarely needed in this app)
- `base-100` / `base-200` / `base-300` — surface layers, lightest to progressively recessed (page background, card background, subtle section/border-adjacent backgrounds)
- `base-content` — default text on base surfaces
- `success` / `warning` / `error` / `info` — semantic status; this is also the vocabulary for sync-state (§12) and feedback (§13)

Use opacity modifiers (`text-base-content/60`, `bg-base-200/50`) for muted variants instead of inventing new gray shades.

**The legacy CSS variables** in `index.css` (`--text`, `--bg`, `--bg-subtle`, `--border`, `--accent`, `--accent-contrast`, `--danger`) are kept **only** to support the not-yet-redesigned pages via `App.css`. Do not reference them from new Tailwind/daisyUI work — use daisyUI tokens instead, so everything naturally unifies as each page gets redesigned.

**`primary` is customized, not stock corporate.** The theme's default primary (a bright, saturated blue) read as too loud for a field tool, so it's overridden via a `@plugin "daisyui/theme" { name: "corporate"; ... }` block in `index.css` (right after the base `@plugin "daisyui"` block) to a darker, lower-chroma navy (`oklch(40% 0.09 240)`, with `--color-primary-content: oklch(98% 0.01 240)` for contrast). This is the officially-documented daisyUI pattern for overriding one token of a built-in theme — every other corporate token is untouched and still inherited. Never hardcode this navy value in a component; always go through the `primary` token so a future palette change stays a one-line edit.

---

## 6. Spacing

Use Tailwind's spacing scale exclusively (`p-*`, `m-*`, `gap-*`, `space-y-*`/`space-x-*`). Avoid arbitrary values (`p-[13px]`) except for a genuinely justified one-off.

| Context | Convention |
|---|---|
| Page padding | `p-4` on mobile, stepping up at `md:`/`lg:` (e.g. `md:p-6 lg:p-8`) |
| Section spacing (between major page sections) | `space-y-6` to `space-y-8` |
| Card padding | `p-4` — compact but breathable |
| Form-field spacing | `space-y-4` between fields; `space-y-1` between a label and its input |
| Button groups | `gap-2` to `gap-3` |
| Closely-related elements (icon+label, badge+text) | `gap-1.5` to `gap-2` |
| Unrelated sections/blocks | `gap-6` or more |
| Minimum touch target | `min-h-11` (44px) for any custom interactive element that isn't already a daisyUI `.btn`; verify daisyUI's own `.btn` sizing meets this when buttons are actually built |

Not every possible value is specified here — these are starting conventions, not a rigid system. Extend by analogy, don't invent a parallel scale.

---

## 7. Responsive Behavior

**Mobile-first, always.** Write base (unprefixed) classes for phones; progressively enhance with `sm:`/`md:`/`lg:` for tablet/desktop. Never compose for desktop and squeeze it down.

- Breakpoints: Tailwind defaults (`sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px). No custom breakpoints unless a genuine need appears.
- Target progression: **mobile (primary) → tablet (secondary, should "just work" via reflow, not necessarily a bespoke layout) → desktop (tertiary, comfortable but not the design target).**
- Actual per-page layout decisions (grid columns, nav pattern, card composition, etc.) are explicitly **out of scope** for this document.

---

## 8. Shape / Radius

Rely on daisyUI's corporate-theme radius tokens (`--radius-box`, `--radius-field`, `--radius-selector`) rather than per-component overrides — the theme's defaults are already moderate: not excessively rounded, not sharp. `.card`, `.btn`, `.input`, `.badge`, `.alert`, etc. all inherit consistent radius automatically, which is what makes them feel like one system.

If a Tailwind radius utility is needed directly, use the standard scale (`rounded`, `rounded-md`, `rounded-lg`, `rounded-xl`) — never an arbitrary value (`rounded-[3px]`).

---

## 9. Shadows / Elevation

Flat by default. Most surfaces (cards, sections) should be distinguished with `border border-base-300`, not a shadow — keeps the GIS-tool feel clean rather than "app store app."

Reserve shadows for genuinely floating/overlaying elements: modals, toasts, dropdown menus, a floating action button (if one is chosen later), sticky nav surfaces.

**Cards are not the default container for every page.** Use a `.card` only when it's separating genuinely distinct content from its surroundings (a list item among several, a grouped panel on a denser page). A single-purpose page with one flow and nothing else competing for attention (Login is the precedent) sits directly on the page background with no card/border wrapper at all — a card there would just be dividing the page from itself.

Two depths, no more:
- `shadow-sm` — gentle separation for floating-but-inline elements
- `shadow-lg` — modals, toasts, and other true overlays

Do not introduce ad hoc shadow values per component.

---

## 10. Buttons

Map daisyUI variants to intent — don't invent new button styles.

| Variant | When |
|---|---|
| `btn btn-primary` | The single primary action on a screen (Save, Sign in, the main forward-progress action) |
| `btn` (plain) / `btn btn-neutral` | Secondary, non-primary actions (Cancel, Edit, Back) |
| `btn btn-ghost` | Low-emphasis actions, especially inline within a card or toolbar |
| `btn btn-outline` | Secondary emphasis needing a visible boundary without full fill |
| `btn btn-error` | Actions whose consequence is destructive (Delete) |
| `btn btn-success` / `btn btn-warning` | Only when the action's consequence genuinely matches that semantic |
| `disabled` | Action currently unavailable (e.g. Save while validation fails) |
| Loading state (daisyUI `loading` + spinner, button text swap) | Any in-flight async action (Saving…, Signing in…, Syncing…) — mirrors the app's existing pattern of swapping button text during a request |

**Icon buttons:** `btn btn-square btn-ghost` (or `btn-circle`), sized to meet the 44px minimum, and **always** given an `aria-label` since there is no visible text.

---

## 11. Forms

- Every input gets a real, visible `<label>` — never placeholder-as-label.
- Required fields must be visually distinguishable (exact marker TBD per-page; the rule is that "required" must never be implicit-only).
- State progression and its daisyUI mapping:

  `normal → focused → disabled → invalid → saving`

  - normal → base `input`/`textarea`/`select` classes
  - focused → daisyUI's built-in focus ring, **recolored to `primary` and flattened to one box** (daisyUI's default draws a `base-content`/near-black `outline` offset 2px *outside* the field's own border — two visibly separate rectangles, independent of color; `index.css`'s `overrides` layer sets `--input-color: var(--color-primary)` and `outline-offset: 0` on `.input:focus`/`:focus-within` globally, so every input gets this automatically — don't re-implement it per component, and don't remove the ring entirely)
  - disabled → `disabled` attribute, daisyUI's automatic disabled styling
  - invalid → `input-error` modifier + adjacent `text-error` message
  - saving → the triggering button enters its loading state (§10); fields involved are typically `disabled` for the duration to prevent double-submission

- Helper text sits directly below the field (`text-xs text-base-content/60`); error text (`text-error`) replaces or supplements it when present.

This section governs **visual treatment only.** It does not change any existing validation logic, timing, or behavior (e.g. how/when New Survey currently collects and displays its validation errors) — that's a page-level decision for the page's own redesign task.

---

## 12. Status / Sync Design Language

The most important part of this system, given the app is offline-first. **Status must never be communicated by color alone** — always combine color + icon + text.

| Sync state | Semantic color | Icon (lucide) | Text |
|---|---|---|---|
| `pending` | `warning` or `neutral` (confirm at component build time) | `Clock` | "Pending" |
| `syncing` | `info` | `RefreshCw` (animating) or `LoaderCircle` | "Syncing…" |
| `synced` | `success` | `Check` | "Synced" |
| `failed` | `error` | `AlertCircle` | "Failed" |

Implemented as daisyUI `badge` components (`badge-warning`, `badge-info`, `badge-success`, `badge-error`) carrying an icon + label together — never a bare colored dot.

**Connectivity language** (distinct from per-survey sync status):
- Online: no persistent indicator needed — the expected default state.
- Offline: `WifiOff` icon, `warning` or `neutral` treatment.
- Reconnected: transient confirmation, likely a toast (§13).

This section defines the **vocabulary only** (colors/icons/text). It does not decide where or how these appear on any specific page — that's deferred to the Dashboard's own design task.

---

## 13. Alerts, Banners, Toasts, and Modals

| Type | daisyUI component | Use for | Example |
|---|---|---|---|
| Inline validation | `text-error text-sm` under the field | Errors tied to one specific field | "Enter a name for this survey." |
| Alert / banner | `alert` (`alert-warning`/`alert-error`/`alert-info`) | Page-level, persists until the condition resolves | Storage quota warning, offline mode, session warning, a significant sync problem |
| Toast / snackbar | `toast` + `alert` | Short-lived, auto-dismissing, non-blocking confirmation of something that already happened | "Survey saved", "Back online", "Sync completed" |
| Modal / dialog | `modal` | Destructive or high-consequence actions needing explicit confirmation | Delete confirmation (replaces the current native `window.confirm()` when that page is redesigned — not changed by this task) |

Rule of thumb: *Can the user act on it right here?* → inline. *Does it persist until something changes?* → banner. *Did something just finish, no action needed?* → toast. *Is it destructive/irreversible?* → modal.

---

## 14. Loading States

Avoid plain `Loading…` text as the default going forward.

- **Button-level:** inline spinner + disabled + text swap (already the app's pattern — e.g. "Saving…") for actions the user just triggered.
- **Section-level:** daisyUI `skeleton` shaped like the eventual content (e.g. card-shaped skeletons for a loading survey grid) — preferred over text for anything with a predictable shape and a perceptible load time.
- **Full-page loading:** reserved for the one genuine case that already exists — initial auth/session restore, where there's truly nothing to show yet. Not for ordinary page transitions.
- **Indeterminate waits with no known shape** (e.g. "Getting your location…"): a spinner (`loading-spinner` / `LoaderCircle`) plus explanatory text.
- Don't animate anything that isn't actually indicating a wait.

---

## 15. Icons

**lucide-react is the only icon source.** No mixing libraries (no Font Awesome/Heroicons/Material Icons), no ad hoc inline SVGs.

- Icons communicate a specific, nameable action or state — not decoration.
- Icon-only buttons (no visible text) **must** have an `aria-label`. No exceptions.
- Default sizing: `size-4` (16px) inline with text, `size-5` (20px) standalone/in buttons. Confirm and keep consistent as real components get built — don't pick arbitrary per-instance sizes.

**Agreed vocabulary** (the palette to draw from — not all necessarily used yet):
`Camera`, `MapPin`, `RefreshCw`, `Wifi`, `WifiOff`, `Cloud`, `CloudOff`, `Check`, `AlertCircle`, `LoaderCircle`, `Trash2`, `ArrowLeft`, `ArrowRight`, `Plus`, `Search`, `Settings`, `LogOut`, `Upload`, `Clock`, `Calendar`, `Image`, `Navigation`, `MoreVertical`.

---

## 16. Motion

Default is **no motion.** Add it only where it clarifies an actual state change.

- Prefer Tailwind's built-in `transition-*` / `duration-150`–`duration-300` for simple property transitions (color, opacity, transform).
- No bounce, scale-pop, parallax, or other marketing-site flourishes.
- Respect `prefers-reduced-motion` — use Tailwind's `motion-reduce:` variant to disable non-essential motion for users who've asked for it.
- Loading spinners are the one always-animating exception, since the animation itself is the information.

---

## 17. Accessibility Foundation

- Semantic HTML first: `<button>` for actions, `<a>`/router `<Link>` for navigation, real `<label htmlFor>` for fields, headings in logical order (resize visually with Tailwind classes, don't pick the wrong heading level for a size effect).
- Prefer native interactive elements always; if a custom interactive element is ever unavoidable, it needs `role`, `tabIndex`, and key handlers.
- Never remove the default focus ring without providing an equivalent visible replacement.
- Icon-only buttons require `aria-label` (restated from §15 — it's an accessibility requirement, not just a style rule).
- Status must be communicated through more than color (restated from §12).
- Touch targets ≥44px (restated from §6 — matters for motor-impairment accessibility, not just gloved-hands field use).
- Respect `prefers-reduced-motion` (restated from §16).
- Rely on daisyUI's corporate-theme token pairs (e.g. `primary` + `primary-content`) for contrast guarantees; avoid manually pairing a semantic token with an unrelated custom color.
- Associate error messages with their field via `aria-describedby` where practical — apply this per-component when forms are actually built, not solved globally here.

---

## 18. Images

Survey photos are central to the product.

- Consistent aspect ratio for thumbnails in lists/grids: `aspect-[4/3]` (matches the app's existing convention), `object-cover` so photos fill the frame without distortion.
- Rounded corners consistent with §8's shape language — same radius scale as cards.
- `loading="lazy"` for any image inside a list/grid — **already implemented**, preserve it.
- Reserve layout space before an image loads (the fixed-aspect-ratio container already does this) to avoid layout shift.
- Full-size/detail-view images: no forced aspect ratio (let the photo's natural proportions show), but constrain max width/height so it doesn't dominate the viewport.

**Hard constraint:** none of this touches how images are captured, compressed, stored as Blobs, or exposed via object URLs. This is a CSS/markup treatment layered on top of the existing `<img src={objectUrl}>` pattern. The create-on-mount/revoke-on-unmount object-URL lifecycle (in `LocalSurveyCard` and elsewhere) is **unchanged and must stay unchanged.**

---

## 19. Design Tokens

Primary source of truth is the daisyUI corporate theme + Tailwind's default scales (spacing, radius, font-size). Do not duplicate these into new custom CSS variables.

The **only** new custom token this task introduces: `--font-sans` (via `@theme` in `index.css`), because the project has a specific, deliberate reason to override Tailwind's default font stack (native system fonts across the OSes surveyors actually use) rather than accept Tailwind's default.

The legacy `--text`/`--bg`/`--accent`/etc. variables are **not** part of this token system — they exist only to keep pre-redesign pages working (§3, §5) and should not be extended.

Do not add new tokens speculatively. If a real, repeated problem appears later (e.g. a z-index scale for stacked offline banners), add it narrowly and document the addition here.

---

## 20. Component Conventions

- Prefer a daisyUI component over a hand-rolled equivalent whenever one exists (`card`, `btn`, `badge`, `alert`, `modal`, `toast`, `skeleton`, `input`, etc.).
- Compose via Tailwind utility classes layered on top of daisyUI components (e.g. `card p-4 gap-3`) rather than overriding daisyUI internals with custom CSS.
- One component, one visual responsibility — don't let a single component silently grow multiple unrelated jobs (mirrors the existing codebase's separation of e.g. `LocalSurveyCard` vs. the page that hosts it).
- New shared/reusable visual components belong in `components/`, following the existing project structure — this document doesn't change that organization.

---

## 21. Rules for Future Page Implementation

Checklist before starting any page/component design or build:

- [ ] Use daisyUI `corporate` semantic tokens for all color — no hardcoded hex/rgb.
- [ ] Do not introduce a second theme or any dark-mode styling/toggle.
- [ ] Mobile-first: design and build for phone first, enhance upward.
- [ ] Interactive elements meet the ~44px touch-target minimum.
- [ ] Status information uses color + icon + text together, per §12's vocabulary.
- [ ] Icons come only from `lucide-react`; icon-only buttons have `aria-label`.
- [ ] Motion is subtle, purposeful, and respects `prefers-reduced-motion`.
- [ ] Images preserve existing aspect-ratio/`object-cover`/lazy-loading treatment, and never touch the underlying Blob/object-URL/compression logic.
- [ ] Do not modify: IndexedDB schema, the sync engine's state machine, sync-event architecture (`record-changed` patches local state; `run-finished` triggers at most one server refresh — do not reintroduce a full reload per event), API contracts, authentication, image compression, or geolocation behavior.
- [ ] Preserve the Pending Sync 20-item render cap + "Load more" pattern.
- [ ] Preserve object-URL/component-identity stability — stable `key`s, no gratuitous remounting.
- [ ] Existing tests must keep passing; add new tests for new behavior, don't delete coverage to make a redesign easier.
- [ ] When in doubt about a color, spacing value, icon, or component choice, consult this document before improvising.

---

*This document covers the global foundation only. Page-specific layout decisions (navigation pattern, Dashboard information architecture, New Survey step structure, camera screen layout, location visualization, Survey Details layout, etc.) are explicitly deferred to their own future design tasks and are not decided here.*

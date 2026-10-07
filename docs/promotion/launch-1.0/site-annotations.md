# Site "why this matters" annotations

Status: copy plan only (Jason, 2026-10-06). Ship it on streamotter.dev before the 1.0 launch (G3 gate in `PUBLIC_LAUNCH.md`). No site changes until Jason says go. The Lontra main freeze applies until the phase-two site is in production.

## Problem

The demo shows *what* happens but never *why it matters*. This was checked against lontra-creek main at 6cb47e9.

- Home (`apps/site/src/components/LiveCreek.astro`, `scripts/live-creek.ts`): the note under "Drop my connection" says views "go stale until fresh snapshots arrive". It never names the failure this avoids: a frozen value that looks current. Nothing ties the demo to the "Never silently wrong" headline.
- Field station (`apps/site/src/pages/field-station.astro`): chapters 4 and 5 show a refusal and an identity switch, but never say that the app's handlers made those calls. "Under the hood" shows only browser code (`snippets/walkthrough.ts`). Policies appear once, in the footer.

## Approach

At each key moment, add one "Why this matters" line, shown in context when the moment happens, plus at most one "how" link. Five lines in total, with no new sections and no doc dumps.

## Copy

1. **Home, after the drop** (the `live-creek.ts` drop note):
   "Most live dashboards keep showing the last value after the connection dies, so a frozen number looks current. StreamOtter marks every view stale as soon as it can't vouch for it."
2. **Home, after the restore** (added to the existing "Back with fresh snapshots" note):
   "It doesn't replay what you missed. It asks the app for the current state, so you're correct immediately instead of catching up."
3. **Field station, chapter 1, Dawn survey:**
   "Behind this, the app's handlers ran: *authenticate* identified you as a volunteer, *authorize* allowed this gauge, and *snapshot* read its current state. StreamOtter wires them together."
4. **Field station, chapter 4, The protected holt:**
   "That refusal came from the app's *authorize* handler, not from StreamOtter. The gateway never sends data a handler hasn't approved."
   In this chapter, "Under the hood" shows the real holt handler (`snippets/handlers.ts`, already type-checked and on the home page).
5. **Field station, after the walkthrough (policies):**
   "When a record can't be read, the default is to pause that source rather than skip the record and quietly show a wrong value. Opt-in policies can set the record aside as evidence and move on, but only when snapshots prove nothing was lost."

## Open

- Optional: a line in chapter 2 on the *map* handler (a Kafka record becomes the channel's state and revision).
- Check every line against the 1.0 docs wording before shipping.

> **Changed since Sept 27:** new file (Oct 5): the shot list for the launch recording.
>
> **Changed in the Oct 5 fix pass:** **one plan** (FIX_DECISIONS §6; PUBLIC_LAUNCH.md §2 "Recording"). **(a)** a 10–15 s GIF of "Drop my connection" on the streamotter.dev home page, `live` → `stale` → `live`, recordable now; **(b)** a 60–90 s recording: S01 "Fouled sensor" (hosted if the Lab is on, otherwise local), then S02 "Garbled reading" on a local Lab stack, labeled "local stack". The old Version A (S03 with an S04 redrive tag) and Version B are gone (accuracy S2, S3, S4). The end card no longer points to `streamotter.dev/lab`, which may be off. Every label below is a real UI string from the live home page, the lontra-creek source or the preview screenshots, or is marked **[#42: confirm]**. The main cut stops at "held, stale, nothing skipped"; recovery stays out of it. The brand title, end and caption cards are referenced.
>
> **Placeholders in this file:** `<date>` and `<exact version>` on every label and card (the brand cards `recording-title.png` and `gif-caption.png` still read `2026-10-XX` and `X.Y.Z` and must be re-rendered).

# Hero demo: GIF and recording (shot list)

October 5, 2026 · Prepared for Jason Fricano · A script, not a recording. Nothing has been captured or posted.

**Who records:** you, with the OS screen recorder, from this list (about 30 minutes for both). No Playwright recording of the hosted Lab is planned.

**Label rule (every segment, on screen and in the description wherever it's posted):** "Recording · <date> · streamotter@<exact version> · <hosted | local stack> · Lontra Creek is fictional; the Kafka pipeline is real." If you trim waiting time, show it on screen ("— 20 s later —"). Never splice separate runs into one take. Never show something recorded locally as if it were on streamotter.dev.

**Where it goes:** the GIF on the README first screen, the Medium fix, the social posts and LinkedIn; the recording in the README (GitHub renders an uploaded mp4), the site's "demo is full" state, the 1.0 article and LinkedIn. The AI sentence lives on those pages, not in the captions.

## What this is based on

- streamotter.dev on 2026-10-05: up, serving the `0.1.0-rc.3` site. The home page's live panel has "Drop my connection" and "Restore it" and the note "Try it: cut this page's connection. The creek keeps moving without you, and every view says it's stale until fresh snapshots arrive." Whether the panel answers couldn't be confirmed from the static page (the page's no-JavaScript fallback says it isn't answering); check in a browser.
- lontra-creek source (`apps/site/src/components/LiveCreek.astro` and its built script): the cards LC-02 "Kestrel Bend gauge", LO-07 "Pebble, adult female" and LC-03 "Slate Canyon gauge", each with a state chip showing the SDK state; the header "Your browser · connection …"; log lines such as "network cut by you", "network restored; reconnecting", and "Revisions in between weren't replayed: StreamOtter V1 delivers the current state, not history."
- Lab preview screenshots (lab-02 to lab-06; not in this repo), captured on a preview backend with Lab benches enabled, not on streamotter.dev.
- FACTS.md and D2: the hosted Lab is off until you approve `lab.enabled`; even when on, only S01 and S06 run there until a hosting configuration change lands. S02 needs a local Lab stack (`npm run dev:lab` in the public lontra-creek repo) with Lontra Creek #42 merged; all 8 new exercises passed real-Kafka tests locally on `0.2.0-rc.1` with ACLs.

---

## (a) GIF: "Drop my connection" (10–15 s, recordable now)

Record on streamotter.dev if the live panel answers in your browser (label "hosted"). If it doesn't, record the same panel from lontra-creek's `npm run dev` at `http://127.0.0.1:4321` (label "local stack"; that mode replays the simulation without Kafka, so say so in the description). Re-record on the `1.0.0` site at T-4.

| # | Time | Shot | Caption (burned in, short) |
| --- | --- | --- | --- |
| 1 | 0:00–0:03 | The live panel, all three cards' chips reading `live`, values ticking. | Live, from Kafka. |
| 2 | 0:03–0:05 | Click **Drop my connection**. | Drop the connection… |
| 3 | 0:05–0:09 | The chips change to `stale`; the cards keep their last values; the log shows "network cut by you". | …every view says **stale**. |
| 4 | 0:09–0:11 | Click **Restore it**; the log shows "network restored; reconnecting". | Restore it… |
| 5 | 0:11–0:15 | The chips return to `live` with new revisions; the log notes the revisions in between weren't replayed. | …fresh snapshots, **live** again. |

Caption card: `gif-caption.png` (launch visuals, PR #65; "Recording · <date> · streamotter.dev · live → stale → live"), re-rendered with the real date, and with "local stack" in place of "streamotter.dev" if recorded locally.

Alt text: "Screen recording of the StreamOtter demo's home page: after Drop my connection, every view's badge changes from live to stale, then back to live after Restore it."

---

## (b) Recording: hold, then quarantine (60–90 s)

Title card: `recording-title.png` (launch visuals, PR #65), re-rendered with the real date and version. Its subtitle ("Foul a sensor, cut the relay, stall a laptop, restart the gateway") lists more than this recording shows; re-render a variant that matches these two segments, and add "local stack" to its label line. End card: `recording-end.png` (launch visuals, PR #65; site, code, install; it doesn't point to the Lab, which is right).

### Segment 1: S01 "Fouled sensor: fix and retry" (about 40 s)

Hosted only if the hosted Lab is on (D2) and you've leased a bench; otherwise from the local Lab (`npm run dev:lab`, `https://localhost:8443/lab/`), labeled "local stack". Every string below appears in `lab-02`, `lab-03`, `lab-04` or `lab-05`; the numbers will differ in your run, so keep them out of the captions.

| # | Time | Shot | Caption |
| --- | --- | --- | --- |
| 1 | 0:00–0:04 | Title card | **Failure Lab · recording.** Lontra Creek is fictional. The Kafka, the gateway and the browser SDK are real. |
| 2 | 0:04–0:10 | **Borrow a bench**. Your bench: "Gateway running · source healthy · relay up · calibration present". "LC-03 subscription: **live**", with Stage, Flow and Revision. | A gauge reading, live: a snapshot first, then updates in revision order. |
| 3 | 0:10–0:17 | Under Bench controls → Fouled sensor, click **Foul sensor**. The feed shows "You: Foul sensor", then "LC-03 record lab-1.field.gauges · partition 2 · offset 78: map failed" and "map failed HANDLER_FAILED · station". | The sensor's calibration is removed. The mapping fails on one record. |
| 4 | 0:17–0:28 | Your bench: "source paused (HANDLER_FAILED)", "LC-03 subscription: **stale · SOURCE_UNAVAILABLE**". Stage, Flow and Revision stay at their last values. Zoom on the state line. | The source stops at that record. It isn't skipped. The page keeps its last reading and says it's **stale**. |
| 5 | 0:28–0:35 | Click **Restore calibration**, then **Resume source**. Feed: "Retried LC-03 record lab-1.field.gauges · partition 2 · offset 78: mapper returned". Your bench: "Fresh snapshot … → …; intermediate states were not replayed." Subscription **live**. | Fix the cause, retry the same record: **live** again, nothing skipped. |

Cautions: don't say "quarantine" or "redrive" in this segment (the Lab itself says "It is an ordinary mapper exception, not quarantine."), and don't say the offset was committed ("'Mapper returned' … isn't proof that the gateway delivered it or committed its offset"). The Current incident panel will read "No incident to show…", which is correct for this exercise; crop it or let it be.

### Segment 2: S02 "Garbled reading: preserve and hold" (about 30–40 s), local stack only

Needs a local Lab stack running the quarantine profile, with Lontra Creek #42 merged **[#42: confirm how the local Lab selects the quarantine profile]**. Label every frame "local stack", not only the first card. S02's card text and the "Source failures" tab are from `lab-05`/`lab-06`; none of S02's running states has been seen in a screenshot yet (the preview said "0 of 8 new exercises can run here"), so check each label against the build before recording.

| # | Time | Shot | Caption |
| --- | --- | --- | --- |
| 6 | 0:35–0:40 | Label card: "Recording · <date> · streamotter@<exact version> · local stack · …". Select the **Source failures** tab; the "Garbled reading: preserve and hold" card (LC11-S02). | Now a record that isn't JSON at all. Recorded on a local Lab stack. |
| 7 | 0:40–0:46 | Click **Start this scenario** on that card **[#42: confirm the control]**. | Real invalid JSON arrives on the gauge topic. |
| 8 | 0:46–0:56 | Your bench turns **stale** **[#42: confirm the exact state line, expected "stale · SOURCE_UNAVAILABLE"]**; Stage, Flow and Revision stop at their last values. | The source holds at the record. The page keeps its last good reading and says **stale**. |
| 9 | 0:56–1:08 | The **Current incident** panel fills **[#42: field names; expect class `invalid-json`, quarantine `acknowledged`, progress `held`]**; the redacted gateway feed shows the matching lines. | The original bytes are copied to a quarantine topic, byte for byte, and the incident is recorded. |
| 10 | 1:08–1:14 | Hold on the stale page for a beat; the revision hasn't changed. | Held. Stale. Nothing skipped. |
| 11 | 1:14–1:20 | End card (`recording-end.png`). | (none) |

Main cut stops here. Recovery (guarded continuation, evaluate and redrive) needs S03 and S04 and loses a cold viewer; keep it for a separate, longer clip if you want one, also labeled "local stack".

**Never show:** raw record bytes (the Lab doesn't), operator commands as browser controls, or S07–S09 as something visitors can run (the Lab marks them "Local and CI only").

---

## Before recording: checklist

1. **Which build, per segment?** GIF: streamotter.dev if the panel answers, else local `npm run dev`. Segment 1: hosted only with the hosted Lab on (D2) and a working lease; else `npm run dev:lab`. Segment 2: always `npm run dev:lab` with #42 merged.
2. **Labels.** Every segment carries its own label line; segment 2 says "local stack" on every frame.
3. **Version.** Record the launch assets on `1.0.0` (T-4). Anything recorded earlier says its version plainly. The footer shows the release (for example "Release 0.1.0-rc.3").
4. **Domain.** Keep any page that still shows "streamotter.app" out of frame.
5. **Cards.** Re-render `recording-title.png` and `gif-caption.png` with the real date and version (they read `2026-10-XX` and `X.Y.Z`).
6. **Privacy.** A clean browser profile, no bookmarks bar, no other tabs, no notifications. On the local Lab, use a test profile for the throwaway certificate (lontra-creek `docs/LOCAL_LAB.md`).
7. **Accessibility.** Ship a `.vtt` with the same captions, and alt text for the GIF (above).

// Launch article headers: titles and eyebrows live here, one line each.
// Edit a string, then re-render: `node render.mjs article-` (renders both the 2000x1125
// blog header and the 1200x630 card for every article).
window.ARTICLES = {
  // (1) "StreamOtter 1.0: live state from Kafka to the browser, never silently wrong".
  // The name comes from the detailed logo on the image; the version is the one string below.
  "launch": {
    eyebrow: "Release",
    version: "1.0",
    title: "Live state from Kafka to the browser, never silently wrong.",
  },
  // (2) "Making it lie", the owner's own short piece after launch week.
  "making-it-lie": {
    eyebrow: "Field notes · reviews and launch week",
    title: "Making it lie: what the pre-1.0 reviews and launch week broke",
  },
};

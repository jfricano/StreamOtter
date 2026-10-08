import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkRelease, docsChannel, repositoryRef } from "../integrations/release-channel.mjs";

describe("release channel", () => {
  test("a build is a preview unless DOCS_CHANNEL says release", () => {
    assert.equal(docsChannel(undefined), "preview");
    assert.equal(docsChannel(""), "preview");
    assert.equal(docsChannel("preview"), "preview");
    assert.equal(docsChannel("release"), "release");
    assert.throws(() => docsChannel("production"), /DOCS_CHANNEL is "production"/);
  });

  test("repository links open at the release tag, or main in a preview", () => {
    assert.equal(repositoryRef("release", "1.0.0"), "v1.0.0");
    assert.equal(repositoryRef("preview", "0.2.0-rc.1"), "main");
  });

  test("a release build needs a released version, checked out at its tag", () => {
    assert.doesNotThrow(() => checkRelease("1.0.0", ["v1.0.0"]));
    assert.throws(() => checkRelease("0.2.0-rc.1", ["v0.2.0-rc.1"]), /needs a released version, and streamotter is 0\.2\.0-rc\.1/);
    assert.throws(() => checkRelease("1.0.0", []), /built from the v1\.0\.0 tag, and this checkout has no tag/);
    assert.throws(() => checkRelease("1.0.0", ["v1.0.1"]), /this checkout has v1\.0\.1/);
  });
});

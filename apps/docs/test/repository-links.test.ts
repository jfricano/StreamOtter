import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { repositoryLink } from "../integrations/repository-links.mjs";

describe("guide links", () => {
  const guide = "docs/guides/kafka.md";
  test("a link to another guide opens its page here, keeping its anchor", () => {
    assert.equal(repositoryLink("./source-failures.md#61-credentials-and-acls", guide, "1.2.3"), "/guides/source-failures/#61-credentials-and-acls");
  });
  test("a link to any other repository file opens on GitHub at the release tag", () => {
    assert.equal(repositoryLink("../DEPLOYMENT.md#health-checks", guide, "1.2.3"), "https://github.com/jfricano/StreamOtter/blob/v1.2.3/docs/DEPLOYMENT.md#health-checks");
    assert.equal(repositoryLink("../releases/v1.1/adr/", guide, "1.2.3"), "https://github.com/jfricano/StreamOtter/tree/v1.2.3/docs/releases/v1.1/adr");
    assert.equal(repositoryLink("../../CONTRIBUTING.md", guide, "1.2.3"), "https://github.com/jfricano/StreamOtter/blob/v1.2.3/CONTRIBUTING.md");
  });
  test("absolute URLs and in-page anchors are left alone", () => {
    for (const href of ["https://kafka.apache.org/", "#what-is-verified", "mailto:security@example.com"]) assert.equal(repositoryLink(href, guide, "1.2.3"), href);
  });
});

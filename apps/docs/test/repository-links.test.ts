import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { repositoryLink } from "../integrations/repository-links.mjs";

describe("guide links", () => {
  const guide = "docs/guides/kafka.md";
  test("a link to another guide opens its page here, keeping its anchor", () => {
    assert.equal(repositoryLink("./source-failures.md#61-credentials-and-acls", guide, "v1.2.3"), "/guides/source-failures/#61-credentials-and-acls");
  });
  test("a link to any other repository file opens on GitHub at the build's ref", () => {
    assert.equal(repositoryLink("../DEPLOYMENT.md#health-checks", guide, "v1.2.3"), "https://github.com/jfricano/StreamOtter/blob/v1.2.3/docs/DEPLOYMENT.md#health-checks");
    assert.equal(repositoryLink("../releases/v1.1/adr/", guide, "v1.2.3"), "https://github.com/jfricano/StreamOtter/tree/v1.2.3/docs/releases/v1.1/adr");
    assert.equal(repositoryLink("../../CONTRIBUTING.md", guide, "v1.2.3"), "https://github.com/jfricano/StreamOtter/blob/v1.2.3/CONTRIBUTING.md");
    assert.equal(repositoryLink("../DEPLOYMENT.md", guide, "main"), "https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md");
  });
  test("absolute URLs and in-page anchors are left alone", () => {
    for (const href of ["https://kafka.apache.org/", "#what-is-verified", "mailto:security@example.com"]) assert.equal(repositoryLink(href, guide, "v1.2.3"), href);
  });
});

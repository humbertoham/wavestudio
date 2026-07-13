import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewUserBadge } from "./NewUserBadge";

describe("NewUserBadge", () => {
  it("renders the existing NEW USER indicator when classification is true", () => {
    const html = renderToStaticMarkup(
      createElement(NewUserBadge, { isNewUser: true })
    );

    expect(html).toContain("NEW USER");
    expect(html).toContain("text-[color:var(--color-primary)]");
  });

  it("renders nothing when classification is false", () => {
    expect(
      renderToStaticMarkup(createElement(NewUserBadge, { isNewUser: false }))
    ).toBe("");
  });
});

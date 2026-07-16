import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Markdown } from "../../src/components/markdown";

const MARKDOWN = `# Heading

**Strong** and ~~removed~~ with [link](https://example.com) and \`inline\`.

> Quote

\`\`\`ts
const value = 1;
\`\`\`

| Name | Value |
| --- | --- |
| theme | light |
`;

describe("Markdown", () => {
  it("uses theme-aware semantic colors throughout agent output", () => {
    const { container } = render(<Markdown>{MARKDOWN}</Markdown>);

    expect(screen.getByText("Heading").className).toContain("text-foreground");
    expect(screen.getByText("Strong").className).toContain("text-foreground");
    expect(screen.getByText("removed").className).toContain("text-muted-foreground");
    expect(screen.getByText("link").className).toContain("text-[var(--localterm-blue)]");
    expect(screen.getByText("inline").className).toContain("text-[var(--localterm-green)]");
    expect(screen.getByText("Quote").closest("blockquote")?.className).toContain(
      "text-muted-foreground",
    );
    expect(screen.getByText("const value = 1;").closest("pre")?.className).toContain(
      "text-foreground/80",
    );
    expect(container.innerHTML).not.toContain("zinc-");
  });
});

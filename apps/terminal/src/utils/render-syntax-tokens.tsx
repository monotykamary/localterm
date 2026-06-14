import type { CSSProperties, ReactNode } from "react";
import type { SyntaxToken } from "./syntax-highlight";

export const renderSyntaxTokens = (tokens: readonly SyntaxToken[]): ReactNode =>
  tokens.map((token, index) => {
    const style: CSSProperties = { color: token.color };
    if (token.fontStyle & 1) style.fontStyle = "italic";
    if (token.fontStyle & 2) style.fontWeight = "bold";
    if (token.fontStyle & 4) style.textDecoration = "underline";
    return (
      <span key={index} style={style}>
        {token.content}
      </span>
    );
  });

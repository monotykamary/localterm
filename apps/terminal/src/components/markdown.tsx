import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown renderer for the agent log. Headings stay pi-like: bold, same size
// (no `text-lg` etc.), so the transcript reads as a flat log. GFM tables,
// strikethrough, and task lists come from remark-gfm. The font size is
// inherited from the log container (text-[11px] font-mono).

const HEADING_CLASS = "font-semibold text-zinc-100";

const components: Components = {
  h1: ({ children }) => <div className={HEADING_CLASS}>{children}</div>,
  h2: ({ children }) => <div className={HEADING_CLASS}>{children}</div>,
  h3: ({ children }) => <div className={HEADING_CLASS}>{children}</div>,
  h4: ({ children }) => <div className={HEADING_CLASS}>{children}</div>,
  h5: ({ children }) => <div className={HEADING_CLASS}>{children}</div>,
  h6: ({ children }) => <div className={HEADING_CLASS}>{children}</div>,
  p: ({ children }) => <p className="my-0.5 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-zinc-500 line-through">{children}</del>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-sky-400 underline underline-offset-2"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-0.5 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-0.5 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-zinc-600">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-0.5 border-l-2 border-zinc-700 pl-2 text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-1.5 border-zinc-700" />,
  pre: ({ children }) => (
    <pre className="my-1 overflow-x-auto rounded bg-zinc-900 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">
      {children}
    </pre>
  ),
  code: ({ node, className, children, ...rest }) => {
    // Fenced block (mdast `code`) renders inside <pre>; keep it plain so the
    // <pre> styles it. Inline (`inlineCode`) gets a monospace pill.
    if ((node as { type?: string } | undefined)?.type === "code") {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-emerald-300" {...rest}>
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="border-collapse text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="text-zinc-400">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-zinc-700 px-1.5 py-0.5 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-zinc-700 px-1.5 py-0.5">{children}</td>,
};

export const Markdown = ({ children }: { children: string }) => (
  <div className="whitespace-normal break-words">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  </div>
);

import { isValidElement, memo, useId, useMemo, type ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import rehypeKatex from "rehype-katex";
import {
  defListHastHandlers,
  remarkDefinitionList,
} from "remark-definition-list";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Pluggable } from "unified";

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { Separator } from "@renderer/components/ui/separator";
import { cn } from "@renderer/lib/utils";
import { MessageCodeBlock } from "./message-code-block";
import { MessageDiagram } from "./message-diagram";
import { MessageDirective } from "./message-directive";
import { MessageImage, MessageImageGallery } from "./message-image";
import { MessageLink } from "./message-link";
import { normalizeMessageMarkdown } from "./message-markdown-normalize";
import { remarkRadiusDirectives } from "./message-markdown-plugins";
import { MessageTable } from "./message-table";

const STREAMING_REMARK_PLUGINS = [
  remarkGfm,
  remarkDefinitionList,
  remarkDirective,
  remarkRadiusDirectives,
] satisfies Pluggable[];
const REMARK_PLUGINS = [
  ...STREAMING_REMARK_PLUGINS,
  remarkMath,
] satisfies Pluggable[];
const STREAMING_REHYPE_PLUGINS: Pluggable[] = [];
const REHYPE_PLUGINS = [
  [
    rehypeKatex,
    {
      errorColor: "currentColor",
      maxExpand: 1_000,
      maxSize: 20,
      output: "htmlAndMathml",
      strict: "error",
      throwOnError: false,
      trust: false,
    },
  ],
] satisfies Pluggable[];
const SAFE_INLINE_IMAGE_URL =
  /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i;

type MarkdownNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};

function markdownElementProps<Props extends { node?: unknown }>(
  input: Props,
): Omit<Props, "node"> {
  const { node, ...props } = input;
  void node;
  return props;
}

function codeBlock(input: {
  children?: ReactNode;
}): { code: string; language: string | null } | null {
  const child = Array.isArray(input.children)
    ? input.children.find(isValidElement)
    : input.children;
  if (!isValidElement(child)) return null;
  const props = child.props as { children?: ReactNode; className?: string };
  const value = props.children;
  if (typeof value !== "string") return null;
  const languageMatch = props.className?.match(/(?:^|\s)language-([^\s]+)/);
  return {
    code: value.endsWith("\n") ? value.slice(0, -1) : value,
    language: languageMatch?.[1] ?? null,
  };
}

function imageOnlyParagraph(node: MarkdownNode | undefined): boolean {
  const children = node?.children ?? [];
  return (
    children.length > 0 &&
    children.every(
      (child) =>
        (child.type === "element" && child.tagName === "img") ||
        (child.type === "text" && !(child.value ?? "").trim()),
    )
  );
}

function focusFootnoteTarget(href: string): void {
  const target = document.getElementById(decodeURIComponent(href.slice(1)));
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center",
  });
  target.focus({ preventScroll: true });
}

function radiusUrlTransform(
  value: string,
  key: string,
  node: Readonly<MarkdownNode>,
): string {
  if (
    key === "src" &&
    node.tagName === "img" &&
    (value.startsWith("blob:") ||
      value.startsWith("sandbox:") ||
      SAFE_INLINE_IMAGE_URL.test(value))
  ) {
    return value;
  }
  if (key === "href" && value.startsWith("file:")) return value;
  return defaultUrlTransform(value);
}

function components({
  footnoteLabelId,
  fullWidthTables,
  imageSize,
  sessionId,
  streaming,
}: {
  footnoteLabelId: string;
  fullWidthTables: boolean;
  imageSize: "assistant" | "user";
  sessionId?: string;
  streaming: boolean;
}): Components {
  return {
    a: (input) => {
      const props = markdownElementProps(input);
      const href = typeof props.href === "string" ? props.href : "";
      if (props["aria-describedby"] === "footnote-label") {
        props["aria-describedby"] = footnoteLabelId;
      }
      if (href.startsWith("#")) {
        return (
          <a
            {...props}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              focusFootnoteTarget(href);
            }}
            className="rounded-sm text-brand no-underline decoration-brand/40 underline-offset-[3px] hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        );
      }
      return (
        <MessageLink href={href} sessionId={sessionId}>
          {props.children}
        </MessageLink>
      );
    },
    blockquote: (input) => (
      <blockquote
        {...markdownElementProps(input)}
        className="radius-message-blockquote my-4 border-l-2 border-border pl-4 text-muted-foreground [&>p]:mb-0 [&>p:first-child]:italic [&>p+p]:mt-2 [&>p+p]:text-xs [&>p+p]:not-italic"
      />
    ),
    br: (input) => <br {...markdownElementProps(input)} />,
    code: (input) => {
      const { className, ...props } = markdownElementProps(input);
      return (
        <code
          {...props}
          className={cn(
            "radius-message-markdown-code font-mono text-[0.8125rem] font-medium",
            className,
          )}
        />
      );
    },
    dd: (input) => (
      <dd
        {...markdownElementProps(input)}
        className="mb-3 ml-4 text-muted-foreground"
      />
    ),
    del: (input) => (
      <del
        {...markdownElementProps(input)}
        className="decoration-muted-foreground/70"
      />
    ),
    div: (input) => {
      const props = markdownElementProps(input);
      const kind = props["data-radius-directive"];
      if (typeof kind !== "string") return <div {...props} />;
      return (
        <MessageDirective
          kind={kind}
          name={String(props["data-radius-directive-name"] ?? "unknown")}
          title={String(props["data-radius-directive-title"] ?? "")}
        >
          {props.children}
        </MessageDirective>
      );
    },
    dl: (input) => (
      <dl
        {...markdownElementProps(input)}
        className="my-4 border-l border-border pl-3"
      />
    ),
    dt: (input) => (
      <dt
        {...markdownElementProps(input)}
        className="mb-1 text-sm font-medium text-foreground"
      />
    ),
    em: (input) => <em {...markdownElementProps(input)} className="italic" />,
    h1: (input) => (
      <h1
        {...markdownElementProps(input)}
        className="mb-3 mt-6 text-2xl font-normal leading-8 tracking-tight text-balance first:mt-0"
      />
    ),
    h2: (input) => (
      <h2
        {...markdownElementProps(input)}
        id={input.id === "footnote-label" ? footnoteLabelId : input.id}
        className="mb-2.5 mt-6 text-xl font-normal leading-7 tracking-tight text-balance first:mt-0"
      />
    ),
    h3: (input) => (
      <h3
        {...markdownElementProps(input)}
        className="mb-2 mt-5 text-lg font-medium leading-7 tracking-tight first:mt-0"
      />
    ),
    h4: (input) => (
      <h4
        {...markdownElementProps(input)}
        className="mb-1.5 mt-4 text-base font-medium leading-6 tracking-tight first:mt-0"
      />
    ),
    h5: (input) => (
      <h5
        {...markdownElementProps(input)}
        className="mb-1.5 mt-4 text-sm font-medium leading-6 first:mt-0"
      />
    ),
    h6: (input) => (
      <h6
        {...markdownElementProps(input)}
        className="mb-1 mt-3 text-xs font-medium leading-5 tracking-tight text-muted-foreground first:mt-0"
      />
    ),
    hr: () => <Separator className="my-5" />,
    img: (input) => {
      const props = markdownElementProps(input);
      const src = typeof props.src === "string" ? props.src : "";
      if (!src) return props.alt ? <span>{props.alt}</span> : null;
      return (
        <MessageImage
          src={src}
          alt={props.alt ?? ""}
          resolveEnabled={!streaming}
          size={imageSize}
          title={props.title ?? undefined}
        />
      );
    },
    input: (input) => {
      const props = markdownElementProps(input);
      return (
        <input
          {...props}
          disabled
          className="mt-[0.3125rem] size-3.5 shrink-0 accent-brand"
        />
      );
    },
    li: (input) => {
      const { className, ...props } = markdownElementProps(input);
      const task = className?.includes("task-list-item");
      return (
        <li
          {...props}
          className={cn(
            "my-0 pl-1 leading-5 marker:text-muted-foreground",
            task && "flex items-start gap-2 pl-0 marker:content-none",
            className,
          )}
        />
      );
    },
    ol: (input) => (
      <ol
        {...markdownElementProps(input)}
        className="my-3 flex list-decimal flex-col gap-0 pl-5 [&_ol]:my-1 [&_ul]:my-1"
      />
    ),
    p: (input) => {
      const node = input.node as MarkdownNode | undefined;
      const props = markdownElementProps(input);
      if (imageOnlyParagraph(node)) {
        return <MessageImageGallery>{props.children}</MessageImageGallery>;
      }
      return <p {...props} className={cn("mb-3", !streaming && "last:mb-0")} />;
    },
    pre: (input) => {
      const block = codeBlock(input);
      if (!block) {
        return (
          <pre
            {...markdownElementProps(input)}
            className="my-3 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-[0.8125rem] leading-5"
          />
        );
      }
      if (block.language?.toLowerCase() === "mermaid") {
        return (
          <MessageDiagram
            source={block.code}
            controlsEnabled={!streaming}
            renderEnabled={!streaming}
          />
        );
      }
      return (
        <MessageCodeBlock
          code={block.code}
          language={block.language}
          controlsEnabled={!streaming}
          highlightEnabled={!streaming}
        />
      );
    },
    strong: (input) => (
      <strong
        {...markdownElementProps(input)}
        className="font-medium text-foreground"
      />
    ),
    table: (input) => (
      <MessageTable
        {...markdownElementProps(input)}
        controlsEnabled={!streaming}
        fullWidth={fullWidthTables}
      />
    ),
    tbody: (input) => <TableBody {...markdownElementProps(input)} />,
    td: (input) => (
      <TableCell
        {...markdownElementProps(input)}
        className="px-3 py-2.5 align-middle"
      />
    ),
    th: (input) => (
      <TableHead
        {...markdownElementProps(input)}
        className="h-11 px-3 align-middle text-sm font-medium"
      />
    ),
    thead: (input) => (
      <TableHeader
        {...markdownElementProps(input)}
        className="bg-transparent"
      />
    ),
    tr: (input) => (
      <TableRow
        {...markdownElementProps(input)}
        className="border-border/70 hover:bg-transparent"
      />
    ),
    ul: (input) => {
      const { className, ...props } = markdownElementProps(input);
      const tasks = className?.includes("contains-task-list");
      return (
        <ul
          {...props}
          className={cn(
            "my-3 flex list-disc flex-col gap-0 pl-5 [&_ol]:my-1 [&_ul]:my-1",
            tasks && "list-none pl-0",
            className,
          )}
        />
      );
    },
  };
}

export const MessageMarkdown = memo(function MessageMarkdown({
  fullWidthTables = false,
  imageSize = "assistant",
  markdown,
  sessionId,
  streaming = false,
}: {
  fullWidthTables?: boolean;
  imageSize?: "assistant" | "user";
  markdown: string;
  sessionId?: string;
  streaming?: boolean;
}): ReactNode {
  const messageId = useId().replace(/[^a-z0-9]/gi, "");
  const componentMap = useMemo(
    () =>
      components({
        footnoteLabelId: `radius-${messageId}-footnote-label`,
        fullWidthTables,
        imageSize,
        sessionId,
        streaming,
      }),
    [fullWidthTables, imageSize, messageId, sessionId, streaming],
  );
  const remarkRehypeOptions = useMemo(
    () => ({
      clobberPrefix: `radius-${messageId}-`,
      handlers: defListHastHandlers,
    }),
    [messageId],
  );

  return (
    <div className="radius-message-markdown min-w-0">
      <ReactMarkdown
        remarkPlugins={streaming ? STREAMING_REMARK_PLUGINS : REMARK_PLUGINS}
        rehypePlugins={streaming ? STREAMING_REHYPE_PLUGINS : REHYPE_PLUGINS}
        remarkRehypeOptions={remarkRehypeOptions}
        skipHtml
        components={componentMap}
        urlTransform={radiusUrlTransform}
      >
        {normalizeMessageMarkdown(markdown, { streaming })}
      </ReactMarkdown>
    </div>
  );
});

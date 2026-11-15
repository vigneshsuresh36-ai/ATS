"use client";

import { Fragment, useLayoutEffect, useRef } from "react";
import type { JobDescriptionMark } from "@/lib/jobDescriptionFormatting";

export function JobDescriptionCopy({
  text, marks = [],
}: { text: string; marks?: JobDescriptionMark[] }) {
  const pieces = [];
  let cursor = 0;
  for (const { start, end, bold, italic, underline } of marks) {
    pieces.push(text.slice(cursor, start));
    let content = <>{text.slice(start, end)}</>;
    if (bold) content = <strong>{content}</strong>;
    if (italic) content = <em>{content}</em>;
    if (underline) content = <u>{content}</u>;
    pieces.push(<Fragment key={start}>{content}</Fragment>);
    cursor = end;
  }
  return <>{pieces}{text.slice(cursor)}</>;
}

function readEditor(editor: HTMLElement) {
  let text = "";
  const marks: JobDescriptionMark[] = [];
  const unformatted = { bold: false, italic: false, underline: false };

  function visitChildren(parent: HTMLElement, style: typeof unformatted) {
    let previousWasBlock = false;
    const start = text.length;
    for (const node of parent.childNodes) {
      if (node instanceof HTMLBRElement && node === parent.lastChild) continue;
      const isBlock = node instanceof HTMLElement && /^(DIV|P)$/.test(node.tagName);
      if (previousWasBlock || (isBlock && text.length > start)) text += "\n";
      previousWasBlock = isBlock;

      if (node instanceof Text) {
        const value = node.data.replace(/\u00a0/g, " ");
        if (value && (style.bold || style.italic || style.underline)) {
          const previous = marks.at(-1);
          if (previous?.end === text.length && previous.bold === style.bold &&
            previous.italic === style.italic && previous.underline === style.underline) {
            previous.end += value.length;
          } else {
            marks.push({ start: text.length, end: text.length + value.length, ...style });
          }
        }
        text += value;
      } else if (node instanceof HTMLBRElement) {
        text += "\n";
      } else if (node instanceof HTMLElement) {
        visitChildren(node, {
          bold: style.bold || /^(B|STRONG)$/.test(node.tagName) || node.style.fontWeight === "bold" || Number(node.style.fontWeight) >= 600,
          italic: style.italic || /^(I|EM)$/.test(node.tagName) || node.style.fontStyle === "italic",
          underline: style.underline || node.tagName === "U" || node.style.textDecoration.includes("underline"),
        });
      }
    }
  }

  visitChildren(editor, unformatted);
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  return {
    text: text.trim(),
    marks: marks.filter((mark) => mark.end > start && mark.start < end).map((mark) => ({
      ...mark,
      start: Math.max(mark.start, start) - start,
      end: Math.min(mark.end, end) - start,
    })),
  };
}

const shortcuts = { b: "bold", i: "italic", u: "underline" } as const;

export default function JobDescriptionEditor({
  initialText, initialMarks, replacement, onChange,
}: {
  initialText: string;
  replacement?: { text: string } | null;
  initialMarks?: JobDescriptionMark[];
  onChange: (draft: ReturnType<typeof readEditor>) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current!;
    const fragment = document.createDocumentFragment();
    const text = replacement?.text ?? initialText;
    let cursor = 0;
    for (const { start, end, bold, italic, underline } of (replacement ? [] : initialMarks ?? [])) {
      fragment.append(text.slice(cursor, start));
      let content: Node = document.createTextNode(text.slice(start, end));
      for (const tag of [bold && "b", italic && "i", underline && "u"]) {
        if (!tag) continue;
        const element = document.createElement(tag);
        element.append(content);
        content = element;
      }
      fragment.append(content);
      cursor = end;
    }
    fragment.append(text.slice(cursor));
    editor.replaceChildren(fragment);
  }, [initialText, initialMarks, replacement]);

  return (
    <div
      ref={editorRef}
      className="ats-jd-input"
      contentEditable
      role="textbox"
      aria-label="Job description"
      aria-multiline="true"
      aria-keyshortcuts="Control+B Control+I Control+U Meta+B Meta+I Meta+U"
      onInput={(event) => onChange(readEditor(event.currentTarget))}
      onKeyDown={(event) => {
        if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;
        const command = shortcuts[event.key.toLowerCase() as keyof typeof shortcuts];
        if (!command) return;
        event.preventDefault();
        document.execCommand(command);
        onChange(readEditor(event.currentTarget));
      }}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      }}
      onDrop={(event) => event.preventDefault()}
    />
  );
}

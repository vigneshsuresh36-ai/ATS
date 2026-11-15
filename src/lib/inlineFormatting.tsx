import { isValidElement, type ReactNode } from "react";

export function renderInlineFormatting(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let position = 0;

  while (position < value.length) {
    let opening = -1;
    let closing = -1;
    let marker = "";

    for (let index = position; index < value.length; index += 1) {
      const candidate = value.startsWith("**", index)
        ? "**"
        : value[index] === "*" && value[index + 1] !== "*"
          ? "*"
          : value[index] === "_"
            ? "_"
            : "";
      if (!candidate) continue;

      let end = -1;
      if (candidate.length === 2) {
        end = value.indexOf(candidate, index + candidate.length);
      } else {
        for (let cursor = index + 1; cursor < value.length; cursor += 1) {
          if (value.startsWith("**", cursor)) {
            cursor += 1;
          } else if (value[cursor] === candidate) {
            end = cursor;
            break;
          }
        }
      }
      if (end > index + candidate.length) {
        opening = index;
        closing = end;
        marker = candidate;
        break;
      }
    }

    if (opening < 0) {
      nodes.push(value.slice(position));
      break;
    }
    if (opening > position) nodes.push(value.slice(position, opening));
    const content = value.slice(opening + marker.length, closing);
    const key = `format-${opening}`;
    nodes.push(
      marker === "**"
        ? <strong key={key}>{renderInlineFormatting(content)}</strong>
        : <em key={key}>{renderInlineFormatting(content)}</em>
    );
    position = closing + marker.length;
  }

  return nodes;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function nodesToHtml(node: ReactNode): string {
  if (typeof node === "string") return escapeHtml(node).replace(/\n/g, "<br>");
  if (Array.isArray(node)) return node.map(nodesToHtml).join("");
  if (!isValidElement<{ children?: ReactNode }>(node)) return "";
  const tag = node.type === "strong" ? "strong" : node.type === "em" ? "em" : "";
  return tag ? `<${tag}>${nodesToHtml(node.props.children)}</${tag}>` : nodesToHtml(node.props.children);
}

export function inlineFormattingToHtml(value: string): string {
  return nodesToHtml(renderInlineFormatting(value));
}

export function editableHtmlToInlineFormatting(element: HTMLElement): string {
  function serialize(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const childText = Array.from(node.childNodes, serialize).join("");
    const tag = (node as HTMLElement).tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${childText}**`;
    if (tag === "em" || tag === "i") return `*${childText}*`;
    if (tag === "div" || tag === "p") return `${childText}\n`;
    return childText;
  }

  return Array.from(element.childNodes, serialize).join("").replace(/\n$/, "");
}
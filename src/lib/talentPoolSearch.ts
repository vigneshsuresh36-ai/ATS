type Token =
  | { type: "term"; value: string }
  | { type: "and" | "or" | "not" | "left" | "right" };

type Predicate = (text: string) => boolean;

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /"([^"]*)"|(\()|(\))|(\bAND\b|\bOR\b|\bNOT\b)|([^\s()"]+)/iy;
  let cursor = 0;

  while (cursor < query.length) {
    if (/\s/.test(query[cursor])) {
      cursor += 1;
      continue;
    }
    pattern.lastIndex = cursor;
    const match = pattern.exec(query);
    if (!match) throw new Error("Check the quotes and parentheses in your search.");
    cursor = pattern.lastIndex;
    if (match[1] !== undefined) {
      if (!match[1].trim()) throw new Error("Quoted search terms cannot be empty.");
      tokens.push({ type: "term", value: match[1].toLowerCase() });
    } else if (match[2]) {
      tokens.push({ type: "left" });
    } else if (match[3]) {
      tokens.push({ type: "right" });
    } else if (match[4]) {
      tokens.push({ type: match[4].toLowerCase() as "and" | "or" | "not" });
    } else if (match[5]) {
      tokens.push({ type: "term", value: match[5].toLowerCase() });
    }
  }

  return tokens;
}

export function compileTalentPoolSearch(query: string): Predicate {
  const tokens = tokenize(query.trim());
  if (!tokens.length) return () => true;
  let cursor = 0;

  function parsePrimary(): Predicate {
    const token = tokens[cursor];
    if (!token) throw new Error("Add a search term after the operator.");
    if (token.type === "term") {
      cursor += 1;
      return (text) => text.includes(token.value);
    }
    if (token.type === "left") {
      cursor += 1;
      const expression = parseOr();
      if (tokens[cursor]?.type !== "right") throw new Error("Add a closing parenthesis to your search.");
      cursor += 1;
      return expression;
    }
    throw new Error("Add a search term after the operator.");
  }

  function parseUnary(): Predicate {
    if (tokens[cursor]?.type === "not") {
      cursor += 1;
      const expression = parseUnary();
      return (text) => !expression(text);
    }
    return parsePrimary();
  }

  function parseAnd(): Predicate {
    let expression = parseUnary();
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.type === "or" || token.type === "right") break;
      if (token.type === "and") cursor += 1;
      else if (token.type !== "term" && token.type !== "left" && token.type !== "not") break;
      const right = parseUnary();
      const left = expression;
      expression = (text) => left(text) && right(text);
    }
    return expression;
  }

  function parseOr(): Predicate {
    let expression = parseAnd();
    while (tokens[cursor]?.type === "or") {
      cursor += 1;
      const right = parseAnd();
      const left = expression;
      expression = (text) => left(text) || right(text);
    }
    return expression;
  }

  const expression = parseOr();
  if (cursor !== tokens.length) throw new Error("Check the order of your Boolean operators.");
  return (text) => expression(text.toLowerCase());
}
// Decode imported HTML entities as plain text, never as HTML markup.
const named: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  hellip: "…", ndash: "–", mdash: "—", euro: "€",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  agrave: "à", acirc: "â", auml: "ä",
  ugrave: "ù", ucirc: "û", uuml: "ü",
  icirc: "î", iuml: "ï", ocirc: "ô", ouml: "ö",
  ccedil: "ç", aelig: "æ", oelig: "œ",
  copy: "©", reg: "®", deg: "°"
};
const entityPattern = /&(?:#(x[0-9a-fA-F]+|[0-9]+)|([a-zA-Z][a-zA-Z0-9]+));/g;

function decodeOnce(value: string): string {
  return value.replace(entityPattern, (match, numeric: string | undefined, name: string | undefined) => {
    if (numeric) {
      const hex = numeric[0]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(hex ? numeric.slice(1) : numeric, hex ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0x20 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return match;
      return String.fromCodePoint(codePoint);
    }
    if (!name) return match;
    if (name in named) return named[name]!;
    const lower = name.toLowerCase();
    if (lower in named && name !== lower) {
      const capitalized = named[lower]!;
      return capitalized.toLocaleUpperCase("fr-FR");
    }
    return match;
  });
}

export function decodeHtmlEntities(value: string): string {
  if (!value.includes("&")) return value;
  const once = decodeOnce(value);
  return decodeOnce(once);
}

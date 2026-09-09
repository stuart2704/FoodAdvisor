import {
  REPLY_PATTERN_GROUPS,
  type RecommendedAction,
  type ReplyCategory,
  type ReplyConfidence,
} from "./replyPatterns";

export interface ReplyClassification {
  category: ReplyCategory;
  confidence: ReplyConfidence;
  matchedPattern: string | null;
  recommendedAction: RecommendedAction;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return HTML_ENTITIES[code.toLowerCase()] ?? entity;
    const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
    const digits = radix === 16 ? code.slice(2) : code.slice(1);
    const point = Number.parseInt(digits, radix);
    return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : entity;
  });
}

function stripQuotedHistoryAndSignature(value: string): string {
  const lines = value.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^>/.test(trimmed) ||
      /^-{2,}\s*(?:original message|forwarded message)\s*-*$/i.test(trimmed) ||
      /^on .{1,240} wrote:$/i.test(trimmed) ||
      /^from:\s*.{1,240}(?:@|<)/i.test(trimmed)
    ) {
      break;
    }
    if (
      kept.some((item) => item.trim().length > 0) &&
      (/^--\s*$/.test(trimmed) || /^sent from my\b/i.test(trimmed))
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

export function normalizeReplyBody(body: string): string {
  const withoutHiddenHtml = body
    .replace(/<(script|style|blockquote)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return stripQuotedHistoryAndSignature(decodeEntities(withoutHiddenHtml))
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02bc\u0060]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase();
}

function isNegated(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 64), matchIndex);
  return (
    /\b(?:do\s+not|don't|not|never)\s+(?:(?:want\s+to|the)\s+)?$/i.test(prefix) ||
    /\b(?:not\s+sure|unsure|don't\s+know)\s+(?:if|whether)\s+$/i.test(prefix)
  );
}

function hasAmbiguousIntent(text: string): boolean {
  return (
    /\b(?:not\s+sure|unsure|undecided|mixed\s+feelings)\s+(?:if|whether|about)\b/i.test(
      text,
    ) ||
    /\b(?:but|however)\s+(?:maybe\s+)?not\b/i.test(text)
  );
}

export function classifyReply(body: string): ReplyClassification {
  const normalized = normalizeReplyBody(body);
  const safetyGroups = REPLY_PATTERN_GROUPS.slice(0, 4);
  for (const group of safetyGroups) {
    for (const pattern of group.patterns) {
      const match = pattern.expression.exec(normalized);
      if (!match || isNegated(normalized, match.index)) continue;
      return {
        category: group.category,
        confidence: pattern.confidence,
        matchedPattern: pattern.name,
        recommendedAction: group.recommendedAction,
      };
    }
  }
  if (hasAmbiguousIntent(normalized)) {
    return {
      category: "unknown",
      confidence: "low",
      matchedPattern: null,
      recommendedAction: "manual_review",
    };
  }
  for (const group of REPLY_PATTERN_GROUPS.slice(4)) {
    for (const pattern of group.patterns) {
      const match = pattern.expression.exec(normalized);
      if (!match || isNegated(normalized, match.index)) continue;
      return {
        category: group.category,
        confidence: pattern.confidence,
        matchedPattern: pattern.name,
        recommendedAction: group.recommendedAction,
      };
    }
  }
  return {
    category: "unknown",
    confidence: "low",
    matchedPattern: null,
    recommendedAction: "manual_review",
  };
}
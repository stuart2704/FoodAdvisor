export type ReplyCategory =
  | "unsubscribe"
  | "wrong_contact"
  | "out_of_office"
  | "not_interested"
  | "upgrade"
  | "interested"
  | "question"
  | "unknown";

export type ReplyConfidence = "low" | "medium" | "high";

export type RecommendedAction =
  | "suppress"
  | "pause"
  | "sales_follow_up"
  | "answer_question"
  | "manual_review";

export interface ReplyPattern {
  readonly name: string;
  readonly expression: RegExp;
  readonly confidence: ReplyConfidence;
}

export interface ReplyPatternGroup {
  readonly category: ReplyCategory;
  readonly recommendedAction: RecommendedAction;
  readonly patterns: readonly ReplyPattern[];
}

export const REPLY_PATTERN_GROUPS: readonly ReplyPatternGroup[] = [
  {
    category: "unsubscribe",
    recommendedAction: "suppress",
    patterns: [
      { name: "unsubscribe", expression: /\b(?:please\s+)?unsubscribe(?:\s+(?:me|us))?\b/i, confidence: "high" },
      { name: "standalone_remove", expression: /^(?:please\s+)?remove[.! ]*$/i, confidence: "medium" },
      { name: "remove_recipient", expression: /\bremove\s+(?:me|us)\b/i, confidence: "high" },
      { name: "stop_emailing", expression: /\bstop\s+emailing(?:\s+(?:me|us))?\b/i, confidence: "high" },
      { name: "remove_from_list", expression: /\b(?:remove|take)\s+(?:me|us)\s+(?:off|from)\s+(?:your\s+)?(?:list|mailing list|emails?)\b/i, confidence: "high" },
      { name: "stop_contact", expression: /\b(?:do not|don't|stop)\s+(?:emailing|contacting|sending(?:\s+(?:me|us))?\s+emails?\s+to)\s+(?:me|us)\b/i, confidence: "high" },
      { name: "opt_out", expression: /\b(?:i|we)\s+(?:want|would like)\s+to\s+opt\s*out\b/i, confidence: "high" },
    ],
  },
  {
    category: "wrong_contact",
    recommendedAction: "suppress",
    patterns: [
      { name: "wrong_recipient", expression: /\bwrong\s+(?:person|contact|recipient|email|address)\b/i, confidence: "high" },
      { name: "not_correct_contact", expression: /\b(?:i am|i'm|we are|we're)\s+not\s+the\s+(?:right|correct)\s+(?:person|contact)\b/i, confidence: "high" },
      { name: "not_our_business", expression: /\b(?:this is|you have)\s+not\s+(?:our|the right)\s+(?:restaurant|business|company)\b/i, confidence: "high" },
      { name: "no_longer_here", expression: /\b(?:no longer|does not|doesn't)\s+(?:work|works)\s+(?:here|at|for)\b/i, confidence: "high" },
      { name: "left_business", expression: /\b(?:has|have)\s+left\s+(?:the\s+)?(?:business|company|restaurant)\b/i, confidence: "high" },
    ],
  },
  {
    category: "out_of_office",
    recommendedAction: "pause",
    patterns: [
      { name: "out_of_office", expression: /\bout\s+of\s+(?:the\s+)?office\b/i, confidence: "high" },
      { name: "automatic_reply", expression: /\b(?:automatic|automated|auto)\s*(?:reply|response)\b/i, confidence: "high" },
      { name: "away_until", expression: /\b(?:away|on\s+(?:annual\s+)?leave|on\s+holiday|on\s+vacation)\s+(?:from\b.*\b)?until\b/i, confidence: "high" },
      { name: "limited_email_access", expression: /\blimited\s+(?:access\s+to|ability\s+to\s+access)\s+(?:my\s+)?email\b/i, confidence: "medium" },
    ],
  },
  {
    category: "not_interested",
    recommendedAction: "suppress",
    patterns: [
      { name: "not_interested", expression: /\b(?:not|no longer)\s+interested\b/i, confidence: "high" },
      { name: "standalone_no", expression: /^no[.! ]*$/i, confidence: "medium" },
      { name: "no_thank_you", expression: /\bno\s+thank\s+you\b/i, confidence: "high" },
      { name: "decline_for_now", expression: /\b(?:not\s+right\s+now|maybe\s+later)\b/i, confidence: "medium" },
      { name: "no_need", expression: /\b(?:don't|do\s+not)\s+need\b/i, confidence: "medium" },
      { name: "already_okay", expression: /\b(?:we're|we\s+are)\s+(?:okay|fine)\b/i, confidence: "medium" },
      { name: "no_thanks", expression: /\b(?:no|not)\s+thanks?\b/i, confidence: "high" },
      { name: "decline_offer", expression: /\b(?:i|we)(?:'re|'m|\s+are|\s+am)?\s*(?:will\s+)?(?:pass|decline)\b/i, confidence: "medium" },
      { name: "do_not_want", expression: /\b(?:do not|don't)\s+want\s+(?:to\s+)?(?:subscribe|upgrade|claim|proceed|continue)\b/i, confidence: "high" },
      { name: "not_for_us", expression: /\b(?:this|it|that)\s+(?:isn't|is\s+not)\s+for\s+us\b/i, confidence: "medium" },
    ],
  },
  {
    category: "upgrade",
    recommendedAction: "sales_follow_up",
    patterns: [
      { name: "upgrade_enquiry", expression: /\b(?:upgrade|paid\s+version|priority\s+placement|send\s+(?:(?:me|us)\s+)?the\s+link)\b/i, confidence: "medium" },
      { name: "ready_to_upgrade", expression: /\b(?:ready|want|would like|keen)\s+to\s+(?:upgrade|subscribe|sign\s*up|claim)\b/i, confidence: "high" },
      { name: "start_subscription", expression: /\b(?:start|set\s+up|activate)\s+(?:the|a|our)?\s*(?:subscription|listing|upgrade)\b/i, confidence: "high" },
      { name: "send_checkout", expression: /\b(?:send|share)\s+(?:me|us)\s+(?:the\s+)?(?:checkout|payment|sign\s*up)\s+link\b/i, confidence: "high" },
    ],
  },
  {
    category: "question",
    recommendedAction: "answer_question",
    patterns: [
      { name: "menu_request", expression: /\bmenus?\b/i, confidence: "medium" },
      { name: "app_question", expression: /\b(?:mobile\s+)?app\b/i, confidence: "medium" },
    ],
  },
  {
    category: "interested",
    recommendedAction: "sales_follow_up",
    patterns: [
      { name: "explicit_interest", expression: /\b(?:i am|i'm|we are|we're)\s+(?:very\s+|definitely\s+)?interested\b/i, confidence: "high" },
      { name: "standalone_interest", expression: /^(?:yes[,.! ]+)?interested[.! ]*$/i, confidence: "medium" },
      { name: "affirmative_reply", expression: /^yes(?:[,.! ]|$)/i, confidence: "medium" },
      { name: "positive_proceed", expression: /\b(?:sounds\s+good|let's\s+do\s+it|go\s+ahead|please\s+proceed|sign\s+us\s+up)\b/i, confidence: "medium" },
      { name: "love_to_be_listed", expression: /\blove\s+to\s+be\s+listed\b/i, confidence: "medium" },
      { name: "keen_to_proceed", expression: /^(?:(?:i'm|i\s+am|we're|we\s+are)\s+)?keen[.! ]*$/i, confidence: "medium" },
      { name: "sounds_interesting", expression: /\b(?:this|that|it)\s+sounds\s+(?:very\s+)?interesting\b/i, confidence: "medium" },
      { name: "tell_me_more", expression: /\b(?:tell|send)\s+(?:me|us)\s+more\b/i, confidence: "medium" },
      { name: "send_details", expression: /\bsend\s+(?:(?:me|us)\s+)?details\b/i, confidence: "medium" },
      { name: "more_info", expression: /\bmore\s+info(?:rmation)?\b/i, confidence: "medium" },
    ],
  },
  {
    category: "question",
    recommendedAction: "answer_question",
    patterns: [
      { name: "pricing_question", expression: /\b(?:how much|what(?:'s| is)\s+the\s+(?:price|cost)|pricing|does it cost)\b/i, confidence: "high" },
      { name: "request_information", expression: /\b(?:more\s+info(?:rmation)?|can\s+you\s+explain|what\s+do\s+you\s+offer|details|price)\b/i, confidence: "medium" },
      { name: "process_question", expression: /\b(?:how|where|when|what)\s+(?:do|does|can|would|is|are)\b/i, confidence: "medium" },
      { name: "question_mark", expression: /\?/i, confidence: "low" },
    ],
  },
] as const;
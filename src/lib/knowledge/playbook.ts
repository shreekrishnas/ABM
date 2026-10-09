// Writing playbook: how a message should look for each channel and step. Seller-agnostic
// (what a seller says comes from its pack; how to say it on each channel lives here).
// The writer gets the play for the step it is writing, and checkPlay() enforces the
// measurable parts as a critic, so a rule here is never just advice.
//
// Every rule cites the sources in ./sources.ts. When our own reply data disagrees
// with a rule, change the rule and say why in its `basis`.

export type PlayKey = "email_first" | "email_follow_up" | "email_last" | "linkedin_connect" | "linkedin_first_message" | "linkedin_follow_up";
export type PlayChannel = "email" | "linkedin";

export interface Play {
  key: PlayKey;
  channel: PlayChannel;
  label: string;
  /** What this message is for. One job per message. */
  goal: string;
  /** Measurable limits, checked by code. Words count the message body before the signature. */
  limits: { minWords?: number; maxWords?: number; maxChars?: number; subjectMaxWords?: number; maxQuestions: number };
  /** Order of the message, in plain steps. */
  structure: string[];
  do: string[];
  dont: string[];
  /** How to ask. */
  cta: string;
  sources: string[];
}

export const PLAYS: Record<PlayKey, Play> = {
  email_first: {
    key: "email_first",
    channel: "email",
    label: "First cold email",
    goal: "Earn a reply by showing you understand one specific thing happening at their company and how it touches their job — not to explain the product.",
    limits: { minWords: 40, maxWords: 110, subjectMaxWords: 7, maxQuestions: 2 },
    structure: [
      "Opening (1 sentence): the most specific, recent fact about their company — the trigger. Name it plainly.",
      "Bridge (1–2 sentences): what that change usually means for someone in their role, phrased as a question or 'teams in that spot often…' — a hypothesis, never a claim about them.",
      "Relevance (1–2 sentences): one thing the seller does about exactly that, with one proof point if it fits.",
      "Ask (1 sentence): a single soft interest question.",
    ],
    do: [
      "Use two concrete details from the facts (a programme name, a number, a place, a date).",
      "Write like one professional to another: short sentences, plain words, no adjectives about the seller.",
      "Subject: 3–7 words, specific to them (their initiative or the problem), lower-key than an ad.",
      "Follow the market norms for greetings and formality (they come with the seller's market knowledge).",
    ],
    dont: [
      "No product tour, feature list, attachments or more than one link.",
      "No ROI promises, percentages about their business, or 'guaranteed' language.",
      "No fake familiarity ('as discussed', 'following our chat') and no stock AI phrases.",
      "Don't ask for a specific meeting time in the first email.",
    ],
    cta: "One interest question: 'Worth exploring?', 'Is this on your radar this quarter?', 'Open to comparing notes?'.",
    sources: ["hunter_2026", "saleshandy_2026", "gong_cta", "gong_stats", "gartner_buyers_2025"],
  },
  email_follow_up: {
    key: "email_follow_up",
    channel: "email",
    label: "Follow-up email",
    goal: "Add one new reason to reply — a different fact, angle or proof — so the follow-up stands on its own.",
    limits: { minWords: 25, maxWords: 90, subjectMaxWords: 7, maxQuestions: 1 },
    structure: [
      "One line that connects to the earlier note without guilt ('Adding one thing to my note on <topic>').",
      "The new item: a second fact about them, a short customer story for the same problem, or a sharper question for their role.",
      "The same soft ask, reworded.",
    ],
    do: [
      "Change the angle each time: trigger → customer story → role-specific question.",
      "Keep it shorter than the first email.",
      "Reply in the same thread (keep 'Re:' on the subject) so context stays together.",
    ],
    dont: [
      "No 'just checking in', 'bumping this', 'circling back' or 'I never heard back'.",
      "Don't repeat the first email's pitch word for word.",
      "Don't add pressure or deadlines that aren't real.",
    ],
    cta: "One soft question, different wording from the first email.",
    sources: ["hunter_2026", "saleshandy_2026", "woodpecker_2026", "gong_stats"],
  },
  email_last: {
    key: "email_last",
    channel: "email",
    label: "Last email in the sequence",
    goal: "Close the loop politely and leave the door open — the last message gets the fewest replies, so make it easy to say 'not now' or point to the right person.",
    limits: { minWords: 20, maxWords: 70, subjectMaxWords: 7, maxQuestions: 1 },
    structure: [
      "Say this is the last note on the topic.",
      "One-line recap of why it could matter to them.",
      "An easy out: is someone else the right person, or is a later time better?",
    ],
    do: ["Make 'no' or 'not now' a perfectly fine answer.", "Offer to send a short summary instead of a call."],
    dont: ["No 'should I close your file' tactics, no guilt, no new claims."],
    cta: "'Is someone else closer to this, or should I check back next quarter?'",
    sources: ["woodpecker_2026", "hunter_2026", "tmf_india_culture"],
  },
  linkedin_connect: {
    key: "linkedin_connect",
    channel: "linkedin",
    label: "LinkedIn connection note",
    goal: "Get the connection accepted. The note is a reason to connect, not a pitch — replies come later, in the conversation.",
    limits: { maxChars: 200, maxQuestions: 1 },
    structure: ["One specific, genuine reason to connect (their initiative, a shared interest in the problem).", "Optional: a light question or a plain 'would be glad to connect'."],
    do: ["Stay under 200 characters so it works on a free LinkedIn account.", "Mention one specific thing about them or their company."],
    dont: ["No pitch, no product name, no link, no meeting request.", "No 'I'd love to pick your brain'."],
    cta: "None needed; at most a light question.",
    sources: ["expandi_li_2026", "linkedin_note_limits"],
  },
  linkedin_first_message: {
    key: "linkedin_first_message",
    channel: "linkedin",
    label: "First LinkedIn message after connecting",
    goal: "Start a conversation about their world. Conversational and short — this is a chat, not an email.",
    limits: { minWords: 15, maxWords: 70, maxQuestions: 1 },
    structure: ["Thanks for connecting (one short clause).", "The specific trigger and one question about how it affects their team.", "Optionally one line on what the seller does — only if it answers that question."],
    do: ["Write the way people message on LinkedIn: no subject, no signature, no formal sign-off.", "Ask a question they can answer in one line."],
    dont: ["No long paragraphs, no bullet lists, no attachments.", "Don't paste the email."],
    cta: "A question about their situation, not a request for time.",
    sources: ["expandi_li_2026", "hunter_2026", "gartner_buyers_2025"],
  },
  linkedin_follow_up: {
    key: "linkedin_follow_up",
    channel: "linkedin",
    label: "LinkedIn follow-up",
    goal: "Give them something useful (a short insight or a customer story in one line) and keep the door open.",
    limits: { minWords: 10, maxWords: 50, maxQuestions: 1 },
    structure: ["One useful line tied to their situation.", "One easy question."],
    do: ["Keep it under three short sentences."],
    dont: ["No 'just following up', no guilt, no repeated pitch."],
    cta: "An easy yes/no or one-line question.",
    sources: ["expandi_li_2026", "gong_stats"],
  },
};

/** Which play a sequence step uses: first email, follow-ups, and the last email; LinkedIn by position. */
export function playFor(channel: string, stepOrder: number, opts: { firstOfChannel: boolean; lastOfChannel: boolean; connected?: boolean }): Play {
  if (channel === "linkedin") return PLAYS[opts.connected ? (opts.firstOfChannel ? "linkedin_first_message" : "linkedin_follow_up") : "linkedin_connect"];
  if (opts.firstOfChannel || stepOrder <= 1) return PLAYS.email_first;
  return opts.lastOfChannel ? PLAYS.email_last : PLAYS.email_follow_up;
}

/** The part of an email people actually read: before the signature block. */
export function messageBody(body: string, senderName?: string) {
  const cut = senderName ? body.split(`\n\n${senderName}`)[0] : body;
  return cut.replace(/\n\nReply "unsubscribe"[\s\S]*$/, "").trim();
}

const FILLER = [/\bjust (checking|following) (in|up)\b/i, /\bbump(ing)? this\b/i, /\bcircling back\b/i, /\bi never heard back\b/i, /\bper my last (email|note)\b/i, /\bpick your brain\b/i, /\bshould i close your file\b/i];

export interface PlayCheck {
  pass: boolean;
  issues: string[];
  words: number;
  chars: number;
}

/** The measurable parts of a play, checked by code. Each issue says what to change. */
export function checkPlay(play: Play, msg: { subject?: string | null; body: string }): PlayCheck {
  const text = msg.body.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  const issues: string[] = [];
  const L = play.limits;
  if (L.maxWords && words > L.maxWords) issues.push(`${play.label}: ${words} words — cut to ${L.maxWords} or fewer`);
  if (L.minWords && words < L.minWords) issues.push(`${play.label}: only ${words} words — add the specific reason it matters to them`);
  if (L.maxChars && chars > L.maxChars) issues.push(`${play.label}: ${chars} characters — LinkedIn allows ${L.maxChars}; shorten it`);
  if (play.channel === "email" && L.subjectMaxWords && msg.subject) {
    const sw = msg.subject.replace(/^re:\s*/i, "").split(/\s+/).filter(Boolean).length;
    if (sw > L.subjectMaxWords) issues.push(`Subject has ${sw} words — use ${L.subjectMaxWords} or fewer`);
  }
  const questions = (text.match(/\?/g) ?? []).length;
  if (questions > L.maxQuestions) issues.push(`${questions} questions — ask only ${L.maxQuestions === 1 ? "one" : `up to ${L.maxQuestions}`}`);
  const filler = FILLER.map((r) => text.match(r)?.[0]).find(Boolean);
  if (filler) issues.push(`"${filler}" — give a new reason to reply instead`);
  if (play.channel === "linkedin" && /https?:\/\//i.test(text) && play.key === "linkedin_connect") issues.push("No links in a connection note");
  if ((text.match(/https?:\/\//gi) ?? []).length > 1) issues.push("More than one link — keep at most one");
  return { pass: issues.length === 0, issues, words, chars };
}

/** The play as plain instructions for the writer. */
export function playBrief(play: Play): string {
  const L = play.limits;
  const limits = [L.maxWords && `${L.minWords ?? 0}–${L.maxWords} words`, L.maxChars && `max ${L.maxChars} characters`, L.subjectMaxWords && `subject ≤ ${L.subjectMaxWords} words`, `at most ${L.maxQuestions} question${L.maxQuestions === 1 ? "" : "s"}`].filter(Boolean).join(", ");
  return [
    `PLAY: ${play.label} (${play.channel}). Goal: ${play.goal}`,
    `Limits: ${limits}.`,
    `Structure:\n- ${play.structure.join("\n- ")}`,
    `Do:\n- ${play.do.join("\n- ")}`,
    `Don't:\n- ${play.dont.join("\n- ")}`,
    `Ask: ${play.cta}`,
  ].join("\n");
}

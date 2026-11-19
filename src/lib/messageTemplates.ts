export type MessageKind = "unableToConnect" | "intro" | "noAnswer" | "callBack" | "thanks" | "documents" | "interview" | "offer" | "other";

export const MESSAGE_LABELS: Record<MessageKind, string> = {
  unableToConnect: "Unable to connect, please call back",
  intro: "Check availability",
  noAnswer: "Missed call",
  callBack: "Call back later",
  thanks: "Thanks after call",
  documents: "Request documents",
  interview: "Interview reminder",
  offer: "Offer follow-up",
  other: "Other (write your own)",
};

export const MESSAGE_FOR_OUTCOME: Record<string, MessageKind> = {
  "Connected": "thanks",
  "No answer": "noAnswer",
  "Busy": "noAnswer",
  "Call back later": "callBack",
  "Wrong number": "intro",
};

export function buildMessage(kind: MessageKind, v: { name: string; role?: string; recruiter?: string; phone?: string }): string {
  const first = v.name.trim().split(/\s+/)[0] || "there";
  const role = v.role ? ` for the ${v.role} role` : "";
  const sign = `\n\nRegards,\n${v.recruiter || "Talent Acquisition"}${v.phone ? `\n${v.phone}` : ""}`;
  const callBack = v.phone ? `Please call me back on ${v.phone}, or reply to this email with a time that suits you.` : "Please reply to this email with a time that suits you, and I will call you.";
  switch (kind) {
    case "unableToConnect": return `Hi ${first}, I tried to reach you about your application${role} but could not connect. ${callBack}${sign}`;
    case "intro": return `Hi ${first}, this is regarding your application${role}. Is this a good number to reach you, and when are you free for a quick call?${sign}`;
    case "noAnswer": return `Hi ${first}, I tried calling you about your application${role}. Please let me know a good time to talk, or reply here.${sign}`;
    case "callBack": return `Hi ${first}, as discussed, I will call you back${v.role ? " about the role" : ""}. Please share the time that suits you best.${sign}`;
    case "thanks": return `Hi ${first}, thank you for speaking with me${role}. I will share the next steps shortly. Please let me know if you have any questions.${sign}`;
    case "documents": return `Hi ${first}, to move your application${role} forward, please share your updated CV, current and expected CTC, and notice period.${sign}`;
    case "interview": return `Hi ${first}, a reminder about your upcoming interview${role}. Please confirm that you can attend, and tell me if you need to reschedule.${sign}`;
    case "other": return `Hi ${first},
${sign}`;
    case "offer": return `Hi ${first}, following up on your offer${role}. Please let me know if you have any questions, or when you expect to decide.${sign}`;
  }
}

/** wa.me wants digits only, with the country code. */
export function whatsappLink(dial: string, text: string) {
  return `https://wa.me/${dial.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export function gmailLink(email: string, subject: string, text: string) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

export function mailLink(email: string, subject: string, text: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

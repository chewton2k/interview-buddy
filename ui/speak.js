// Reads interviewer replies aloud with the voices built into the browser and the system.
const WORDS = { le: 'at most', leq: 'at most', ge: 'at least', geq: 'at least', times: 'times', cdot: 'times', to: 'to', ne: 'not equal to', neq: 'not equal to', approx: 'about', infty: 'infinity', sum: 'sum of' };

/** Plain words from a reply: code, markdown marks and math markup are dropped or said in words. */
export function spoken(text) {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' (see the code in the chat) ')
    .replace(/\$\$?([^$]+)\$\$?/g, (_, m) => m.replace(/\\([a-zA-Z]+)/g, (_, w) => ` ${WORDS[w] ?? w} `).replace(/\^/g, ' to the ').replace(/[{}_\\]/g, ' '))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/g, 'a link')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*~#]+/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentences of at most `max` characters, because some browsers stop long utterances partway. */
export function sentences(text, max = 220) {
  const out = [];
  for (const s of text.split(/(?<=[.!?:;])\s+/)) {
    let rest = s;
    while (rest.length > max) {
      const at = rest.lastIndexOf(' ', max);
      out.push(rest.slice(0, at > 0 ? at : max));
      rest = rest.slice(at > 0 ? at + 1 : max);
    }
    if (rest) out.push(rest);
  }
  return out;
}

export const canSpeak = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

/** Prefers an enhanced or premium English voice when the system has one downloaded. */
const voice = () => {
  const english = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  return english.find((v) => /premium|enhanced/i.test(v.name)) ?? english.find((v) => v.default) ?? english[0];
};

export function say(text) {
  const v = voice();
  for (const s of sentences(spoken(text))) {
    const u = new SpeechSynthesisUtterance(s);
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-US';
    speechSynthesis.speak(u);
  }
}

export const hush = () => canSpeak() && speechSynthesis.cancel();

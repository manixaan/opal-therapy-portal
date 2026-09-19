'use strict';

/**
 * PLAIN TEXT — no formatting notation in any assistant reply.
 *
 * The chat surfaces show text as typed; a model that answers in Markdown
 * leaves "**Scheduling**" and "## Summary" on the screen, and the same marks
 * would be pasted into Word, Outlook and case notes. The prompts ask for plain
 * text, but a request is not a guarantee, so every reply also passes through
 * here. Pure: no I/O.
 *
 * Kept: the words, line breaks, numbered lists ("1."), and de-identification
 * tokens ("[CLIENT_1]"). Changed: list dashes become "• ". Removed: bold and
 * italic marks, heading hashes, backticks and code fences, block-quote marks,
 * horizontal rules, and Markdown links (the text stays, with its address).
 */

function toPlainText(input) {
  let t = String(input || '');
  t = t.replace(/^[ \t]*```[a-zA-Z0-9_-]*[ \t]*$/gm, '');          // code fences
  t = t.replace(/`([^`\n]*)`/g, '$1').replace(/`/g, '');             // inline code
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');                    // headings
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, '');                         // block quotes
  t = t.replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, '');            // horizontal rules
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)'); // links
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2');             // bold
  t = t.replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=[\s).,;:!?]|$)/gm, '$1$2'); // italic *x*
  t = t.replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=[\s).,;:!?]|$)/gm, '$1$2');   // italic _x_
  t = t.replace(/\*\*|__/g, '');                                     // any unpaired leftovers
  t = t.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ');                   // list dashes
  return t.replace(/\n{3,}/g, '\n\n');
}

/**
 * Streaming: marks can be split across chunks ("*" + "*Scheduling**"), so text
 * is released a line at a time, or word by word once the unfinished line holds
 * nothing that could still turn out to be a mark. `flush()` releases the rest.
 */
function plainTextStream(onText) {
  let held = '';
  let midLine = false; // the text already released ended part-way through a line
  const release = (chunk) => {
    // Fence marker lines vanish; what is between them stays.
    const kept = chunk.split('\n').filter((line, i) => !(/^[ \t]*```/.test(line) && !(midLine && i === 0))).join('\n');
    // Part-way through a line, the start of this chunk is NOT a line start: a guard letter keeps "- " from becoming a bullet.
    const out = midLine ? toPlainText(`x${kept}`).slice(1) : toPlainText(kept);
    if (out) onText(out);
    midLine = !chunk.endsWith('\n');
  };
  return {
    push(chunk) {
      held += String(chunk || '');
      const cut = held.lastIndexOf('\n');
      if (cut !== -1) { release(held.slice(0, cut + 1)); held = held.slice(cut + 1); }
      // The unfinished line can go too, once nothing in it could still turn out to be a mark:
      // no asterisk, underscore or backtick anywhere, and not a line that may yet begin "- ", "# " or "> ".
      if (held && !/[*_`]/.test(held) && (midLine || !/^[ \t]{0,3}(?:[-+#>][ \t#]*)?$/.test(held)) && (midLine || !/^[ \t]{0,3}[-+#>]/.test(held))) {
        const space = held.lastIndexOf(' ');
        if (space > 0) { release(held.slice(0, space + 1)); held = held.slice(space + 1); }
      }
    },
    flush() { if (held) { release(held); held = ''; } },
  };
}

const PLAIN_TEXT_INSTRUCTION = 'FORMAT\nWrite plain text only. No Markdown and no formatting marks of any kind: no asterisks for bold or italics, '
  + 'no # headings, no backticks, no tables. For a list, start each line with "• " or "1." and nothing else. Use blank lines between paragraphs.';

module.exports = { toPlainText, plainTextStream, PLAIN_TEXT_INSTRUCTION };

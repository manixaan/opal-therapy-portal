'use strict';

/** No formatting notation reaches a chat bubble, a document or a note — whatever the model sends. */

const { toPlainText, plainTextStream } = require('../assist/plain-text');

test('the reply Antony saw on staging comes out clean', () => {
  const md = "Yes, I'm working!\n\nI can answer questions about:\n\n- **Scheduling** — the Master Scheduler\n- **Resource Hub** — finding resources\n\n## Next\nUse `Settings` or see [the guide](https://example.com/guide).\n\n> note\n\n---\n*Thanks*, __Antony__.";
  expect(toPlainText(md)).toBe("Yes, I'm working!\n\nI can answer questions about:\n\n• Scheduling — the Master Scheduler\n• Resource Hub — finding resources\n\nNext\nUse Settings or see the guide (https://example.com/guide).\n\nnote\n\nThanks, Antony.");
});

test('what is not formatting is left alone: tokens, numbered steps, maths, snake_case, a lone asterisk', () => {
  const t = '1. Ring [CLIENT_1] on [PHONE_1].\n2. [SCHOOL_1] (primary school) agreed.\n3 * 4 = 12, file_name_here, rated 4* overall.';
  expect(toPlainText(t)).toBe(t);
});

test('streaming catches a mark split across chunks and never emits one', () => {
  const seen = [];
  const s = plainTextStream((x) => seen.push(x));
  ['- *', '*Sched', 'uling** is ', 'here\n```js\nco', 'de line\n```\n# Hea', 'ding\nlast **bo', 'ld**'].forEach((c) => s.push(c));
  s.flush();
  const out = seen.join('');
  expect(out).toBe('• Scheduling is here\ncode line\nHeading\nlast bold');
  expect(out).not.toMatch(/\*\*|`|^#/m);
});

test('Opal Assist and Opa both pass their replies through it', async () => {
  const provider = require('../assist/assist-provider');
  provider._setProviderForTests(async ({ onText }) => { if (onText) { onText('**Hi** [CLIENT'); onText('_1]\n- one'); } return { text: '**Hi** [CLIENT_1]\n- one' }; });
  const seen = [];
  const streamed = await provider.generate({ system: 's', messages: [], onText: (x) => seen.push(x) });
  expect(seen.join('')).toBe('Hi [CLIENT_1]\n• one');
  expect(streamed.text).toBe('Hi [CLIENT_1]\n• one');
  expect((await provider.generate({ system: 's', messages: [] })).text).toBe('Hi [CLIENT_1]\n• one');
  provider._setProviderForTests(null);
  const fs = require('fs'); const path = require('path');
  expect(fs.readFileSync(path.join(__dirname, '../opa-routes.js'), 'utf8')).toContain('toPlainText(String(parsed.answer');
  expect(fs.readFileSync(path.join(__dirname, '../opa-provider.js'), 'utf8')).toContain('plainTextStream(onText)');
});

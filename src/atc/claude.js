// Optional Claude-powered radio understanding. The player supplies their own Anthropic API key
// in Settings; it is kept in that browser's localStorage and sent only to the Anthropic API.
// This module is lazy-loaded, so players without a key never download the SDK.
//
// Claude does not invent clearances. It maps what the pilot said onto one of the calls the
// procedural controller can act on right now (or answers a side question in character), so the
// simulation always tracks exactly what was cleared.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const Decision = z.object({
  action: z.string().describe('The id of the matching available action, or "none" if no action matches.'),
  reply: z.string().describe('Only when action is "none": what the controller transmits, in standard radio phraseology. Otherwise an empty string.'),
});

const SYSTEM = `You are the air traffic controller in a flight simulator. You work one frequency at a time; the "facility" field says which position you are (clearance delivery, ground, tower, departure, center or approach).

You receive a JSON situation report and the pilot's latest radio transmission (typed or transcribed from speech, so expect errors, missing punctuation and misheard numbers).

Your job is to decide what the pilot is asking for.

1. "available_actions" lists every call the simulator can act on right now. Each has an "id" and "pilot_says", a description of the call. If the pilot's transmission means the same thing as one of them, return that id as "action" and leave "reply" empty. The simulator then issues the correct clearance itself. Match on meaning, not wording: "ready to go on two eight left" matches a ready-for-departure action; "with you at nine thousand" matches a check-in.
2. A read-back action is available when an instruction is waiting to be read back; "last_instruction" holds that instruction. Choose the read-back action only if the pilot repeated the important numbers correctly (runway, altitude, heading, frequency, squawk) or clearly acknowledged. If a number is wrong, return "none" and correct it: "<callsign>, negative, <the correct item>, read back."
3. If nothing matches, return "none" and answer as the controller would, briefly, using the situation report for facts (wind, altimeter, runway in use, traffic, the pilot's position and assigned altitude/heading). Use standard FAA phraseology, address the aircraft by call sign first, and keep it to one or two short sentences.
4. You cannot grant anything that is not in "available_actions". If the pilot requests something else (a different runway, a different altitude, a shortcut), reply "<callsign>, unable, <short reason>" or "stand by", or tell them which facility to contact.
5. If the transmission is unintelligible or not aviation-related, reply "<callsign>, say again."

Write numbers the way they appear in the situation report (for example "runway 28L", "5,000", "FL350", "heading 270", "120.5"). Never use markdown. Never mention that you are an AI or that this is a simulator.`;

let client = null, clientKey = '';

/**
 * situation: plain object (facility, callsign, phase, aircraft, position, assigned, weather, ...)
 * actions:   [{ id, pilot_says }]
 * Returns { action, reply } or throws an Error with a short, user-readable message.
 */
export async function interpretTransmission({ apiKey, model, situation, actions, text }) {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 20000 });
    clientKey = apiKey;
  }
  const params = {
    model,
    max_tokens: 2000,
    // stable instructions first so repeated calls can reuse the prompt cache
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify({ ...situation, available_actions: actions, pilot_transmission: text }) }],
    output_config: { effort: 'low', format: zodOutputFormat(Decision) },
  };
  let res;
  try {
    // Opus and Sonnet can decline a request; opt in to the server-side fallback so the radio
    // still gets an answer. Haiku has no server-side fallback.
    if (/haiku/.test(model)) res = await client.messages.create(params);
    else res = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('API key rejected — check it in Settings.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('This API key cannot use the selected model.');
    if (err instanceof Anthropic.NotFoundError) throw new Error('Selected Claude model is not available to this key.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the API — try again in a moment.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Anthropic API.');
    if (err instanceof Anthropic.APIError) throw new Error(`API error ${err.status || ''}`.trim());
    throw err;
  }
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.');
  const block = res.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Empty response from the model.');
  const parsed = Decision.safeParse(JSON.parse(block.text));
  if (!parsed.success) throw new Error('Unexpected response from the model.');
  return { ...parsed.data, usage: res.usage };
}

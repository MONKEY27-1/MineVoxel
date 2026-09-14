// Chat commands (phase 1b) that aren't already covered by /say and /me
// (see commands/effectsFeedback.js — they live there since the spec
// lists them under "effects/feedback" too, and a command must only be
// registered once). Everything here reads/writes the one shared
// MessageLog (chat/messageLog.js) — no separate note/filter state.
import { literal, argument } from '../commandTree.js';
import { string, literalSet, bool } from '../argumentTypes.js';
import { CATEGORIES } from '../../chat/messageLog.js';

export function register(dispatcher) {
  dispatcher.register(
    literal('note')
      .describes('Pins a searchable note to the chat log')
      .then(
        argument('text', string('greedy')).executes((context, args) => {
          context.world.messageLog.push({ source: 'player', category: 'system', style: 'normal', segments: `📌 ${args.text}`, pinned: true });
          context.success('Noted.');
          return { success: true };
        })
      )
  );

  dispatcher.register(
    literal('chat')
      .describes('Manages the chat log')
      .then(
        literal('clear').executes((context) => {
          context.world.messageLog.clear();
          return { success: true };
        })
      )
      .then(
        literal('export').executes((context) => {
          runChatExport(context);
          return { success: true };
        })
      )
      .then(
        literal('filter').then(
          argument('category', literalSet(CATEGORIES)).then(
            argument('enabled', bool()).executes((context, args) => {
              context.world.messageLog.setCategoryEnabled(args.category, args.enabled);
              context.success(`Category "${args.category}" ${args.enabled ? 'shown' : 'hidden'}.`);
              return { success: true };
            })
          )
        )
      )
  );
}

/** A plain client-side text download — the same Blob+anchor pattern any web app uses for a "download my data" button, triggered by the player's own /chat export, on their own machine. */
function runChatExport(context) {
  const text = context.world.messageLog.exportText();
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `minevoxel-chat-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  context.success('Chat log exported.');
}

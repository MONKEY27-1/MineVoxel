// Effects/feedback commands (phase 5): particle, playsound, title,
// actionbar, say, me. Each resolves into an already-existing effect —
// ParticleSystem.spawnBurst, the named synth.js sound triggers,
// TitleDisplay, MessageLog — never a parallel rendering/audio path.
import { literal, argument } from '../commandTree.js';
import { color, blockPos, integer, float, string, literalSet } from '../argumentTypes.js';
import { resolvePos } from '../commandHelpers.js';
import { CommandExecutionError } from '../context.js';
import {
  playUIClick,
  playMobHit,
  playMobDeath,
  playPlayerHurt,
  playExplosion,
  playSplash,
  playDrip,
} from '../../audio/synth.js';

// Every sound this engine can actually play is one of these named,
// zero-argument synthesized triggers (audio/synth.js) — no positional
// audio, and no per-call volume/pitch override exists to plumb through,
// so /playsound only takes the sound name, not the [pos]/[volume]/
// [pitch] vanilla also accepts (accepting and silently ignoring them
// would be worse than just not offering them).
const SOUND_EFFECTS = {
  click: playUIClick,
  mob_hit: playMobHit,
  mob_death: playMobDeath,
  player_hurt: playPlayerHurt,
  explosion: playExplosion,
  splash: playSplash,
  drip: playDrip,
};
const SOUND_NAMES = Object.keys(SOUND_EFFECTS);

export function register(dispatcher) {
  dispatcher.register(
    literal('particle')
      // This engine's particle effect is one generic colored burst (see
      // entities/particles.js's spawnBurst) — there's no registry of
      // named particle types (flame, smoke, heart, ...) the way vanilla
      // has, so /particle's "type" slot is genuinely a color rather than
      // a fake type name standing in for one.
      .describes('Spawns a particle burst')
      .then(
        argument('color', color()).then(
          argument('pos', blockPos())
            .executes((context, args) => runParticle(context, args.color, args.pos, 8, 2.5))
            .then(
              argument('count', integer({ min: 1, max: 500 })).executes((context, args) =>
                runParticle(context, args.color, args.pos, args.count, 2.5)
              ).then(
                argument('spread', float({ min: 0 })).then(
                  argument('speed', float({ min: 0 })).executes((context, args) =>
                    runParticle(context, args.color, args.pos, args.count, args.speed)
                  )
                )
              )
            )
        )
      )
  );

  dispatcher.register(
    literal('playsound')
      .describes('Plays a sound effect')
      .then(
        argument('sound', literalSet(SOUND_NAMES)).executes((context, args) => {
          SOUND_EFFECTS[args.sound]();
          context.success(`Played "${args.sound}".`);
          return { success: true };
        })
      )
  );

  dispatcher.register(
    literal('title')
      .describes('Shows a title on screen')
      .then(
        argument('title', string('quoted')).executes((context, args) => runTitle(context, args.title, null))
          .then(argument('subtitle', string('quoted')).executes((context, args) => runTitle(context, args.title, args.subtitle)))
      )
  );

  dispatcher.register(
    literal('actionbar')
      .describes('Shows text above the hotbar')
      .then(
        argument('text', string('greedy')).executes((context, args) => {
          requireTitleDisplay(context).showActionbar(args.text);
          context.success('Shown.');
          return { success: true };
        })
      )
  );

  dispatcher.register(
    literal('say')
      .describes('Broadcasts a message to chat')
      .then(
        argument('message', string('greedy')).executes((context, args) => {
          context.world.messageLog.push({
            source: 'player',
            category: 'player',
            style: 'normal',
            segments: `<${context.executor.name}> ${args.message}`,
          });
          return { success: true };
        })
      )
  );

  dispatcher.register(
    literal('me')
      .describes('Broadcasts an action to chat')
      .then(
        argument('action', string('greedy')).executes((context, args) => {
          context.world.messageLog.push({
            source: 'player',
            category: 'player',
            style: 'normal',
            segments: `* ${context.executor.name} ${args.action}`,
          });
          return { success: true };
        })
      )
  );
}

function requireTitleDisplay(context) {
  if (!context.world.titleDisplay) throw new CommandExecutionError('Title display is not available.');
  return context.world.titleDisplay;
}

function runParticle(context, hexColor, parsedPos, count, speed) {
  const pos = resolvePos(context, parsedPos, { floor: false });
  context.world.particles.spawnBurst(pos, Number.parseInt(hexColor.slice(1), 16), count, speed);
  context.success(`Spawned ${count} particle${count === 1 ? '' : 's'}.`);
  return { success: true };
}

function runTitle(context, title, subtitle) {
  requireTitleDisplay(context).showTitle(title, subtitle);
  context.success('Shown.');
  return { success: true };
}

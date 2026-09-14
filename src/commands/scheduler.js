// /schedule <delay> <command> — fires a command once after a real-time
// delay. `delay` is in ticks, same unit every other time argument uses
// (argumentTypes.js's duration()/timeValue(), 20 ticks/second) — update()
// is meant to be called once per frame from the same tick loop that
// already drives DayNightCycle.update() and every other per-frame timer,
// once the command system is wired into main.js; nothing here runs on
// its own clock.
const TICKS_PER_SECOND = 20;

export class Scheduler {
  constructor() {
    this.pending = []; // {remaining (seconds), command}
  }

  push(ticks, command) {
    this.pending.push({ remaining: ticks / TICKS_PER_SECOND, command });
  }

  /** `execute(command)` is the caller's own dispatcher.execute(command, rootContext) — this class only tracks timers, never touches the dispatcher directly. */
  update(dt, execute) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const entry = this.pending[i];
      entry.remaining -= dt;
      if (entry.remaining <= 0) {
        this.pending.splice(i, 1);
        execute(entry.command);
      }
    }
  }
}

// A small concurrency gate: at most `max` tasks run at once, the rest wait
// in arrival order. The media page's Sakuga rows go through one so that a
// fast scroll past twenty animators starts two lookups, not twenty (the
// Rust side rate-limits anyway; this keeps its queue short).

export interface TaskGate {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

export function createTaskGate(max: number): TaskGate {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active += 1;
          task().then(resolve, reject).finally(release);
        };
        if (active < max) start();
        else queue.push(start);
      });
    },
    get active() { return active; },
    get waiting() { return queue.length; },
  };
}

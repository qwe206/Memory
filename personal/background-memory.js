/** ST awaits its event listeners: never return the summary promise to its bus. */
export function createBackgroundMemoryQueue({ run, onError, schedule = callback => setTimeout(callback, 0) }) {
  let running = false, scheduled = false, pending = false;
  async function drain() {
    scheduled = false;
    if (running || !pending) return;
    pending = false; running = true;
    try { await run(); }
    catch (error) { onError(error); }
    finally {
      running = false;
      if (pending && !scheduled) { scheduled = true; schedule(drain); }
    }
  }
  return function enqueue() {
    pending = true;
    if (!running && !scheduled) { scheduled = true; schedule(drain); }
  };
}

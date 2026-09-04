/**
 * Monotonic time source for runtime scheduling.
 *
 * Values are elapsed milliseconds in an arbitrary epoch. Simulation rules must
 * use fixed ticks instead of reading this clock directly.
 */
export interface Clock {
  nowMilliseconds(): number;
}

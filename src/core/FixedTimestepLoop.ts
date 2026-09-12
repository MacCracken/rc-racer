/**
 * Fixed-timestep accumulator loop, decoupled from the render rate.
 *
 * The simulation always advances in `fixedDt` chunks so physics is
 * deterministic regardless of display refresh. `update() consumes real
 * elapsed time and returns the interpolation alpha the renderer uses to
 * blend the last two simulation states.
 */
import { MAX_FRAME_TIME, MAX_STEPS_PER_FRAME } from "./tuning.ts";

export class FixedTimestepLoop {
  private accumulator = 0;
  private stepsThisFrame = 0;

  constructor(
    private readonly fixedDt: number,
    private readonly step: (dt: number) => void,
  ) {}

  /**
   * Feed elapsed time (seconds) since the last update. Runs as many fixed
   * steps as the accumulated time permits and returns the leftover alpha.
   *
   * `deltaSeconds` is clamped so a single long frame (tab was backgrounded,
   * GC pause) cannot trigger a runaway cascade of simulation steps.
   */
  update(deltaSeconds: number): number {
    this.stepsThisFrame = 0;
    this.accumulator += Math.min(deltaSeconds, MAX_FRAME_TIME);

    while (
      this.accumulator >= this.fixedDt &&
      this.stepsThisFrame < MAX_STEPS_PER_FRAME
    ) {
      this.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      this.stepsThisFrame += 1;
    }

    // If we hit the cap, keep the remainder to avoid permanent time loss.
    // The next frame will consume it, preventing a permanent drift.
    if (this.stepsThisFrame >= MAX_STEPS_PER_FRAME) {
      // Keep the remainder so simulation time is not lost forever.
      // We still cap the maximum time we allow to accumulate.
      this.accumulator = Math.min(this.accumulator, MAX_FRAME_TIME);
    }

    return this.accumulator / this.fixedDt;
  }

  get stepCount(): number {
    return this.stepsThisFrame;
  }

  get totalAccumulator(): number {
    return this.accumulator;
  }
}

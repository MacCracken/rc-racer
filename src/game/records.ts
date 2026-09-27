/**
 * The Records screen: your best laps on every open track, and "Copy best" to
 * share one. Building the view is pure; copying is the one part that touches
 * the browser, and where the clipboard is blocked (some embeds, private
 * modes) it falls back to the older copy, then to showing the line so it can
 * be copied by hand.
 */
import type { Progression } from "./progression.ts";
import type { TrackDef } from "../track/Track.ts";
import { carById } from "./cars.ts";
import { conditionsOf, conditionTags } from "../track/conditions.ts";
import { outlineOf } from "../track/outline.ts";
import { formatLap } from "../race/RaceState.ts";
import { shareText, THUMB_H, THUMB_W, type RecordsView } from "../ui/ui.ts";

/** A lap's day, e.g. "26 Sep" (blank when an old save didn't record it). */
function dayOf(at: number): string {
  return at > 0
    ? new Date(at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : "";
}

export class Records {
  /** The track whose best lap was just copied (to say so)… */
  private copied: string | null = null;
  /** …or the line to copy by hand, where the clipboard wouldn't take it. */
  private byHand: string | null = null;

  /** Opening the screen afresh forgets the last copy. */
  reset(): void {
    this.copied = null;
    this.byHand = null;
  }

  /** Every open track's board, fastest first, ready to show. */
  view(prog: Progression, ladder: readonly TrackDef[]): RecordsView {
    return {
      tracks: ladder
        .filter((_, i) => prog.isTrackUnlocked(i))
        .map((t) => ({
          id: t.id,
          name: t.name,
          tags: conditionTags(conditionsOf(t)),
          outline: outlineOf(t, THUMB_W, THUMB_H),
          laps: prog.recordsFor(t.id).map((r) => ({
            time: formatLap(r.ms),
            car: carById(r.car)?.name ?? "—",
            date: dayOf(r.at),
          })),
        })),
      copied: this.byHand === null ? this.copied : null,
      byHand:
        this.byHand === null || this.copied === null
          ? null
          : { id: this.copied, text: this.byHand },
    };
  }

  /**
   * "Copy best": a line to share `trackId`'s best lap — the time, the car,
   * and where to play when the game is on the web — onto the clipboard. Once
   * it has gone (or has to be copied by hand), and only if the screen is
   * still up (`isOpen`), the screen is redrawn (`reshow`) to say so.
   */
  share(
    prog: Progression,
    ladder: readonly TrackDef[],
    trackId: string,
    isOpen: () => boolean,
    reshow: () => void,
  ): void {
    const def = ladder.find((t) => t.id === trackId);
    const best = prog.recordsFor(trackId)[0];
    if (def === undefined || best === undefined) return;
    const url =
      typeof location !== "undefined" ? location.href.split("#")[0] : undefined;
    const text = shareText(
      def.name,
      formatLap(best.ms),
      carById(best.car)?.name ?? "",
      url,
    );
    const shown = (copied: boolean): void => {
      if (!isOpen()) return;
      this.copied = trackId;
      this.byHand = copied ? null : text;
      reshow();
    };
    const clip =
      typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (clip?.writeText === undefined) shown(copyWithSelection(text));
    else
      clip.writeText(text).then(
        () => shown(true),
        () => shown(copyWithSelection(text)),
      );
  }
}

/**
 * The older way to copy text, for where the async clipboard is blocked:
 * select it in an off-screen textarea and copy. False if that's blocked too.
 */
function copyWithSelection(text: string): boolean {
  if (typeof document === "undefined" || document.body === null) return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

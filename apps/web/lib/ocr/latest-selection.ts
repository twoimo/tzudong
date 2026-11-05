export type LatestSelectionLease = Readonly<{
  generation: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
  complete: () => boolean;
}>;

export type LatestSelection = Readonly<{
  begin: () => LatestSelectionLease;
  isCurrent: (generation: number) => boolean;
  invalidate: () => void;
}>;

/** Keeps one abortable file preparation current across replace, clear, close and unmount. */
export function createLatestSelection(): LatestSelection {
  let generation = 0;
  let controller: AbortController | null = null;

  const invalidate = () => {
    generation += 1;
    controller?.abort();
    controller = null;
  };

  return {
    begin: () => {
      invalidate();
      const candidate = generation;
      const candidateController = new AbortController();
      controller = candidateController;
      const isCurrent = () => candidate === generation && !candidateController.signal.aborted;
      return {
        generation: candidate,
        signal: candidateController.signal,
        isCurrent,
        complete: () => {
          if (!isCurrent()) return false;
          if (controller === candidateController) controller = null;
          return true;
        },
      };
    },
    isCurrent: (candidate) => candidate === generation,
    invalidate,
  };
}

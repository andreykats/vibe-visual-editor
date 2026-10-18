import type { Candidate, RankedCandidate, SourceLoc } from '@vibe-visual-editor/protocol';

/**
 * Ranks literals by how close they are to the element showing the text: a
 * direct child of that element's creation site first (0), then anything in
 * the same module (1), then anywhere else (2).
 */
export function rankByOwner(candidates: Candidate[], { elementLoc }: { elementLoc?: SourceLoc }): RankedCandidate[] {
  return candidates.map((candidate): RankedCandidate => {
    let rank = 2;
    if (elementLoc && candidate.file === elementLoc.file) {
      rank = candidate.owner === elementLoc.start ? 0 : 1;
    }
    return { candidate, rank };
  });
}

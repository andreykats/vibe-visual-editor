import type { Candidate, SourceLoc, Span } from './types';

/** Minimal ESTree node shape; adapters receive the parser's full AST. */
export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface AdapterContext {
  /** Absolute module path (no query). */
  id: string;
  code: string;
  /** Dev server root. */
  root: string;
  program: AstNode;
}

/**
 * The framework-specific facts about one module. Generic literal indexing is
 * done by the plugin core; the adapter only says which expressions create
 * elements and how literals relate to them.
 */
export interface AdapterAnalysis {
  /** Expressions that evaluate to a newly created element; each is tagged with its location. */
  creationSites: Span[];
  /** Literals inside these spans are not rendered text (tag names, attribute values) and are not indexed. */
  excluded: Span[];
  /** Literal start offset -> start offset of the creation site that takes it as a direct child. */
  owners: Map<number, number>;
}

export interface RankedCandidate {
  candidate: Candidate;
  /** Lower is better. Candidates sharing the best rank are equally likely. */
  rank: number;
}

export interface SourceAdapter {
  name: string;
  /** Cheap check: should this module be analyzed by this adapter? */
  include(id: string, code: string): boolean;
  analyze(ctx: AdapterContext): AdapterAnalysis;
  /** Rank literals whose value equals a rendered text node's data. */
  rank(candidates: Candidate[], ctx: { elementLoc?: SourceLoc }): RankedCandidate[];
}

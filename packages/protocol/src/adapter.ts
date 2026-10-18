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
/** The attribute that carries a creation site into the DOM: `token:start:end:line:column`. */
export const LOC_ATTRIBUTE = 'data-vve-loc';

/**
 * An expression that creates an element. By default the plugin wraps it as
 * `__le(expr, loc)`, which records the DOM element it returns. Set
 * `attributeAt` when the expression doesn't return the DOM element (JSX
 * returns a React element): the plugin then inserts a `data-vve-loc`
 * attribute at that offset, which the element carries into the DOM.
 */
export interface CreationSite extends Span {
  attributeAt?: number;
}

export interface AdapterAnalysis {
  /** Expressions that create an element; each is tagged with its location. */
  creationSites: CreationSite[];
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

# Writing a source adapter

An adapter teaches the Vite plugin how one rendering style creates elements. The plugin core already does the generic work:

- parsing with `oxc-parser`
- indexing every string literal and substitution-free template literal, with exact UTF-16 offsets, raw text, cooked value and line/column
- skipping literals that are syntax rather than values: import sources, object keys, TS literal types, directives, `require()` arguments, and tagged templates
- counting how many places read a `const` literal, including across imports
- wrapping creation sites with `__le(expr, loc)` and producing source maps
- serving `/__vibe-visual-editor/resolve`

The adapter supplies only facts that depend on the framework. The interface lives in `packages/protocol/src/adapter.ts`:

```ts
interface SourceAdapter {
  name: string;
  include(id: string, code: string): boolean;
  analyze(ctx: { id; code; root; program }): {
    creationSites: Span[];         // expressions that evaluate to a new element
    excluded: Span[];              // literals inside these aren't rendered text
    owners: Map<number, number>;   // literal start -> creation-site start that has it as a direct child
  };
  rank(candidates: Candidate[], ctx: { elementLoc?: SourceLoc }): RankedCandidate[];
}
```

## The `h()` adapter (reference)

The reference implementation is `packages/vite-plugin/src/adapters/h.ts`. It works as follows:

- **`include`** accepts `.ts`/`.js` files outside `node_modules`.
- **`analyze`** finds imports of the factory from the configured module, both named (aliases included) and namespace (`dom.h`). Every call to the factory is a creation site. The first argument (the tag) is excluded, and so is the second when it's an object literal (the attributes). String-literal children are owned by their call.
- **`rank`** orders candidates: first a literal owned by the element's own call (rank 0), then any literal in the element's module (rank 1), then any literal elsewhere (rank 2). If several candidates share the best rank, the user picks one.

## Sketch: a JSX adapter

A JSX adapter needs no changes to the shared code:

- **`include`**: `.tsx` / `.jsx`.
- **`creationSites`**: each `JSXElement` span. Wrapping `<div>…</div>` as `__le(<div>…</div>, loc)` works for intrinsic elements that render to DOM. For components, tag the host element inside them instead, or skip them.
- **Literals**: the core indexes `Literal` and `TemplateLiteral` nodes. JSX text (`<h2>Videos</h2>`) is a `JSXText` node, so a JSX adapter needs core support for an extra literal kind, with its own escaping rules (`{`, `}`, `<`, `>`, and how whitespace is trimmed). The protocol's `Quote` type and `escapeLiteral` are the places to extend.
- **`excluded`**: attribute values (`className="x"`), unless they're rendered as children.
- **`owners`**: JSX text and `{"literal"}` children map to the start of their enclosing element.

## Testing an adapter

Add cases to `packages/vite-plugin/test/indexer.test.ts` that build a `SourceIndex` with your adapter and assert on `analyzeDetached` and `resolve`. Also add a fixture app under `fixtures/`, and extend `packages/vite-plugin/test/plugin.test.ts` to check that the transform output still runs and has source maps.

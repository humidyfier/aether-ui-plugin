# Aether UI — Plugin Architecture & Invariant Specification

## Core System Architecture
1. **Local-First State Engine:** Local SQLite ledger for briefs, UX directions, UI concepts, and version checkpoints (`FR-01` through `FR-08`, `FR-18`)[cite: 3, 4].
2. **Shadow Worktree Sandbox:** Isolated Vite/React development server running in `.aether/sandbox/`. Host files are never mutated directly until user approval (`FR-16`, `FR-19`)[cite: 4, 6].
3. **Dual-Anchor Identity:** Dev-time Babel/SWC injected `data-aether-uid` + Structural AST Fingerprints. Duplicates are quarantined as ambiguous.
4. **Tiered Edit Transactions (`EditTx`):** Strict state contract enforcing candidate validation, TypeScript checks, and layout probes before committing changes.
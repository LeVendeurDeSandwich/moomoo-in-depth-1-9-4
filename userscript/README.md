# Userscripts

Two tools live here:

| File | Purpose | Status |
|---|---|---|
| [`moomoo-readable.user.js`](moomoo-readable.user.js) | Downloads a **readable copy** of the client: un-minified, main functions renamed, `// RENDER GRID:`-style landmarks. Nothing is decoded. | written for build 1.9.4 |
| [`moomoo-deobfuscator.user.js`](moomoo-deobfuscator.user.js) | Bundle deobfuscator, documented in the second half of this page. | not re-checked against build 1.9.4 |

## Readable bundle

`moomoo-readable.user.js` (annotator 3.1) works on the AST (Babel), not on text:

1. **Un-minify**: `a, b, c;` sequences, `x && f()` and `c ? a : b` statements, `!0`, `void 0`, `var` lists become ordinary statements. This step was checked to be behaviour-preserving on the 1.9.4 bundle.
2. **Rename**, scope-aware: `renderGameObjects`, `updatePlayers`, `updateHealth`, `gatherAnimation`, `isOnScreen`, `maxScreenWidth`, `maxScreenHeight`, `screenWidth`, `screenHeight`, parameter names and a few locals. A name is only changed where it really is the same variable.
3. **Comment**: `// UPDATE DIRECTION:`, `// MOVE CAMERA:`, `// RENDER GRID:`, `// RENDER MINIMAP:` and the other landmarks used by the [rendering docs](../rendering/README.md).

The file it downloads starts with a report: what was applied and what was not found. After a game
update, the "not found" list tells you which landmark moved.

Options (top of the script): `baseMods = false` leaves the code's behaviour untouched (no `window.*`
hooks); the default `true` also exposes `window.fps`, `window.delta`, `window.cameraX` and similar.

The part of the bundle that holds the encrypted strings (the connection / integrity layer) is only
re-formatted and labelled `PROTOCOL LAYER`. It is not decoded.

---

# MooMoo Bundle Deobfuscator — Installation & Usage

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser (Chrome/Firefox/Edge).
2. Open Tampermonkey Dashboard → **+ Create a new script**.
3. Paste the contents of `moomoo-deobfuscator.user.js` and save (`Ctrl+S`).
4. Alternatively: click the Tampermonkey icon → **Create new script** → paste → save.

## Usage

1. Navigate to `https://moomoo.io/` (or sandbox).
2. Wait for the page to fully load (the game lobby should be visible).
3. A panel titled **🔍 MooMoo Deobfuscator** will appear in the top-right corner.
4. Click **▶ Run Deobfuscation**.
5. The panel shows live progress. When complete, a download is triggered automatically:
   `index-XXXXXXXX.deobf.js`

## What It Does (Pipeline)

| Step | Action |
|------|--------|
| 1 | Finds the bundle URL from `<script src>` / `<link rel=modulepreload>` |
| 2 | Fetches the bundle text via GM_xmlhttpRequest |
| 3 | Parses it with **Acorn** (no execution) |
| 4 | Locates the three decoder groups (aa/\_e, ra/se, la/Le) in the AST |
| 5 | Extracts the array fn + decoder fn + rotation IIFE for each group |
| 6 | Validates extracted code (AST parse + forbidden-global check) |
| 7 | Executes each group in a **tightly scoped Function() sandbox** |
| 8 | Collects all static `_e(n, "key")` / `se(n, "key")` / `Le(n, "key")` call sites from the AST |
| 9 | Resolves each call via the sandboxed decoder |
| 10 | Replaces call-sites with `JSON.stringify(resolvedValue)` literals |
| 11 | AST-validates the substituted code; rolls back on failure |
| 12 | Beautifies with js-beautify (formatting only) |
| 13 | AST-validates the beautified code |
| 14 | Prepends a metadata header with resolution statistics |
| 15 | Triggers browser download of `*.deobf.js` |

## Expected Log Output (Success)

```
━━ MooMoo Deobfuscator v1.0.0 ━━
► Step 1: Locating bundle URL…
✓ Bundle URL: index-45e2f6ff.js
► Step 2: Fetching bundle…
✓ Bundle fetched: 892.4 KB
► Step 3: Parsing AST (Acorn)…
✓ AST parsed (487 top-level nodes)
► Step 4: Locating decoder groups (aa/_e, ra/se, la/Le)…
✓ Found 3 decoder group(s): _e/aa, se/ra, Le/la
► Step 5: Sandboxing decoders…
  Sandboxing _e/aa…
  ✓ _e ready
  Sandboxing se/ra…
  ✓ se ready
  Sandboxing Le/la…
  ✓ Le ready
► Step 6: Collecting static call sites…
✓ 2840 static call sites detected
    _e: 1890 call(s)
    se: 620 call(s)
    Le: 330 call(s)
► Step 7: Resolving call sites…
✓ Resolved: 2840 / 2840
► Step 8: Applying literal replacements…
✓ 2840 replacements applied, 0 skipped
► Step 9: Artifact stripping (conservative)…
  Artifacts preserved (source positions invalidated post-substitution). See log for details.
► Step 10: Beautifying output…
✓ Beautify pass complete
► Step 11: Final AST validation…
✓ Final AST validation passed
► Downloading index-45e2f6ff.deobf.js…
✓ Download triggered: index-45e2f6ff.deobf.js
━━ Complete ━━
Groups: 3 found / 3 executed
Calls: 2840 detected / 2840 resolved / 0 unresolved
```

*Actual call site counts will vary depending on the live bundle version.*

## Dependencies (loaded via @require)

| Library | Version | Purpose |
|---------|---------|---------|
| [Acorn](https://github.com/acornjs/acorn) | 8.11.3 | AST parsing |
| [js-beautify](https://github.com/beautifier/js-beautify) | 1.15.1 | Code formatting only |

Both are loaded from jsDelivr CDN. They do not require installation.

## Known Limitations

### Artifact stripping is disabled
After literal substitution, the original AST positions are invalidated (source offsets shift). The decoder arrays, decoder functions, and rotation IIFEs are therefore **preserved** in the output. They are harmless to read, and removing them manually is straightforward (search for `function aa()`, `function _e(`, `function se(`, `function Le(`, and their rotation IIFEs).

### moomoo-protocol imports stay unresolved
`BUILD_ID`, `mixKey`, `BUILD_SALT` from `"moomoo-protocol"` are bare module imports not present in the fetched bundle. They are preserved verbatim. Replacing them would require the protocol module, which is not in scope.

### Non-static call sites
Some decoders are called with computed indices (e.g., `_e(x + 1, key)`) — these are not collected by the static analysis pass. They remain unchanged with a note in the unresolved log.

### Bundle version changes
If moomoo.io deploys a new bundle with different function names or obfuscation patterns, Step 4 will report "No decoder groups found". The output will still be a beautified version of the bundle, which is useful as a starting point.

## Security Notes

- The sandbox **refuses to execute** any extracted code that references `document`, `window`, `fetch`, `XMLHttp`, `setInterval`, `setTimeout`, `eval`, `Image`, `WebSocket`, `navigator`, or `location`.
- The full bundle is **never executed**. Only the three self-contained decoder groups run in the sandbox.
- The anti-tamper functions (`uh`, `mh`, `gh`, `xh`, `pd`, `fh`, `yd`) are never called.

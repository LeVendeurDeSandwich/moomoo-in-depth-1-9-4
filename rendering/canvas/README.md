# Canvas and viewport

Checked against **build 1.9.4 (`index-6642cae8.js`, API 1.31)**. See also the
[rendering overview](../).

## Two canvases, both WebGL

The page has two canvases, `#gameCanvas` and `#textCanvas`. **Neither one uses a 2D context**: a
helper creates a WebGL context on each of them and exposes a Canvas2D-like drawing API on top
(`fillRect`, `fillRoundRect`, `line`, `drawImage`, `save` / `restore`, `translate`, `rotate`,
`setTransform`, `clear`, and text methods such as `label`, `text`, `measureText`).

```js
const gameCtx = createGl2dContext(gameCanvas, null);               // atlas page size / count can be overridden
const textCtx = createGl2dContext(textCanvas, { overlay: true });  // transparent canvas on top
```

Settings of the WebGL context: `alpha` only for the overlay, `antialias: false`,
`premultipliedAlpha: true`, `powerPreference: "high-performance"`. Images are packed into texture
atlas pages (2048 px by default, limited by `MAX_TEXTURE_SIZE`). If WebGL is unavailable the loading
text becomes *"MooMoo needs WebGL, which this browser has turned off."* and the script stops.

What this means in practice:

- A hook on `CanvasRenderingContext2D.prototype` **does not see the game's drawing**: the game
  canvases are not 2D contexts.
- Only the minimap (`#mapDisplay`) is a real 2D canvas (`getContext("2d")`).
- The text canvas is only used when text should be sharper than the game canvas (see
  [resolution](#resolution)). Otherwise text is drawn on the game canvas.

## Viewport scaling

The design size is `maxScreenWidth × maxScreenHeight = 1920 × 1080`. On every `resize`:

```js
const scale = Math.max(
    innerWidth  / maxScreenWidth,
    innerHeight / (maxScreenHeight * 1.15),
    Math.sqrt(innerWidth * innerHeight / (maxScreenWidth * maxScreenHeight))
);
screenWidth  = innerWidth  / scale;   // size of the visible world, in world pixels
screenHeight = innerHeight / scale;
```

`screenWidth` / `screenHeight` therefore **change with the window**; only `maxScreenWidth` and
`maxScreenHeight` are constants. The drawing code uses the dynamic pair for the background, grid,
culling and boundaries. (In the minified bundle the dynamic pair is a plain `let` initialised from
the constants; the readable copy names them `screenWidth` / `screenHeight`.)

The canvas CSS size is the window size, and the transform is
`setTransform(scale · resolution, 0, 0, scale · resolution, 0, 0)`, so game code draws in world
pixels.

## Resolution

`resolution` is the canvas pixel ratio:

- `1` by default;
- `min(2, devicePixelRatio)` when the *native resolution* setting (`native_resolution`) is on.

Text can be rendered at a higher ratio, `min(4, devicePixelRatio)`. When that is larger than the
game canvas ratio, the text canvas is shown, resized to `innerWidth · textRatio`, and all text goes
there; otherwise it is hidden.

## Constants

From the shared config object (the same values the server uses).

| Name | Value | Used for |
|---|---|---|
| `maxScreenWidth` / `maxScreenHeight` | 1920 / 1080 | design size, grid spacing |
| `serverUpdateRate` | 9 / s | interpolation window |
| `clientSendRate` | 5 / s | how often the aim direction can be sent |
| `mapScale` | 14400 | world size (square) |
| `snowBiomeTop` | 2400 | height of the snow biome |
| `riverWidth` / `riverPadding` | 724 / 114 | river band |
| `waveSpeed` / `waveMax` | 0.0001 / 1.3 | river edge animation |
| `nameY` | 34 | distance of the name above the player |
| `healthBarWidth` / `healthBarPad` | 50 / 4.5 | health bar |
| `crownIconScale` / `crownPad` | 60 / 35 | leader crown and rank icons |
| `chatCountdown` | 3000 ms | chat bubble lifetime |
| `deathFadeout` | 3000 ms | death screen fade |
| `minimapRate` | 3000 ms | minimap ping refresh |

## Biomes

The map is split in three horizontal bands:

| Band | World `y` | Colour |
|---|---|---|
| Snow | `0 … snowBiomeTop` (2400) | `#fff` |
| Grass | `snowBiomeTop … mapScale - snowBiomeTop` | `#b6db66` |
| Desert | `mapScale - snowBiomeTop … mapScale` (12000 …14400) | `#dbc666` |

The background is a full-screen fill when the viewport is inside one band, and two fills when it
straddles a border (the border position on screen is `border - offsetY`). Objects use the same
rule to get their *biome id* (`2` desert, `1` snow, `0` grass).

## River

The river is a horizontal band centred on `mapScale / 2` (7200). Two rectangles are drawn per frame:

| Pass | Height | Colour |
|---|---|---|
| sand edge | `riverWidth + riverPadding` = 838 | `#dbc666` |
| water | `riverWidth + (wave - 1) · 250` | `#91b2db` |

`wave` goes back and forth between `1` and `waveMax` (1.3) at `waveSpeed · delta` per frame, so the
water edge breathes by up to 75 px.

## Grid

When the `show_grid` setting is on: line width 4, `#000` at 6 % opacity, one line every
`maxScreenHeight / 18` = 60 px, in both directions. The first line is offset by
`(-camera % spacing + spacing) % spacing`, which is what makes the grid scroll with the camera.

## Names, health bars, icons

For each visible entity (`RENDER PLAYER AND AI UI`):

- the name is drawn at `y - offsetY - scale - nameY`, in white, size 30 (or the entity's
  `nameScale`), with a dark outline of width 8 (11 for a custom `nameScale`);
- the tribe tag goes before the name; a clan member that is not on your team is tinted;
- the leader crown and the rank icon (skull / crowns) sit on each side of the name, 60 px wide;
- the health bar is a dark rounded rectangle of width `2 · healthBarWidth` (+ padding) under the
  player, with a fill that is green for you and your team and red for others.

Players with `skinIndex == 10`, and animals that are diving, are not given a name.

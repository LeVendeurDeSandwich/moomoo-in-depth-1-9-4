# Rendering

How MooMoo.io draws a frame. Checked against **build 1.9.4 (`index-6642cae8.js`, API 1.31)**.

Identifiers in the minified bundle change with every release, so this page names functions by what
they *do*. If you want to find them in the code, generate the readable copy with the
[annotator](../userscript/README.md#readable-bundle): its `// RENDER GRID:`-style landmarks are the
labels used below.

- [Canvas and viewport](canvas/): WebGL-backed canvases, scaling, camera offset, constants.
- This page: the frame loop, update order and draw order.

## The frame loop

```js
function frame() {
    now   = Date.now();
    delta = now - lastFrame;      // milliseconds, variable: nothing runs on a fixed timestep
    lastFrame = now;
    render();                     // the main render function (below)
    updateFpsCounter();           // counts frames, refreshes the FPS display about every 500 ms
    requestAnimFrame(frame);
}
```

Everything that moves is driven by `delta`, so animation speed does not depend on the frame rate.

## The main render function, in order

One call per frame. Each row is one landmark of the readable copy.

| # | Landmark | What happens |
|---|---|---|
| 0 | *(start)* | If the second (text) canvas is active, it is cleared. |
| 1 | `UPDATE DIRECTION` | At most every `1000 / clientSendRate` ms (200 ms), the aim direction is computed and **sent only if it changed**. |
| 2 | `DEATH TEXT` | While the death-screen text size is under 120 it grows by `0.1 · delta`, capped at `min(120, 17 % of window width, 30 % of window height)` px. |
| 3 | `MOVE CAMERA` | The camera eases toward the local player: `step = min(distance · 0.01 · delta, distance)`; under 0.05 px it snaps. With no player it sits at the map centre (`mapScale / 2`). |
| 4 | `INTERPOLATE PLAYERS AND AI` | Every visible player and animal is placed between its previous and latest server position (see below). A camera-lock flag, when set, snaps the camera to the player afterwards. |
| 5 | `RENDER CORDS` | `offsetX = cameraX - screenWidth / 2`, `offsetY = cameraY - screenHeight / 2`. Everything is drawn at `(x - offsetX, y - offsetY)`. |
| 6 | `RENDER BACKGROUND` | Biome fill, see [canvas](canvas/#biomes). |
| 7 | `RENDER WATER AREAS` | The river band and its animated edge, then the waterfall / gorge decoration of the secret area (skipped when off screen). |
| 8 | `RENDER GRID` | Optional grid (setting `show_grid`). |
| 9 | `RENDER BOTTOM LAYER` | Visible objects are bucketed by their `layer`; bucket `-1` is drawn first, then the boss attack telegraphs. |
| 10 | `RENDER PROJECTILES`, `RENDER PLAYERS`, `RENDER AI` | Projectiles of layer 0, players with `zIndex` 0, then animals. |
| 11 | `RENDER GAME OBJECTS (LAYERED)` | Object bucket 0, projectiles of layer 1, object bucket 1, players with `zIndex` 1, object buckets 2 and 3. |
| 12 | `MAP BOUNDARIES` | Black at 9 % opacity over everything outside `[0, mapScale]`. |
| 13 | `RENDER DAY/NIGHT TIME` | A full-screen `rgba(0, 0, 70, 0.35)` fill, every frame. In this build it is a constant tint: nothing animates it. |
| 14 | `RENDER PLAYER AND AI UI` | Name, tribe tag, crown / skull icons and health bar of each visible entity; the boss bar. |
| 15 | `RENDER ANIM TEXTS` | Floating texts (damage numbers…), advanced by `delta`. |
| 16 | `RENDER CHAT MESSAGES` | Chat bubbles, see below. |

The minimap is drawn by a **separate function** that the render function calls last, throttled to
once every 80 ms of accumulated delta. Its landmarks are `RENDER MINIMAP`, `RENDER PINGS`,
`RENDER PLAYERS`, `DEATH LOCATION` and `MAP MARKER`.

## Interpolation

The server sends positions `serverUpdateRate` = 9 times a second (about 111 ms apart; the [reference server](../protocol/current/README.md#what-the-server-sends-and-when) ticks at exactly that interval). Each entity
keeps its previous (`x1, y1, d1`) and latest (`x2, y2, d2`) state and a timer `dt`:

```js
dt += delta;
t   = Math.min(settle ? 1 : 1.7, dt / 170);          // position
x   = x1 + (x2 - x1) * t;
y   = y1 + (y2 - y1) * t;
dir = lerpAngle(d2, d1, Math.min(1, dt / (1000 / serverUpdateRate)));
```

`t` may go up to 1.7: an entity is allowed to **extrapolate** past the last known position for a
moment. An entity flagged `forcePos` skips all of this and jumps straight to `x2, y2, d2`.

## Culling

Objects, projectiles and animals are only drawn when their circle touches the viewport:

```js
function isOnScreen(x, y, s) {
    return x + s >= 0 && x - s <= screenWidth && y + s >= 0 && y - s <= screenHeight;
}
```

`x, y` are already offset by the camera, and `s` is the object's `scale` (plus its `blocker`
radius for objects that have one). Objects also add their wiggle (`xWiggle`, `yWiggle`) to the
position before the test.

## Players

Players are drawn in the `RENDER PLAYERS` passes, once per `zIndex`. For each visible player:

- opacity is `0.5` for an `invisible` player, `1` otherwise;
- the body rotation is `direction + dirPlus` (for the local player the direction is the one just
  computed from the mouse, not the interpolated one);
- the skin rotation advances by `0.002 · delta` per frame;

Animals are drawn after players, rotated by `dir + dirPlus - π/2`.

## Chat bubbles

A message is shown while `chatCountdown > 0`; the countdown starts at 3000 ms and is decreased by
`delta`. The bubble is placed at `(x - offsetX, y - scale - offsetY - 90)`; it is a 47 px high
rounded rectangle (`rgba(0, 0, 0, 0.2)`, radius 6) as wide as the text plus 17 px, with the text at
size 32 in white.

## Not covered yet

- Per-weapon and per-hat drawing, player animations (gather / hit swing).
- How each object type is drawn.

These live in the drawing helpers called from the passes above.

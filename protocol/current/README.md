# Gameplay packets, build 1.9.4 (API 1.31)

Packet ids were **reassigned** in API 1.31: the old numeric ids (`33`, `c`, `ch`, …) are gone. This
page lists the ids of the gameplay packets for **build 1.9.4 (`index-6642cae8.js`)**. The id sets
were checked against the bundle: the client sends 21 distinct ids with its connection object's
`send`, and the incoming handler table has 42 entries.

> **Ids change between builds.** Treat the ids below as belonging to this build only. The
> [legacy pages](../client/README.md) keep the old names and explanations; the
> [mapping table](#old-name--current-id) at the bottom links the two.

## What this page does not cover

The connection to the official servers is authenticated: frames are wrapped in a sealed, masked
format and the client answers integrity requests. **That layer is deliberately not documented
here.** This page describes what the packets *mean*, not how to get a connection accepted by the
official servers. (If you run your own server, the format of your own handshake is up to you.)

For that reason these ids are left out: the handshake (`io-init`), the telemetry / integrity
exchange, and the staff / admin commands.

## Packet structure

Unchanged in spirit: a packet is `[id, args]`, and arrays of repeated records are *chunked*
(flattened) as described in the [protocol overview](../README.md#chunk-arrays).

## Source of the details below

The field layouts come from a **reference server** (the `moomoo-clone` private server). Its packet
handlers were written against what the official client sends and parses, and it keeps the client's
own field order in comments (for example *"client setData reads [id, sid, name, …]"*). Treat the
layouts as what the official client expects. How the *official* server behaves (cooldowns, limits)
may differ; where a number below is a reference-server value it is marked as such.

Lists marked *flat* are chunked: records of a fixed size are concatenated into one array (see the
[protocol overview](../README.md#chunk-arrays)).

## What the server sends, and when

The reference server runs one tick every `1000 / serverUpdateRate` ms (9 per second, about 111 ms),
the same interval the [renderer interpolates over](../../rendering/README.md#interpolation). Each
tick it builds, **per viewer**, only what that viewer needs:

- `D`, `H` are sent **once** per viewer for each player / object that comes into view (the server
  remembers who already received it);
- `a` is sent every tick; the attribute part only contains players whose attributes **changed**
  since the last one sent to that viewer;
- `I` is sent when there are visible animals or animals that left view;
- `7` (tribe minimap) goes to players in a tribe;
- `G` (leaderboard) runs on its own timer.

## Client → server: arguments and rules

| Id | Arguments | Notes |
|---|---|---|
| `M` | `{name, moofoll, skin, anon}` | Ignored if you are already alive. Answered by `C` (your sid), then the usual `D` / `a`. `moofoll: true` starts with extra resources. |
| `D` | angle | Number. Only applied while alive. |
| `9` | angle or `null` | `null` = stop moving. |
| `e` | – | Resets movement (the client sends it when the window loses focus). |
| `F` | `[down, buildDir]` | `buildDir` (a number or `null`) also sets your aim. With an item selected, pressing places it **once**; with a weapon selected, `down` starts / stops attacking. |
| `z` | `[index, isWeapon]` | You must own it. Selecting the item you already hold deselects it. |
| `H` | `[index]` | Weapons come first, then items: `index >= weaponCount` means `items[index - weaponCount]`. Needs an upgrade point; the entry's `age` must equal your current upgrade age and its prerequisite must be owned. Answered by two `V` and one `U`. |
| `K` | `0` or `1` | `0` toggles lock rotation, `1` toggles auto-gather. |
| `c` | `[action, id, isAccessory]` | `1` buys (needs enough points, item must be for sale), `0` equips; equipping id `0` takes the piece off. Answered by `5`. |
| `6` | text | Filtered. Reference-server cooldown: 500 ms. The client limits input to 30 characters. |
| `S` | – | Reference-server cooldown: 2200 ms. Everyone in your tribe (and you) receives `9`. |
| `0` | – | Answered by `0`. |
| `L` | tribe name | 1 to 7 printable ASCII characters, not `solo`, only while you have no tribe. Reference-server cooldown on tribe actions: 200 ms. |
| `N` | – | Leave your tribe. When the owner leaves, the tribe is disbanded. |
| `b` | tribe name | Ask to join. The owner receives `2`. |
| `P` | `[sid, accept]` | The owner answers a request. |
| `Q` | sid | The owner kicks a member. |
| `I` | `0` or `1` | Anonymous mode, signed-in players only, rate limited. |
| `R` | `[sid]`, then `[sid, 0, reason]` | Report a player; reasons are `1` Bot, `2` Hack, `3` Autoheal, `4` Abuse. |
| `V` | `[sid]` | Asks for a player's profile; answered by `p` and `F`. |

Invalid arguments are rejected by the reference server (and counted by its checks), so send exactly
what the table says.

## Server → client: packet reference

### Connection and player

| Id | Arguments | Notes |
|---|---|---|
| `C` | `sid` | Your player sid, right after an accepted spawn. |
| `A` | `{teams, animals}` | `teams` is a list of `{sid, owner[, clan: true]}`; `animals` is the animal table. |
| `D` | `[data, isMe]` | `data` has 17 fields, in this order: `id, sid, name, x, y, dir, health, maxHealth, scale, skinColor, aura, bossMode, clan, morph, dive, invisible, disguised`. Sent once per viewer for each player in view. `isMe` is true for your own player. |
| `E` | `id` | A player left. Note: the **id**, not the sid. |
| `a` | `[positions, attributes, hidden]` | `positions` is flat, 4 values per player: `sid, x, y, dir·100`. `attributes` is flat, 10 values per player: `sid, buildIndex, weaponIndex, variant, team, isLeader, skin, tail, icon, zIndex` (`icon` 1 skull, 2 to 4 crowns, 5 to 7 crowns with skull). `hidden` lists the sids that left view. |
| `O` | `[sid, health]` | Health of a player. |
| `P` | – | You died. |
| `B` | reason | Disconnect reason (`kicked`, `server is full`, …). |

### Stats and inventory

| Id | Arguments | Notes |
|---|---|---|
| `N` | `[name, value, updateView]` | `name` is `wood`, `food`, `stone`, `points` or `kills`. |
| `T` | `[xp, maxXP, age]` or `[xp]` | The short form is sent when only XP changed. |
| `U` | `[points, age]` | Upgrade points left and the current upgrade age. |
| `V` | `[list, isWeapons]` | Your items (`0`) or weapons (`1`). |
| `S` | `[index, count]` | Placed-item count for an item. |
| `5` | `[state, id, isAccessory]` | Store update: `0` bought, `1` equipped. |

### World

| Id | Arguments | Notes |
|---|---|---|
| `H` | `[objects]` | Flat, 8 values per object: `sid, x, y, dir, scale, type, id, ownerSid` (`-1` when it has no owner). Sent once per viewer. |
| `Q` | `sid` | An object was removed. |
| `R` | `sid` | **Every object of the player with this sid** was removed (for example when they die). |
| `L` | `[dir, sid]` | An object wiggles (it was hit). |
| `M` | `[sid, dir]` | A turret shot. |
| `I` | `[animals, hidden]` | Flat, 8 values per animal: `sid, index, x, y, dir·100, health, nameIndex, state`; then the sids that left view. |
| `J` | `sid` | Animal attack animation. |
| `X` | `[x, y, dir, range, speed, index, layer, sid]` | A projectile appeared. |
| `Y` | `[sid, range]` | A projectile ended (the range it really flew). |
| `K` | `[sid, hit, weaponIndex, speed?]` | Swing animation. `hit` is `1` when the swing hit something; `speed` (`1 / attackSpeedMultiplier`) is only present when the attack speed is not 1. |
| `W` | `[kind, x, y, radius, ms, x2?, y2?]` | Boss attack telegraph, drawn by the [renderer](../../rendering/README.md) in `RENDER BOTTOM LAYER`. |
| `m` | `[sid, state, ms]` | Dive: `0` up, `1` diving, `2` under, `3` coming up. |
| `8` | `[x, y, value, type]` | Floating text. A **negative** `value` is damage you dealt. |

### Tribes, chat, map

| Id | Arguments | Notes |
|---|---|---|
| `g` | `{sid, owner[, clan: true]}` | A tribe was created. |
| `1` | `name` | A tribe was deleted. |
| `2` | `[playerSid, name]` | Sent to the owner: someone asks to join. |
| `3` | `[tribe, isOwner]` | Your tribe (`null` when you left or were kicked). |
| `4` | `[sid, name, sid, name, …]` | Flat list of your tribe's members. |
| `6` | `[sid, text]` | Chat. `sid` is `-1` for a server notice. |
| `7` | `[x, y, x, y, …]` | Flat positions of your tribe's members (the minimap). |
| `9` | `[x, y]` | A map ping. |
| `0` | – | Pong. |
| `G` | `[entries, roles, dead, crab, clans, tribes, crowns]` | Leaderboard (top 10). `entries` is flat `sid, name, points`; `roles` flat `sid, role`; `dead` a list of sids; `clans` flat `sid, tag`; `tribes` flat `sid, tribe`; `crowns` flat `sid, 1 to 3`. |
| `p` | `[sid, json]` | A player's profile card, as a JSON string. |
| `F` | `[sid, kills, wood, food, stone, gold, damage, animalDamage, healing, animals, bosses, …]` | Live stats of a player for the profile card. Staff get extra trailing fields. |
| `Z` | `seconds` | Restart countdown. Above 60 means minutes / hours, `-1` cancels. |
| `r` | `seconds` | "Game updated, reloading in…" (`0` = after this life). |

## Old name → current id

By meaning. The old explanations are in the [legacy client](../client/README.md) and
[legacy server](../server/README.md) pages.

| Old name (id then) | Current id | | Old name (id then) | Current id |
|---|---|---|---|---|
| Spawn Player (`sp`) | `M` | | setInitData (`id`) | `A` |
| set angle (`2`) | `D` | | disconnect (`d`) | `B` |
| send movement (`33`) | `9` | | setupGame (`1`) | `C` |
| Mouse / Space attack (`c`) | `F` | | addPlayer (`2`) | `D` |
| hold item (`5`) | `z` | | removePlayer (`4`) | `E` |
| select Upgrade (`6`) | `H` | | updatePlayers (`33`) | `a` |
| Auto Attack / Lock Dir (`7`) | `K` | | updateLeaderboard (`5`) | `G` |
| hat/acc buy / equip (`13c`) | `c` | | loadGameObject (`6`) | `H` |
| Send Chat (`ch`) | `6` | | loadAI (`a`) | `I` |
| pingMap (`14`) | `S` | | animateAI (`aa`) | `J` |
| ping (`pp`) | `0` | | gatherAnimation (`7`) | `K` |
| create clan (`8`) | `L` | | wiggleGameObject (`8`) | `L` |
| clan Leave (`9`) | `N` | | shootTurret (`sp`) | `M` |
| Clan send join Request (`10`) | `b` | | updatePlayerValue (`9`) | `N` |
| Clan Accept player (`11`) | `P` | | updateHealth (`h`) | `O` |
| Clan Kick player (`12`) | `Q` | | killPlayer (`11`) | `P` |
| | | | killObject / killObjects (`12` / `13`) | `Q` / `R` |
| | | | updateItemCounts (`14`) | `S` |
| | | | updateAge (`15`) | `T` |
| | | | updateUpgrades (`16`) | `U` |
| | | | updateItems (`17`) | `V` |
| | | | addProjectile / remProjectile (`18` / `19`) | `X` / `Y` |
| | | | serverShutdownNotice (`20`) | `Z` |
| | | | addAlliance (`ac`) | `g` |
| | | | deleteAlliance (`ad`) | `1` |
| | | | allianceNotification (`an`) | `2` |
| | | | setPlayerTeam (`st`) | `3` |
| | | | setAlliancePlayers (`sa`) | `4` |
| | | | updateStoreItems (`us`) | `5` |
| | | | receiveChat (`ch`) | `6` |
| | | | updateMinimap (`mm`) | `7` |
| | | | showText (`t`) | `8` |
| | | | pingMap (`p`) | `9` |
| | | | pingSocketResponse (`pp`) | `0` |

The old *window focus* packet (`rmd`) has no counterpart in this list.

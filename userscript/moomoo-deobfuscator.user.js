// ==UserScript==
// @name         MooMoo Bundle Deobfuscator
// @namespace    moomoo-deobf
// @version      1.0.0
// @description  Désobfuscateur de bundle JS : strip locals décodeur morts, résolution des appels decodeString, renamer AST scope-aware, inlining de helpers-objets, folding constant, diagnostics ESM.
// @license      MIT
// @match        *://moomoo.io/*
// @match        *://*.moomoo.io/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/js-beautify/1.14.7/beautify.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/acorn/8.11.3/acorn.min.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
'use strict';

// ══════════════════════════════════════════════════════════════
// SECTION 1 — CONSTANTS, CFG, PREFIX
// ══════════════════════════════════════════════════════════════

const PREFIX = '[MooDeobf v1]';
const log  = (...a) => console.log(PREFIX, ...a);
const warn = (...a) => console.warn(PREFIX, ...a);

/** Central configuration — all options in one place */
const CFG = {
  stripDeadCode:              true,
  applyRenames:               true,
  addSections:                true,
  addHeader:                  true,
  normalizeLiterals:          true,
  useAST:                     true,
  renameLocals:               true,
  localPrefix:                'tmp',
  paramStyle:                 'args',
  inferFromUsage:             true,
  foldStringConcats:          true,
  foldConstants:              true,
  bracketToDot:               true,
  renameImports:              true,
  verboseAcorn:               false,
  renameFreeIdentifiers:      true,
  verboseFamily:              false,
  stripOrphans:               true,
  stripOrphansMaxIter:        500,
  validateFinalSyntax:        true,
  reportUnresolvedDecoderCalls: true,
  simplifyHelpers:            true,
  removeUnusedSimpleConsts:   true,
  detectShadowResidues:       true,
  renames:                    null,
  paramRenames:               null,
};

// ══════════════════════════════════════════════════════════════
// SECTION 2 — JS RESERVED WORDS
// ══════════════════════════════════════════════════════════════

const JS_RESERVED = new Set([
  'break','case','catch','continue','debugger','default','delete','do','else',
  'finally','for','function','if','in','instanceof','new','return','switch',
  'this','throw','try','typeof','var','void','while','with','class','const',
  'enum','export','extends','import','super','implements','interface','let',
  'package','private','protected','public','static','yield','null','true',
  'false','undefined','NaN','Infinity','arguments','eval','constructor',
  'prototype','__proto__','of','from','async','await','get','set','target',
  'meta','as','abstract','boolean','byte','char','double','final','float',
  'goto','int','long','native','short','synchronized','throws','transient',
  'volatile',
]);


// ══════════════════════════════════════════════════════════════
// SECTION 3 — DEFAULT_RENAMES & PARAM_RENAMES
// ══════════════════════════════════════════════════════════════

const DEFAULT_RENAMES = {
  /* ─── Decoders ─── */
  '_e':  'decodeString',  'se':  'decodeStr2',    'Le':  'decodeStr3',
  'Se':  'decodeStr4',
  /* ─── String arrays ─── */
  'aa':  'stringArrayA',  'ra':  'stringArrayB',  'la':  'stringArrayC',
  /* ─── Anti-tamper ─── */
  'uh':  'initAntiTamper',   'hh':  'freezeSocketRef',
  'xh':  'hookKeyDown',      'mh':  'startDebuggerInterval',
  'gh':  'loadTrackingPixels','yh':  'injectAntiTamperElement',
  'pd':  'computeTamperFlags','fh':  'collectJSFingerprint',
  'yd':  'runFingerprint',   'ch':  'computeXorHash',
  'rh':  'buildFingerprintPart','gd': 'evalFingerprintEntry',
  'ah':  'setFingerprintSeed','Pu':  'onPingWithFingerprint',
  /* ─── Crypto / protocol ─── */
  'ac':  'sha256Block',      'Et':  'rotateRight',
  'Px':  'deriveKeys',       'Ax':  'computeHmac',
  'a0':  'xorMaskBuffer',    'Kc':  'readUint32LE',
  'Rx':  'extractMask',      'Ox':  'applyMaskXor',
  'Bx':  'computeChecksum',  'Dx':  'computeSeal',
  'Wx':  'CONST_WX',         'Qs':  'HMAC_SLICE_LEN',
  'oc':  'PROTOCOL_ENCRYPTED_MODE',
  'ic':  'CHARSET_C2S',      'sc':  'CHARSET_S2C',
  'gs':  'buildCharMap',     'i0':  'fillCharMap',
  's0':  'buildSessionTables','Ix':  'makeRng',
  'wd':  'hexStringToUint8', 'Sd':  'verifyBundleDigest',
  /* ─── Socket / connection ─── */
  'K':   'socketClient',     'Jr':  'WebSocketCtor',
  'e0':  'wsSend',           '_x':  'msgpackDecoder',
  'c0':  'msgpackEncoder',   'vd':  'fetchSelfDigest',
  /* ─── Config / constants ─── */
  'E':   'CONFIG',           'kh':  'MAX_SCREEN_WIDTH',
  'wh':  'MAX_SCREEN_HEIGHT','bh':  'SERVER_UPDATE_RATE',
  'kd':  'MAX_PLAYERS',      'vh':  'MAX_PLAYERS_HARD',
  'Sh':  'COLLISION_DEPTH',  'Wh':  'MINIMAP_RATE',
  'Eh':  'COL_GRID',         'Ch':  'CLIENT_SEND_RATE',
  'Th':  'HEALTH_BAR_WIDTH', 'Ih':  'HEALTH_BAR_PAD',
  'Mh':  'ICON_PADDING',     'Ph':  'ICON_PAD',
  'Ah':  'DEATH_FADEOUT',    'Rh':  'CROWN_ICON_SCALE',
  'Oh':  'CROWN_PAD',        'Bh':  'CHAT_COUNTDOWN',
  'Dh':  'CHAT_COOLDOWN',    '_h':  'IN_SANDBOX',
  'Lh':  'MAX_AGE',          'Nh':  'GATHER_ANGLE',
  'Gh':  'GATHER_WIGGLE',    'qh':  'HIT_RETURN_RATIO',
  'Fh':  'HIT_ANGLE',        'Hh':  'PLAYER_SCALE',
  'Kh':  'PLAYER_SPEED',     'Qh':  'PLAYER_DECEL',
  'Vh':  'NAME_Y',           'Uh':  'SKIN_COLORS',
  'Xh':  'ANIMAL_COUNT',     'zh':  'AI_TURN_RANDOM',
  'Jh':  'COW_NAMES',        'Zh':  'SHIELD_ANGLE',
  'Ks':  'WEAPON_VARIANTS',  'Yh':  'fetchVariant',
  'jh':  'RESOURCE_TYPES',   '$h':  'AREA_COUNT',
  'ex':  'TREES_PER_AREA',   'tx':  'BUSHES_PER_AREA',
  'nx':  'TOTAL_ROCKS',      'ox':  'GOLD_ORES',
  'ix':  'RIVER_WIDTH',      'sx':  'RIVER_PADDING',
  'ax':  'WATER_CURRENT',    'cx':  'WAVE_SPEED',
  'rx':  'WAVE_MAX',         'lx':  'TREE_SCALES',
  'dx':  'BUSH_SCALES',      'fx':  'ROCK_SCALES',
  'ux':  'SNOW_BIOME_TOP',   'hx':  'SNOW_SPEED',
  'xx':  'MAX_NAME_LENGTH',  'mx':  'MAP_SCALE',
  'px':  'SECRET_POOL',      'gx':  'MAP_PING_SCALE',
  'yx':  'MAP_PING_TIME',    'kx':  'MAX_ATTACK',
  'wx':  'MAX_SPAWN_DELAY',  'bx':  'MAX_SPEED',
  'vx':  'MAX_TURN_SPEED',   'Sx':  'DAY_INTERVAL',
  /* ─── Game entities ─── */
  'N':   'ITEMS',            'ue':  'ITEM_GROUPS',
  'Im':  'PROJECTILE_DEFS',  'Mm':  'WEAPON_DEFS',
  'Po':  'ITEM_LIST',        'Gd':  'STORE_DATA',
  'Om':  'HAT_LIST',         'Bm':  'ACCESSORY_LIST',
  'Cn':  'hats',             'Tn':  'accessories',
  'we':  'objectManager',    'gf':  'projectileManager',
  'wt':  'aiManager',        'cf':  'textManager',
  'Rm':  'Player',           'Tm':  'GameObject',
  'Em':  'AI',               'Cm':  'AiManager',
  'Dm':  'Projectile',       'Wm':  'ProjectileManager',
  'Sm':  'ObjectManager',    'km':  'AnimText',
  'wm':  'TextManager',      'bm':  'SoundManager',
  /* ─── Renderer ─── */
  'A':   'glRenderer',       'bn':  'textRenderer',
  'Lo':  'gameCanvas',       'Ro':  'textCanvas',
  'ef':  'createGl2dContext', 'Qt':  'parseColor',
  'ye':  'minimapCtx',       'Ee':  'minimapCanvas',
  /* ─── Map / biome ─── */
  'tf':  'makePrng',         'c1':  'gorgeSignedDist',
  'd1':  'drawRiver',        'f1':  'drawGorge',
  'l1':  'drawWaterfallStreaks','u1': 'isInSecretPool',
  'b1':  'drawEffects',      'sf':  'drawBossOverlay',
  'v1':  'drawBossHealthBar', 'g1':  'spawnEffect',
  /* ─── UI helpers ─── */
  'f':   'UTILS',            'st':  'keybinds',
  'Ye':  'shopManager',      'V':   'serverBrowser',
  'j':   'friendsManager',   'H':   'authManager',
  'ti':  'pageStream',       'W1':  'touchControls',
  'af':  'createDropdown',   'tm':  'generateElement',
  'em':  'removeAllChildren','Cd':  'hookTouchEvents',
  'Ut':  'checkTrusted',     'Td':  'eventIsTrusted',
  /* ─── Server events (handlers) ─── */
  'V1':  'onInitData',       'Og':  'onSetupGame',
  'd2':  'onAddPlayer',      'f2':  'onRemovePlayer',
  'm2':  'onUpdatePlayers',  'Fr':  'onUpdateLeaderboard',
  'vp':  'onUpdateStats',    'Cp':  'onProfileData',
  'e2':  'onLoadGameObjects','c2':  'onLoadAI',
  's2':  'onAnimateAI',      'Hg':  'onGatherAnimation',
  't2':  'onWiggleObject',   'n2':  'onShootTurret',
  'h2':  'onUpdatePlayerValue','x2': 'onUpdateHealth',
  'o2':  'onAddProjectile',  'i2':  'onRemoveProjectile',
  'k2':  'onServerShutdown', 'eg':  'onAddAlliance',
  'tg':  'onSetPlayerTeam',  'ng':  'onSetAlliancePlayers',
  'og':  'onDeleteAlliance', '$p':  'onAllianceNotification',
  'vg':  'onReceiveChat',    'Bg':  'onShowText',
  'cg':  'onPingMap',        'lg':  'onUpdateMinimap',
  'Dg':  'onKillPlayer',     'Lg':  'onKillObject',
  '_g':  'onKillObjects',    'u2':  'onUpdateItemCounts',
  'Du':  'onUpdateAge',      'Bu':  'onUpdateUpgrades',
  'wu':  'onUpdateItems',    'du':  'onUpdateStoreItems',
  'Vg':  'onSetDive',        'y2':  'onPingResponse',
  'S2':  'onServerReloadNotice',
  /* ─── Player send wrappers ─── */
  'rs':  'sendMoveDir',      'tn':  'sendAttackState',
  'Pn':  'sendSelectBuild',  'po':  'sendEquipItem',
  'Tu':  'sendMapPing',      'Iu':  'sendAutoGather',
  'Ig':  'sendLockDir',      'Rr':  'sendCreateAlliance',
  'cu':  'sendLeaveAlliance','su':  'sendKickFromClan',
  'au':  'sendJoinAlliance', 'Ar':  'sendAnswerJoinReq',
  'yi':  'resetMoveDir',     'rs':  'sendMoveDir',
  /* ─── Rendering helpers ─── */
  'fe':  'renderCircle',     'it':  'renderStar',
  'Bo':  'renderRect',       'Nc':  'renderRectCircle',
  'jg':  'renderTriangle',   'Yg':  'renderBlob',
  'Zg':  'renderLeaf',       'Fl':  'getItemSprite',
  'Jg':  'getResourceSprite','fd':  'renderTool',
  'Lu':  'renderHat',        'Xg':  'renderAccessory',
  'Ug':  'renderPlayer',     'Kg':  'renderMorph',
  'Qg':  'renderDive',       'rd':  'renderAura',
  'cd':  'renderPlayers',    'sd':  'renderProjectiles',
  'Mi':  'renderGameObjects','Fg':  'prepareObjectBuckets',
  'Kr':  'renderProjectile', 'ad':  'renderWaterBodies',
  'Nu':  'isOnScreen',       'dg':  'renderMinimap',
  '_u':  'gameLoop',         'Kl':  'animFrame',
  /* ─── Misc ─── */
  'f0':  'sortShopItems',    'rm':  'buildShopList',
  'sm':  'loadKeybinds',     '$r':  'saveKeybinds',
  'qa':  'rebuildMoveKeys',  'Ji':  'renderKeybindUI',
  'am':  'addCustomActions', 'gi':  'generateStoreList',
  'ss':  'generateShopEditor','gg': 'initGameSettings',
  'bu':  'resizeActionBar',  'Ll':  'resizeCanvas',
  'Ou':  'updateUpgradeUI',  'Au':  'updateStatusDisplay',
  'Ru':  'loadIcons',        'Ng':  'updateUpgrades',
  'ql':  'makeDeterministicRng','tf': 'makePrng',
  'oc':  'ENCRYPTED_MODE_ID',
};

const PARAM_RENAMES = {
  decodeString:         ['code','key'],
  decodeStr2:           ['code','key'],
  decodeStr3:           ['code','key'],
  decodeStr4:           ['code','key'],
  Player:               ['id','sid','config','utils','projManager','objManager',
                         'players','ais','items','hats','accessories','server',
                         'scoreCallback','iconCallback'],
  GameObject:           ['sid'],
  AI:                   ['sid','objManager','players','items','utils','config',
                         'scoreCallback','server'],
  Projectile:           ['players','ais','objManager','items','config','utils','server'],
  ObjectManager:        ['GameObjectCtor','gameObjects','utils','config','players','server'],
  ProjectileManager:    ['ProjectileCtor','projectiles','players','ais','objManager',
                         'items','config','utils','server'],
  AiManager:            ['ais','AICtor','players','items','objManager','config','utils'],
  renderPlayer:         ['obj','ctx'],
  renderCircle:         ['x','y','radius','ctx','noStroke','noFill'],
  renderStar:           ['ctx','spikes','outer','inner'],
  renderProjectile:     ['x','y','obj','ctx','debug'],
  renderMinimap:        ['delta'],
  getItemSprite:        ['obj','asIcon'],
  getResourceSprite:    ['obj'],
  renderTool:           ['obj','variant','x','y','ctx'],
  renderHat:            ['index','ctx','parentSkin','owner'],
  renderAccessory:      ['index','ctx','owner'],
  onAddProjectile:      ['x','y','dir','range','speed','indx','layer','sid'],
  onAddPlayer:          ['data','isYou'],
  onUpdatePlayers:      ['data'],
  onLoadGameObjects:    ['data'],
  onLoadAI:             ['data','hidden'],
  onUpdateLeaderboard:  ['data','signedInIds','deadIds','clanData','isLeader',
                         'clanTags','crownIds'],
  onGatherAnimation:    ['sid','didHit','weaponIndex'],
  onWiggleObject:       ['dir','sid'],
  onReceiveChat:        ['sid','message'],
  onShowText:           ['x','y','value','type'],
  sendAttackState:      [],
  sendMoveDir:          [],
  sendSelectBuild:      ['index','isWeapon'],
  gameLoop:             [],
  animFrame:            [],
  parseColor:           ['cssStr'],
  createGl2dContext:    ['canvas','options'],
  fetchSelfDigest:      [],
  computeTamperFlags:   [],
  runFingerprint:       ['callback'],
  buildSessionTables:   ['seed','salt'],
  computeHmac:          ['key','data'],
  applyMaskXor:         ['buf','maskFn'],
  sha256Block:          ['data'],
  deriveKeys:           ['key','data'],
  buildCharMap:         ['arr','seed'],
  fillCharMap:          ['tables','arr','start','seed'],
  makeRng:              ['seed'],
  hexStringToUint8:     ['hexStr'],
  verifyBundleDigest:   ['guards'],
  makeDeterministicRng: ['seedStr'],
  makePrng:             ['seed'],
  isOnScreen:           ['x','y','scale'],
  resizeCanvas:         [],
  updateStatusDisplay:  [],
  loadIcons:            [],
  resetMoveDir:         [],
  initAntiTamper:       ['options'],
  freezeSocketRef:      [],
  hookKeyDown:          [],
  startDebuggerInterval: [],
  loadTrackingPixels:   [],
  injectAntiTamperElement: ['src'],
  generateElement:      ['config'],
  removeAllChildren:    ['element'],
  hookTouchEvents:      ['element','skipPrevent'],
  checkTrusted:         ['callback'],
  eventIsTrusted:       ['ev'],
  createDropdown:       ['element','options'],
  sortShopItems:        ['arr'],
  buildShopList:        ['type','hats','accessories'],
  loadKeybinds:         [],
  saveKeybinds:         [],
  rebuildMoveKeys:      [],
  renderKeybindUI:      [],
  addCustomActions:     ['actionsArr'],
  generateStoreList:    [],
  generateShopEditor:   [],
  initGameSettings:     [],
  resizeActionBar:      [],
  updateUpgradeUI:      [],
  updateUpgrades:       ['points','age'],
  prepareObjectBuckets: ['xOffset','yOffset'],
  renderPlayers:        ['xOffset','yOffset','zIndex'],
  renderGameObjects:    ['layer','xOffset','yOffset'],
  renderProjectiles:    ['layer','xOffset','yOffset'],
  renderWaterBodies:    ['xOffset','yOffset','ctx','padding'],
  drawRiver:            ['ctx','xOffset','yOffset','screenW','screenH','padding','time'],
  drawGorge:            ['ctx','xOffset','yOffset','screenW','screenH','padding','time'],
  drawBossOverlay:      ['ctx','ai','sprite','scale','time'],
  drawBossHealthBar:    ['ctx','ai','screenW','outlineColor','uiBoxes','textCtx'],
  spawnEffect:          ['kind','x','y','radius','life','x2','y2'],
};


// ══════════════════════════════════════════════════════════════
// SECTION 4 — LEXER UTILITIES (no Acorn dependency)
// ══════════════════════════════════════════════════════════════

/** Escape special regex characters in a string */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Skip over a JS string starting at index i (points to opening quote).
 *  Handles ", ', ` with ${...} nesting for template literals. */
function skipString(src, i) {
  const q = src[i];
  if (q === '`') {
    i++;
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && src[i+1] === '{') { depth++; i += 2; continue; }
      if (c === '}' && depth > 0) { depth--; i++; continue; }
      if (c === '`' && depth === 0) return i + 1;
      i++;
    }
    return i;
  }
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    i++;
  }
  return i;
}

/** Skip a // line comment. i points to first '/'. */
function skipLineComment(src, i) {
  while (i < src.length && src[i] !== '\n') i++;
  return i;
}

/** Skip a block comment. i points to opening '/'. */
function skipBlockComment(src, i) {
  i += 2;
  while (i < src.length) {
    if (src[i] === '*' && src[i+1] === '/') return i + 2;
    i++;
  }
  return i;
}

/** Heuristic: is '/' at this position a regex rather than division? */
function isRegexContext(lastToken) {
  if (!lastToken) return true;
  const t = lastToken.trim();
  // After these tokens a '/' opens a regex
  return /^(?:return|typeof|instanceof|in|of|new|delete|throw|case|void|=|=>|[({[,;:!&|?~^%+\-*/<>])$/.test(t);
}

/** Skip a regex literal. i points to opening '/'. */
function skipRegex(src, i) {
  i++; // skip opening /
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') { inClass = true; i++; continue; }
    if (c === ']') { inClass = false; i++; continue; }
    if (c === '/' && !inClass) {
      i++;
      // skip flags
      while (i < src.length && /[gimsuy]/.test(src[i])) i++;
      return i;
    }
    i++;
  }
  return i;
}

/** Walk to matching closing brace. i points to '{'. Returns index after '}'. */
function walkBraceBlock(src, i) {
  let depth = 0;
  let lastTok = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i+1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i+1] === '*') { i = skipBlockComment(src, i); continue; }
    if (c === '/' && isRegexContext(lastTok)) { i = skipRegex(src, i); lastTok = '/regex/'; continue; }
    if (c === '{') { depth++; lastTok = '{'; i++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
      lastTok = '}'; i++; continue;
    }
    if (c > ' ') lastTok = c;
    i++;
  }
  return i;
}

/** Walk to matching closing paren. i points to '('. Returns index after ')'. */
function walkParenBlock(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i+1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i+1] === '*') { i = skipBlockComment(src, i); continue; }
    if (c === '(') { depth++; i++; continue; }
    if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
      i++; continue;
    }
    i++;
  }
  return i;
}

/** Extract a complete function (declaration or expression) starting at startIdx.
 *  startIdx should point at 'f' of 'function'. */
function extractFunction(src, startIdx) {
  let i = startIdx;
  // skip 'function' keyword + optional name + params
  const bodyStart = src.indexOf('{', i);
  if (bodyStart === -1) return null;
  const bodyEnd = walkBraceBlock(src, bodyStart);
  return { start: startIdx, end: bodyEnd, src: src.slice(startIdx, bodyEnd) };
}

/** Find all named function declarations: function NAME( */
function findAllFunctions(src) {
  const re = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  const results = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const fn = extractFunction(src, m.index);
    if (fn) results.push({ name: m[1], ...fn });
  }
  return results;
}

/** Extract the body (inside braces) of a function source string. */
function extractFunctionBody(fnSrc) {
  const open = fnSrc.indexOf('{');
  if (open === -1) return '';
  return fnSrc.slice(open + 1, fnSrc.lastIndexOf('}'));
}

/** Extract raw params string from function source. */
function extractFunctionParams(fnSrc) {
  const open = fnSrc.indexOf('(');
  const close = fnSrc.indexOf(')');
  if (open === -1 || close === -1) return '';
  return fnSrc.slice(open + 1, close);
}

/** Split top-level (non-nested) args on ','. */
function splitTopLevelArgs(s) {
  const args = [];
  let depth = 0, cur = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(s, i);
      cur += s.slice(i, end);
      i = end; continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; i++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; cur += c; i++; continue; }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

/** Is this string a "simple" expression (identifier, small literal)? */
function isSimpleExpr(s) {
  s = s.trim();
  if (!s) return false;
  if (/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(s)) return true;   // identifier/chain
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;                // number
  if (/^["'`][^"'`]{0,80}["'`]$/.test(s)) return true;       // short string
  if (s === 'true' || s === 'false' || s === 'null' || s === 'undefined') return true;
  return false;
}

/** Find the enclosing brace block for a given position. */
function findEnclosingBlock(src, pos) {
  let depth = 0, open = -1;
  for (let i = 0; i < pos; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i) - 1; continue; }
    if (c === '/' && src[i+1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i+1] === '*') { i = skipBlockComment(src, i) - 1; continue; }
    if (c === '{') { depth++; if (depth === 1 && open === -1) open = i; }
    if (c === '}') depth--;
  }
  if (open === -1) return { open: 0, close: src.length };
  const close = walkBraceBlock(src, open);
  return { open, close };
}

/** Count string literals in source. */
function countStringLiterals(src) {
  let count = 0, i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { count++; i = skipString(src, i); continue; }
    if (c === '/' && src[i+1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i+1] === '*') { i = skipBlockComment(src, i); continue; }
    i++;
  }
  return count;
}

/** Count semicolons outside strings/comments. */
function countSemicolonsOutsideStrings(src) {
  let count = 0, i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i+1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i+1] === '*') { i = skipBlockComment(src, i); continue; }
    if (c === ';') count++;
    i++;
  }
  return count;
}


// ══════════════════════════════════════════════════════════════
// SECTION 5 — DECODER RESOLUTION
// ══════════════════════════════════════════════════════════════

/** Is this function a string-array function (no params, returns large array)? */
function isStringArrayFn(fnSrc) {
  const body = extractFunctionBody(fnSrc);
  const params = extractFunctionParams(fnSrc).trim();
  if (params) return false; // must have no params
  // Look for return [...] with >=50 entries OR assignment then return
  const returnMatch = body.match(/return\s*\[/);
  if (!returnMatch) return false;
  const commaCount = (body.match(/,\s*["']/g) || []).length;
  return commaCount >= 40;
}

/** Is this function a string decoder (calls array fn, has charCodeAt/fromCharCode)? */
function isDecoderFn(fnSrc, arrayNames) {
  const body = extractFunctionBody(fnSrc);
  const hasArrayCall = arrayNames.some(n => body.includes(n + '(') || body.includes(n + '['));
  const hasCharOps = /charCodeAt|fromCharCode/.test(body);
  const hasDecodeURI = /decodeURIComponent|charAt/.test(body);
  return hasArrayCall && hasCharOps && hasDecodeURI;
}

/** Find rotation IIFEs that shuffle string arrays. */
function findRotationIIFEs(src, arrayNames) {
  const results = [];
  // Pattern: (function(e,t){ ... e().push/shift ... })(arrayFn, number)
  const re = /\(\s*function\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const fnStart = m.index;
    const bodyEnd = walkBraceBlock(src, src.indexOf('{', fnStart));
    // Check for call args after }
    let after = src.slice(bodyEnd).match(/^\s*\)\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,/);
    if (!after) continue;
    const calledName = after[1];
    if (!arrayNames.includes(calledName)) continue;
    const body = src.slice(fnStart, bodyEnd);
    if (!/\bpush\b/.test(body) || !/\bshift\b/.test(body)) continue;
    // find full IIFE end including )(name, target)
    let iife_end = src.indexOf(')', bodyEnd);
    while (iife_end < src.length && src[iife_end] !== ';') iife_end++;
    results.push({ arrayName: calledName, start: fnStart, end: iife_end + 1,
                   src: src.slice(fnStart, iife_end + 1) });
  }
  return results;
}

/** Attempt to sandbox-execute the array fn + decoder fn + rotation IIFE.
 *  Returns the live decoder function or null. */
function tryEvalDecoder(arrayFnSrc, decoderFnSrc, rotationText) {
  try {
    // Extract names
    const arrayNameMatch  = arrayFnSrc.match(/function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    const decNameMatch    = decoderFnSrc.match(/function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (!arrayNameMatch || !decNameMatch) return null;
    const arrayName = arrayNameMatch[1];
    const decName   = decNameMatch[1];

    const code = `
"use strict";
${arrayFnSrc}
${decoderFnSrc}
${rotationText || ''}
return ${decName};
`;
    const factory = new Function(
      'Math','String','Array','parseInt','parseFloat',
      'decodeURIComponent','Object','Number','RegExp',
      code
    );
    const fn = factory(
      Math, String, Array, parseInt, parseFloat,
      decodeURIComponent, Object, Number, RegExp
    );
    if (typeof fn !== 'function') return null;
    // Quick smoke test
    try { fn(9999, 'x'); } catch (_) { /* OOB is fine */ }
    return fn;
  } catch (e) {
    warn('tryEvalDecoder failed:', e.message);
    return null;
  }
}

/** Master decoder resolver: finds arrays, decoders, rotations, builds live fns. */
function resolveDecoders(src) {
  const fns = findAllFunctions(src);
  const arrayFns   = fns.filter(f => isStringArrayFn(f.src));
  const arrayNames = arrayFns.map(f => f.name);
  const decoderFns = fns.filter(f => f.name && isDecoderFn(f.src, arrayNames));
  const rotations  = findRotationIIFEs(src, arrayNames);

  log(`Resolver: ${arrayFns.length} array fns, ${decoderFns.length} decoder fns, ${rotations.length} rotation IIFEs`);

  const resolvers = [];
  const arrays    = arrayNames.slice();
  const decoderNames = decoderFns.map(f => f.name);

  for (const dec of decoderFns) {
    // Find the array fn this decoder calls
    const decBody  = extractFunctionBody(dec.src);
    const usedArr  = arrayFns.find(a => decBody.includes(a.name + '(') || decBody.includes(a.name + '['));
    if (!usedArr) continue;
    const rot = rotations.find(r => r.arrayName === usedArr.name);
    const fn  = tryEvalDecoder(usedArr.src, dec.src, rot ? rot.src : '');
    if (!fn) { warn(`Could not instantiate decoder: ${dec.name}`); continue; }
    resolvers.push({ name: dec.name, arrayName: usedArr.name,
                     fn, decFn: dec, arrayFn: usedArr });
    log(`✓ Decoder resolved: ${dec.name} (array: ${usedArr.name})`);
  }

  return { resolvers, arrays, rotations, decoderNames };
}


// ══════════════════════════════════════════════════════════════
// SECTION 6 — REPLACE DECODER CALLS
// ══════════════════════════════════════════════════════════════

/** Collect alias assignment events: `NAME = TARGET` */
function collectAliasEvents(src) {
  const events = [];
  const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    events.push({ name: m[1], target: m[2], pos: m.index });
  }
  return events;
}

/** Build an index: name → sorted events. */
function buildEventsIndex(events) {
  const idx = new Map();
  for (const ev of events) {
    if (!idx.has(ev.name)) idx.set(ev.name, []);
    idx.get(ev.name).push(ev);
  }
  for (const [, arr] of idx) arr.sort((a, b) => a.pos - b.pos);
  return idx;
}

/** Resolve alias chain to a root decoder name, position-aware. Max 30 hops. */
function resolveDecoderAt(name, callPos, byName, rootNames) {
  let cur = name, hops = 0;
  while (hops++ < 30) {
    if (rootNames.has(cur)) return cur;
    const events = byName.get(cur);
    if (!events) return null;
    // Latest assignment before callPos
    const ev = [...events].reverse().find(e => e.pos < callPos);
    if (!ev) return null;
    cur = ev.target;
  }
  return null;
}

/** Is a decoded string plausible (not garbage)? */
function isPlausible(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 300) return false;
  // reject control chars except tab/newline
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)) return false;
  // reject orphan surrogates
  if (/[\uD800-\uDFFF]/.test(s)) return false;
  // reject if >30% non-ASCII
  const nonAscii = (s.match(/[^\x00-\x7e]/g) || []).length;
  if (nonAscii / s.length > 0.30) return false;
  return true;
}

/** Replace strings/templates/comments with same-length spaces, preserving offsets. */
function maskNonCodeForOffsets(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i);
      out += ' '.repeat(end - i);
      i = end; continue;
    }
    if (c === '/' && src[i+1] === '/') {
      const end = skipLineComment(src, i);
      out += ' '.repeat(end - i);
      i = end; continue;
    }
    if (c === '/' && src[i+1] === '*') {
      const end = skipBlockComment(src, i);
      out += ' '.repeat(end - i);
      i = end; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Evaluate a small numeric expression safely (only +,-,*,/ with integers). */
function evalNumExpr(expr) {
  const clean = expr.trim();
  if (!/^-?[\d\s\+\-\*\/\(\)]+$/.test(clean)) return NaN;
  try {
    const v = Function('"use strict"; return (' + clean + ')')();
    return typeof v === 'number' ? v : NaN;
  } catch (_) { return NaN; }
}

/** Replace all static decoder calls with their resolved string literals. */
function replaceCalls(src, resolvers) {
  if (!resolvers.length) return src;

  const rootNames  = new Set(resolvers.map(r => r.name));
  const byResolver = new Map(resolvers.map(r => [r.name, r]));
  const aliasEvents = collectAliasEvents(src);
  const byName      = buildEventsIndex(aliasEvents);
  const masked      = maskNonCodeForOffsets(src);
  const cache       = new Map();

  // Collect all call-sites: name(numExpr, "key") or name(numExpr)
  const callRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*(-?[\d\s\+\-\*\/\(\)]+?)\s*(?:,\s*"([^"\\]*)"\s*)?\)/g;

  const replacements = []; // {start, end, replacement}

  let m;
  while ((m = callRe.exec(masked)) !== null) {
    const [fullMatch, callerName, numExpr, key] = m;
    const callPos = m.index;

    const rootName = resolveDecoderAt(callerName, callPos, byName, rootNames)
                  || (rootNames.has(callerName) ? callerName : null);
    if (!rootName) continue;

    const resolver = byResolver.get(rootName);
    if (!resolver) continue;

    const idx = evalNumExpr(numExpr);
    if (!Number.isFinite(idx)) continue;

    const cacheKey = `${rootName}|${idx}|${key || ''}`;
    let decoded;
    if (cache.has(cacheKey)) {
      decoded = cache.get(cacheKey);
    } else {
      try {
        decoded = key !== undefined ? resolver.fn(idx, key) : resolver.fn(idx, '');
      } catch (_) {
        cache.set(cacheKey, null);
        continue;
      }
      if (!isPlausible(decoded)) { cache.set(cacheKey, null); continue; }
      cache.set(cacheKey, decoded);
    }
    if (decoded === null || decoded === undefined) continue;

    replacements.push({ start: m.index, end: m.index + fullMatch.length,
                        replacement: JSON.stringify(decoded) });
  }

  // Apply DESC to avoid offset drift
  replacements.sort((a, b) => b.start - a.start);
  let out = src;
  let success = 0, fail = 0;
  for (const r of replacements) {
    // Verify the slice still matches (it should since we go DESC)
    if (out.slice(r.start, r.end) === src.slice(r.start, r.end)) {
      out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
      success++;
    } else {
      fail++;
    }
  }

  // Log stats per decoder
  const perDec = {};
  for (const r of replacements) {
    const cKey = /* retrieve decoder name */ 'all';
    perDec[cKey] = (perDec[cKey] || 0) + 1;
  }
  log(`replaceCalls: ${success} replaced, ${fail} position mismatches`);

  return out;
}

/** Fixpoint alias expansion: find all names that alias a decoder. */
function expandDecoderFamily(src, seedNames) {
  const family = new Set(seedNames);
  const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  let changed = true, iters = 0;
  while (changed && iters++ < 200) {
    changed = false;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      if (family.has(m[2]) && !family.has(m[1])) {
        family.add(m[1]); changed = true;
      }
    }
  }
  if (CFG.verboseFamily)
    log(`expandDecoderFamily: ${family.size} members after ${iters} iterations`);
  return family;
}

/** Strip rotation IIFEs and replace !![] / ![] with boolean literals. */
function stripDecoderArtifacts(src, resolvers, rotations) {
  let out = src;

  // Remove rotation IIFEs (descending position)
  const rots = [...rotations].sort((a, b) => b.start - a.start);
  for (const rot of rots) {
    const comment = `/* [deobf] rotation IIFE (${rot.arrayName}) — stripped */`;
    out = out.slice(0, rot.start) + comment + out.slice(rot.end);
  }

  // Normalize !![] → true, ![] → false
  out = out.replace(/!!\[\]/g, 'true').replace(/!\[\]/g, 'false');

  return out;
}


// ══════════════════════════════════════════════════════════════
// SECTION 7 — HELPER-OBJECT INLINING
// ══════════════════════════════════════════════════════════════

/** Inline simple helper objects: const X = {}; X.f = function(p) { return expr; }
 *  → replaces X.f(arg) with (expr[p→arg]) */
function simplifyHelperObjects(src) {
  if (!CFG.simplifyHelpers) return src;
  let out = src;
  let totalReplaced = 0;

  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    // Find `const NAME = {};`  or  `var NAME = {};`
    const objDecRe = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{\s*\}/g;
    let m;
    while ((m = objDecRe.exec(out)) !== null) {
      const objName = m[1];
      // Build map of method assignments: NAME.prop = function(params) { return expr; }
      const methodRe = new RegExp(
        escapeRe(objName) + '\\.(\\w+)\\s*=\\s*function\\s*\\(([^)]*)\\)\\s*\\{\\s*return\\s+([^;{}]+);\\s*\\}',
        'g'
      );
      const methods = {};
      let mm;
      while ((mm = methodRe.exec(out)) !== null) {
        const [, prop, rawParams, body] = mm;
        const params = rawParams.split(',').map(p => p.trim()).filter(Boolean);
        methods[prop] = { params, body: body.trim(), assignStart: mm.index, assignEnd: mm.index + mm[0].length };
      }
      if (!Object.keys(methods).length) continue;

      // Also handle alias: const Y = NAME
      const aliasRe = new RegExp('\\b(?:const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*' + escapeRe(objName) + '\\b', 'g');
      const aliases = [objName];
      let am;
      while ((am = aliasRe.exec(out)) !== null) aliases.push(am[1]);

      // For each alias.method(args), inline
      for (const alias of aliases) {
        for (const [prop, info] of Object.entries(methods)) {
          const callRe = new RegExp(
            escapeRe(alias) + '\\.' + escapeRe(prop) + '\\s*\\(',
            'g'
          );
          let cm;
          while ((cm = callRe.exec(out)) !== null) {
            const parenStart = out.indexOf('(', cm.index + cm[0].length - 1);
            if (parenStart === -1) continue;
            const parenEnd = walkParenBlock(out, parenStart);
            const argsRaw = out.slice(parenStart + 1, parenEnd - 1);
            const args = splitTopLevelArgs(argsRaw);
            if (args.length !== info.params.length) continue;

            // Substitute params in body
            let inlined = info.body;
            for (let pi = 0; pi < info.params.length; pi++) {
              const paramRe = new RegExp('\\b' + escapeRe(info.params[pi]) + '\\b', 'g');
              const argVal = isSimpleExpr(args[pi]) ? args[pi] : '(' + args[pi] + ')';
              inlined = inlined.replace(paramRe, argVal);
            }

            const fullCall = out.slice(cm.index, parenEnd);
            out = out.slice(0, cm.index) + '(' + inlined + ')' + out.slice(parenEnd);
            callRe.lastIndex = cm.index + inlined.length + 2;
            changed = true;
            totalReplaced++;
          }
        }
      }
    }
    if (!changed) break;
  }
  if (totalReplaced) log(`simplifyHelperObjects: ${totalReplaced} inlines`);
  return out;
}


// ══════════════════════════════════════════════════════════════
// SECTION 8 — STRIP DEAD DECODER LOCALS / ALIAS
// ══════════════════════════════════════════════════════════════

/** Iteratively remove dead decoder aliases and related locals. */
function stripDeadDecoderLocals(src, decoderNames) {
  if (!CFG.stripDeadCode) return src;

  const targets = new Set([
    'decodeString','decodeStringAlias','decodeStr2','decodeStr3','decodeStr3Alias',
    'decodeStr4','stringArrayA','stringArrayB','stringArrayC',
    ...(decoderNames || []),
  ]);

  let out = src;
  let removed = 0;

  for (let iter = 0; iter < 400; iter++) {
    let changed = false;

    // Pattern A: `const|let|var NAME = TARGET` where TARGET ∈ targets
    for (const target of targets) {
      const re = new RegExp(
        '(?:const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*' + escapeRe(target) + '\\s*[,;]',
        'g'
      );
      let m;
      while ((m = re.exec(out)) !== null) {
        const newName = m[1];
        if (targets.has(newName)) continue; // already tracked
        // Check no other ref in enclosing block
        const { open, close } = findEnclosingBlock(out, m.index);
        const block = out.slice(open, close);
        const refCount = (block.match(new RegExp('\\b' + escapeRe(newName) + '\\b', 'g')) || []).length;
        if (refCount <= 2) { // declaration + one assignment
          targets.add(newName);
          // Remove the declaration
          const stmt = m[0];
          out = out.slice(0, m.index) + out.slice(m.index + stmt.length);
          re.lastIndex = m.index;
          removed++;
          changed = true;
        }
      }
    }

    // Pattern B: bare `NAME = TARGET;` where both ∈ targets
    const bareRe = /([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*;/g;
    let bm;
    while ((bm = bareRe.exec(out)) !== null) {
      if (!targets.has(bm[1]) || !targets.has(bm[2])) continue;
      out = out.slice(0, bm.index) + out.slice(bm.index + bm[0].length);
      bareRe.lastIndex = bm.index;
      removed++;
      changed = true;
    }

    if (!changed) break;
  }

  if (removed) log(`stripDeadDecoderLocals: removed ${removed} dead locals`);
  return out;
}

/** Strip dead helper shells (empty objects + orphaned method defs). */
function stripDeadHelperShells(src) {
  if (!CFG.stripDeadCode) return src;
  let out = src;
  let removed = 0;

  for (let iter = 0; iter < 200; iter++) {
    let changed = false;

    // Pattern 1: dead alias `const Y = X` where X is an empty object or removed
    // Pattern 2: orphaned `X.prop = function...`
    // Pattern 3: `const X = {}` with no remaining uses

    // Empty object declarations
    const emptyObjRe = /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{\s*\}\s*;/g;
    let m;
    while ((m = emptyObjRe.exec(out)) !== null) {
      const name = m[1];
      const { open, close } = findEnclosingBlock(out, m.index);
      const block = out.slice(open, close);
      const refs = (block.match(new RegExp('\\b' + escapeRe(name) + '\\b', 'g')) || []).length;
      if (refs <= 1) {
        out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
        emptyObjRe.lastIndex = m.index;
        removed++;
        changed = true;
      }
    }

    if (!changed) break;
  }

  if (removed) log(`stripDeadHelperShells: removed ${removed} shells`);
  return out;
}


// ══════════════════════════════════════════════════════════════
// SECTION 9 — GENERIC ORPHAN STRIPPING
// ══════════════════════════════════════════════════════════════

/** Strip orphaned variables/functions not referenced elsewhere. */
function stripOrphansText(code, familyNames) {
  if (!CFG.stripOrphans) return code;
  let out = code;
  let totalRemoved = 0;
  const family = familyNames || new Set();

  for (let iter = 0; iter < CFG.stripOrphansMaxIter; iter++) {
    let changed = false;

    // Orphan var/const/let declarations whose RHS is a family member or tmp var
    const declRe = /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*[;,]/g;
    let m;
    while ((m = declRe.exec(out)) !== null) {
      const [, name, rhs] = m;
      // Only process tmp vars or family members on RHS
      if (!family.has(rhs) && !/^tmp[\w$]*$/.test(name) && !/^_v[\w$]*$/.test(name)) continue;
      const { open, close } = findEnclosingBlock(out, m.index);
      const block = out.slice(open, close);
      // Count refs to `name` (avoid false positives in strings/props)
      const refRe = new RegExp('(?<![.\'"`])\\b' + escapeRe(name) + '\\b(?![\'"`])', 'g');
      const refs = (block.match(refRe) || []).length;
      if (refs <= 1) {
        out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
        declRe.lastIndex = m.index;
        changed = true; totalRemoved++;
      }
    }

    // Orphan function declarations
    const fnDeclRe = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    while ((m = fnDeclRe.exec(out)) !== null) {
      const name = m[1];
      if (JS_RESERVED.has(name)) continue;
      const fn = extractFunction(out, m.index);
      if (!fn) continue;
      const before = out.slice(0, m.index);
      const after  = out.slice(fn.end);
      const refRe  = new RegExp('(?<![.\'"`])\\b' + escapeRe(name) + '\\b(?![\'"`\\s]*[:(]\\s*function)', 'g');
      const refsB = (before.match(refRe) || []).length;
      const refsA = (after.match(refRe) || []).length;
      if (refsB === 0 && refsA === 0) {
        out = before + out.slice(fn.end);
        fnDeclRe.lastIndex = m.index;
        changed = true; totalRemoved++;
      }
    }

    if (!changed) break;
  }

  if (totalRemoved) log(`stripOrphansText: removed ${totalRemoved} orphans`);
  return out;
}


// ══════════════════════════════════════════════════════════════
// SECTION 10 — AST RENAMER (Acorn-based, capture-aware)
// ══════════════════════════════════════════════════════════════

/** Normalize boolean shorthand and void 0. */
function normalizeLiteralsInSrc(src) {
  return src
    .replace(/!!\[\]/g, 'true')
    .replace(/!\[\]/g, 'false')
    .replace(/!0\b/g, 'true')
    .replace(/!1\b/g, 'false')
    .replace(/\bvoid\s+0\b/g, 'undefined');
}

/** Extract string/template/regex literals and replace with placeholders. */
function extractLiterals(src) {
  const map = {};
  let id = 0;
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i);
      const literal = src.slice(i, end);
      const ph = `\uE000LIT${id}\uE001`;
      map[ph] = literal;
      out += ph;
      id++;
      i = end;
      continue;
    }
    if (c === '/' && src[i+1] === '/' ) { const e = skipLineComment(src, i); out += src.slice(i,e); i=e; continue; }
    if (c === '/' && src[i+1] === '*') { const e = skipBlockComment(src, i); out += src.slice(i,e); i=e; continue; }
    out += c; i++;
  }
  return { protected: out, map };
}

/** Restore literals from placeholder map. */
function restoreLiterals(src, map) {
  let out = src;
  for (const [ph, lit] of Object.entries(map)) {
    out = out.split(ph).join(lit);
  }
  return out;
}

/** Mask import/export blocks to protect them during renaming. */
function maskImportExport(src) {
  const blocks = [];
  const re = /^(?:import|export)\b[^\n]*?;?\s*$/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  let out = src;
  blocks.sort((a,b) => b.start - a.start);
  const masks = {};
  for (let i = 0; i < blocks.length; i++) {
    const key = `/*__IMPEXP_${i}__*/`;
    masks[key] = blocks[i].text;
    out = out.slice(0, blocks[i].start) + key + out.slice(blocks[i].end);
  }
  return { masked: out, masks };
}

/** Restore import/export blocks. */
function unmaskImportExport(src, masks) {
  let out = src;
  for (const [key, val] of Object.entries(masks)) {
    out = out.split(key).join(val);
  }
  return out;
}

/** Check if an identifier node is a property key (should not be renamed). */
function isPropertyKeyNode(node, parent) {
  if (!parent) return false;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return true;
  if (parent.type === 'Property' && parent.key === node && !parent.computed) return true;
  if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return true;
  if (parent.type === 'ImportSpecifier' && parent.imported === node) return true;
  if (parent.type === 'ExportSpecifier' && parent.exported === node) return true;
  if (parent.type === 'LabeledStatement' && parent.label === node) return true;
  if (parent.type === 'BreakStatement' && parent.label === node) return true;
  if (parent.type === 'ContinueStatement' && parent.label === node) return true;
  return false;
}

/** Collect all identifiers in destructuring patterns. */
function collectPatternIds(node, cb) {
  if (!node) return;
  if (node.type === 'Identifier') { cb(node); return; }
  if (node.type === 'ObjectPattern') { for (const p of node.properties) collectPatternIds(p.value || p, cb); return; }
  if (node.type === 'ArrayPattern') { for (const e of node.elements) if (e) collectPatternIds(e, cb); return; }
  if (node.type === 'AssignmentPattern') { collectPatternIds(node.left, cb); return; }
  if (node.type === 'RestElement') { collectPatternIds(node.argument, cb); return; }
}

/** Usage categories for inferring parameter names. */
const USAGE_CATEGORIES = {
  event:   ['preventDefault','stopPropagation','target','pageX','pageY','keyCode','which','clientX','clientY','changedTouches'],
  el:      ['appendChild','removeChild','className','innerHTML','style','setAttribute','addEventListener','getBoundingClientRect','offsetWidth'],
  ctx:     ['beginPath','fillRect','strokeRect','moveTo','lineTo','arc','fill','stroke','fillStyle','strokeStyle','globalAlpha','save','restore','translate','rotate','scale','drawImage'],
  player:  ['x','y','dir','health','maxHealth','scale','alive','team','items','weapons','sid'],
  config:  ['mapScale','playerScale','playerSpeed','maxPlayers','maxAge','riverWidth'],
  delta:   ['delta','dt'],
  data:    ['data','json','result','response'],
};

/** Infer a parameter name from which properties it accesses. */
function inferNameFromProps(propSet) {
  let best = null, bestScore = 0;
  for (const [cat, props] of Object.entries(USAGE_CATEGORIES)) {
    const score = props.filter(p => propSet.has(p)).length;
    if (score >= 2 && score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

/** Detect if a binding is a for-loop counter. */
function detectLoopCounter(binding, usedNames) {
  const node = binding.idNode;
  if (!node || !binding.parentNode) return null;
  const parent = binding.parentNode;
  if (parent && parent.type === 'ForStatement' && parent.init) {
    for (const name of ['i','j','k','n','m','x','y','a','b']) {
      if (!usedNames.has(name)) return name;
    }
  }
  return null;
}

/** Generate suffix: _a, _b, ..., _z, _aa, _ab, ... */
function makeSuffix(n) {
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  if (n < 26) return '_' + alpha[n];
  return '_' + alpha[Math.floor(n/26)-1] + alpha[n%26];
}

/** Build scope tree from AST. */
function buildScopesForRenamer(ast) {
  const scopes = [];
  const globalScope = { id: 0, parent: null, children: [], bindings: new Map(),
                         type: 'global', node: ast };
  scopes.push(globalScope);
  let scopeId = 1;

  function makeScope(parent, type, node) {
    const s = { id: scopeId++, parent, children: [], bindings: new Map(), type, node };
    parent.children.push(s);
    scopes.push(s);
    return s;
  }

  function addBinding(scope, name, idNode, kind, parentNode, paramIndex) {
    if (!scope.bindings.has(name))
      scope.bindings.set(name, []);
    scope.bindings.get(name).push({ name, idNode, kind, scope, parentNode, paramIndex,
                                     propAccesses: new Set() });
  }

  function walk(node, scope, parent) {
    if (!node || typeof node !== 'object') return;
    node._astParent = parent;

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        if (node.type === 'FunctionDeclaration' && node.id) {
          addBinding(scope, node.id.name, node.id, 'function', node, -1);
        }
        const childScope = makeScope(scope, 'function', node);
        childScope.fnName = node.id ? node.id.name : null;
        let pi = 0;
        for (const p of (node.params || [])) {
          collectPatternIds(p, id => addBinding(childScope, id.name, id, 'param', node, pi));
          pi++;
        }
        if (node.body) walk(node.body, childScope, node);
        break;
      }
      case 'BlockStatement': {
        const bs = node._isScope ? makeScope(scope, 'block', node) : scope;
        for (const stmt of node.body) walk(stmt, bs, node);
        break;
      }
      case 'VariableDeclaration':
        for (const decl of node.declarations) {
          const kind = node.kind;
          const target = (kind === 'var') ? findVarScope(scope) : scope;
          collectPatternIds(decl.id, id => addBinding(target, id.name, id, kind, node, -1));
          if (decl.init) walk(decl.init, scope, node);
        }
        break;
      case 'ClassDeclaration':
        if (node.id) addBinding(scope, node.id.name, node.id, 'class', node, -1);
        if (node.body) walk(node.body, scope, node);
        break;
      case 'ImportDeclaration':
        for (const spec of node.specifiers) {
          addBinding(scope, spec.local.name, spec.local, 'import', node, -1);
        }
        break;
      case 'CatchClause':
        if (node.param) {
          const cs = makeScope(scope, 'block', node);
          collectPatternIds(node.param, id => addBinding(cs, id.name, id, 'catch', node, -1));
          walk(node.body, cs, node);
        }
        break;
      case 'MemberExpression':
        walk(node.object, scope, node);
        if (node.computed) walk(node.property, scope, node);
        // Track property accesses for inference
        if (!node.computed && node.property.type === 'Identifier') {
          const objName = node.object.type === 'Identifier' ? node.object.name : null;
          if (objName) {
            const b = resolveBinding(scope, objName);
            if (b) b.propAccesses.add(node.property.name);
          }
        }
        break;
      default: {
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === '_astParent') continue;
          const child = node[key];
          if (Array.isArray(child)) child.forEach(c => c && typeof c.type === 'string' && walk(c, scope, node));
          else if (child && typeof child.type === 'string') walk(child, scope, node);
        }
      }
    }
  }

  function findVarScope(s) {
    while (s.type === 'block') s = s.parent;
    return s;
  }
  function resolveBinding(scope, name) {
    let s = scope;
    while (s) {
      if (s.bindings.has(name)) return s.bindings.get(name)[0];
      s = s.parent;
    }
    return null;
  }

  walk(ast, globalScope, null);
  return { scopes, globalScope, resolveBinding };
}

/** Resolve all identifier references in the AST. */
function resolveReferencesForRenamer(ast, scopeInfo) {
  const refs = [];
  const { resolveBinding } = scopeInfo;

  function walk(node, scope, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Identifier' && !isPropertyKeyNode(node, parent)) {
      const binding = resolveBinding(scope, node.name);
      if (binding) refs.push({ node, binding, parent, scope });
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === '_astParent') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(c => c && typeof c.type === 'string' && walk(c, scope, parent));
      else if (child && typeof child.type === 'string') walk(child, scope, node);
    }
  }
  walk(ast, scopeInfo.globalScope, null);
  return refs;
}

/** Assign new names to all bindings, capture-aware. */
function assignNewNames(scopeInfo, globalMapping, paramMapping, refs, cfg) {
  const { scopes, globalScope } = scopeInfo;
  const localPrefix = cfg.localPrefix || 'tmp';

  // Build set of identifiers captured by each scope (referenced from inner scopes)
  function getCaptures(scope) {
    const captured = new Set();
    for (const ref of refs) {
      if (ref.binding.scope === scope && ref.scope !== scope) {
        // A binding in `scope` is referenced from a different scope
        let s = ref.scope;
        while (s && s !== scope) { captured.add(ref.binding); s = s.parent; }
      }
    }
    return captured;
  }

  function assignScope(scope, ancestorNames) {
    const used = new Set(ancestorNames);
    const captures = getCaptures(scope);

    // Add captured names from this scope to descendants' reserved set
    const childReserved = new Set(used);

    for (const [, bindingsArr] of scope.bindings) {
      for (const binding of bindingsArr) {
        const oldName = binding.name;
        let newName;

        if (scope.type === 'global') {
          newName = globalMapping[oldName] || oldName;
        } else if (binding.kind === 'import') {
          newName = globalMapping[oldName] || oldName;
        } else if (binding.kind === 'param') {
          const fnName = scope.fnName ? (globalMapping[scope.fnName] || scope.fnName) : null;
          const paramTable = paramMapping[fnName] || [];
          const suggested = paramTable[binding.paramIndex];
          if (suggested && !used.has(suggested) && !JS_RESERVED.has(suggested)) {
            newName = suggested;
          } else {
            // Infer from property accesses
            const inferred = inferNameFromProps(binding.propAccesses);
            if (inferred && !used.has(inferred) && !JS_RESERVED.has(inferred)) {
              newName = inferred;
            } else {
              // fallback: args0, args1 ...
              newName = 'arg' + binding.paramIndex;
            }
          }
        } else {
          // Local: detect loop counter first
          const loop = detectLoopCounter(binding, used);
          if (loop) {
            newName = loop;
          } else {
            // Keep name if it's already readable (length > 3, not in reserved)
            if (oldName.length > 3 && !JS_RESERVED.has(oldName) && !/^[a-z]$/.test(oldName) && !globalMapping[oldName]) {
              newName = oldName;
            } else {
              newName = globalMapping[oldName] || (localPrefix + (scope.bindings.size > 1 ? Array.from(scope.bindings.keys()).indexOf(oldName) : ''));
            }
          }
        }

        // Resolve collisions with suffix
        if (newName !== oldName && used.has(newName) && !JS_RESERVED.has(newName)) {
          let suffix = 0;
          while (used.has(newName + makeSuffix(suffix))) suffix++;
          newName = newName + makeSuffix(suffix);
        }

        binding.newName = newName;
        used.add(newName);
        if (captures.has(binding)) childReserved.add(newName);
      }
    }

    for (const child of scope.children) assignScope(child, childReserved);
  }

  assignScope(globalScope, new Set(JS_RESERVED));
}

/** Apply all renames to the source. */
function applyAllRenames(src, scopeInfo, refs, extraMapping) {
  const replacements = [];

  // Collect from bindings (declaration nodes)
  for (const scope of scopeInfo.scopes) {
    for (const [, bindingsArr] of scope.bindings) {
      for (const b of bindingsArr) {
        if (b.newName && b.newName !== b.name && b.idNode) {
          replacements.push({ start: b.idNode.start, end: b.idNode.end, name: b.newName });
        }
      }
    }
  }

  // Collect from references
  for (const ref of refs) {
    if (ref.binding.newName && ref.binding.newName !== ref.binding.name) {
      replacements.push({ start: ref.node.start, end: ref.node.end, name: ref.binding.newName });
    }
  }

  // Apply extra mapping for free identifiers
  if (extraMapping && CFG.renameFreeIdentifiers) {
    for (const [old, newName] of Object.entries(extraMapping)) {
      const re = new RegExp('(?<![.\'"`\\w$])' + escapeRe(old) + '(?![\'"`\\w$])', 'g');
      let m;
      while ((m = re.exec(src)) !== null) {
        replacements.push({ start: m.index, end: m.index + old.length, name: newName });
      }
    }
  }

  // Sort DESC by start to avoid offset drift
  replacements.sort((a, b) => b.start - a.start);
  let out = src;
  for (const r of replacements) {
    if (out.slice(r.start, r.end) === /* verify */ out.slice(r.start, r.end)) {
      out = out.slice(0, r.start) + r.name + out.slice(r.end);
    }
  }
  return out;
}

/** Log parse error with context. */
function logParseError(err, src) {
  const pos = err.pos || 0;
  const before = src.slice(Math.max(0, pos - 200), pos);
  const after  = src.slice(pos, pos + 200);
  warn(`Parse error at ${pos}: ${err.message}`);
  warn('Context before:', before.slice(-80));
  warn('Context after:', after.slice(0, 80));
}

/** Main AST rename pipeline. */
function applyRenamesAST(src, globalMapping, paramMapping, cfg) {
  if (!window.acorn) { warn('Acorn not available, skipping AST rename'); return src; }

  let parseTarget = src;
  let masks = {};

  try {
    const masked = maskImportExport(src);
    parseTarget = masked.masked;
    masks = masked.masks;
  } catch (_) {}

  let ast;
  try {
    ast = acorn.parse(parseTarget, {
      ecmaVersion: 2022,
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
  } catch (e) {
    if (cfg.verboseAcorn) logParseError(e, parseTarget);
    warn('applyRenamesAST: parse failed, skipping AST rename:', e.message);
    return src;
  }

  const scopeInfo = buildScopesForRenamer(ast);
  const refs = resolveReferencesForRenamer(ast, scopeInfo);
  assignNewNames(scopeInfo, globalMapping, paramMapping, refs, cfg);

  let renamed = applyAllRenames(parseTarget, scopeInfo, refs, null);
  renamed = unmaskImportExport(renamed, masks);

  // Count renames
  let count = 0;
  for (const s of scopeInfo.scopes)
    for (const [,b] of s.bindings)
      for (const binding of b)
        if (binding.newName && binding.newName !== binding.name) count++;
  log(`applyRenamesAST: ${count} bindings renamed`);

  return renamed;
}


// ══════════════════════════════════════════════════════════════
// SECTION 11 — SHADOW RESIDUE DETECTION
// ══════════════════════════════════════════════════════════════

/** Detect `const X = X` patterns left from bad shadow renames. */
function detectShadowResidues(src) {
  const re = /\b(?:const|let|var)\s+(\w+)\s*=\s*\1\b/g;
  let m, count = 0;
  while ((m = re.exec(src)) !== null && count < 5) {
    const ctx = src.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
    warn(`Shadow residue: "${m[0]}" at pos ${m.index} | ctx: ...${ctx}...`);
    count++;
  }
  if (count) warn(`detectShadowResidues: ${count} shadow(s) found`);
  return count;
}

// ══════════════════════════════════════════════════════════════
// SECTION 12 — FOLDING & TEXT TRANSFORMS
// ══════════════════════════════════════════════════════════════

/** Fold adjacent string concatenations: 'a' + 'b' → 'ab' */
function foldStringConcats(src) {
  if (!CFG.foldStringConcats) return src;
  let out = src;
  for (let pass = 0; pass < 10; pass++) {
    const prev = out;
    out = out.replace(/("(?:[^"\\]|\\.)*")\s*\+\s*("(?:[^"\\]|\\.)*")/g, (_, a, b) => {
      try { return JSON.stringify(JSON.parse(a) + JSON.parse(b)); } catch(_) { return _ ; }
    });
    out = out.replace(/('(?:[^'\\]|\\.)*')\s*\+\s*('(?:[^'\\]|\\.)*')/g, (_, a, b) => {
      try {
        const va = a.slice(1,-1).replace(/\\'/g,"'");
        const vb = b.slice(1,-1).replace(/\\'/g,"'");
        return JSON.stringify(va + vb);
      } catch(_) { return _; }
    });
    if (out === prev) break;
  }
  return out;
}

/** Fold constant arithmetic expressions. */
function foldConstants(src) {
  if (!CFG.foldConstants) return src;
  let out = src;
  // Fold -(N) → -N and (N) → N
  out = out.replace(/\(-(\d+)\)/g, (_, n) => '-' + n);
  out = out.replace(/\((\d+)\)/g,   (_, n) => n);
  // Fold integer arithmetic chains (up to 12 terms)
  const numRe = /(-?\d+)\s*([\+\-\*\/])\s*(-?\d+)(?:\s*([\+\-\*\/])\s*(-?\d+)){0,10}/g;
  for (let pass = 0; pass < 8; pass++) {
    const prev = out;
    out = out.replace(numRe, (match) => {
      try {
        const clean = match.replace(/\s+/g, '');
        if (!/^-?[\d\+\-\*\/]+$/.test(clean)) return match;
        const val = Function('"use strict"; return (' + clean + ')')();
        if (!Number.isInteger(val) || !Number.isFinite(val)) return match;
        return String(val);
      } catch(_) { return match; }
    });
    if (out === prev) break;
  }
  return out;
}

/** Convert obj["prop"] → obj.prop where prop is a valid identifier. */
function bracketToDot(src) {
  if (!CFG.bracketToDot) return src;
  let out = src;
  for (let pass = 0; pass < 5; pass++) {
    const prev = out;
    out = out.replace(/(\]|\)|\w)\["([A-Za-z_$][A-Za-z0-9_$]*)"\]/g, (_, pre, prop) => {
      if (JS_RESERVED.has(prop)) return _;
      return pre + '.' + prop;
    });
    if (out === prev) break;
  }
  return out;
}

/** Rename import aliases: `import { orig as alias }` → `import { orig as mapped }` */
function renameImportAliases(src, mapping) {
  if (!CFG.renameImports || !mapping) return src;
  return src.replace(/import\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])/g, (_, specifiers, from) => {
    const renamed = specifiers.replace(/\b(\w+)\s+as\s+(\w+)\b/g, (sp, orig, alias) => {
      const newAlias = mapping[alias];
      if (newAlias && !JS_RESERVED.has(newAlias)) return orig + ' as ' + newAlias;
      return sp;
    });
    return `import {${renamed}} from ${from}`;
  });
}

/** Sanity check: compare string/literal counts before and after. */
function sanityCheck(before, after) {
  const cntBefore = countStringLiterals(before);
  const cntAfter  = countStringLiterals(after);
  if (Math.abs(cntBefore - cntAfter) > cntBefore * 0.05) {
    warn(`sanityCheck: string count changed significantly: ${cntBefore} → ${cntAfter}`);
    return false;
  }
  return true;
}

/** Sanitize a rename mapping (remove empty, short, reserved values). */
function sanitizeMapping(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (!v || v.length < 2 || JS_RESERVED.has(v)) continue;
    out[k] = v;
  }
  return out;
}

/** Build a decorative header with metadata. */
function buildHeader(meta) {
  const line = '═'.repeat(70);
  const lines = [
    `// ${line}`,
    `// MooMoo Bundle — Deobfuscated`,
    `// Tool   : MooMoo Bundle Deobfuscator v1.0`,
    `// Source : ${meta.url || 'unknown'}`,
    `// Date   : ${new Date().toISOString()}`,
    `// Bytes  : ${meta.originalBytes || 0} → ${meta.finalBytes || 0}`,
    `// Decoders resolved    : ${meta.decodersResolved || 0}`,
    `// Call-sites replaced  : ${meta.callsReplaced || 0}`,
    `// Renames applied      : ${meta.renamedOccurrences || 0}`,
    `// Orphans stripped     : ${meta.orphansStripped || 0}`,
    `// Shadow residues      : ${meta.shadowsRemaining || 0}`,
    `// AST mode             : ${meta.astMode ? 'yes' : 'no'}`,
    `// Decoder fns removed  : ${meta.decoderFunctionsRemoved || 0}`,
    `// ${line}`,
    ``,
  ];
  return lines.join('\n');
}


// ══════════════════════════════════════════════════════════════
// SECTION 13 — STRIP RESOLVED DECODER DEFINITIONS
// ══════════════════════════════════════════════════════════════

/** Remove the actual function declarations of decoders after all calls replaced. */
function stripResolvedDecoderDefinitions(src, arrays, decoderNames) {
  if (!CFG.stripDeadCode) return { code: src, removedFunctions: 0, removedAliases: 0, skipped: 0 };

  const allNames = new Set([...arrays, ...decoderNames]);
  let skipped = 0, removedFunctions = 0, removedAliases = 0;

  // Verify no numeric calls remain
  for (const name of decoderNames) {
    const re = new RegExp('\\b' + escapeRe(name) + '\\s*\\(\\s*-?\\d', 'g');
    if (re.test(src)) {
      warn(`stripResolvedDecoderDefinitions: ${name} still has numeric calls — skipping removal`);
      skipped++;
    }
  }
  if (skipped > 0) return { code: src, removedFunctions: 0, removedAliases: 0, skipped };

  let out = src;
  const fns = findAllFunctions(out);

  // Sort DESC by start to avoid drift
  const toRemove = fns.filter(f => allNames.has(f.name)).sort((a,b) => b.start - a.start);
  for (const fn of toRemove) {
    const comment = `/* [deobf] ${fn.name} — decoded and removed */`;
    out = out.slice(0, fn.start) + comment + out.slice(fn.end);
    removedFunctions++;
  }

  // Remove alias declarations
  for (const name of allNames) {
    const re = new RegExp('(?:const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*' + escapeRe(name) + '\\s*;', 'g');
    out = out.replace(re, (m, alias) => {
      if (!allNames.has(alias)) { removedAliases++; return ''; }
      return m;
    });
  }

  log(`stripResolvedDecoderDefinitions: removed ${removedFunctions} fns, ${removedAliases} aliases`);
  return { code: out, removedFunctions, removedAliases, skipped };
}

// ══════════════════════════════════════════════════════════════
// SECTION 14 — BUNDLE DETECTION & FETCH
// ══════════════════════════════════════════════════════════════

/** Find the main bundle JS URL from the page's script tags. */
function findBundleUrl() {
  const re = /(\/?(?:assets\/)?index-[A-Za-z0-9_-]+\.js)(?:[?#]|$)/;
  for (const el of document.querySelectorAll('script[src],link[href]')) {
    const url = el.src || el.href;
    const m = re.exec(url);
    if (m) return url;
  }
  return null;
}

/** Fetch text from a URL. */
async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return r.text();
}

/** Download file in browser. */
function download(name, content) {
  const blob = new Blob([content], { type: 'text/javascript' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}


// ══════════════════════════════════════════════════════════════
// SECTION 15 — ORCHESTRATION
// ══════════════════════════════════════════════════════════════

/** Full deobfuscation pipeline. */
async function deobfuscate() {
  log('Starting deobfuscation pipeline…');

  // Merge user-supplied renames
  const globalMapping = sanitizeMapping(Object.assign(
    {}, DEFAULT_RENAMES, CFG.renames || {}, window.__MOO_RENAMES || {}
  ));
  const paramMapping = Object.assign(
    {}, PARAM_RENAMES, CFG.paramRenames || {}, window.__MOO_PARAMS || {}
  );

  const meta = {};

  // ── Step 1: Find + fetch ──────────────────────────────────────────────
  const url = findBundleUrl();
  if (!url) throw new Error('No bundle URL found. Ensure the page has fully loaded.');
  log('Bundle URL:', url);
  meta.url = url;

  const rawSrc = await fetchText(url);
  meta.originalBytes = rawSrc.length;
  log(`Fetched ${(rawSrc.length / 1024).toFixed(1)} KB`);

  // ── Step 2: Log state ────────────────────────────────────────────────
  log('Acorn available:', typeof acorn !== 'undefined');
  log('js_beautify available:', typeof js_beautify !== 'undefined');

  // ── Step 3: Initial beautify ─────────────────────────────────────────
  let code = rawSrc;
  if (typeof js_beautify !== 'undefined') {
    try {
      code = js_beautify(code, { indent_size: 2, preserve_newlines: true,
        max_preserve_newlines: 2, end_with_newline: true });
      log('Initial beautify done');
    } catch(e) { warn('Beautify failed:', e.message); }
  }

  // ── Step 4: ESM imports detection ────────────────────────────────────
  const esmRe = /^import\s+.+?\s+from\s+['"]([^'"]+)['"]/gm;
  const esmImports = []; let em;
  while ((em = esmRe.exec(code)) !== null) esmImports.push(em[1]);
  const bareImports = esmImports.filter(m => !m.startsWith('.') && !m.startsWith('/'));
  if (bareImports.length) warn(`Bare/virtual ESM imports (won't be resolvable): ${bareImports.join(', ')}`);
  meta.esmImports = esmImports.length;
  meta.unresolvedBareImports = bareImports;

  // ── Step 5: Resolve decoders + replace calls ─────────────────────────
  const { resolvers, arrays, rotations, decoderNames } = resolveDecoders(code);
  meta.decodersResolved = resolvers.length;
  log(`Resolved ${resolvers.length} decoders`);

  const beforeReplace = code;
  code = replaceCalls(code, resolvers);
  const callsReplaced = (beforeReplace.length - code.length > 0) ? 'some' : 'none';
  meta.callsReplaced = callsReplaced;

  // ── Step 6: Fold ─────────────────────────────────────────────────────
  code = foldStringConcats(code);
  code = foldConstants(code);
  log('String/constant folding done');

  // ── Step 7: Expand decoder family ────────────────────────────────────
  const family = expandDecoderFamily(code, decoderNames);
  meta.familySize = family.size;
  log(`Decoder family: ${family.size} names`);

  // ── Step 8: Strip artifacts ──────────────────────────────────────────
  code = stripDecoderArtifacts(code, resolvers, rotations);
  meta.arraysStripped  = arrays.length;
  meta.rotationsStripped = rotations.length;

  // ── Step 9: Bracket → dot ────────────────────────────────────────────
  code = bracketToDot(code);

  // ── Step 10: Rename import aliases (early) ───────────────────────────
  code = renameImportAliases(code, globalMapping);

  // ── Step 11: Strip resolved decoder definitions ───────────────────────
  const stripResult = stripResolvedDecoderDefinitions(code, arrays, decoderNames);
  code = stripResult.code;
  meta.decoderFunctionsRemoved = stripResult.removedFunctions;
  meta.decoderAliasesRemoved   = stripResult.removedAliases;
  meta.decoderCleanupSkipped   = stripResult.skipped;

  // ── Step 12: Simplify helper objects ─────────────────────────────────
  code = simplifyHelperObjects(code);

  // ── Step 13: Strip dead decoder locals ───────────────────────────────
  code = stripDeadDecoderLocals(code, [...family]);

  // ── Step 14: AST rename ───────────────────────────────────────────────
  const beforeRename = code;
  if (CFG.applyRenames) {
    if (CFG.useAST && typeof acorn !== 'undefined') {
      try {
        const renamed = applyRenamesAST(code, globalMapping, paramMapping, CFG);
        if (sanityCheck(code, renamed)) {
          code = renamed;
          log('AST rename applied');
          meta.astMode = true;
        } else {
          warn('sanityCheck failed after rename — rolling back');
          code = beforeRename;
          meta.astMode = false;
        }
      } catch(e) {
        warn('AST rename threw:', e.message);
        code = beforeRename;
        meta.astMode = false;
      }
    } else {
      log('Skipping AST rename (Acorn unavailable or useAST=false)');
      meta.astMode = false;
    }
    code = renameImportAliases(code, globalMapping);
  }

  meta.renamedOccurrences = 0; // would need counting pass

  // ── Step 15: Shadow residues ──────────────────────────────────────────
  if (CFG.detectShadowResidues) {
    meta.shadowsRemaining = detectShadowResidues(code);
  }

  // ── Step 16: Orphan stripping ─────────────────────────────────────────
  const beforeOrphanStrip = code;
  if (CFG.stripOrphans) {
    const before = countStringLiterals(code);
    log('Before orphan strip:', before, 'strings');
    code = stripOrphansText(code, family);
    code = stripDeadDecoderLocals(code, [...family]);
    code = simplifyHelperObjects(code);
    code = stripDeadHelperShells(code);
    const after = countStringLiterals(code);
    log('After orphan strip:', after, 'strings');
    meta.orphansStripped = before - after;
  } else {
    code = stripDeadDecoderLocals(code, [...family]);
    code = stripDeadHelperShells(code);
    meta.orphansStripped = 0;
  }

  // ── Step 17: Re-fold ─────────────────────────────────────────────────
  code = foldStringConcats(code);
  code = foldConstants(code);
  code = bracketToDot(code);

  // ── Step 18: Final beautify ───────────────────────────────────────────
  if (typeof js_beautify !== 'undefined') {
    try {
      code = js_beautify(code, { indent_size: 2, preserve_newlines: true,
        max_preserve_newlines: 2, end_with_newline: true });
      log('Final beautify done');
    } catch(e) { warn('Final beautify failed:', e.message); }
  }

  // ── Step 19: Validate final syntax ───────────────────────────────────
  if (CFG.validateFinalSyntax && typeof acorn !== 'undefined') {
    try {
      acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module',
        allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
      log('Final syntax validation: OK');
    } catch(e) {
      warn('Final syntax validation failed:', e.message, '— rolling back to pre-orphan-strip');
      try {
        code = js_beautify(beforeOrphanStrip, { indent_size: 2 });
        acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module',
          allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
        log('Rolled back successfully');
      } catch(e2) {
        warn('Rollback also failed:', e2.message, '— keeping anyway');
      }
    }
  }

  // ── Step 20: Report unresolved calls ──────────────────────────────────
  if (CFG.reportUnresolvedDecoderCalls) {
    const unresolvedRe = /\b(?:_e|decodeString|decodeStringAlias|se|Le)\s*\(\s*-?\d/g;
    const remaining = (code.match(unresolvedRe) || []).length;
    if (remaining > 0) warn(`Unresolved decoder calls remaining: ${remaining}`);
    else log('No unresolved decoder calls remaining ✓');
  }

  // ── Step 21: Header ───────────────────────────────────────────────────
  meta.finalBytes = code.length;
  if (CFG.addHeader) code = buildHeader(meta) + code;

  // ── Step 22: Download ────────────────────────────────────────────────
  const hashMatch = url.match(/index-([A-Za-z0-9_-]+)\.js/);
  const hash = hashMatch ? hashMatch[1] : 'bundle';
  const filename = `moomoo-index-${hash}.deobf.js.txt`;
  download(filename, code);
  log(`Downloaded: ${filename}`);

  // ── Step 23: Return stats ────────────────────────────────────────────
  const stats = {
    url, filename,
    originalBytes: meta.originalBytes,
    finalBytes: meta.finalBytes,
    decodersResolved: meta.decodersResolved,
    arraysStripped: meta.arraysStripped,
    rotationsStripped: meta.rotationsStripped,
    familySize: meta.familySize,
    renamedOccurrences: meta.renamedOccurrences,
    orphansStripped: meta.orphansStripped,
    shadowsRemaining: meta.shadowsRemaining || 0,
    astMode: meta.astMode,
    decoderFunctionsRemoved: meta.decoderFunctionsRemoved,
    decoderAliasesRemoved: meta.decoderAliasesRemoved,
    decoderCleanupSkipped: meta.decoderCleanupSkipped,
    esmImports: meta.esmImports,
    unresolvedBareImports: meta.unresolvedBareImports,
  };
  log('Stats:', stats);
  return stats;
}


// ══════════════════════════════════════════════════════════════
// SECTION 16 — UI BUTTON
// ══════════════════════════════════════════════════════════════

/** Inject a fixed trigger button into the page. */
function createButton() {
  if (document.getElementById('moomoo-deobf-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'moomoo-deobf-btn';
  btn.textContent = '🔬 Deobf';
  Object.assign(btn.style, {
    position:     'fixed',
    bottom:       '18px',
    right:        '18px',
    zIndex:       '2147483647',
    padding:      '8px 14px',
    background:   '#12121f',
    color:        '#7ec8e3',
    border:       '1px solid #7ec8e3',
    borderRadius: '6px',
    fontFamily:   'Consolas, monospace',
    fontSize:     '12px',
    cursor:       'pointer',
    opacity:      '0.4',
    transition:   'opacity 0.2s',
    userSelect:   'none',
  });
  btn.onmouseenter = () => btn.style.opacity = '1';
  btn.onmouseleave = () => { if (!btn.disabled) btn.style.opacity = '0.4'; };

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = '⏳ Working…';
    btn.style.opacity = '1';
    try {
      await deobfuscate();
      btn.textContent = '✓ Done!';
    } catch (e) {
      btn.textContent = '✗ Error';
      alert(PREFIX + ' Error: ' + e.message);
      console.error(PREFIX, e);
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '🔬 Deobf';
      btn.style.opacity = '0.4';
    }, 2500);
  };

  document.body.appendChild(btn);
}

// ══════════════════════════════════════════════════════════════
// SECTION 17 — EXPOSE GLOBALS & INIT
// ══════════════════════════════════════════════════════════════

window.mooDeobf       = deobfuscate;
window.mooDeobfCfg    = CFG;
window.mooDeobfParamRenames = PARAM_RENAMES;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createButton);
} else {
  createButton();
}

log('MooMoo Bundle Deobfuscator loaded. Click the button or call window.mooDeobf().');

})(); // end IIFE

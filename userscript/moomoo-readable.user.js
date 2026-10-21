// ==UserScript==
// @name         MooMoo Bundle Annotator
// @namespace    https://moomoo.io/readable-bundle
// @version      3.1
// @description  Télécharge une version lisible du bundle client : dé-minification AST, renommages, window.*, commentaires de repère.
// @author       Community reconstruction
// @license      MIT
// @match        https://mohmoh-js.onrender.com/*
// @match        https://moomoo.io/*
// @match        https://*.moomoo.io/*
// @match        https://sandbox.moomoo.io/*
// @require      https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

/*
  Reconstruction de l'état « lisible » du client, c'est-à-dire de la couche qui
  existait déjà avant l'ajout de fonctionnalités par-dessus le bundle.

  Le script travaille sur l'AST (Babel) et non sur du texte, donc :
    - les renommages respectent la portée des variables (aucune collision) ;
    - les séquences « a, b, c », « x && f() » et « c ? a : b » en position
      d'instruction sont rétablies en instructions normales ;
    - les commentaires sont posés sur des instructions précises.

  Phase 1  dé-minification        (séquences, if/else, !0 → true, var multiples…)
  Phase 2  renommages + ajouts    (fonctions, paramètres, locales, window.*)
  Phase 3  commentaires de repère (// UPDATE DIRECTION:, // RENDER GRID:, …)

  Le fichier téléchargé commence par un rapport : ce qui a été appliqué, et ce
  qui n'a pas été retrouvé (utile si le bundle change de version).
*/

(function () {
  "use strict";

  const TAG = "[MooMoo Bundle Annotator]";
  const log = (m) => console.log(`${TAG} ${m}`);
  const warn = (m) => console.warn(`${TAG} ${m}`);

  const OPTIONS = {
    baseMods: true,      // false = ne touche PAS au comportement (aucun window.*, maxPlayers, etc.) : renommages + commentaires seulement
    cleanLiterals: true, // !0 → true, void 0 → undefined, 1e3 → 1000, .5 → 0.5, -1 !== x → x !== -1
    splitVarLists: true, // « var a = 1, b = 2; » → deux déclarations
  };

  // ------------------------------------------------------------------
  // Outils Babel
  // ------------------------------------------------------------------
  let SOURCE_TYPE = "script"; // devient "module" pour les builds Vite (import/export)
  const P = Babel.packages;
  const t = P.types;
  const traverse = P.traverse.default || P.traverse;
  const generate = P.generator.default || P.generator;

  const parse = (code) => P.parser.parse(code, { sourceType: SOURCE_TYPE, allowReturnOutsideFunction: true });
  const print = (nodeOrAst) =>
    generate(nodeOrAst, {
      comments: true,
      compact: false,
      retainLines: false,
      jsescOption: { minimal: true, quotes: "double" },
    }).code;
  const snippet = (src) => parse(src).program.body;
  const code = (node) => print(node);

  const isWindowProp = (n, prop) =>
    t.isMemberExpression(n) && t.isIdentifier(n.object, { name: "window" }) && t.isIdentifier(n.property, { name: prop });

  // Rapport partagé entre les phases
  const report = { applied: [], missed: [] };
  const ok = (what) => report.applied.push(what);
  const miss = (what) => {
    report.missed.push(what);
    warn(`Introuvable : ${what}`);
  };

  // ------------------------------------------------------------------
  // Localiser / télécharger le bundle
  // ------------------------------------------------------------------
  function findBundleUrl() {
    const urls = [...document.querySelectorAll("script[src], link[rel=modulepreload][href]")]
      .map((el) => el.src || el.href)
      .filter(Boolean);
    // Build Vite : le code du jeu est dans assets/index-<hash>.js (vendor-<hash>.js = bibliothèques)
    return (
      urls.find((u) => /\/assets\/index-[\w-]+\.js/.test(u)) ||
      urls.find((u) => /index-[\w-]+\.js/.test(u)) ||
      urls.find((u) => /bundle\.js(\?|$)/i.test(u)) ||
      [location.origin + "/bundle.js"]
    );
  }

  async function fetchBundle(target) {
    const list = Array.isArray(target) ? target : [target];
    for (const url of list) {
      try {
        log(`Essai de ${url}`);
        const res = await fetch(url, { cache: "no-store", credentials: "omit" });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.length > 80000 && text.includes("maxScreenWidth")) {
          log(`Bundle valide (${(text.length / 1024).toFixed(1)} Ko)`);
          return { url, code: text };
        }
      } catch (_) {}
    }
    return null;
  }

  // ==================================================================
  // PHASE 1 — dé-minification (cosmétique, sans changement de sémantique)
  // ==================================================================
  const flatSeq = (e) => (t.isSequenceExpression(e) ? e.expressions.flatMap(flatSeq) : [e]);
  const exprStmt = (e) => t.expressionStatement(e);

  function replaceStmts(path, list) {
    if (path.inList) path.replaceWithMultiple(list);
    else path.replaceWith(list.length === 1 ? list[0] : t.blockStatement(list));
  }

  const EQ_FLIP = { "==": "!=", "!=": "==", "===": "!==", "!==": "===" };
  function negate(node) {
    if (t.isUnaryExpression(node, { operator: "!" })) return node.argument;
    if (t.isBinaryExpression(node) && EQ_FLIP[node.operator]) {
      return t.binaryExpression(EQ_FLIP[node.operator], node.left, node.right);
    }
    return t.unaryExpression("!", node);
  }

  function condToIf(c) {
    const cons = t.blockStatement([exprStmt(c.consequent)]);
    const alt = t.isConditionalExpression(c.alternate)
      ? condToIf(c.alternate)
      : t.blockStatement([exprStmt(c.alternate)]);
    return t.ifStatement(c.test, cons, alt);
  }

  const isLiteralish = (n) =>
    t.isNumericLiteral(n) ||
    t.isStringLiteral(n) ||
    t.isBooleanLiteral(n) ||
    t.isNullLiteral(n) ||
    t.isIdentifier(n, { name: "undefined" }) ||
    (t.isUnaryExpression(n, { operator: "-" }) && t.isNumericLiteral(n.argument));

  const FLIP_CMP = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "==": "==", "!=": "!=", "===": "===", "!==": "!==" };

  function unminifyPass(ast) {
    let changed = false;
    const mark = () => (changed = true);

    const ensureBlock = (path, key) => {
      const n = path.node[key];
      if (!n) return;
      if (t.isBlockStatement(n)) return;
      if (key === "alternate" && t.isIfStatement(n)) return;
      path.get(key).replaceWith(t.blockStatement(t.isEmptyStatement(n) ? [] : [n]));
      mark();
    };

    traverse(ast, {
      ExpressionStatement(path) {
        const e = path.node.expression;
        if (t.isSequenceExpression(e)) {
          mark();
          return replaceStmts(path, e.expressions.map(exprStmt));
        }
        if (t.isLogicalExpression(e) && (e.operator === "&&" || e.operator === "||")) {
          mark();
          const test = e.operator === "&&" ? e.left : negate(e.left);
          return replaceStmts(path, [t.ifStatement(test, t.blockStatement([exprStmt(e.right)]))]);
        }
        if (t.isConditionalExpression(e)) {
          mark();
          return replaceStmts(path, [condToIf(e)]);
        }
      },

      ReturnStatement(path) {
        const a = path.node.argument;
        if (a && t.isSequenceExpression(a)) {
          mark();
          const list = flatSeq(a);
          replaceStmts(path, [...list.slice(0, -1).map(exprStmt), t.returnStatement(list[list.length - 1])]);
        }
      },

      ThrowStatement(path) {
        const a = path.node.argument;
        if (t.isSequenceExpression(a)) {
          mark();
          const list = flatSeq(a);
          replaceStmts(path, [...list.slice(0, -1).map(exprStmt), t.throwStatement(list[list.length - 1])]);
        }
      },

      IfStatement: {
        enter(path) {
          if (t.isSequenceExpression(path.node.test)) {
            mark();
            const list = flatSeq(path.node.test);
            const rest = t.ifStatement(list[list.length - 1], path.node.consequent, path.node.alternate);
            return replaceStmts(path, [...list.slice(0, -1).map(exprStmt), rest]);
          }
          ensureBlock(path, "consequent");
          ensureBlock(path, "alternate");
        },
        exit(path) {
          const a = path.node.alternate;
          if (t.isBlockStatement(a) && a.body.length === 1 && t.isIfStatement(a.body[0])) {
            path.node.alternate = a.body[0]; // else { if … } → else if …
          }
        },
      },

      ForStatement(path) {
        ensureBlock(path, "body");

        // « a = 0; for (; a < n; ++a) »  →  « for (a = 0; a < n; ++a) »
        if (!path.node.init && path.inList && path.key > 0) {
          const prev = path.getSibling(path.key - 1);
          const e = prev.isExpressionStatement() ? prev.node.expression : null;
          const test = path.node.test;
          if (
            e &&
            t.isAssignmentExpression(e, { operator: "=" }) &&
            t.isIdentifier(e.left) &&
            t.isBinaryExpression(test) &&
            t.isIdentifier(test.left, { name: e.left.name })
          ) {
            path.node.init = e;
            prev.remove();
            mark();
            return;
          }
        }

        const init = path.node.init;
        if (init && !t.isVariableDeclaration(init) && t.isSequenceExpression(init)) {
          mark();
          const list = flatSeq(init);
          const last = list[list.length - 1];
          const keepLast = t.isAssignmentExpression(last);
          const pre = keepLast ? list.slice(0, -1) : list;
          const loop = t.forStatement(keepLast ? last : null, path.node.test, path.node.update, path.node.body);
          replaceStmts(path, [...pre.map(exprStmt), loop]);
        }
      },

      "WhileStatement|DoWhileStatement|ForInStatement|ForOfStatement"(path) {
        ensureBlock(path, "body");
      },

      VariableDeclaration(path) {
        if (!OPTIONS.splitVarLists) return;
        const n = path.node;
        if (n.declarations.length < 2 || !path.inList) return;
        mark();
        path.replaceWithMultiple(n.declarations.map((d) => t.variableDeclaration(n.kind, [d])));
      },

      UnaryExpression(path) {
        if (!OPTIONS.cleanLiterals) return;
        const { operator, argument } = path.node;
        if (operator === "!" && t.isNumericLiteral(argument) && (argument.value === 0 || argument.value === 1)) {
          path.replaceWith(t.booleanLiteral(argument.value === 0));
        } else if (operator === "void" && t.isNumericLiteral(argument, { value: 0 })) {
          path.replaceWith(t.identifier("undefined"));
        }
      },

      BinaryExpression(path) {
        if (!OPTIONS.cleanLiterals) return;
        const { left, right, operator } = path.node;
        if (FLIP_CMP[operator] && isLiteralish(left) && !isLiteralish(right)) {
          path.node.left = right;
          path.node.right = left;
          path.node.operator = FLIP_CMP[operator];
        }
      },

      NumericLiteral(path) {
        if (!OPTIONS.cleanLiterals) return;
        const raw = path.node.extra && path.node.extra.raw;
        if (!raw || /^0[xXbBoO]/.test(raw)) return;
        if (/e/i.test(raw) || raw.startsWith(".")) {
          const v = path.node.value;
          if (Number.isFinite(v) && Math.abs(v) < 1e15) {
            path.node.extra = { raw: String(v), rawValue: v };
          }
        }
      },
    });
    return changed;
  }

  function unminify(src) {
    log("Phase 1 : dé-minification (AST)…");
    const ast = parse(src);
    for (let round = 0; round < 25; round++) {
      if (!unminifyPass(ast)) break;
    }
    return print(ast);
  }

  // ==================================================================
  // PHASE 2 — renommages, expositions window.*, modifications de base
  //   Tout est retrouvé par la STRUCTURE du code (jamais par un nom minifié),
  //   car les noms changent à chaque build.
  // ==================================================================
  const within = (path, container) => !!path.findParent((p) => p.node === container.node);
  const keyName = (k) => (t.isIdentifier(k) ? k.name : t.isStringLiteral(k) ? k.value : null);
  const isProp = (n, name) => t.isMemberExpression(n) && !n.computed && t.isIdentifier(n.property, { name });

  // Rend un binding local à un bloc : var → const/let + renommage.
  // Si la variable sert aussi hors du bloc, « var ancienNom; » est conservé en tête
  // de fonction : la sémantique reste strictement identique.
  function localizeVar(blockPath, oldName, newName, label) {
    const binding = blockPath.scope.getBinding(oldName);
    if (!binding || binding.kind !== "var") return miss(`${label} (${oldName} → ${newName})`);
    const declPath = binding.path;
    if (!declPath.isVariableDeclarator() || !within(declPath, blockPath)) return miss(`${label} (déclaration hors bloc)`);
    const refs = binding.referencePaths;
    const viol = binding.constantViolations;
    const outside = [...refs, ...viol].filter((p) => !within(p, blockPath));

    for (const r of refs) if (within(r, blockPath)) r.node.name = newName;
    let reassigned = false;
    for (const v of viol) {
      if (!within(v, blockPath)) continue;
      reassigned = true;
      const target = v.isAssignmentExpression() ? v.node.left : v.isUpdateExpression() ? v.node.argument : null;
      if (target && t.isIdentifier(target, { name: oldName })) target.name = newName;
      else if (v.isVariableDeclarator() && t.isIdentifier(v.node.id)) v.node.id.name = newName;
    }
    declPath.node.id.name = newName;
    const declStmt = declPath.parentPath;
    if (declStmt.node.declarations.length === 1) declStmt.node.kind = reassigned ? "let" : "const";
    if (outside.length) {
      blockPath
        .getFunctionParent()
        .get("body")
        .unshiftContainer("body", t.variableDeclaration("var", [t.variableDeclarator(t.identifier(oldName))]));
    }
    ok(`${label} : ${oldName} → ${newName}`);
  }

  function renameBinding(scope, oldName, newName, label) {
    const b = scope.getBinding(oldName);
    if (!b) return miss(`${label || oldName} (binding absent)`);
    if (scope.hasBinding(newName)) return miss(`${label || oldName} (nom ${newName} déjà pris)`);
    b.scope.rename(oldName, newName);
    ok(`${label || "renommage"} : ${oldName} → ${newName}`);
  }

  function renameOwn(scope, oldName, newName, label) {
    if (!scope.hasOwnBinding(oldName)) return miss(`${label} (${oldName})`);
    if (scope.hasBinding(newName)) return miss(`${label} (nom ${newName} déjà pris)`);
    scope.rename(oldName, newName);
    ok(`${label} : ${oldName} → ${newName}`);
  }

  function first(ast, key, pred) {
    let found = null;
    traverse(ast, {
      [key](p) {
        if (!found && pred(p)) {
          found = p;
          p.stop();
        }
      },
    });
    return found;
  }

  // Fonctions déclarées au niveau du module, filtrées par arité + motif du code généré.
  function functionsMatching(ast, arity, re) {
    const hits = [];
    for (const n of ast.program.body) {
      if (!t.isFunctionDeclaration(n) || n.params.length !== arity || n.body.body.length > 60) continue;
      if (re.test(code(n))) hits.push(n);
    }
    return hits;
  }

  // names[i] = "wanted" or ["wanted", "fallback", …] — the first one that does not collide wins.
  function renameParams(fnNode, rootScope, names, label) {
    const p = fnNode._path;
    const olds = fnNode.params.map((x) => (t.isIdentifier(x) ? x.name : null));
    const used = [];
    names.forEach((neu, i) => {
      if (!neu || !olds[i]) return;
      const pick = (Array.isArray(neu) ? neu : [neu]).find((c) => !p.scope.hasOwnBinding(c) && !rootScope.hasBinding(c));
      if (!pick) return;
      p.scope.rename(olds[i], pick);
      used.push(pick);
    });
    ok(`${label}(${used.join(", ")})`);
  }

  function transformSemantics(src) {
    log("Phase 2 : renommages et modifications de base (détection structurelle)…");
    const ast = parse(src);
    let rootScope = null;
    const declPaths = new Map();
    traverse(ast, {
      Program(p) {
        rootScope = p.scope;
      },
      FunctionDeclaration(p) {
        if (p.parentPath.isProgram()) p.node._path = p; // accès direct aux fonctions de premier niveau
      },
    });

    // 0) Objet de configuration (celui qui porte maxScreenWidth + clientSendRate)
    const cfgObj = first(
      ast,
      "ObjectExpression",
      (p) => p.node.properties.some((k) => keyName(k.key) === "maxScreenWidth") && p.node.properties.some((k) => keyName(k.key) === "clientSendRate")
    );
    const cfgDecl = cfgObj && cfgObj.parentPath.isVariableDeclarator() ? cfgObj.parent.id.name : null;
    if (!cfgDecl) miss("objet de configuration (maxScreenWidth / clientSendRate)");

    // 1) maxScreenWidth / maxScreenHeight (constantes issues de la config) + dimensions dynamiques
    const constFor = (prop) =>
      first(
        ast,
        "VariableDeclarator",
        (p) => t.isIdentifier(p.node.id) && cfgDecl && t.isMemberExpression(p.node.init) && t.isIdentifier(p.node.init.object, { name: cfgDecl }) && isProp(p.node.init, prop)
      );
    const wDecl = constFor("maxScreenWidth");
    const hDecl = constFor("maxScreenHeight");
    const wOld = wDecl && wDecl.node.id.name;
    const hOld = hDecl && hDecl.node.id.name;
    if (wOld) renameBinding(rootScope, wOld, "maxScreenWidth");
    else miss("constante maxScreenWidth");
    if (hOld) renameBinding(rootScope, hOld, "maxScreenHeight");
    else miss("constante maxScreenHeight");

    // Dans ce build, la largeur/hauteur de rendu est dynamique (let X = maxScreenWidth, recalculée au resize).
    const dynFor = (initName) => first(ast, "VariableDeclarator", (p) => t.isIdentifier(p.node.id) && t.isIdentifier(p.node.init, { name: initName }));
    const dw = wOld && dynFor("maxScreenWidth");
    const dh = hOld && dynFor("maxScreenHeight");
    if (dw) renameBinding(rootScope, dw.node.id.name, "screenWidth", "largeur de rendu dynamique");
    else miss("largeur de rendu dynamique");
    if (dh) renameBinding(rootScope, dh.node.id.name, "screenHeight", "hauteur de rendu dynamique");
    else miss("hauteur de rendu dynamique");

    // 2) Fonctions
    const one = (list, label) => {
      if (list.length !== 1) {
        miss(`${label} (${list.length} candidats)`);
        return null;
      }
      return list[0];
    };
    const upd = one(functionsMatching(ast, 2, /^function \w+\(e, t\) \{\s*\w+ = \w+\(e\);\s*if \(\w+\) \{\s*\w+\.health = t;\s*\}\s*\}$/), "updateHealth");
    if (upd) {
      renameBinding(rootScope, upd.id.name, "updateHealth");
      renameParams(upd, rootScope, ["sid", "health"], "updateHealth");
    }
    const ups = one(functionsMatching(ast, 3, /forcePos = !\w+\.visible[\s\S]*\.zIndex = /), "updatePlayers");
    if (ups) {
      renameBinding(rootScope, ups.id.name, "updatePlayers");
      ups._tick = true;
    }
    const ios = one(functionsMatching(ast, 3, /return \w+ \+ \w+ >= 0 && \w+ - \w+ <= \w+ && \w+ \+ \w+ >= 0 && \w+ - \w+ <= \w+;/), "isOnScreen");
    if (ios) {
      renameBinding(rootScope, ios.id.name, "isOnScreen");
      renameParams(ios, rootScope, ["x", ["y", "posY"], "s"], "isOnScreen");
    }
    const gat = one(functionsMatching(ast, 4, /^function \w+\(e, t, n, o\) \{\s*\w+ = \w+\(e\);\s*if \(\w+\) \{\s*\w+\.startAnim\(t, n, o\);\s*\}\s*\}$/), "gatherAnimation");
    if (gat) renameBinding(rootScope, gat.id.name, "gatherAnimation");
    const wig = one(functionsMatching(ast, 2, /xWiggle \+= \w+\.gatherWiggle \* Math\.cos\(e\)/), "fonction gatherWiggle");
    if (wig) renameParams(wig, rootScope, ["angle", "sid"], wig.id.name);
    const dis = one(functionsMatching(ast, 1, /^function \w+\(e\) \{\s*\w+\.disableBySid\(e\);?\s*\}$/), "fonction disableBySid");
    if (dis) renameParams(dis, rootScope, ["sid"], dis.id.name);
    const prj = one(functionsMatching(ast, 8, /addProjectile\(/), "fonction addProjectile");
    if (prj) renameParams(prj, rootScope, ["x", ["y", "posY"], "dir", "range", "speed", "indx", "layer", "sid"], prj.id.name);

    // 3) Boucle de rendu (la fonction qui lit config.clientSendRate)
    const useRate = first(ast, "MemberExpression", (p) => isProp(p.node, "clientSendRate") && p.getFunctionParent());
    const loopFn = useRate ? useRate.getFunctionParent() : null;
    const ctx = {};
    if (!loopFn) miss("boucle de rendu (clientSendRate)");
    else {
      const rgo = stmtIn(loopFn, "ExpressionStatement", (p) => {
        const e = p.node.expression;
        return t.isCallExpression(e) && t.isIdentifier(e.callee) && e.arguments.length === 3 && t.isUnaryExpression(e.arguments[0], { operator: "-" }) && t.isNumericLiteral(e.arguments[0].argument, { value: 1 }) && t.isIdentifier(e.arguments[1]) && t.isIdentifier(e.arguments[2]);
      });
      if (rgo) renameBinding(rootScope, rgo.node.expression.callee.name, "renderGameObjects");
      else miss("renderGameObjects (appel avec -1)");
      renameLoopLocals(loopFn, ctx);
    }

    if (OPTIONS.baseMods) applyBaseMods(ast, loopFn, rootScope, ctx, dw, dh, ups);
    return print(ast);
  }

  function stmtIn(fnPath, key, pred) {
    let found = null;
    fnPath.traverse({
      [key](p) {
        if (!found && pred(p)) {
          found = p;
          p.stop();
        }
      },
    });
    return found;
  }

  function renameLoopLocals(loopFn, ctx) {
    // UPDATE DIRECTION : const f = ui()  →  const dir = ui()
    const dirIf = stmtIn(loopFn, "IfStatement", (p) => /clientSendRate/.test(code(p.node.test)));
    if (dirIf && t.isBlockStatement(dirIf.node.consequent)) {
      const body = dirIf.get("consequent");
      const decl = body.node.body.find((s) => t.isVariableDeclaration(s) && t.isCallExpression(s.declarations[0].init));
      if (decl) renameOwn(body.scope, decl.declarations[0].id.name, "dir", "direction");
      else miss("variable de direction");
    } else miss("bloc UPDATE DIRECTION");

    // MOVE CAMERA : distance / angle / fixSpeed (+ noms de la caméra et du joueur)
    const camIf = stmtIn(loopFn, "IfStatement", (p) => {
      const b = p.node.consequent;
      return t.isBlockStatement(b) && b.body[0] && /\.getDistance\(/.test(code(b.body[0]));
    });
    if (camIf) {
      const body = camIf.get("consequent");
      const call = body.node.body[0].declarations[0].init;
      const [cx, cy, own] = call.arguments;
      ctx.cameraX = cx && cx.name;
      ctx.cameraY = cy && cy.name;
      ctx.own = own && own.object && own.object.name;
      const names = body.node.body.slice(0, 3).map((s) => (t.isVariableDeclaration(s) ? s.declarations[0].id.name : null));
      ["distance", "angle", "fixSpeed"].forEach((n, i) => names[i] && renameOwn(body.scope, names[i], n, "caméra"));
    } else miss("bloc MOVE CAMERA");

    // MAP BOUNDARIES : tmpY / tmpX / tmpMin
    const yIf = stmtIn(loopFn, "IfStatement", (p) => {
      const b = p.node.consequent;
      return /^\w+\.mapScale - \w+ <= screenWidth$/.test(code(p.node.test)) && t.isBlockStatement(b) && b.body[0] && /= Math\.max\(0, -\w+\)/.test(code(b.body[0]));
    });
    if (yIf) {
      const body = yIf.get("consequent");
      localizeVar(body, body.node.body[0].declarations[0].id.name, "tmpY", "bordures");
    } else miss("bordure droite (tmpY)");

    const xIf = stmtIn(loopFn, "IfStatement", (p) => {
      const b = p.node.consequent;
      return /^\w+\.mapScale - \w+ <= screenHeight$/.test(code(p.node.test)) && t.isBlockStatement(b) && b.body[0] && /= Math\.max\(0, -\w+\)/.test(code(b.body[0]));
    });
    if (xIf) {
      const body = xIf.get("consequent");
      const [a, b] = body.node.body;
      localizeVar(body, a.declarations[0].id.name, "tmpX", "bordures");
      if (t.isVariableDeclaration(b)) renameOwn(body.scope, b.declarations[0].id.name, "tmpMin", "bordures");
    } else miss("bordure basse (tmpX / tmpMin)");

    // RENDER GRID : x / y
    const gridLoops = [];
    loopFn.traverse({
      ForStatement(p) {
        if (p.node.init && t.isVariableDeclaration(p.node.init) && p.node.test && /< screen(Width|Height)$/.test(code(p.node.test).replace(/^.*&& /, ""))) gridLoops.push(p);
      },
    });
    if (gridLoops.length >= 2) {
      const [lx, ly] = gridLoops;
      const xn = lx.node.init.declarations[0].id.name;
      const yn = ly.node.init.declarations[0].id.name;
      if (lx.node.init.kind === "var") localizeVar(lx, xn, "gridX", "grille");
      else renameOwn(lx.scope, xn, "gridX", "grille");
      if (ly.node.init.kind === "var") localizeVar(ly, yn, "gridY", "grille");
      else renameOwn(ly.scope, yn, "gridY", "grille");
    } else miss("boucles de la grille");
  }

  function applyBaseMods(ast, loopFn, rootScope, ctx, dw, dh, ups) {
    // maxPlayers 40 → 50 (ne change que l'affichage et la liste des serveurs)
    const mp = first(
      ast,
      "VariableDeclarator",
      (p) => t.isConditionalExpression(p.node.init) && /largeserver/.test(code(p.node.init.test)) && t.isNumericLiteral(p.node.init.alternate, { value: 40 })
    );
    if (mp) {
      mp.node.init.alternate = t.numericLiteral(50);
      ok("maxPlayers 40 → 50");
    } else miss("maxPlayers");

    // window.loadedScript → inSandbox, ticks, fps
    const ls = first(ast, "ExpressionStatement", (p) => t.isAssignmentExpression(p.node.expression) && isWindowProp(p.node.expression.left, "loadedScript"));
    if (ls) {
      ls.insertAfter(snippet("window.inSandbox = /sandbox\\./.test(location.href);\nwindow.ticks = 0;\nwindow.fps = 0;"));
      ok("window.inSandbox / window.ticks / window.fps");
    } else miss("window.loadedScript");

    // window._maxScreenWidth / _maxScreenHeight + promoImgHolder
    const setWin = (declPath, prop, valName, extra) => {
      if (!declPath) return false;
      declPath.getStatementParent().insertAfter(snippet(`window.${prop} = ${valName};` + (extra ? "\n" + extra : "")));
      const b = declPath.scope.getBinding(valName);
      if (b) {
        for (const v of b.constantViolations) {
          const s = v.getStatementParent();
          if (s && s.isExpressionStatement() && t.isAssignmentExpression(s.node.expression)) s.insertAfter(snippet(`window.${prop} = ${valName};`));
        }
      }
      return true;
    };
    const promo = 'if (document.getElementById("promoImgHolder")) {\n  document.getElementById("promoImgHolder").remove();\n}';
    const w1 = setWin(dw, "_maxScreenWidth", dw && dw.node.id.name);
    const h1 = setWin(dh, "_maxScreenHeight", dh && dh.node.id.name, promo);
    if (w1 && h1) ok("window._maxScreenWidth / _maxScreenHeight (init + resize), promoImgHolder retiré");
    else miss("window._maxScreen*");

    // Barre d'action : flex + centrée
    const bar = first(ast, "ExpressionStatement", (p) => {
      const e = p.node.expression;
      return (
        t.isCallExpression(e) &&
        t.isMemberExpression(e.callee) &&
        isProp(e.callee, "generateElement") &&
        t.isObjectExpression(e.arguments[0]) &&
        e.arguments[0].properties.some((pr) => t.isObjectProperty(pr) && t.isStringLiteral(pr.value, { value: "actionBarItem" }))
      );
    });
    if (bar) {
      const prop = bar.node.expression.arguments[0].properties.find((pr) => t.isObjectProperty(pr) && keyName(pr.key) === "parent");
      const bn = prop && t.isIdentifier(prop.value) ? prop.value.name : null;
      if (bn) {
        bar.insertAfter(snippet(`${bn}.style.display = "flex";\n${bn}.style.justifyContent = "center";`));
        ok("actionBar en flex centré");
      } else miss("actionBar (parent)");
    } else miss("actionBar (generateElement)");

    // fps / delta : « A = Date.now(); B = A - C; C = A; »
    let frameDone = false;
    traverse(ast, {
      ExpressionStatement(p) {
        if (frameDone || !p.inList) return;
        const m1 = /^(\w+) = Date\.now\(\);$/.exec(code(p.node));
        if (!m1) return;
        const s2 = p.getSibling(p.key + 1);
        const s3 = p.getSibling(p.key + 2);
        if (!s2.node || !s3.node) return;
        const m2 = new RegExp(`^(\\w+) = ${m1[1]} - (\\w+);$`).exec(code(s2.node));
        if (!m2 || code(s3.node) !== `${m2[2]} = ${m1[1]};`) return;
        frameDone = true;
        p.insertBefore(snippet(`window.fps += (1000 / Math.max(Date.now() - ${m2[2]}, 1) - window.fps) / 10;`));
        s3.insertAfter(snippet(`window.delta = ${m2[1]};`));
        ok("window.fps / window.delta");
        p.getFunctionParent().node._isFrameLoop = true;
      },
    });
    if (!frameDone) miss("fps / delta (Date.now() - dernière frame)");

    // xOffset / yOffset / cameraX / cameraY / ownPlayer
    if (loopFn && ctx.cameraX && ctx.own) {
      const first2 = stmtIn(loopFn, "VariableDeclaration", (p) => /^const \w+ = \w+ - screenWidth \/ 2;$/.test(code(p.node)));
      const second = first2 && first2.getSibling(first2.key + 1);
      if (first2 && second && /^const \w+ = \w+ - screenHeight \/ 2;$/.test(code(second.node))) {
        const dn = first2.node.declarations[0].id.name;
        const fn = second.node.declarations[0].id.name;
        second.insertAfter(
          snippet(`window.xOffset = ${dn};\nwindow.yOffset = ${fn};\nwindow.cameraX = ${ctx.cameraX};\nwindow.cameraY = ${ctx.cameraY};\nwindow.ownPlayer = ${ctx.own};`)
        );
        ok("window.xOffset / yOffset / cameraX / cameraY / ownPlayer");
      } else miss("coordonnées de rendu (X - screenWidth / 2)");
    } else miss("coordonnées de rendu (contexte caméra)");

    // window.ticks += 1 à chaque mise à jour des joueurs
    if (ups) {
      ups._path.get("body").pushContainer("body", snippet("window.ticks += 1;"));
      ok("window.ticks += 1 (updatePlayers)");
    } else miss("window.ticks (updatePlayers)");

    // Non reconstruit dans ce build : window.weaponsConfig / window.hatsConfig, ping limité
    miss("window.weaponsConfig / hatsConfig (données d'armes et de chapeaux déplacées dans ce build)");
  }

  // ==================================================================
  // PHASE 3 — commentaires de repère
  // ==================================================================
  const CTX = "\\w+";
  // [étiquette, motifs sur instructions consécutives]
  const LOOP_ANCHORS = [
    ["UPDATE DIRECTION:", [/^if \(\w+ && \(!\w+ \|\| \w+ - \w+ >= 1000 \/ \w+\.clientSendRate\)\) \{/]],
    ["DEATH TEXT:", [/^if \(\w+ < 120\) \{/]],
    ["MOVE CAMERA:", [/^if \(\w+\) \{\s*const \w+ = \w+\.getDistance\(/]],
    ["INTERPOLATE PLAYERS AND AI:", [/^(?:const|var|let) \w+ = 1000 \/ \w+\.serverUpdateRate;/]],
    ["RENDER CORDS:", [/^const \w+ = \w+ - screenWidth \/ 2;/, /^const \w+ = \w+ - screenHeight \/ 2;/]],
    ["RENDER BACKGROUND:", [/^if \(\w+\.snowBiomeTop - \w+ <= 0 && \w+\.mapScale - \w+\.snowBiomeTop - \w+ >= screenHeight\) \{/]],
    ["RENDER WATER AREAS:", [/^if \(!\w+\) \{[\s\S]{0,160}\.waveSpeed/]],
    ["RENDER GRID:", [/^\w+\.lineWidth = 4;/, /^\w+\.strokeStyle = "#000";/, /^\w+\.globalAlpha = 0\.06;/]],
    ["RENDER BOTTOM LAYER:", [/^\w+\.globalAlpha = 1;/, /^\w+\.strokeStyle = \w+;/]],
    ["RENDER PROJECTILES:", [/^\w+\.globalAlpha = 1;/, /^\w+\.lineWidth = \w+;/]],
    ["RENDER PLAYERS:", [/^\w+\(\w+, \w+, 0\);/]],
    ["RENDER AI:", [/^\w+\.globalAlpha = 1;/, /^for \((?:var |let )?\w+ = 0; \w+ < \w+\.length; \+\+\w+\)/]],
    ["RENDER GAME OBJECTS (LAYERED):", [/^renderGameObjects\(0, \w+, \w+\);/]],
    ["MAP BOUNDARIES:", [/^\w+\.fillStyle = "#000";/, /^\w+\.globalAlpha = 0\.09;/]],
    ["RENDER DAY/NIGHT TIME:", [/^\w+\.globalAlpha = 1;/, /^\w+\.fillStyle = "rgba\(0, 0, 70, 0\.35\)";/]],
    ["RENDER PLAYER AND AI UI:", [/^let \w+ = null;/, /^let \w+ = null;/, /^for \([^)]*< \w+\.length \+ \w+\.length;/]],
    ["NAME, HEALTH, TRACERS, ETC:", [/^const \w+ = \w+\.disguised \?/]],
    ["RENDER ANIM TEXTS:", [/^\w+\.update\(\w+, \w+, \w+, \w+\);/]],
    ["RENDER CHAT MESSAGES:", [/^for \([^)]*\) \{[\s\S]{0,70}chatCountdown > 0/]],
  ];
  const MINIMAP_ANCHORS = [
    ["RENDER MINIMAP:", [/^if \(\w+ && \w+\.alive\) \{\s*\w+\.clearRect\(/]],
    ["RENDER PINGS:", [/^\w+\.strokeStyle = "#fff";/, /^\w+\.lineWidth = 4;/]],
    ["RENDER PLAYERS:", [/^\w+\.globalAlpha = 1;/, /^\w+\.fillStyle = "#fff";/]],
    ["DEATH LOCATION:", [/^if \(\w+\) \{\s*(?:const \w+ = [^;]+;\s*)?\w+\.fillStyle = "#fc5553"/]],
    ["MAP MARKER:", [/^if \([^)]*\) \{\s*\w+\.fillStyle = "#fff";\s*\w+\.font = "34px/]],
  ];

  function runAnchors(scopePath, anchors, text) {
    const list = [];
    scopePath.traverse({
      Statement(p) {
        if (p.node.start != null && p.node.end != null) list.push(p);
      },
    });
    let cursor = 0;
    for (const [label, patterns] of anchors) {
      let hit = -1;
      for (let i = cursor; i < list.length && hit < 0; i++) {
        const p = list[i];
        if (!patterns[0].test(text(p.node))) continue;
        let good = true;
        if (patterns.length > 1) {
          const sibs = p.getAllNextSiblings();
          for (let k = 1; k < patterns.length; k++) {
            if (!sibs[k - 1] || sibs[k - 1].node.start == null || !patterns[k].test(text(sibs[k - 1].node))) {
              good = false;
              break;
            }
          }
        }
        if (good) hit = i;
      }
      if (hit < 0) {
        miss(`commentaire // ${label}`);
        continue;
      }
      list[hit].addComment("leading", ` ${label}`, true);
      ok(`// ${label}`);
      cursor = hit;
    }
  }

  function annotate(src) {
    log("Phase 3 : commentaires de repère…");
    const ast = parse(src);
    const text = (n) => src.slice(n.start, n.end);

    const useRate = first(ast, "MemberExpression", (p) => isProp(p.node, "clientSendRate") && p.getFunctionParent());
    const loopFn = useRate ? useRate.getFunctionParent() : null;
    if (loopFn) {
      t.addComment(loopFn.node, "leading", " ===== MAIN RENDER FUNCTION (one call per frame) ===== ", true);
      runAnchors(loopFn, LOOP_ANCHORS, text);
    } else miss("boucle de rendu pour les commentaires");

    const mapFn = first(ast, "IfStatement", (p) => p.node.start != null && MINIMAP_ANCHORS[0][1][0].test(text(p.node)));
    if (mapFn) runAnchors(mapFn.getFunctionParent(), MINIMAP_ANCHORS, text);
    else miss("fonction de la minimap");

    // fonction « frame » : Date.now() → requestAnimFrame
    const frame = first(ast, "FunctionDeclaration", (p) => p.node.start != null && /Date\.now\(\);[\s\S]{0,80}requestAnimFrame\(/.test(text(p.node)) && p.node.body.body.length < 12);
    if (frame) {
      t.addComment(frame.node, "leading", " ===== FRAME LOOP (time, delta, render, requestAnimFrame) ===== ", true);
      ok("repère FRAME LOOP");
    } else miss("repère FRAME LOOP");

    // // biomeID
    const biome = first(
      ast,
      "VariableDeclaration",
      (p) => p.node.start != null && /^(?:var|const|let) \w+ = \w+\.y >= \w+\.mapScale - \w+\.snowBiomeTop \? 2 : \w+\.y <= \w+\.snowBiomeTop \? 1 : 0;$/.test(text(p.node))
    );
    if (biome) {
      biome.addComment("trailing", " biomeID", true);
      ok("// biomeID");
    } else miss("commentaire // biomeID");

    // objet de configuration
    const cfg = first(
      ast,
      "ObjectExpression",
      (p) => p.node.properties.some((k) => keyName(k.key) === "maxScreenWidth") && p.node.properties.some((k) => keyName(k.key) === "clientSendRate")
    );
    if (cfg) {
      t.addComment(cfg.getStatementParent().node, "leading", " ===== CONFIG (shared game constants) ===== ", true);
      ok("repère CONFIG");
    } else miss("repère CONFIG");

    // Couche protocole : chaînes chiffrées → volontairement NON décodée
    const DECODER = /\b\w{1,3}\(\d{2,4}, "[^"]{4}"\)/g;
    const proto = ast.program.body.find((n) => n.start != null && (text(n).match(DECODER) || []).length >= 5);
    if (proto) {
      t.addComment(
        proto,
        "leading",
        " ===== PROTOCOL LAYER — its strings are encrypted. Left exactly as found on purpose: not decoded by this tool. ===== ",
        true
      );
      ok("repère PROTOCOL LAYER (non décodée)");
    }

    return print(ast);
  }

  // ------------------------------------------------------------------
  // En-tête + téléchargement
  // ------------------------------------------------------------------
  function addHeader(body, sourceUrl) {
    const lines = [
      "/*",
      " * ============================================================",
      " *  MooMoo — bundle lisible (annotator 3.1)",
      " * ============================================================",
      " *  Source : " + (sourceUrl || "inconnue"),
      " *  Date   : " + new Date().toISOString(),
      " *",
      ` *  Appliqué (${report.applied.length}) :`,
      ...report.applied.map((x) => " *    + " + x),
      ` *  Non retrouvé (${report.missed.length}) :`,
      ...(report.missed.length ? report.missed.map((x) => " *    - " + x) : [" *    (rien)"]),
      " * ============================================================",
      " */",
      "",
    ];
    return lines.join("\n") + body;
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ------------------------------------------------------------------
  // Main
  // ------------------------------------------------------------------
  (async () => {
    try {
      const result = await fetchBundle(findBundleUrl());
      if (!result) return warn("Bundle client introuvable.");

      // Build Vite = module ES (import/export) ; ancien webpack = script classique.
      SOURCE_TYPE = /^\s*import\s*[{*\w"']|\bexport\s*\{/m.test(result.code.slice(0, 4000)) ? "module" : "script";
      log(`Type de source : ${SOURCE_TYPE}`);

      let out = result.code;
      out = unminify(out);
      out = transformSemantics(out);
      out = annotate(out);
      out = addHeader(out, result.url);

      // Garde-fou : le résultat doit rester un JavaScript valide.
      try {
        parse(out);
      } catch (e) {
        warn("Le résultat final ne se parse pas : " + e.message);
      }

      const name = "MooMoo_Readable_" + Date.now() + ".txt";
      download(name, out);
      log(`Terminé → ${name} (${report.applied.length} appliqués, ${report.missed.length} manquants)`);
    } catch (err) {
      console.error(TAG, err);
    }
  })();
})();

/**
 * Parse one JS/TS source file with the TypeScript compiler API:
 * named functions/methods with line spans, a cyclomatic-complexity proxy
 * (1 + if/for/while/do/case/catch/&&/||/??/?:) and import specifiers
 * (require('x'), import ... from 'x', export ... from 'x', import('x')).
 */
import ts from 'typescript'

const DECISION_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
])
const DECISION_OPS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])

const isDecision = (node) =>
  DECISION_KINDS.has(node.kind) ||
  (ts.isBinaryExpression(node) && DECISION_OPS.has(node.operatorToken.kind))

const isFunctionLike = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)

const propName = (name, sf) => {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return name.getText(sf)
}

/** Name for a function-like node, or null when it is an anonymous callback. */
function nameOf (node, sf) {
  const cls = (n) => {
    const c = n.parent
    if (c && (ts.isClassDeclaration(c) || ts.isClassExpression(c))) {
      return c.name ? c.name.text : (ts.isVariableDeclaration(c.parent) && ts.isIdentifier(c.parent.name) ? c.parent.name.text : '(class)')
    }
    return null
  }
  if (ts.isFunctionDeclaration(node)) return node.name ? node.name.text : 'default'
  if (ts.isConstructorDeclaration(node)) return `${cls(node) || '(class)'}.constructor`
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const c = cls(node)
    const prefix = ts.isGetAccessorDeclaration(node) ? 'get ' : ts.isSetAccessorDeclaration(node) ? 'set ' : ''
    const n = propName(node.name, sf)
    return c ? `${c}.${prefix}${n}` : `${prefix}${n}`
  }
  // function expressions / arrows: name by what they are assigned to
  let p = node.parent
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p))) p = p.parent
  if (!p) return null
  if (ts.isVariableDeclaration(p) && p.initializer && ts.isIdentifier(p.name)) return p.name.text
  if (ts.isPropertyDeclaration(p) && p.initializer) {
    const c = cls(p)
    return c ? `${c}.${propName(p.name, sf)}` : propName(p.name, sf)
  }
  if (ts.isPropertyAssignment(p)) return propName(p.name, sf)
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right) {
    const t = p.left.getText(sf)
    if (t === 'module.exports' || t === 'exports.default') return 'module.exports'
    return t.replace(/^(module\.)?exports\./, '').replace(/^this\./, '')
  }
  if (ts.isExportAssignment(p)) return 'default'
  if (ts.isFunctionExpression(node) && node.name) return node.name.text
  return null
}

/** Count decision points inside `node`, not descending into nested named functions in `skip`. */
function countDecisions (node, skip) {
  let n = 0
  const visit = (c) => {
    if (skip.has(c)) return
    if (isDecision(c)) n++
    ts.forEachChild(c, visit)
  }
  ts.forEachChild(node, visit)
  return n
}

export function scriptKindFor (fileName) {
  if (/\.tsx$/.test(fileName)) return ts.ScriptKind.TSX
  if (/\.(c|m)?ts$/.test(fileName)) return ts.ScriptKind.TS
  if (/\.jsx$/.test(fileName)) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

/**
 * @returns {{lines:number, complexity:number, functions:{name:string,startLine:number,endLine:number,lines:number,complexity:number}[], imports:string[], docComment:string}}
 */
export function parseSource (text, fileName = 'file.js') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindFor(fileName))
  const srcLines = text.split('\n')
  const nonBlank = (a, b) => {
    let n = 0
    for (let i = a - 1; i < b && i < srcLines.length; i++) if (srcLines[i].trim()) n++
    return n
  }
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1

  // 1. collect named functions; a named function nested in another becomes part of the outer one,
  //    except class members (methods of a class inside a function still get their own floor).
  const named = []
  const visit = (node, insideNamed) => {
    let inside = insideNamed
    if (isFunctionLike(node)) {
      const name = nameOf(node, sf)
      const isMember = ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
      if (name && (!insideNamed || isMember) && node.body) {
        // span: include the declaring statement (e.g. `const diff = (...) => {`)
        let spanNode = node
        const p = node.parent
        if (ts.isVariableDeclaration(p) && p.parent && ts.isVariableDeclarationList(p.parent) && p.parent.declarations.length === 1 && ts.isVariableStatement(p.parent.parent)) spanNode = p.parent.parent
        else if (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) spanNode = p
        else if (ts.isBinaryExpression(p) && ts.isExpressionStatement(p.parent)) spanNode = p.parent
        named.push({ node, name, startLine: lineOf(spanNode.getStart(sf)), endLine: lineOf(spanNode.getEnd()) })
        inside = true
      }
    }
    ts.forEachChild(node, (c) => visit(c, inside))
  }
  visit(sf, false)

  const namedNodes = new Set(named.map((f) => f.node))
  const functions = named.map((f) => {
    const skip = new Set([...namedNodes].filter((n) => n !== f.node))
    return {
      name: f.name,
      startLine: f.startLine,
      endLine: f.endLine,
      lines: nonBlank(f.startLine, f.endLine),
      complexity: 1 + countDecisions(f.node, skip),
    }
  })
  // keep unique names (overloads / duplicate assignments)
  const seen = new Map()
  for (const f of functions) {
    const k = f.name
    if (seen.has(k)) { seen.set(k, seen.get(k) + 1); f.name = `${k}#${seen.get(k)}` } else seen.set(k, 1)
  }
  functions.sort((a, b) => a.startLine - b.startLine)

  // 2. module-level decisions (outside every named function)
  const moduleDecisions = countDecisions(sf, namedNodes)

  // 3. imports
  const imports = []
  const findImports = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0]) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      imports.push(node.arguments[0].text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      imports.push(node.moduleReference.expression.text)
    }
    ts.forEachChild(node, findImports)
  }
  findImports(sf)

  // 4. leading doc comment: the first block comment before one of the first statements
  //    that is not a licence header
  let docComment = ''
  const isImport = (st) => ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st) ||
    (ts.isVariableStatement(st) && /\brequire\(/.test(st.getText(sf)) && st.getText(sf).length < 200) ||
    (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) // 'use strict'
  outer: for (const st of sf.statements.slice(0, 40)) {
    for (const r of ts.getLeadingCommentRanges(text, st.getFullStart()) || []) {
      const c = text.slice(r.pos, r.end)
      if (!c.startsWith('/*') || /copyright|spdx-license|@license|eslint-|@ts-/i.test(c)) continue
      // a one-line comment glued to a declaration documents that declaration, not the file
      if (!isImport(st) && !c.includes('\n') && !/\n[ \t]*\n/.test(text.slice(r.end, st.getStart(sf)))) continue
      docComment = c.replace(/^\/\*+/, '').replace(/\*+\/$/, '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ')
      break outer
    }
    if (!isImport(st)) break
  }
  docComment = docComment.replace(/\s+/g, ' ').trim()

  const complexity = functions.reduce((s, f) => s + f.complexity, 0) + moduleDecisions + (functions.length ? 0 : 1)
  return { lines: nonBlank(1, srcLines.length), complexity, functions, imports: [...new Set(imports)], docComment }
}

/** Source excerpt: up to maxLines from startLine (not past endLine), dedented, each line ≤ maxCols. */
export function excerpt (text, startLine, endLine, maxLines = 16, maxCols = 60) {
  const lines = text.split('\n').slice(startLine - 1, Math.min(endLine, startLine - 1 + maxLines))
    .map((l) => l.replace(/\t/g, '  ').replace(/\s+$/, ''))
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop()
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length), Infinity)
  return lines.map((l) => (Number.isFinite(indent) ? l.slice(indent) : l))
    .map((l) => ([...l].length > maxCols ? [...l].slice(0, maxCols - 1).join('') + '…' : l))
    .join('\n')
}

/**
 * Excerpt for the failing function: like `excerpt`, but when the bug line would
 * fall outside the first maxLines, use a window that contains it (a few lines
 * of context above). Returns { code, codeStart } with codeStart only set when
 * the window does not begin at startLine.
 */
export function bugExcerpt (text, startLine, endLine, bugLine, maxLines = 16, maxCols = 60, above = 5) {
  if (bugLine < startLine + maxLines) return { code: excerpt(text, startLine, endLine, maxLines, maxCols) }
  let from = Math.max(startLine, bugLine - above)
  const to = Math.min(endLine, from + maxLines - 1)
  from = Math.max(startLine, Math.min(from, to - maxLines + 1))
  return { code: excerpt(text, from, to, maxLines, maxCols), codeStart: from }
}

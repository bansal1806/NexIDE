import { parse } from 'acorn';

/**
 * AST-based instrumentation for the time-travel debugger.
 *
 * Inserts, without adding any newlines (so line numbers are preserved):
 *  - `__record(line, {vars})` after simple statements / before control flow
 *  - `__enter(name, line); try { … } finally { __exit(); }` around function bodies
 *
 * Variable reads go through `__cap(() => x)` so that names still in their
 * temporal dead zone (or out of scope) are skipped instead of throwing.
 */

export const PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  allowHashBang: true,
  locations: true,
};

const MAX_CAPTURED_NAMES = 80;
const INTERNAL = /^__(record|cap|enter|exit|exitWith)$/;

const CONTROL_FLOW = new Set([
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement',
  'LabeledStatement', 'BlockStatement',
]);
const JUMPS = new Set(['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** Parse only — throws acorn SyntaxError with `(line:col)` in the message. */
export function checkSyntax(code) {
  parse(code, PARSE_OPTIONS);
}

function patternNames(pattern, out) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier': out.add(pattern.name); break;
    case 'ObjectPattern':
      pattern.properties.forEach(p => patternNames(p.type === 'RestElement' ? p.argument : p.value, out));
      break;
    case 'ArrayPattern': pattern.elements.forEach(el => patternNames(el, out)); break;
    case 'AssignmentPattern': patternNames(pattern.left, out); break;
    case 'RestElement': patternNames(pattern.argument, out); break;
  }
}

function childNodes(node) {
  const result = [];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'type' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach(v => { if (v && typeof v.type === 'string') result.push(v); });
    } else if (value && typeof value.type === 'string') {
      result.push(value);
    }
  }
  return result;
}

function keyName(key) {
  if (!key) return null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  if (key.type === 'PrivateIdentifier') return `#${key.name}`;
  return null;
}

export function instrumentJS(code) {
  const ast = parse(code, PARSE_OPTIONS);
  const inserts = [];   // { pos, seq, text?: string, record?: { line, scope } }
  let seq = 0;
  const addText = (pos, text) => inserts.push({ pos, seq: seq++, text });
  const addRecord = (pos, line, scope) => inserts.push({ pos, seq: seq++, record: { line, scope } });

  const newScope = (parent) => ({ names: new Set(), parent });

  function instrumentStatementList(list, scope) {
    for (const stmt of list) {
      if (stmt.type === 'FunctionDeclaration' || stmt.type === 'EmptyStatement') continue;
      const line = stmt.loc.start.line;
      if (JUMPS.has(stmt.type) || CONTROL_FLOW.has(stmt.type)) {
        addRecord(stmt.start, line, scope);
      } else {
        addRecord(stmt.end, line, scope);
      }
    }
  }

  function visitFunction(fn, parentScope, nameHint) {
    const scope = newScope(parentScope);
    fn.params.forEach(p => patternNames(p, scope.names));
    const name = fn.id?.name || nameHint || '(anonymous)';
    const line = fn.loc.start.line;
    const nameLit = JSON.stringify(name);

    if (fn.body.type === 'BlockStatement') {
      addText(fn.body.start + 1, `__enter(${nameLit},${line});try{`);
      visit(fn.body, scope, { isFunctionBody: true });
      addText(fn.body.end - 1, `}finally{__exit();}`);
    } else {
      // Expression-bodied arrow: (__enter(...), __exitWith(expr))
      addText(fn.body.start, `(__enter(${nameLit},${line}),__exitWith(`);
      visit(fn.body, scope);
      addText(fn.body.end, `))`);
    }
  }

  function visit(node, scope, opts = {}) {
    if (FUNCTIONS.has(node.type)) {
      visitFunction(node, scope, opts.nameHint);
      return;
    }

    switch (node.type) {
      case 'Program':
        instrumentStatementList(node.body, scope);
        break;
      case 'BlockStatement':
      case 'StaticBlock':
        instrumentStatementList(node.body, scope);
        break;
      case 'SwitchCase':
        instrumentStatementList(node.consequent, scope);
        break;
      case 'VariableDeclaration':
        node.declarations.forEach(d => patternNames(d.id, scope.names));
        break;
      case 'CatchClause':
        patternNames(node.param, scope.names);
        break;
      case 'AssignmentExpression':
        if (node.left.type === 'Identifier') scope.names.add(node.left.name);
        break;
    }

    // Visit children, passing function-name hints where we can infer them
    for (const child of childNodes(node)) {
      let nameHint;
      if (FUNCTIONS.has(child.type)) {
        if (node.type === 'VariableDeclarator' && node.init === child) nameHint = keyName(node.id);
        else if ((node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && node.value === child) nameHint = keyName(node.key);
        else if (node.type === 'AssignmentExpression' && node.right === child) {
          nameHint = node.left.type === 'Identifier' ? node.left.name
            : node.left.type === 'MemberExpression' ? keyName(node.left.property) : null;
        }
      }
      visit(child, scope, { nameHint });
    }
  }

  const root = newScope(null);
  visit(ast, root);

  function captureExpr(scope) {
    const names = new Set();
    for (let s = scope; s; s = s.parent) s.names.forEach(n => names.add(n));
    const list = Array.from(names).filter(n => !INTERNAL.test(n)).slice(0, MAX_CAPTURED_NAMES);
    if (list.length === 0) return '{}';
    return `{${list.map(n => `${JSON.stringify(n)}:__cap(()=>${n})`).join(',')}}`;
  }

  inserts.sort((a, b) => a.pos - b.pos || a.seq - b.seq);

  let out = '';
  let last = 0;
  for (const ins of inserts) {
    out += code.slice(last, ins.pos);
    out += ins.record
      ? `;__record(${ins.record.line},${captureExpr(ins.record.scope)});`
      : ins.text;
    last = ins.pos;
  }
  out += code.slice(last);
  return out;
}

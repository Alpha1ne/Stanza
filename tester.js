'use strict';

/*
  tester.js — the Test button's brain.

  Stanza has no server, so it cannot run Ansible, Terraform or Jenkins for real.
  Instead this file does two honest things with the files a generator made:

    1. CHECKS: reads each file and looks for mistakes (bad YAML, unbalanced
       braces, a variable nobody declared, a risky setting).
    2. DRY RUN: walks through the files and shows, step by step, what the real
       tool would do. It is a simulation. Nothing is executed or sent anywhere.

  Tester.test(files) takes [{ path, lines: [{ t }] }] and returns
    { checks: [{ file, level: 'pass'|'warn'|'error'|'info', name, detail, line }],
      runs:   [{ title, note, lines: [{ t, cls }] }],
      counts: { pass, warn, error, info } }
*/

const Tester = (() => {
  /* ---------------------------------------------------------------- *
   *  A small YAML reader (the block style that Stanza writes)
   * ---------------------------------------------------------------- */

  const L = '__line';
  const withLine = (v, n) => {
    if (v && typeof v === 'object') Object.defineProperty(v, L, { value: n, enumerable: false, configurable: true });
    return v;
  };
  const lineOf = (v) => (v && typeof v === 'object' && v[L]) || 0;

  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '\\' && q === '"') i++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'") {
        if (i === 0 || /[\s:\[{,-]/.test(s[i - 1])) q = c;
      } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
        return s.slice(0, i);
      }
    }
    return s;
  }

  // Split "key: rest" at the first colon that is outside quotes, brackets and {{ }}.
  function splitKey(s) {
    let q = null;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '\\' && q === '"') i++;
        else if (c === q) q = null;
        continue;
      }
      if ((c === '"' || c === "'") && i === 0) {
        q = c;
        continue;
      }
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ':' && depth <= 0 && (i === s.length - 1 || s[i + 1] === ' ')) {
        let key = s.slice(0, i).trim();
        if (!key) return null;
        if ((key[0] === '"' && key.endsWith('"')) || (key[0] === "'" && key.endsWith("'"))) key = key.slice(1, -1);
        return [key, s.slice(i + 1).trim()];
      }
    }
    return null;
  }

  function splitFlat(s) {
    const out = [];
    let depth = 0;
    let q = null;
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        cur += c;
        if (c === '\\' && q === '"') cur += s[++i] || '';
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") q = c;
      if (c === '[' || c === '{') depth++;
      if (c === ']' || c === '}') depth--;
      if (c === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function scalar(raw, n, errors) {
    const s = raw.trim();
    if (s === '') return null;
    if (s[0] === '"') {
      if (!/^"(?:[^"\\]|\\.)*"$/.test(s)) errors.push({ line: n, msg: 'A double quote is opened but not closed correctly.' });
      return s.slice(1, -1);
    }
    if (s[0] === "'") {
      if (!/^'(?:[^']|'')*'$/.test(s)) errors.push({ line: n, msg: 'A single quote is opened but not closed correctly.' });
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s[0] === '[') {
      if (!s.endsWith(']')) {
        errors.push({ line: n, msg: 'A [ list is not closed with ].' });
        return [];
      }
      return withLine(splitFlat(s.slice(1, -1)).map((x) => scalar(x, n, errors)), n);
    }
    if (s[0] === '{' && !s.startsWith('{{')) {
      if (!s.endsWith('}')) {
        errors.push({ line: n, msg: 'A { map is not closed with }.' });
        return {};
      }
      const o = {};
      for (const part of splitFlat(s.slice(1, -1))) {
        const kv = splitKey(part);
        if (kv) o[kv[0]] = scalar(kv[1], n, errors);
      }
      return withLine(o, n);
    }
    if (s === 'true' || s === 'false') return s === 'true';
    if (s === 'null' || s === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }

  function parseYaml(text) {
    const errors = [];
    const raw = text.split('\n');
    const toks = [];
    for (let i = 0; i < raw.length; i++) {
      const line = raw[i].replace(/\r$/, '');
      if (/^ *\t/.test(line)) errors.push({ line: i + 1, msg: 'A tab is used for indentation. YAML allows spaces only.' });
      const body = stripComment(line);
      if (!body.trim() || body.trim() === '---' || body.trim() === '...') continue;
      const indent = body.match(/^ */)[0].length;
      const tok = { indent, s: body.trim(), n: i + 1 };
      // A block scalar (| or >) swallows the more-indented lines that follow it.
      if (/(^|:\s|-\s)[|>][+-]?$/.test(tok.s)) {
        const parts = [];
        let j = i + 1;
        while (j < raw.length && (raw[j].trim() === '' || raw[j].match(/^ */)[0].length > indent)) {
          parts.push(raw[j].trim());
          j++;
        }
        tok.block = parts.join('\n').trim();
        tok.s = tok.s.replace(/[|>][+-]?$/, '').trimEnd();
        if (tok.s.endsWith(':')) tok.s += ' ';
        i = j - 1;
      }
      toks.push(tok);
    }

    let pos = 0;

    function parseBlock(indent) {
      const t = toks[pos];
      if (!t) return null;
      if (t.s === '-' || t.s.startsWith('- ')) return parseList(t.indent);
      if (splitKey(t.s)) return parseMap(t.indent);
      pos++;
      return scalar(t.s, t.n, errors);
    }

    function parseMap(indent) {
      const obj = withLine({}, toks[pos].n);
      while (pos < toks.length) {
        const t = toks[pos];
        if (t.indent < indent) break;
        if (t.indent > indent) {
          errors.push({ line: t.n, msg: 'This line is indented more than the lines around it.' });
          pos++;
          continue;
        }
        if (t.s === '-' || t.s.startsWith('- ')) break;
        const kv = splitKey(t.s);
        if (!kv) {
          errors.push({ line: t.n, msg: 'Expected "name: value" here but found no colon.' });
          pos++;
          continue;
        }
        const [key, rest] = kv;
        if (Object.prototype.hasOwnProperty.call(obj, key)) errors.push({ line: t.n, msg: `The key "${key}" appears twice in the same map.` });
        pos++;
        let value;
        if (t.block !== undefined && rest === '') {
          value = t.block;
        } else if (rest === '') {
          const nx = toks[pos];
          if (nx && nx.indent > indent) value = parseBlock(nx.indent);
          else if (nx && nx.indent === indent && (nx.s === '-' || nx.s.startsWith('- '))) value = parseList(indent);
          else value = null;
        } else {
          value = scalar(rest, t.n, errors);
        }
        obj[key] = value;
        if (value && typeof value === 'object' && !lineOf(value)) withLine(value, t.n);
        Object.defineProperty(obj, '__lines', { value: Object.assign(obj.__lines || {}, { [key]: t.n }), enumerable: false, configurable: true });
      }
      return obj;
    }

    function parseList(indent) {
      const arr = withLine([], toks[pos].n);
      while (pos < toks.length) {
        const t = toks[pos];
        if (t.indent < indent) break;
        if (t.indent > indent) {
          errors.push({ line: t.n, msg: 'This line is indented more than the lines around it.' });
          pos++;
          continue;
        }
        if (!(t.s === '-' || t.s.startsWith('- '))) break;
        const content = t.s === '-' ? '' : t.s.slice(2).trimStart();
        if (content === '') {
          pos++;
          const nx = toks[pos];
          arr.push(nx && nx.indent > indent ? parseBlock(nx.indent) : null);
        } else if (splitKey(content)) {
          // "- key: value": the rest of this item's keys line up with "key".
          const offset = t.s.length - content.length;
          toks[pos] = { indent: indent + offset, s: content, n: t.n, block: t.block };
          arr.push(parseMap(indent + offset));
        } else {
          pos++;
          arr.push(scalar(content, t.n, errors));
        }
      }
      return arr;
    }

    let value = null;
    if (toks.length) {
      value = parseBlock(toks[0].indent);
      while (pos < toks.length) {
        errors.push({ line: toks[pos].n, msg: 'This line does not fit the structure above it. Check its indentation.' });
        pos++;
      }
    }
    return { value, errors };
  }

  /* ---------------------------------------------------------------- *
   *  Helpers shared by the checkers
   * ---------------------------------------------------------------- */

  const textOf = (f) => f.lines.map((l) => l.t).join('\n');
  const isArr = Array.isArray;
  const isObj = (v) => v && typeof v === 'object' && !isArr(v);
  const base = (p) => p.split('/').pop();

  const SECRET_NAME = /(pass(word)?|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
  const PLACEHOLDER = /^(\$\{.*\}|\{\{.*\}\}|\$\w+|.*change-me.*|.*your-.*|.*paste-.*|)$/i;

  /* ---------------------------------------------------------------- *
   *  Ansible: playbooks, roles, inventory, config, ad-hoc
   * ---------------------------------------------------------------- */

  const TASK_KEYWORDS = new Set([
    'name', 'become', 'become_user', 'become_method', 'when', 'loop', 'with_items', 'with_dict', 'with_fileglob', 'register',
    'notify', 'tags', 'vars', 'ignore_errors', 'ignore_unreachable', 'changed_when', 'failed_when', 'delegate_to', 'args',
    'environment', 'no_log', 'until', 'retries', 'delay', 'block', 'rescue', 'always', 'check_mode', 'diff', 'run_once',
    'listen', 'loop_control', 'throttle', 'async', 'poll', 'connection', 'any_errors_fatal', 'delegate_facts',
    'module_defaults', 'collections', 'local_action', 'action', 'timeout', 'remote_user', 'port', 'vars_files', 'debugger',
  ]);

  const ANSIBLE_MODULES = (() => {
    const set = new Set();
    try {
      const groups = typeof MODULE_GROUPS !== 'undefined' ? MODULE_GROUPS : require('./modules.js').MODULE_GROUPS;
      for (const g of groups) for (const c of g.commands) for (const m of c.cmd.match(/\bansible\.[a-z]+\.[a-z_]+/g) || []) set.add(m);
    } catch (e) {
      /* the list is optional */
    }
    return set;
  })();

  // In check mode these modules only look, so they report "ok" instead of "changed".
  const READ_ONLY = new Set(['ping', 'debug', 'setup', 'stat', 'assert', 'fail', 'meta', 'wait_for', 'find', 'slurp', 'uri', 'service_facts', 'package_facts', 'gather_facts', 'set_fact', 'include_vars', 'getent']);

  function moduleOf(task) {
    if (task.local_action) return 'local_action';
    for (const k of Object.keys(task)) if (!TASK_KEYWORDS.has(k)) return k;
    return null;
  }

  function parseIni(text) {
    const sections = [];
    let cur = { name: null, items: [], line: 0 };
    sections.push(cur);
    text.split('\n').forEach((raw, i) => {
      const s = raw.replace(/\r$/, '').trim();
      if (!s || s[0] === '#' || s[0] === ';') return;
      const m = s.match(/^\[([^\]]+)\]$/);
      if (m) {
        cur = { name: m[1], items: [], line: i + 1 };
        sections.push(cur);
      } else cur.items.push({ s, n: i + 1 });
    });
    return sections;
  }

  function inventoryOf(files) {
    const f = files.find((x) => base(x.path) === 'inventory.ini');
    if (!f) return null;
    const groups = {};
    const kids = {};
    for (const sec of parseIni(textOf(f))) {
      if (!sec.name) continue;
      const mc = sec.name.match(/^(.+):children$/);
      if (mc) kids[mc[1]] = sec.items.map((i) => i.s);
      else if (/:vars$/.test(sec.name)) continue;
      else groups[sec.name] = sec.items.map((i) => i.s.split(/\s+/)[0]);
    }
    const hostsOf = (g, seen = new Set()) => {
      if (g === 'all') return [...new Set(Object.values(groups).flat())];
      if (seen.has(g)) return [];
      seen.add(g);
      return [...(groups[g] || []), ...(kids[g] || []).flatMap((k) => hostsOf(k, seen))];
    };
    return { groups, kids, hostsOf };
  }

  function checkInventory(file, out) {
    const text = textOf(file);
    const secs = parseIni(text);
    const names = new Set(secs.filter((s) => s.name).map((s) => s.name));
    const groupNames = new Set([...names].filter((n) => !/:(children|vars)$/.test(n)));
    let hostCount = 0;
    const seenHosts = new Map();
    let bad = null;
    for (const sec of secs) {
      if (!sec.name) {
        if (sec.items.length && !bad) bad = { n: sec.items[0].n, d: 'This line is above every [group]. Put hosts under a [group] heading.' };
        continue;
      }
      if (/:vars$/.test(sec.name)) {
        for (const i of sec.items) if (!/^[A-Za-z_][\w]*\s*=/.test(i.s) && !bad) bad = { n: i.n, d: 'Variables must look like name=value.' };
        continue;
      }
      if (/:children$/.test(sec.name)) {
        for (const i of sec.items) {
          if (!groupNames.has(i.s)) out.push({ file: file.path, level: 'error', name: 'Group exists', detail: `[${sec.name}] lists "${i.s}", but there is no [${i.s}] group.`, line: i.n });
        }
        continue;
      }
      for (const i of sec.items) {
        hostCount++;
        const host = i.s.split(/\s+/)[0];
        if (seenHosts.has(host)) out.push({ file: file.path, level: 'warn', name: 'Unique hosts', detail: `${host} is listed in two groups. That is allowed, but check it is on purpose.`, line: i.n });
        seenHosts.set(host, i.n);
        for (const kv of i.s.split(/\s+/).slice(1)) if (!/^[A-Za-z_]\w*=/.test(kv) && !bad) bad = { n: i.n, d: `"${kv}" is not name=value.` };
      }
    }
    out.push(bad ? { file: file.path, level: 'error', name: 'Inventory syntax', detail: bad.d, line: bad.n } : { file: file.path, level: 'pass', name: 'Inventory syntax', detail: `${groupNames.size} group(s), ${hostCount} host line(s) read correctly.` });
    if (/ansible_(ssh_)?pass(word)?\s*=\s*[^\s{]/.test(text)) out.push({ file: file.path, level: 'warn', name: 'No passwords in the inventory', detail: 'A password is written in plain text. Use SSH keys, or Ansible Vault.' });
    else out.push({ file: file.path, level: 'pass', name: 'No passwords in the inventory', detail: 'Logins use keys, not written passwords.' });
  }

  function checkAnsibleCfg(file, out) {
    const secs = parseIni(textOf(file));
    const def = secs.find((s) => s.name === 'defaults');
    out.push(def ? { file: file.path, level: 'pass', name: '[defaults] section', detail: 'Found.' } : { file: file.path, level: 'warn', name: '[defaults] section', detail: 'Most settings belong under [defaults].' });
    const bad = secs.flatMap((s) => s.items).find((i) => !/^[A-Za-z_]\w*\s*=/.test(i.s));
    out.push(bad ? { file: file.path, level: 'error', name: 'Setting syntax', detail: `"${bad.s}" is not name = value.`, line: bad.n } : { file: file.path, level: 'pass', name: 'Setting syntax', detail: 'Every line is name = value.' });
    const hk = secs.flatMap((s) => s.items).find((i) => /^host_key_checking\s*=\s*false/i.test(i.s));
    if (hk) out.push({ file: file.path, level: 'warn', name: 'Host key checking', detail: 'Turned off. Fine in a lab, but it hides a man-in-the-middle attack. Leave it on for real machines.', line: hk.n });
  }

  function checkTasks(file, tasks, out, ctx, where) {
    let unnamed = 0;
    let shorts = 0;
    for (const t of tasks) {
      if (!isObj(t)) {
        out.push({ file: file.path, level: 'error', name: 'Task shape', detail: 'A task must be a map such as "- name: ...", with a module under it.', line: lineOf(t) });
        continue;
      }
      if (t.block) {
        checkTasks(file, isArr(t.block) ? t.block : [], out, ctx, where);
        continue;
      }
      const mod = moduleOf(t);
      const n = lineOf(t);
      if (!mod) {
        out.push({ file: file.path, level: 'error', name: 'Task has a module', detail: `The task "${t.name || '(no name)'}" does not call any module.`, line: n });
        continue;
      }
      if (!t.name) unnamed++;
      if (ANSIBLE_MODULES.size && /^[a-z_]+$/.test(mod) && !['local_action', 'meta'].includes(mod)) shorts++;
      else if (ANSIBLE_MODULES.size && /^ansible\.builtin\./.test(mod) && !ANSIBLE_MODULES.has(mod)) {
        out.push({ file: file.path, level: 'warn', name: 'Module is known', detail: `${mod} is not in Stanza's module list. It may be misspelled.`, line: n });
      }
      if (/^(ansible\.builtin\.)?(command|shell|raw)$/.test(mod) && !t.changed_when && !(t.args && t.args.creates)) {
        out.push({ file: file.path, level: 'warn', name: 'Safe to repeat', detail: `"${t.name || mod}" uses ${mod} with no changed_when, so it will report "changed" on every run.`, line: n });
      }
      const body = t[mod];
      if (isObj(body)) {
        for (const [k, v] of Object.entries(body)) {
          if (SECRET_NAME.test(k) && typeof v === 'string' && !PLACEHOLDER.test(v) && !/^(no|yes|true|false|present|absent|none)$/i.test(v) && !/(file|path|length|state|hash|encrypt|update|policy|mode)$/i.test(k)) {
            out.push({ file: file.path, level: 'warn', name: 'No secrets in the playbook', detail: `"${k}" holds a plain-text value. Use a variable and Ansible Vault.`, line: n });
          }
        }
      }
      if (t.notify) for (const h of isArr(t.notify) ? t.notify : [t.notify]) ctx.notified.push({ name: h, line: n });
      if (t.register) ctx.registered.add(t.register);
      ctx.tasks.push({ task: t, mod, where });
    }
    if (unnamed) out.push({ file: file.path, level: 'warn', name: 'Tasks have names', detail: `${unnamed} task(s) have no name. Names are what you read in the output.` });
    if (shorts) out.push({ file: file.path, level: 'info', name: 'Full module names', detail: `${shorts} task(s) use a short module name. The full name (ansible.builtin.x) avoids clashes.` });
  }

  function checkAnsibleYaml(file, files, out) {
    const { value, errors } = parseYaml(textOf(file));
    for (const e of errors) out.push({ file: file.path, level: 'error', name: 'YAML syntax', detail: e.msg, line: e.line });
    if (!errors.length) out.push({ file: file.path, level: 'pass', name: 'YAML syntax', detail: 'The file reads as valid YAML.' });
    if (errors.length || value === null) return { parsed: null };

    const ctx = { tasks: [], notified: [], registered: new Set() };
    const info = { plays: [], taskFile: null };

    // A role's defaults/vars file is a plain map.
    if (isObj(value) && /(defaults|vars)\/main\.ya?ml$/.test(file.path)) {
      out.push({ file: file.path, level: 'pass', name: 'Variables read', detail: `${Object.keys(value).length} variable(s) defined.` });
      return { parsed: value, kind: 'vars' };
    }
    if (isObj(value) && /meta\/main\.ya?ml$/.test(file.path)) {
      out.push({ file: file.path, level: value.galaxy_info ? 'pass' : 'warn', name: 'Role metadata', detail: value.galaxy_info ? 'galaxy_info is present.' : 'galaxy_info is missing.' });
      return { parsed: value, kind: 'meta' };
    }
    if (!isArr(value)) return { parsed: value, kind: 'map' };

    const isPlays = value.length && value.every((x) => isObj(x) && ('hosts' in x || 'import_playbook' in x || 'tasks' in x || 'roles' in x || 'pre_tasks' in x || 'post_tasks' in x));
    if (isPlays) {
      for (const play of value) {
        const n = lineOf(play);
        if (!play.hosts && !play.import_playbook) out.push({ file: file.path, level: 'error', name: 'Play has hosts', detail: 'A play needs "hosts:" so Ansible knows where to run.', line: n });
        else out.push({ file: file.path, level: 'pass', name: 'Play has hosts', detail: `"${play.name || play.hosts}" runs on ${play.hosts}.`, line: n });
        const tasks = play.tasks || [];
        const pre = play.pre_tasks || [];
        const post = play.post_tasks || [];
        if (!tasks.length && !play.roles && !pre.length && !post.length) out.push({ file: file.path, level: 'warn', name: 'Play does something', detail: 'This play has no tasks and no roles.', line: n });
        if (isArr(tasks)) checkTasks(file, [...pre, ...tasks, ...post], out, ctx, play);
        if (play.handlers) {
          const names = new Set(play.handlers.map((h) => h.name).concat(play.handlers.map((h) => h.listen).filter(Boolean)));
          for (const nt of ctx.notified) {
            out.push(names.has(nt.name) ? { file: file.path, level: 'pass', name: 'Handler exists', detail: `"${nt.name}" is defined.`, line: nt.line } : { file: file.path, level: 'error', name: 'Handler exists', detail: `A task notifies "${nt.name}", but no handler has that name.`, line: nt.line });
          }
        } else if (ctx.notified.length) {
          out.push({ file: file.path, level: 'error', name: 'Handler exists', detail: `A task notifies "${ctx.notified[0].name}", but the play has no handlers.`, line: ctx.notified[0].line });
        }
        if (play.become !== undefined && play.become !== true && play.become !== false) out.push({ file: file.path, level: 'warn', name: 'become value', detail: 'become should be true or false.', line: n });
        info.plays.push(play);
      }
      if (!ctx.tasks.length) return { parsed: value, kind: 'plays', info };
    } else if (value.every((x) => isObj(x))) {
      checkTasks(file, value, out, ctx, null);
      info.taskFile = value;
      if (ctx.tasks.length) out.push({ file: file.path, level: 'pass', name: 'Task list', detail: `${ctx.tasks.length} task(s) read.` });
    } else {
      out.push({ file: file.path, level: 'error', name: 'Playbook shape', detail: 'A playbook is a list of plays; a role file is a list of tasks. This is neither.' });
    }

    // Variables used with {{ }} but never defined (only judged when we can see the role's defaults).
    const defaults = files.find((f) => /defaults\/main\.ya?ml$/.test(f.path));
    if (defaults && info.taskFile) {
      const known = new Set(Object.keys(parseYaml(textOf(defaults)).value || {}));
      for (const r of ctx.registered) known.add(r);
      const used = new Map();
      for (const m of textOf(file).matchAll(/\{\{\s*([A-Za-z_]\w*)/g)) if (!used.has(m[1])) used.set(m[1], 1);
      const magic = /^(item|ansible_.*|inventory_hostname.*|hostvars|groups|group_names|play_hosts|role_path|playbook_dir|omit|lookup|ansible_facts)$/;
      const missing = [...used.keys()].filter((v) => !known.has(v) && !magic.test(v));
      out.push(missing.length ? { file: file.path, level: 'warn', name: 'Variables are defined', detail: `Used but not in defaults/main.yml: ${missing.join(', ')}.` } : { file: file.path, level: 'pass', name: 'Variables are defined', detail: `Every {{ variable }} is defined in defaults/main.yml (${used.size} used).` });
    }
    return { parsed: value, kind: isPlays ? 'plays' : 'tasks', info };
  }

  function checkAdhoc(file, out) {
    const text = textOf(file).replace(/\\\n/g, ' ');
    const cmd = text.split('\n').find((l) => /^\s*ansible\s/.test(l));
    if (!cmd) {
      out.push({ file: file.path, level: 'warn', name: 'Ad-hoc command', detail: 'No line starts with "ansible".' });
      return null;
    }
    const m = cmd.trim().split(/\s+/);
    const pattern = m[1];
    const mod = (cmd.match(/-m\s+(\S+)/) || [])[1];
    const args = (cmd.match(/-a\s+("[^"]*"|'[^']*'|\S+)/) || [])[1];
    const inv = (cmd.match(/-i\s+(\S+)/) || [])[1];
    out.push({ file: file.path, level: 'pass', name: 'Command shape', detail: `Runs "${mod || 'command'}" on "${pattern}".` });
    out.push(inv ? { file: file.path, level: 'pass', name: 'Inventory given', detail: `Uses ${inv}.` } : { file: file.path, level: 'info', name: 'Inventory given', detail: 'No -i, so Ansible uses the inventory in ansible.cfg or /etc/ansible/hosts.' });
    if (mod && ANSIBLE_MODULES.size && /^ansible\.builtin\./.test(mod) && !ANSIBLE_MODULES.has(mod)) out.push({ file: file.path, level: 'warn', name: 'Module is known', detail: `${mod} is not in Stanza's module list.` });
    if (/^ansible\.builtin\.(shell|command)$|^(shell|command)$/.test(mod || '') && args && /rm\s+-rf|--no-preserve-root/.test(args)) out.push({ file: file.path, level: 'warn', name: 'Careful command', detail: 'This deletes files on every machine it matches.' });
    return { pattern, mod: mod || 'ansible.builtin.command', args, inv };
  }

  /* ---------------------------------------------------------------- *
   *  Terraform
   * ---------------------------------------------------------------- */

  // Walk the text once, skipping strings and comments, and return top-level blocks.
  function scanTerraform(text, errors) {
    const blocks = [];
    let depth = 0;
    let line = 1;
    let i = 0;
    let headStart = 0;
    let head = '';
    let headLine = 1;
    let bodyStart = -1;
    const stack = [];
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (c === '\n') {
        line++;
        if (depth === 0) {
          headStart = i + 1;
          headLine = line;
        }
        i++;
        continue;
      }
      if (c === '#' || (c === '/' && text[i + 1] === '/')) {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        const e = text.indexOf('*/', i + 2);
        const stop = e < 0 ? n : e + 2;
        for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
        if (e < 0) errors.push({ line, msg: 'A /* comment is never closed.' });
        i = stop;
        continue;
      }
      if (c === '<' && text[i + 1] === '<' && /^<<-?[A-Z_]+/.test(text.slice(i, i + 12))) {
        const tag = text.slice(i).match(/^<<-?([A-Z_]+)/)[1];
        const re = new RegExp('\\n\\s*' + tag + '\\s*(\\n|$)');
        const rest = text.slice(i);
        const m = re.exec(rest);
        const stop = m ? i + m.index + m[0].length - 1 : n;
        for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
        i = stop;
        continue;
      }
      if (c === '"') {
        const startLine = line;
        i++;
        let tmpl = 0;
        while (i < n) {
          const d = text[i];
          if (d === '\n' && !tmpl) {
            errors.push({ line: startLine, msg: 'A double-quoted string is not closed on its line.' });
            break;
          }
          if (d === '\n') line++;
          if (d === '\\') {
            i += 2;
            continue;
          }
          if (d === '$' && text[i + 1] === '{') {
            tmpl++;
            i += 2;
            continue;
          }
          if (d === '}' && tmpl) {
            tmpl--;
            i++;
            continue;
          }
          if (d === '"' && !tmpl) break;
          i++;
        }
        i++;
        continue;
      }
      if (c === '{' || c === '[' || c === '(') {
        if (c === '{' && depth === 0) {
          head = text.slice(headStart, i).trim();
          bodyStart = i + 1;
        }
        stack.push({ c, line });
        if (c === '{') depth++;
        i++;
        continue;
      }
      if (c === '}' || c === ']' || c === ')') {
        const open = stack.pop();
        const want = { '}': '{', ']': '[', ')': '(' }[c];
        if (!open) errors.push({ line, msg: `A "${c}" closes something that was never opened.` });
        else if (open.c !== want) errors.push({ line, msg: `A "${c}" does not match the "${open.c}" opened on line ${open.line}.` });
        if (c === '}') {
          depth--;
          if (depth === 0 && bodyStart >= 0) {
            blocks.push({ head, line: headLine, endLine: line, body: text.slice(bodyStart, i), bodyLine: headLine });
            bodyStart = -1;
            headStart = i + 1;
          }
        }
        i++;
        continue;
      }
      i++;
    }
    for (const o of stack) errors.push({ line: o.line, msg: `A "${o.c}" is opened here and never closed.` });
    return blocks;
  }

  // Top-level "name = value" lines inside a block body.
  function attrsOf(body) {
    const attrs = {};
    let depth = 0;
    for (const raw of body.split('\n')) {
      const s = raw.replace(/#.*$/, '');
      if (depth === 0) {
        const m = s.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*(.*)$/);
        if (m) attrs[m[1]] = m[2].trim();
      }
      const clean = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
      for (const ch of clean) {
        if (ch === '{' || ch === '[' || ch === '(') depth++;
        else if (ch === '}' || ch === ']' || ch === ')') depth--;
      }
    }
    return attrs;
  }

  const TF_BLOCKS = new Set(['terraform', 'provider', 'resource', 'data', 'variable', 'output', 'locals', 'module', 'moved', 'import', 'removed', 'check']);
  const TF_NEEDS = {
    aws_instance: ['ami', 'instance_type'],
    aws_vpc: ['cidr_block'],
    aws_subnet: ['vpc_id', 'cidr_block'],
    aws_s3_bucket_versioning: ['bucket', 'versioning_configuration'],
    aws_s3_bucket_public_access_block: ['bucket'],
    aws_s3_bucket_server_side_encryption_configuration: ['bucket', 'rule'],
    aws_vpc_security_group_ingress_rule: ['security_group_id', 'ip_protocol'],
    aws_vpc_security_group_egress_rule: ['security_group_id', 'ip_protocol'],
  };

  function parseTf(files) {
    const all = { resources: [], datas: [], variables: [], outputs: [], providers: [], terraform: null, locals: new Set() };
    const checks = [];
    for (const f of files) {
      const errors = [];
      const text = textOf(f);
      const blocks = scanTerraform(text, errors);
      for (const e of errors) checks.push({ file: f.path, level: 'error', name: 'Braces and quotes', detail: e.msg, line: e.line });
      if (!errors.length) checks.push({ file: f.path, level: 'pass', name: 'Braces and quotes', detail: `Balanced. ${blocks.length} block(s) read.` });
      for (const b of blocks) {
        const m = b.head.match(/^([A-Za-z_]\w*)((?:\s+"[^"]*")*)\s*$/);
        if (!m) {
          checks.push({ file: f.path, level: 'error', name: 'Block header', detail: `"${b.head.slice(0, 50)}" is not a valid block header.`, line: b.line });
          continue;
        }
        const type = m[1];
        const labels = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
        if (!TF_BLOCKS.has(type)) {
          checks.push({ file: f.path, level: 'error', name: 'Block type', detail: `"${type}" is not a Terraform block type.`, line: b.line });
          continue;
        }
        const want = { resource: 2, data: 2, variable: 1, output: 1, provider: 1, module: 1, terraform: 0, locals: 0 }[type];
        if (want !== undefined && labels.length !== want) {
          checks.push({ file: f.path, level: 'error', name: 'Block labels', detail: `A ${type} block needs ${want} name(s) in quotes, found ${labels.length}.`, line: b.line });
          continue;
        }
        const blk = { type, labels, file: f.path, line: b.line, endLine: b.endLine, body: b.body, attrs: attrsOf(b.body) };
        if (type === 'resource') all.resources.push(blk);
        else if (type === 'data') all.datas.push(blk);
        else if (type === 'variable') all.variables.push(blk);
        else if (type === 'output') all.outputs.push(blk);
        else if (type === 'provider') all.providers.push(blk);
        else if (type === 'terraform') all.terraform = blk;
        else if (type === 'locals') for (const k of Object.keys(blk.attrs)) all.locals.add(k);
      }
    }
    return { all, checks };
  }

  function checkTerraform(files, out) {
    const tf = files.filter((f) => /\.tf$/.test(f.path));
    if (!tf.length) return null;
    const { all, checks } = parseTf(tf);
    out.push(...checks);
    const text = tf.map(textOf).join('\n');
    const stripped = text.replace(/#.*$/gm, '').replace(/\/\/.*$/gm, '');

    for (const r of all.resources) {
      const need = TF_NEEDS[r.labels[0]];
      if (need) {
        const miss = need.filter((k) => !(k in r.attrs) && !new RegExp('^\\s*' + k + '\\s*\\{', 'm').test(r.body));
        out.push(miss.length ? { file: r.file, level: 'error', name: 'Required arguments', detail: `${r.labels.join('.')} is missing: ${miss.join(', ')}.`, line: r.line } : { file: r.file, level: 'pass', name: 'Required arguments', detail: `${r.labels.join('.')} has what it needs.`, line: r.line });
      }
    }

    const declared = new Set(all.variables.map((v) => v.labels[0]));
    const usedVars = new Set([...stripped.matchAll(/\bvar\.([A-Za-z_]\w*)/g)].map((m) => m[1]));
    const missingVars = [...usedVars].filter((v) => !declared.has(v));
    if (usedVars.size) {
      out.push(missingVars.length ? { file: tf[0].path, level: 'warn', name: 'Variables declared', detail: `Used but not declared in these files: ${missingVars.join(', ')}. They come from variables.tf; keep it in the same folder.` } : { file: tf[0].path, level: 'pass', name: 'Variables declared', detail: `All ${usedVars.size} variable(s) used are declared.` });
    }
    const unused = [...declared].filter((v) => !usedVars.has(v) && !/\.tfvars/.test(v));
    if (unused.length && all.resources.length) out.push({ file: tf[0].path, level: 'info', name: 'Variables used', detail: `Declared but unused here: ${unused.join(', ')}. Another file may use them.` });
    const noDesc = all.variables.filter((v) => !/description\s*=/.test(v.body));
    if (all.variables.length) out.push(noDesc.length ? { file: noDesc[0].file, level: 'info', name: 'Variables described', detail: `${noDesc.length} variable(s) have no description.`, line: noDesc[0].line } : { file: all.variables[0].file, level: 'pass', name: 'Variables described', detail: 'Every variable has a description.' });

    // References to other resources must exist, somewhere.
    const have = new Set(all.resources.map((r) => r.labels.join('.')));
    const haveData = new Set(all.datas.map((r) => r.labels.join('.')));
    const refs = new Set();
    for (const m of stripped.matchAll(/\b(?:data\.)?([a-z][a-z0-9]*_[a-z0-9_]+)\.([A-Za-z_][\w-]*)/g)) {
      const key = `${m[1]}.${m[2]}`;
      if (/^(aws|random|tls|null|local|http|time|archive|template)_/.test(m[1])) refs.add(m[0].startsWith('data.') ? 'data.' + key : key);
    }
    const unresolved = [...refs].filter((r) => (r.startsWith('data.') ? !haveData.has(r.slice(5)) : !have.has(r)));
    if (refs.size) {
      out.push(unresolved.length ? { file: tf[0].path, level: 'info', name: 'References resolve', detail: `Points at ${unresolved.join(', ')}, which is not in these files. It must exist in another .tf file of your project (for example from another generator).` } : { file: tf[0].path, level: 'pass', name: 'References resolve', detail: `${refs.size} reference(s) to other resources all resolve.` });
    }

    // Safety checks
    if (/\bAKIA[0-9A-Z]{16}\b/.test(text) || /(access_key|secret_key)\s*=\s*"[^"$]{8,}"/.test(text)) out.push({ file: tf[0].path, level: 'error', name: 'No keys in the code', detail: 'An AWS key is written in the file. Remove it and use environment variables or a profile.' });
    else if (all.providers.some((p) => p.labels[0] === 'aws')) out.push({ file: all.providers[0].file, level: 'pass', name: 'No keys in the code', detail: 'No AWS keys are written in the files.' });
    for (const r of all.resources) {
      if (r.labels[0] === 'aws_security_group' || r.labels[0] === 'aws_vpc_security_group_ingress_rule' || r.labels[0] === 'aws_security_group_rule') {
        const open = /0\.0\.0\.0\/0/.test(r.body);
        const ssh = /(from_port|to_port)\s*=\s*22\b/.test(r.body);
        if (open && ssh) out.push({ file: r.file, level: 'warn', name: 'SSH is not open to the world', detail: `${r.labels.join('.')} allows port 22 from 0.0.0.0/0. Limit it to your own IP address.`, line: r.line });
        else if (open) out.push({ file: r.file, level: 'info', name: 'Open to the internet', detail: `${r.labels.join('.')} allows 0.0.0.0/0 on some port. Fine for a public web server, risky for anything else.`, line: r.line });
      }
      if (r.labels[0] === 'aws_instance') {
        out.push(/http_tokens\s*=\s*"required"/.test(r.body) ? { file: r.file, level: 'pass', name: 'Instance metadata v2', detail: 'IMDSv2 is required, which blocks a common credential-theft trick.', line: r.line } : { file: r.file, level: 'warn', name: 'Instance metadata v2', detail: 'Add metadata_options { http_tokens = "required" }.', line: r.line });
        if (/root_block_device/.test(r.body)) out.push(/encrypted\s*=\s*true/.test(r.body) ? { file: r.file, level: 'pass', name: 'Disk encrypted', detail: 'The root disk is encrypted.', line: r.line } : { file: r.file, level: 'warn', name: 'Disk encrypted', detail: 'Set encrypted = true on the root disk.', line: r.line });
      }
      if (r.labels[0] === 'aws_s3_bucket') {
        const name = r.labels[1];
        const hasPab = all.resources.some((x) => x.labels[0] === 'aws_s3_bucket_public_access_block' && x.body.includes(`aws_s3_bucket.${name}`));
        out.push(hasPab ? { file: r.file, level: 'pass', name: 'Bucket is private', detail: `${r.labels.join('.')} has a public access block.`, line: r.line } : { file: r.file, level: 'warn', name: 'Bucket is private', detail: `${r.labels.join('.')} has no public access block next to it.`, line: r.line });
      }
    }
    if (all.providers.some((p) => p.labels[0] === 'aws') && !all.terraform) out.push({ file: all.providers[0].file, level: 'warn', name: 'Versions pinned', detail: 'No terraform { required_providers } block, so provider versions can change under you.' });
    else if (all.terraform) out.push(/required_providers/.test(all.terraform.body) ? { file: all.terraform.file, level: 'pass', name: 'Versions pinned', detail: 'The provider version is pinned.', line: all.terraform.line } : { file: all.terraform.file, level: 'warn', name: 'Versions pinned', detail: 'No required_providers block.', line: all.terraform.line });
    return all;
  }

  function checkTfvars(file, out) {
    const bad = textOf(file).split('\n').map((l, i) => [l, i + 1]).filter(([l]) => /^\s*[\w-]+\s*=/.test(l) && SECRET_NAME.test(l.split('=')[0]) && !/=\s*(""|"\$\{)/.test(l));
    out.push(bad.length ? { file: file.path, level: 'error', name: 'No secrets in tfvars', detail: `"${bad[0][0].split('=')[0].trim()}" looks like a secret. tfvars files usually end up in git.`, line: bad[0][1] } : { file: file.path, level: 'pass', name: 'No secrets in tfvars', detail: 'Only ordinary settings are in this file.' });
  }

  function checkGitignore(file, files, out) {
    const t = textOf(file);
    if (files.some((f) => /\.tf$/.test(f.path))) {
      out.push(/\.tfstate/.test(t) ? { file: file.path, level: 'pass', name: 'State files ignored', detail: 'terraform.tfstate is kept out of git. It can contain secrets.' } : { file: file.path, level: 'error', name: 'State files ignored', detail: 'Add *.tfstate. State files can hold passwords and keys.' });
    }
    if (files.some((f) => base(f.path) === '.env.example')) out.push(/^\.env$/m.test(t) ? { file: file.path, level: 'pass', name: '.env is ignored', detail: 'Your real .env will not be committed.' } : { file: file.path, level: 'error', name: '.env is ignored', detail: 'Add a line ".env" so the real secrets are never committed.' });
  }

  /* ---------------------------------------------------------------- *
   *  Jenkins: Jenkinsfile, shared library, setup files, agent script
   * ---------------------------------------------------------------- */

  // A tiny Groovy reader: finds { } blocks, skipping strings and comments.
  function groovyTree(text, errors) {
    const root = { head: '', line: 1, children: [], body: '' };
    const stack = [root];
    const pairs = [];
    let line = 1;
    let i = 0;
    let stmtStart = 0;
    const n = text.length;
    const top = () => stack[stack.length - 1];
    while (i < n) {
      const c = text[i];
      if (c === '\n') {
        line++;
        if (stack.length === 1 || true) stmtStart = i + 1;
        i++;
        continue;
      }
      if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        const e = text.indexOf('*/', i + 2);
        const stop = e < 0 ? n : e + 2;
        for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
        if (e < 0) errors.push({ line, msg: 'A /* comment is never closed.' });
        i = stop;
        continue;
      }
      if (c === "'" || c === '"') {
        const triple = text.substr(i, 3) === c.repeat(3);
        const q = triple ? c.repeat(3) : c;
        const startLine = line;
        i += q.length;
        let closed = false;
        let tmpl = 0;
        while (i < n) {
          if (text[i] === '\\') {
            i += 2;
            continue;
          }
          if (text[i] === '\n') {
            line++;
            if (!triple && !tmpl) break;
          }
          if (c === '"' && text[i] === '$' && text[i + 1] === '{') {
            tmpl++;
            i += 2;
            continue;
          }
          if (c === '"' && text[i] === '}' && tmpl) {
            tmpl--;
            i++;
            continue;
          }
          if (!tmpl && text.substr(i, q.length) === q) {
            closed = true;
            i += q.length;
            break;
          }
          i++;
        }
        if (!closed) errors.push({ line: startLine, msg: `A ${q} string is not closed.` });
        continue;
      }
      if (c === '{') {
        const head = text.slice(stmtStart, i).replace(/\/\/.*$/gm, '').trim();
        const node = { head, line, children: [], body: '', start: i + 1 };
        top().children.push(node);
        stack.push(node);
        pairs.push({ c, line });
        i++;
        stmtStart = i;
        continue;
      }
      if (c === '}') {
        const open = pairs.pop();
        if (!open || open.c !== '{') {
          errors.push({ line, msg: 'A "}" closes a block that was never opened.' });
          if (open) pairs.push(open);
        } else {
          const node = stack.pop();
          node.body = text.slice(node.start, i);
          node.endLine = line;
        }
        i++;
        stmtStart = i;
        continue;
      }
      if (c === '(' || c === '[') pairs.push({ c, line });
      if (c === ')' || c === ']') {
        const want = c === ')' ? '(' : '[';
        const open = pairs.pop();
        if (!open) errors.push({ line, msg: `A "${c}" has no matching "${want}".` });
        else if (open.c !== want) errors.push({ line, msg: `A "${c}" does not match the "${open.c}" opened on line ${open.line}.` });
      }
      if (c === ';') stmtStart = i + 1;
      i++;
    }
    for (const o of pairs) errors.push({ line: o.line, msg: `A "${o.c}" is opened here and never closed.` });
    return root;
  }

  const child = (node, re) => node.children.filter((c) => re.test(c.head));
  // The text of a block with its nested { } blocks cut out, so only its own lines are left.
  function ownText(node) {
    let s = node.body;
    for (const c of [...node.children].reverse()) {
      const a = c.start - node.start;
      s = s.slice(0, a) + s.slice(a + c.body.length);
    }
    return s;
  }
  const stageName = (node) => (node.head.match(/^stage\s*\(\s*(['"])(.*?)\1\s*\)/) || [])[2];

  function stageList(node) {
    const out = [];
    for (const st of child(node, /^stages$/)) for (const s of child(st, /^stage\s*\(/)) out.push(s);
    return out;
  }

  function checkJenkinsfile(file, out) {
    const text = textOf(file);
    const errors = [];
    const tree = groovyTree(text, errors);
    for (const e of errors) out.push({ file: file.path, level: 'error', name: 'Brackets and quotes', detail: e.msg, line: e.line });
    if (!errors.length) out.push({ file: file.path, level: 'pass', name: 'Brackets and quotes', detail: 'Every { ( [ and quote is closed.' });
    if (errors.length) return null;

    const pipes = child(tree, /^pipeline$/);
    if (!pipes.length) {
      if (/@Library/.test(text)) {
        out.push({ file: file.path, level: 'pass', name: 'Shared library call', detail: 'This file loads a library and calls its step.' });
        return { tree, lib: true, text };
      }
      out.push({ file: file.path, level: 'error', name: 'Has a pipeline', detail: 'No "pipeline { }" block was found.' });
      return null;
    }
    const pipe = pipes[0];
    out.push({ file: file.path, level: 'pass', name: 'Has a pipeline', detail: 'Found pipeline { }.', line: pipe.line });

    const stages = stageList(pipe);
    out.push(stages.length ? { file: file.path, level: 'pass', name: 'Has stages', detail: `${stages.length} stage(s): ${stages.map(stageName).join(', ')}.` } : { file: file.path, level: 'error', name: 'Has stages', detail: 'A pipeline needs a stages { } block with at least one stage.' });

    const pipeAgent = child(pipe, /^agent\b/).length || /^\s*agent\s+(any|none)\b/m.test(ownText(pipe));
    const allStagesHaveAgent = stages.length && stages.every((s) => child(s, /^agent\b/).length || /^\s*agent\s/m.test(ownText(s)) || child(s, /^matrix$/).length);
    out.push(pipeAgent || allStagesHaveAgent ? { file: file.path, level: 'pass', name: 'Has an agent', detail: 'Jenkins knows where to run.' } : { file: file.path, level: 'error', name: 'Has an agent', detail: 'Add "agent any" (or an agent in every stage).' });

    const names = stages.map(stageName);
    const dup = names.find((x, i) => names.indexOf(x) !== i);
    if (dup) out.push({ file: file.path, level: 'error', name: 'Stage names are unique', detail: `Two stages are called "${dup}".` });
    for (const s of stages) {
      const has = child(s, /^(steps|stages|parallel|matrix)$/).length;
      if (!has) out.push({ file: file.path, level: 'error', name: 'Stage has steps', detail: `Stage "${stageName(s)}" has no steps { }.`, line: s.line });
    }

    // Secrets
    const sh = [...text.matchAll(/^\s*sh\s+"(.*)"\s*$/gm)];
    const leaky = sh.filter((m) => /\$\{?[A-Za-z_]*(PASS|TOKEN|SECRET|KEY|CRED)[A-Za-z_]*\}?/i.test(m[1]));
    out.push(leaky.length ? { file: file.path, level: 'warn', name: 'Secrets stay out of Groovy strings', detail: 'A secret is put into a double-quoted sh string, so Groovy (not the shell) expands it. Use single quotes so the shell does it.' } : { file: file.path, level: 'pass', name: 'Secrets stay out of Groovy strings', detail: 'No secret is expanded inside a double-quoted sh string.' });
    const hard = text.split('\n').map((l, i) => [l, i + 1]).find(([l]) => /(password|token|secret|apikey)\s*[=:]\s*['"][^'"$]{6,}['"]/i.test(l) && !/credentialsId|usernameVariable|passwordVariable|credentials\(/i.test(l));
    out.push(hard ? { file: file.path, level: 'error', name: 'No secrets written in', detail: 'A password or token is written in the Jenkinsfile. Store it in Jenkins credentials.', line: hard[1] } : { file: file.path, level: 'pass', name: 'No secrets written in', detail: 'No password or token is typed into the file.' });

    // input must not hold an executor
    const inputs = [...text.matchAll(/\binput\s+(message|\()/g)];
    if (inputs.length) {
      const noTimeout = !/timeout\s*\([^)]*\)\s*\{[^}]*input\b/s.test(text);
      out.push(noTimeout ? { file: file.path, level: 'warn', name: 'Approval has a time limit', detail: 'An input step waits forever. Wrap it in timeout(time: 1, unit: \'HOURS\') { }.' } : { file: file.path, level: 'pass', name: 'Approval has a time limit', detail: 'The approval step gives up after a set time.' });
    }
    out.push(/timeout\s*\(/.test(text) ? { file: file.path, level: 'pass', name: 'Run has a time limit', detail: 'A timeout is set.' } : { file: file.path, level: 'info', name: 'Run has a time limit', detail: 'No timeout. A stuck build would run until someone stops it.' });

    // What to prepare in Jenkins
    const needs = new Set();
    const plugins = new Set(['workflow-aggregator (Pipeline)']);
    const rules = [
      [/docker\s*\{|dockerfile/i, 'docker-workflow (Docker Pipeline)'],
      [/\bjunit\b/, 'junit'],
      [/\bsshagent\b/, 'ssh-agent'],
      [/withCredentials|credentials\(/, 'credentials-binding'],
      [/\bcleanWs\b/, 'ws-cleanup'],
      [/timestamps\(\)/, 'timestamper'],
      [/changeRequest\(\)|buildingTag\(\)|\btag\s+['"]|branch\s+['"]/, 'a multibranch job (github-branch-source for GitHub)'],
    ];
    for (const [re, p] of rules) if (re.test(text)) plugins.add(p);
    for (const m of text.matchAll(/credentialsId\s*:\s*['"]([^'"]+)['"]|credentials\(\s*['"]([^'"]+)['"]\s*\)|usernamePassword\([^)]*credentialsId:\s*['"]([^'"]+)['"]|sshUserPrivateKey\([^)]*credentialsId:\s*['"]([^'"]+)['"]|string\([^)]*credentialsId:\s*['"]([^'"]+)['"]/g)) needs.add(m[1] || m[2] || m[3] || m[4] || m[5]);
    for (const m of text.matchAll(/sshagent\s*\(\s*(?:credentials\s*:\s*)?\[\s*['"]([^'"]+)['"]/g)) needs.add(m[1]);
    out.push({ file: file.path, level: 'info', name: 'Plugins needed', detail: [...plugins].join(', ') + '.' });
    if (needs.size) out.push({ file: file.path, level: 'info', name: 'Credentials to create', detail: `Create these in Manage Jenkins > Credentials before the first run: ${[...needs].join(', ')}.` });
    return { tree, pipe, stages, text };
  }

  function checkGroovyLib(file, out) {
    const errors = [];
    groovyTree(textOf(file), errors);
    for (const e of errors) out.push({ file: file.path, level: 'error', name: 'Brackets and quotes', detail: e.msg, line: e.line });
    if (!errors.length) out.push({ file: file.path, level: 'pass', name: 'Brackets and quotes', detail: 'Every { ( [ and quote is closed.' });
    out.push(/def\s+call\s*\(/.test(textOf(file)) ? { file: file.path, level: 'pass', name: 'Has call()', detail: 'The step has a call method, which Jenkins runs.' } : { file: file.path, level: 'error', name: 'Has call()', detail: 'A vars/ step needs "def call(...) { }".' });
    const stepName = base(file.path).replace(/\.groovy$/, '');
    out.push(/^[a-z][A-Za-z0-9]*$/.test(stepName) ? { file: file.path, level: 'pass', name: 'Step name', detail: `The step is called ${stepName}.` } : { file: file.path, level: 'warn', name: 'Step name', detail: 'Use camelCase, starting with a lowercase letter.' });
  }

  function checkShell(file, out) {
    const t = textOf(file);
    const lines = t.split('\n');
    out.push(/^#!\/(usr\/)?bin\/(env )?(ba)?sh/.test(lines[0]) ? { file: file.path, level: 'pass', name: 'Has a shebang', detail: 'The first line names the interpreter.' } : { file: file.path, level: 'warn', name: 'Has a shebang', detail: 'Start the script with #!/usr/bin/env bash.' });
    out.push(/^set\s+-[a-z]*e[a-z]*u|set -euo pipefail|set -e/m.test(t) ? { file: file.path, level: 'pass', name: 'Stops on errors', detail: 'set -e is on, so a failed step stops the script.' } : { file: file.path, level: 'warn', name: 'Stops on errors', detail: 'Add "set -euo pipefail" near the top.' });
    const badQuote = lines.map((l, i) => [l.replace(/\\./g, '').replace(/'[^']*'/g, "''"), i + 1]).find(([l]) => !/^\s*#/.test(l) && ((l.match(/"/g) || []).length % 2 === 1) && !/\\$/.test(l));
    out.push(badQuote ? { file: file.path, level: 'error', name: 'Quotes are closed', detail: 'A double quote is opened and not closed on this line.', line: badQuote[1] } : { file: file.path, level: 'pass', name: 'Quotes are closed', detail: 'Every quote is paired.' });
    if (/curl[^|\n]*\|\s*(sudo\s+)?(ba)?sh/.test(t)) out.push({ file: file.path, level: 'warn', name: 'No pipe to shell', detail: 'curl ... | sh runs code you have not read.' });
    if (/chmod\s+(-R\s+)?777/.test(t)) out.push({ file: file.path, level: 'error', name: 'Sensible permissions', detail: 'chmod 777 lets everyone change the file.' });
    if (/ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]{20,}/.test(t) && /PRIVATE KEY/.test(t)) out.push({ file: file.path, level: 'error', name: 'No private keys', detail: 'A private key is written in the script.' });
    else if (/PUBLIC_KEY=/.test(t)) out.push({ file: file.path, level: 'pass', name: 'Only a public key', detail: 'Only the public half of the key is in the script, which is safe.' });
  }

  function checkDockerfile(file, files, out) {
    const lines = textOf(file).split('\n').filter((l) => l.trim() && !/^\s*#/.test(l));
    out.push(/^FROM\s/i.test(lines[0] || '') ? { file: file.path, level: 'pass', name: 'Starts with FROM', detail: lines[0].trim() } : { file: file.path, level: 'error', name: 'Starts with FROM', detail: 'A Dockerfile must start with FROM.' });
    const from = (lines[0] || '').match(/^FROM\s+(\S+)/i);
    if (from) out.push(/:latest$|^[^:]+$/.test(from[1]) ? { file: file.path, level: 'warn', name: 'Image is pinned', detail: `${from[1]} has no fixed version tag.` } : { file: file.path, level: 'pass', name: 'Image is pinned', detail: `Uses a tagged image (${from[1]}).` });
    const users = lines.filter((l) => /^USER\s/i.test(l));
    const last = users[users.length - 1];
    out.push(last && !/root/i.test(last) ? { file: file.path, level: 'pass', name: 'Runs as a normal user', detail: `The last USER is ${last.replace(/^USER\s+/i, '')}.` } : { file: file.path, level: 'warn', name: 'Runs as a normal user', detail: 'End the file with USER set to a non-root user.' });
    for (const l of lines) {
      const m = l.match(/^COPY\s+(?:--\S+\s+)*(\S+)\s+\S+/i);
      if (m && !m[1].startsWith('--') && !files.some((f) => f.path === m[1] || base(f.path) === base(m[1]))) {
        out.push({ file: file.path, level: 'warn', name: 'COPY source exists', detail: `${m[1]} is copied in, but is not among these files.` });
      } else if (m) out.push({ file: file.path, level: 'pass', name: 'COPY source exists', detail: `${m[1]} is in the build.` });
    }
    if (/apt-get install(?![^\n]*-y)/.test(textOf(file).replace(/\\\n/g, ' '))) out.push({ file: file.path, level: 'warn', name: 'apt-get has -y', detail: 'apt-get install without -y stops and waits for a keypress during a build.' });
  }

  function checkPlugins(file, out) {
    const lines = textOf(file).split('\n').map((l, i) => [l.replace(/#.*$/, '').trim(), i + 1]).filter(([l]) => l);
    const seen = new Set();
    let bad = null;
    let dup = null;
    for (const [l, n] of lines) {
      if (!/^[a-z0-9][a-z0-9-]*(:[\w.-]+)?$/.test(l)) bad = bad || [l, n];
      const id = l.split(':')[0];
      if (seen.has(id)) dup = dup || [id, n];
      seen.add(id);
    }
    out.push(bad ? { file: file.path, level: 'error', name: 'Plugin ids', detail: `"${bad[0]}" is not a plugin id. Use lowercase names such as git or git:5.7.0.`, line: bad[1] } : { file: file.path, level: 'pass', name: 'Plugin ids', detail: `${lines.length} plugin id(s) are well formed.` });
    if (dup) out.push({ file: file.path, level: 'warn', name: 'No duplicates', detail: `${dup[0]} is listed twice.`, line: dup[1] });
    const pinned = lines.filter(([l]) => l.includes(':')).length;
    out.push({ file: file.path, level: 'info', name: 'Versions', detail: pinned ? `${pinned} of ${lines.length} are pinned.` : 'None are pinned, so a rebuild installs the newest versions. Fine for learning; pin them for a real server.' });
    let known = null;
    try {
      known = new Set((typeof JK_PLUGIN_GROUPS !== 'undefined' ? JK_PLUGIN_GROUPS : require('./jk-ref2.js').JK_PLUGIN_GROUPS).flatMap((g) => g.commands.map((c) => c.cmd.split(/\s/)[0])));
    } catch (e) {
      /* optional */
    }
    if (known && known.size) {
      const unk = [...seen].filter((p) => !known.has(p));
      if (unk.length) out.push({ file: file.path, level: 'info', name: 'Known ids', detail: `Not in Stanza's plugin list (may still be real): ${unk.join(', ')}.` });
    }
  }

  function envVarsIn(text) {
    return [...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]);
  }

  function checkCompose(file, files, out) {
    const { value, errors } = parseYaml(textOf(file));
    for (const e of errors) out.push({ file: file.path, level: 'error', name: 'YAML syntax', detail: e.msg, line: e.line });
    if (!errors.length) out.push({ file: file.path, level: 'pass', name: 'YAML syntax', detail: 'The file reads as valid YAML.' });
    if (errors.length || !isObj(value) || !isObj(value.services)) {
      if (!errors.length) out.push({ file: file.path, level: 'error', name: 'Has services', detail: 'A compose file needs a top-level "services:" map.' });
      return null;
    }
    const svcs = value.services;
    out.push({ file: file.path, level: 'pass', name: 'Has services', detail: `${Object.keys(svcs).length} service(s): ${Object.keys(svcs).join(', ')}.` });
    const namedVols = new Set(Object.keys(value.volumes || {}));
    for (const [name, s] of Object.entries(svcs)) {
      if (!s.image && !s.build) out.push({ file: file.path, level: 'error', name: 'Service has an image', detail: `${name} needs "image:" or "build:".`, line: lineOf(s) });
      for (const p of s.ports || []) {
        if (typeof p !== 'string') out.push({ file: file.path, level: 'warn', name: 'Ports are quoted', detail: `${name}: write ports as "8080:8080" in quotes. YAML can misread some unquoted pairs.`, line: lineOf(s) });
      }
      for (const v of s.volumes || []) {
        const src = String(v).split(':')[0];
        if (/^[a-z_][\w-]*$/i.test(src) && !namedVols.has(src)) out.push({ file: file.path, level: 'error', name: 'Volume is declared', detail: `${name} uses the volume "${src}", but it is not listed under volumes:.`, line: lineOf(s) });
        if (/docker\.sock/.test(String(v))) out.push({ file: file.path, level: 'warn', name: 'Docker socket shared', detail: `${name} can control the host's Docker, which is nearly root on the host. Use it only on a machine you trust.`, line: lineOf(s) });
        if (/^\.\/|^\//.test(src) && files.length) {
          const local = src.replace(/^\.\//, '');
          if (/^\.\//.test(String(v)) && !files.some((f) => f.path === local)) out.push({ file: file.path, level: 'warn', name: 'Mounted file exists', detail: `${src} is mounted into ${name}, but is not among these files.`, line: lineOf(s) });
        }
      }
      const env = s.environment;
      const pairs = isObj(env) ? Object.entries(env) : isArr(env) ? env.map((e) => String(e).split(/=(.*)/s).slice(0, 2)) : [];
      const literal = pairs.find(([k, v]) => SECRET_NAME.test(k) && typeof v === 'string' && !PLACEHOLDER.test(v));
      out.push(literal ? { file: file.path, level: 'error', name: 'No secrets in compose', detail: `${name}: ${literal[0]} is written in the file. Use \${NAME} and a .env file.`, line: lineOf(s) } : { file: file.path, level: 'pass', name: 'No secrets in compose', detail: `${name}: secrets come from variables, not from the file.` });
      out.push(s.restart ? { file: file.path, level: 'pass', name: 'Restart policy', detail: `${name} restarts: ${s.restart}.` } : { file: file.path, level: 'info', name: 'Restart policy', detail: `${name} will not restart after a reboot.` });
    }
    // Variables like ${X} need a value in .env.example
    const env = files.find((f) => base(f.path) === '.env.example');
    const used = [...new Set(envVarsIn(textOf(file)))];
    if (env && used.length) {
      const defined = new Set(textOf(env).split('\n').map((l) => (l.match(/^([A-Z][A-Z0-9_]*)=/) || [])[1]).filter(Boolean));
      const missing = used.filter((v) => !defined.has(v));
      out.push(missing.length ? { file: file.path, level: 'error', name: '.env has every variable', detail: `${missing.join(', ')} used here but missing from .env.example.` } : { file: file.path, level: 'pass', name: '.env has every variable', detail: `All ${used.length} \${VARIABLE}s have a value line in .env.example.` });
    }
    return { value, used };
  }

  function checkCasc(file, files, out) {
    const { value, errors } = parseYaml(textOf(file));
    for (const e of errors) out.push({ file: file.path, level: 'error', name: 'YAML syntax', detail: e.msg, line: e.line });
    if (!errors.length) out.push({ file: file.path, level: 'pass', name: 'YAML syntax', detail: 'The file reads as valid YAML.' });
    if (errors.length || !isObj(value)) return null;
    const known = new Set(['jenkins', 'unclassified', 'credentials', 'security', 'tool', 'jobs', 'appearance', 'globalCredentialsConfiguration']);
    const odd = Object.keys(value).filter((k) => !known.has(k));
    out.push(odd.length ? { file: file.path, level: 'warn', name: 'Top-level sections', detail: `Unusual: ${odd.join(', ')}. A plugin may add it; otherwise check the spelling.` } : { file: file.path, level: 'pass', name: 'Top-level sections', detail: `Sections: ${Object.keys(value).join(', ')}.` });
    const text = textOf(file);
    const pw = text.split('\n').map((l, i) => [l, i + 1]).find(([l]) => /^\s*(-\s*)?(password|secret|token|privateKey)\s*:\s*"?[^"\s$]+/i.test(l));
    out.push(pw ? { file: file.path, level: 'error', name: 'No secrets in jenkins.yaml', detail: 'A password is written in the file. Use "${NAME}" and set the value in .env.', line: pw[1] } : { file: file.path, level: 'pass', name: 'No secrets in jenkins.yaml', detail: 'Passwords are read from variables.' });
    if (/allowAnonymousRead:\s*true/.test(text)) out.push({ file: file.path, level: 'warn', name: 'Anonymous read', detail: 'Anyone can read jobs and logs without logging in.' });
    else if (/allowAnonymousRead:\s*false/.test(text)) out.push({ file: file.path, level: 'pass', name: 'Anonymous read is off', detail: 'Strangers see nothing.' });
    if (/allowsSignup:\s*true/.test(text)) out.push({ file: file.path, level: 'warn', name: 'Sign-up is closed', detail: 'Anyone can create an account.' });
    const compose = files.find((f) => base(f.path) === 'docker-compose.yml');
    const used = [...new Set(envVarsIn(text))];
    if (compose && used.length) {
      const ct = textOf(compose);
      const missing = used.filter((v) => !new RegExp('\\b' + v + '\\b').test(ct));
      out.push(missing.length ? { file: file.path, level: 'error', name: 'Variables reach Jenkins', detail: `${missing.join(', ')} used here but not passed to the container in docker-compose.yml.` } : { file: file.path, level: 'pass', name: 'Variables reach Jenkins', detail: `${used.join(', ')} are passed into the container by docker-compose.yml.` });
    }
    return value;
  }

  function checkEnvExample(file, out) {
    const lines = textOf(file).split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    const bad = lines.find((l) => !/^[A-Z][A-Z0-9_]*=/.test(l));
    out.push(bad ? { file: file.path, level: 'error', name: 'NAME=value lines', detail: `"${bad}" is not NAME=value.` } : { file: file.path, level: 'pass', name: 'NAME=value lines', detail: `${lines.length} variable(s).` });
    const ph = lines.filter((l) => /change-me|your-|paste-|=999$/.test(l)).length;
    if (ph) out.push({ file: file.path, level: 'info', name: 'Replace placeholders', detail: `${ph} value(s) are placeholders. Copy this file to .env and put real values there.` });
  }

  /* ---------------------------------------------------------------- *
   *  Dry runs: what the real tool would do
   * ---------------------------------------------------------------- */

  const line = (t, cls = 'out') => ({ t, cls });
  const stars = (s) => `${s} ${'*'.repeat(Math.max(3, 62 - s.length))}`;

  function dryAnsiblePlay(play, files, inv, tasksOfRole) {
    const L = [];
    const hostsPat = String(play.hosts);
    let hosts = inv ? inv.hostsOf(hostsPat) : [];
    let sample = false;
    if (!hosts.length) {
      hosts = ['server1', 'server2'];
      sample = true;
    }
    L.push(line(`$ ansible-playbook -i inventory.ini ${'site.yml'} --check --diff`, 'cmd'));
    L.push(line(''));
    L.push(line(stars(`PLAY [${play.name || hostsPat}]`), 'head'));
    L.push(line(`# Ansible picks the machines matching "${hostsPat}"${sample ? ' (no inventory in this build, so two example names are used)' : ''}: ${hosts.join(', ')}.`, 'why'));
    let ok = 0;
    let changed = 0;
    let skipped = 0;
    const emit = (name, mod, task, tag) => {
      L.push(line(''));
      L.push(line(stars(`${tag || 'TASK'} [${name}]`), 'head'));
      const readOnly = READ_ONLY.has(String(mod).replace(/^ansible\.builtin\./, ''));
      const cond = task && task.when;
      for (const h of hosts) {
        if (cond && /ansible_(os_family|distribution)|ansible_facts/.test(String(isArr(cond) ? cond.join(' ') : cond)) && h === hosts[hosts.length - 1] && hosts.length > 1) {
          L.push(line(`skipping: [${h}]`, 'skip'));
          skipped++;
        } else if (readOnly) {
          L.push(line(`ok: [${h}]`, 'ok'));
          ok++;
        } else {
          L.push(line(`changed: [${h}]`, 'changed'));
          changed++;
        }
      }
      if (task && task.when) L.push(line(`# Only runs where: ${isArr(task.when) ? task.when.join(' and ') : task.when}`, 'why'));
      if (!readOnly) L.push(line(`# "${String(mod).replace('ansible.builtin.', '')}" makes a change the first time. A second run reports ok, because the machine already matches.`, 'why'));
      else L.push(line(`# "${String(mod).replace('ansible.builtin.', '')}" only looks or reports, so it never changes anything.`, 'why'));
    };
    if (play.gather_facts !== false) {
      L.push(line(''));
      L.push(line(stars('TASK [Gathering Facts]'), 'head'));
      for (const h of hosts) L.push(line(`ok: [${h}]`, 'ok'));
      ok += hosts.length;
      L.push(line('# Ansible first asks each machine about itself (OS, IP, memory). These facts are what {{ ansible_facts[...] }} reads.', 'why'));
    }
    let tasks = [...(play.pre_tasks || []), ...(play.tasks || [])];
    for (const r of play.roles || []) {
      const rn = isObj(r) ? r.role || r.name : r;
      const rt = tasksOfRole(rn);
      if (rt) tasks = tasks.concat(rt.map((t) => Object.assign({}, t, { __role: rn })));
    }
    const flat = [];
    for (const t of tasks) {
      if (isObj(t) && isArr(t.block)) flat.push(...t.block);
      else flat.push(t);
    }
    for (const t of flat) {
      if (!isObj(t)) continue;
      const mod = moduleOf(t) || 'task';
      emit((t.__role ? `${t.__role} : ` : '') + (t.name || mod), mod, t);
    }
    const handlers = play.handlers || [];
    const notified = new Set(flat.flatMap((t) => (isObj(t) && t.notify ? (isArr(t.notify) ? t.notify : [t.notify]) : [])));
    for (const h of handlers) {
      if (notified.has(h.name)) {
        emit(h.name, moduleOf(h) || 'handler', h, 'RUNNING HANDLER');
        L.push(line('# A handler runs once, at the end, and only because a task above said "changed".', 'why'));
      }
    }
    L.push(line(''));
    L.push(line(stars('PLAY RECAP'), 'head'));
    const per = (h) => `${h.padEnd(14)}: ok=${(ok + changed) / hosts.length | 0}  changed=${changed / hosts.length | 0}  unreachable=0  failed=0  skipped=${skipped ? 1 : 0}`;
    for (const h of hosts) L.push(line(per(h), 'ok'));
    return L;
  }

  function dryInventory(file, inv) {
    const L = [line('$ ansible-inventory -i inventory.ini --graph', 'cmd')];
    const walk = (g, pad, seen) => {
      L.push(line(`${pad}|--@${g}:`, 'ok'));
      for (const k of inv.kids[g] || []) if (!seen.has(k)) walk(k, pad + '  ', new Set([...seen, k]));
      for (const h of inv.groups[g] || []) L.push(line(`${pad}  |--${h}`));
    };
    L.push(line('@all:'));
    const childOf = new Set(Object.values(inv.kids).flat());
    const tops = [...new Set([...Object.keys(inv.groups), ...Object.keys(inv.kids)])].filter((g) => !childOf.has(g));
    for (const g of tops) walk(g, '  ', new Set([g]));
    L.push(line('  |--@ungrouped:'));
    L.push(line(''));
    L.push(line('# Ansible reads every [group] and [group:children] and prints who belongs where. A host in two groups appears twice.', 'why'));
    return L;
  }

  function dryAdhoc(info, inv) {
    const hosts = (inv && inv.hostsOf(info.pattern)) || [];
    const hs = hosts.length ? hosts : ['server1'];
    const mod = info.mod.replace('ansible.builtin.', '');
    const L = [line(`$ ansible ${info.pattern}${info.inv ? ' -i ' + info.inv : ''} -m ${info.mod}${info.args ? ' -a ' + info.args : ''}`, 'cmd'), line('')];
    for (const h of hs) {
      if (mod === 'ping') L.push(line(`${h} | SUCCESS => {`, 'ok'), line('    "changed": false,'), line('    "ping": "pong"'), line('}'));
      else if (/^(command|shell)$/.test(mod)) L.push(line(`${h} | CHANGED | rc=0 >>`, 'changed'), line('    (the command output would appear here)'));
      else L.push(line(`${h} | ${READ_ONLY.has(mod) ? 'SUCCESS' : 'CHANGED'} => {`, READ_ONLY.has(mod) ? 'ok' : 'changed'), line(`    "changed": ${READ_ONLY.has(mod) ? 'false' : 'true'}`), line('}'));
    }
    L.push(line(''));
    L.push(line(`# "${info.pattern}" selects ${hosts.length ? hosts.join(', ') : 'the matching machines'}. The module "${mod}" runs on each, and "pong" means SSH works and Python is found.`, 'why'));
    return L;
  }

  function dryTerraform(all, files) {
    const L = [];
    const rs = all.resources;
    L.push(line('$ terraform init', 'cmd'));
    L.push(line('Initializing the backend...', 'out'));
    L.push(line('Initializing provider plugins...', 'out'));
    for (const p of all.terraform && /required_providers/.test(all.terraform.body) ? [...all.terraform.body.matchAll(/source\s*=\s*"([^"]+)"[\s\S]*?version\s*=\s*"([^"]+)"/g)] : []) {
      L.push(line(`- Installing ${p[1]} (version ${p[2].replace(/[~>=\s]/g, '')}.x)...`, 'out'));
    }
    L.push(line('Terraform has been successfully initialized!', 'ok'));
    L.push(line('# init downloads the provider plugin that knows how to talk to AWS. It also creates the .terraform folder.', 'why'));
    L.push(line(''));
    L.push(line('$ terraform validate', 'cmd'));
    L.push(line('Success! The configuration is valid.', 'ok'));
    L.push(line(''));
    L.push(line('$ terraform plan', 'cmd'));
    if (!rs.length) {
      L.push(line('No changes. Your infrastructure matches the configuration (there are no resources in these files).'));
      L.push(line('# Provider and variable files describe settings only. Resources come from the other generators.', 'why'));
      return L;
    }
    // Order: a resource comes after anything it refers to.
    const key = (r) => r.labels.join('.');
    const deps = new Map(rs.map((r) => [key(r), new Set([...r.body.matchAll(/\b([a-z][a-z0-9]*_[a-z0-9_]+)\.([A-Za-z_][\w-]*)/g)].map((m) => `${m[1]}.${m[2]}`).filter((k) => k !== key(r) && rs.some((x) => key(x) === k)))]));
    const order = [];
    const seen = new Set();
    const visit = (k) => {
      if (seen.has(k)) return;
      seen.add(k);
      for (const d of deps.get(k) || []) visit(d);
      order.push(k);
    };
    for (const r of rs) visit(key(r));
    L.push(line('Terraform will perform the following actions:', 'out'));
    for (const k of order) {
      const r = rs.find((x) => key(x) === k);
      L.push(line(''));
      L.push(line(`  # ${k} will be created`, 'out'));
      L.push(line(`  + resource "${r.labels[0]}" "${r.labels[1]}" {`, 'changed'));
      const entries = Object.entries(r.attrs).slice(0, 7);
      const pad = Math.max(2, ...entries.map(([a]) => a.length), 2);
      for (const [a, v] of entries) {
        const computed = /\b(aws|data)[\w.]*\.\w+\.\w+|\$\{|\bvar\./.test(v) && /^(aws_|data\.)/.test(v.replace(/^\[|\]$/g, ''));
        const shown = computed ? '(known after apply)' : /[{[]$/.test(v) ? v + ' ... ' + (v.endsWith('{') ? '}' : ']') : v.length > 52 ? v.slice(0, 50) + '...' : v;
        L.push(line(`      + ${a.padEnd(pad)} = ${shown}`, 'changed'));
      }
      if (Object.keys(r.attrs).length > 7) L.push(line('      # ... more arguments', 'why'));
      for (const nb of [...r.body.matchAll(/^\s{2}([a-z_]+)\s*\{/gm)].slice(0, 3)) L.push(line(`      + ${nb[1]} { ... }`, 'changed'));
      L.push(line('      + id = (known after apply)', 'changed'));
      L.push(line('    }', 'changed'));
      const need = [...(deps.get(k) || [])];
      if (need.length) L.push(line(`    # Created after ${need.join(', ')}, because it refers to ${need.length > 1 ? 'them' : 'it'}.`, 'why'));
    }
    L.push(line(''));
    L.push(line(`Plan: ${rs.length} to add, 0 to change, 0 to destroy.`, 'head'));
    if (all.outputs.length) {
      L.push(line(''));
      L.push(line('Changes to Outputs:', 'out'));
      for (const o of all.outputs) L.push(line(`  + ${o.labels[0].padEnd(22)} = (known after apply)`, 'changed'));
    }
    L.push(line(''));
    L.push(line('# plan only shows the future. Nothing is created until you run "terraform apply" and answer yes.', 'why'));
    L.push(line(`# Costs money? ${rs.some((r) => /aws_instance|aws_nat|aws_db/.test(r.labels[0])) ? 'Yes: an instance is billed per hour while it runs. Run "terraform destroy" when you finish learning.' : 'Little or nothing for these resources, but check the AWS pricing page.'}`, 'why'));
    return L;
  }

  function evalWhen(whenNode, scenario) {
    const w = whenNode.body;
    const results = [];
    if (/changeRequest\(\)/.test(w)) results.push(scenario.pr);
    if (/buildingTag\(\)/.test(w)) results.push(!!scenario.tag);
    const t = w.match(/\btag\s+['"]([^'"]+)['"]/);
    if (t) results.push(!!scenario.tag && new RegExp('^' + t[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(scenario.tag));
    const b = w.match(/\bbranch\s+['"]([^'"]+)['"]/);
    if (b) results.push(!scenario.pr && !scenario.tag && scenario.branch === b[1]);
    if (!results.length) return true;
    return results.every(Boolean);
  }

  function drySteps(body, L, pad, env = {}) {
    const sub = (t) => t.replace(/\$\{env\.(\w+)\}/g, (x, v) => (env[v] !== undefined ? env[v] : `<${v}>`));
    for (const raw of body.split('\n')) {
      const s = raw.trim();
      if (!s || s.startsWith('//')) continue;
      let m;
      if ((m = s.match(/^sh\s+(['"])(.*)\1\s*$/))) L.push(line(`${pad}+ ${m[2].replace(/\\\$/g, '$')}`, 'out'));
      else if ((m = s.match(/^sh\s+script\s*:\s*(['"])(.*)\1/))) L.push(line(`${pad}+ ${m[2]}`, 'out'));
      else if ((m = s.match(/^echo\s+(['"])(.*)\1\s*$/))) L.push(line(`${pad}${sub(m[2])}`, 'out'));
      else if (/^junit\b/.test(s)) L.push(line(`${pad}Recording test results`, 'ok'));
      else if (/^archiveArtifacts\b/.test(s)) L.push(line(`${pad}Archiving artifacts`, 'ok'));
      else if (/^cleanWs\b/.test(s)) L.push(line(`${pad}[WS-CLEANUP] Deleting project workspace...`, 'out'));
      else if (/^input\b/.test(s)) {
        const msg = (s.match(/message\s*:\s*['"]([^'"]*)['"]/) || [])[1] || 'Proceed?';
        L.push(line(`${pad}Input requested: "${msg}"  (a person clicks the button in Jenkins; shown here as approved)`, 'skip'));
      } else if (/^checkout\b|^git\b/.test(s)) L.push(line(`${pad}Cloning the repository...`, 'out'));
      else if (/^withCredentials|^sshagent|^withEnv/.test(s)) L.push(line(`${pad}Masking supported pattern matches of the secret values in the log`, 'out'));
      else if (/^(mail|slackSend)\b/.test(s)) L.push(line(`${pad}Sending a notification`, 'out'));
    }
  }

  function dryJenkins(info) {
    const { pipe, stages, text } = info;
    const L = [];
    const multi = /changeRequest\(\)|buildingTag\(\)|\bbranch\s+['"]|\btag\s+['"]/.test(text);
    const mainBranch = (text.match(/\bbranch\s+['"]([^'"]+)['"]/) || [])[1] || 'main';
    const scenarios = multi
      ? [
          { label: `A push to the "${mainBranch}" branch`, branch: mainBranch, pr: false, tag: null },
          { label: 'A pull request', branch: 'PR-17', pr: true, tag: null },
          ...(/\btag\s+['"]|buildingTag\(\)/.test(text) ? [{ label: 'A version tag (v1.0.0)', branch: 'v1.0.0', pr: false, tag: 'v1.0.0' }] : []),
        ]
      : [{ label: 'One run of the job', branch: mainBranch, pr: false, tag: null }];
    const agentLine = () => {
      const a = child(pipe, /^agent\b/)[0];
      if (a && /docker/.test(a.body)) return `Running inside a Docker container: ${(a.body.match(/image\s+['"]([^'"]+)['"]/) || [])[1] || 'image'}`;
      if (/^\s*agent\s+none/m.test(ownText(pipe)) && !a) return 'No agent at pipeline level (each stage picks its own)';
      return 'Running on an available agent (the built-in node or any connected agent)';
    };
    for (const sc of scenarios) {
      const env = { BUILD_NUMBER: '1', BRANCH_NAME: sc.branch, JOB_NAME: 'my-job', BUILD_URL: 'http://jenkins/job/my-job/1/', CHANGE_ID: sc.pr ? '17' : '', CHANGE_BRANCH: sc.pr ? 'feature-login' : '', CHANGE_TARGET: sc.pr ? mainBranch : '', TAG_NAME: sc.tag || '' };
      L.push(line(`━━ ${sc.label} ━━`, 'head'));
      if (multi) L.push(line(`# Variables Jenkins would set: BRANCH_NAME=${sc.branch}${sc.pr ? ', CHANGE_ID=17, CHANGE_TARGET=' + mainBranch : ''}${sc.tag ? ', TAG_NAME=' + sc.tag : ''}`, 'why'));
      L.push(line('Started by user admin', 'out'));
      L.push(line('[Pipeline] Start of Pipeline', 'out'));
      L.push(line(`[Pipeline] ${agentLine()}`, 'out'));
      const row = [];
      for (const st of stages) {
        const name = stageName(st);
        const when = child(st, /^when$/)[0];
        const run = !when || evalWhen(when, sc);
        if (!run) {
          L.push(line(`[Pipeline] { (${name})`, 'out'));
          L.push(line(`Stage "${name}" skipped due to when conditional`, 'skip'));
          L.push(line('[Pipeline] }', 'out'));
          row.push([name, 'skip']);
          continue;
        }
        L.push(line(`[Pipeline] { (${name})`, 'out'));
        const mx = child(st, /^matrix$/)[0];
        if (mx) {
          const axes = [...mx.body.matchAll(/name\s+['"]([^'"]+)['"]\s*values\s+([^\n]+)/g)].map((m) => ({ name: m[1], values: [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) }));
          let cells = [{}];
          for (const ax of axes) cells = cells.flatMap((c) => ax.values.map((v) => Object.assign({}, c, { [ax.name]: v })));
          L.push(line(`# The matrix makes ${cells.length} run(s) at the same time: one for each combination.`, 'why'));
          const inner = child(child(mx, /^stages$/)[0] || { children: [] }, /^stage\s*\(/);
          for (const c of cells) {
            const tag = Object.entries(c).map(([k, v]) => `${k}=${v}`).join(', ');
            L.push(line(`[${tag}] Running`, 'out'));
            for (const is of inner) drySteps((child(is, /^steps$/)[0] || { body: '' }).body, L, `[${tag}]   `, env);
          }
        } else {
          const par = child(st, /^parallel$/)[0];
          if (par) for (const ps of child(par, /^stage\s*\(/)) drySteps((child(ps, /^steps$/)[0] || { body: '' }).body, L, `  (${stageName(ps)}) `, env);
          drySteps((child(st, /^steps$/)[0] || { body: '' }).body, L, '  ', env);
        }
        const gate = child(st, /^steps$/)[0] && /\binput\b/.test(child(st, /^steps$/)[0].body);
        L.push(line('[Pipeline] }', 'out'));
        row.push([name, gate ? 'wait' : 'ok']);
      }
      const post = child(pipe, /^post$/)[0];
      if (post && child(post, /^always$/).length) L.push(line('[Pipeline] post: always { ... }', 'out'));
      L.push(line('[Pipeline] End of Pipeline', 'out'));
      L.push(line('Finished: SUCCESS', 'ok'));
      L.push(line(`  Stages: ${row.map(([n, s]) => `${s === 'skip' ? '⊘' : s === 'wait' ? '⏸' : '✓'} ${n}`).join('   ')}`, 'head'));
      L.push(line('# ✓ ran   ⊘ skipped by a when condition   ⏸ waited for a person', 'why'));
      L.push(line(''));
    }
    L.push(line('# This is a simulation. Real output also contains what your commands print (npm, pytest and so on), and a failing command would turn the run red.', 'why'));
    return L;
  }

  function dryCompose(file, comp) {
    const L = [line('$ docker compose up -d', 'cmd')];
    const svcs = comp.value.services;
    const hasBuild = Object.values(svcs).some((s) => s.build);
    if (hasBuild) {
      L.push(line('[+] Building (reads the Dockerfile)', 'out'));
      L.push(line('# build: . means "make the image from the Dockerfile in this folder". That step also installs your plugins.', 'why'));
    }
    L.push(line('[+] Running', 'out'));
    L.push(line(' ✔ Network default            Created', 'ok'));
    for (const v of Object.keys(comp.value.volumes || {})) L.push(line(` ✔ Volume "${v}"  Created`, 'ok'));
    for (const [n, s] of Object.entries(svcs)) {
      L.push(line(` ✔ Container ${s.container_name || n}  Started`, 'ok'));
      for (const p of s.ports || []) L.push(line(`# Port ${p}: open http://localhost:${String(p).split(':')[0]} on this machine.`, 'why'));
    }
    if (comp.used.length) L.push(line(`# Compose swaps in ${comp.used.map((v) => '${' + v + '}').join(', ')} from your .env file before starting.`, 'why'));
    return L;
  }

  function dryShell(file) {
    const L = [line(`$ bash ${base(file.path)}`, 'cmd')];
    let note = '';
    for (const raw of textOf(file).split('\n')) {
      const s = raw.trim();
      if (!s) continue;
      if (s.startsWith('#!')) continue;
      if (s.startsWith('#')) {
        note = s.replace(/^#\s*/, '');
        continue;
      }
      if (/^(set |[A-Z_]+=)/.test(s)) continue;
      L.push(line(`+ ${s.length > 90 ? s.slice(0, 88) + '...' : s}`, 'out'));
      if (note) {
        L.push(line(`# ${note}`, 'why'));
        note = '';
      }
    }
    L.push(line('# These are the commands the script would run, in order. Read each "+" line as one step.', 'why'));
    return L;
  }

  function dryCasc(value) {
    const L = [line('Jenkins starts and reads jenkins.yaml (Configuration as Code):', 'cmd')];
    const j = value.jenkins || {};
    if (j.systemMessage) L.push(line(`+ set the banner: "${j.systemMessage}"`, 'changed'));
    if (j.numExecutors !== undefined) L.push(line(`+ builds on the server itself: ${j.numExecutors} at a time${j.numExecutors === 0 ? ' (agents only)' : ''}`, 'changed'));
    const users = j.securityRealm && j.securityRealm.local && j.securityRealm.local.users;
    if (users) for (const u of users) L.push(line(`+ create user ${u.id} (password from the environment)`, 'changed'));
    if (j.authorizationStrategy) L.push(line(`+ permissions: ${Object.keys(j.authorizationStrategy)[0]}`, 'changed'));
    const loc = value.unclassified && value.unclassified.location;
    if (loc && loc.url) L.push(line(`+ Jenkins URL: ${loc.url}`, 'changed'));
    const cr = value.credentials && value.credentials.system && value.credentials.system.domainCredentials;
    if (cr) for (const d of cr) for (const c of d.credentials || []) { const k = Object.keys(c)[0]; L.push(line(`+ credential "${c[k].id}" (${k})`, 'changed')); }
    L.push(line('# Because the first-run wizard is skipped, this file is the whole setup. Edit the file and reload, instead of clicking in the web page.', 'why'));
    return L;
  }

  /* ---------------------------------------------------------------- *
   *  GitHub Actions: workflow files and dependabot.yml
   * ---------------------------------------------------------------- */

  const GHA_EVENTS = new Set([
    'branch_protection_rule', 'check_run', 'check_suite', 'create', 'delete', 'deployment', 'deployment_status', 'discussion',
    'discussion_comment', 'fork', 'gollum', 'issue_comment', 'issues', 'label', 'merge_group', 'milestone', 'page_build',
    'public', 'pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_target', 'push',
    'registry_package', 'release', 'repository_dispatch', 'schedule', 'status', 'watch', 'workflow_call', 'workflow_dispatch',
    'workflow_run',
  ]);

  // Old majors of well-known actions. They run on Node versions GitHub has stopped supporting.
  const GHA_OLD = {
    'actions/checkout': 3, 'actions/setup-node': 3, 'actions/setup-python': 4, 'actions/setup-java': 3, 'actions/setup-go': 4,
    'docker/login-action': 2, 'docker/build-push-action': 4, 'docker/setup-buildx-action': 2, 'docker/metadata-action': 4,
    'github/codeql-action': 2,
  };
  // Majors GitHub switched off. A run that uses them fails.
  const GHA_DEAD = { 'actions/upload-artifact': 3, 'actions/download-artifact': 3, 'actions/cache': 2 };
  const GHA_DEAD_RUNNERS = /^(ubuntu-(16|18|20)\.04|macos-(10\.15|11|12)|windows-(2016|2019))$/;
  const GHA_INJECT = /\$\{\{\s*(github\.(head_ref|event\.(issue\.(title|body)|pull_request\.(title|body|head\.(ref|label)|head\.repo\.default_branch)|comment\.body|review\.body|review_comment\.body|discussion\.(title|body)|pages\.[^}]*\.page_name|head_commit\.(message|author\.(email|name))|commits\S*|workflow_run\.(head_branch|head_commit\.message|head_commit\.author\.(email|name)|display_title)|release\.(name|body))))/;

  const strOf = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

  // The line of a key inside a map (the parser keeps __lines for maps it built).
  const keyLine = (obj, key) => (obj && obj.__lines && obj.__lines[key]) || lineOf(obj) || 0;

  // "main", "release/*", "**" and so on, as a regular expression.
  function globRe(p) {
    const s = String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
    return new RegExp('^' + s + '$');
  }
  const globAny = (pats, v) => (isArr(pats) ? pats : [pats]).some((p) => globRe(strOf(p)).test(v));

  // The events a workflow listens to: { push: {...filters}, schedule: [...] }
  function eventsOf(on) {
    if (typeof on === 'string') return { [on]: {} };
    if (isArr(on)) return Object.fromEntries(on.map((e) => [strOf(e), {}]));
    if (isObj(on)) return Object.fromEntries(Object.entries(on).map(([k, v]) => [k, v === null ? {} : v]));
    return {};
  }

  function checkCron(expr) {
    const f = strOf(expr).trim().split(/\s+/);
    if (f.length !== 5) return `A cron time needs 5 fields (minute hour day month weekday) but this has ${f.length}.`;
    const ranges = [[0, 59, 'minute'], [0, 23, 'hour'], [1, 31, 'day of the month'], [1, 12, 'month'], [0, 6, 'day of the week']];
    for (let i = 0; i < 5; i++) {
      const [lo, hi, label] = ranges[i];
      for (const part of f[i].split(',')) {
        const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
        if (!m) return `The ${label} field "${f[i]}" is not valid cron.`;
        const nums = m[1] === '*' ? [] : m[1].split('-').map(Number);
        if (nums.some((n) => n < lo || n > hi)) return `The ${label} field "${f[i]}" is outside ${lo} to ${hi}.`;
        if (nums.length === 2 && nums[0] > nums[1]) return `The ${label} range "${part}" runs backwards.`;
      }
    }
    return null;
  }

  function usesInfo(u) {
    const s = strOf(u);
    if (s.startsWith('./')) return { kind: 'local', name: s };
    if (s.startsWith('docker://')) return { kind: 'docker', name: s };
    const m = s.match(/^([^@\s]+)(?:@(\S+))?$/);
    if (!m) return { kind: 'bad', name: s };
    const name = m[1];
    const ref = m[2] || '';
    const major = (ref.match(/^v?(\d+)(?:[.\d]*)$/) || [])[1];
    const parts = name.split('/');
    return { kind: 'repo', name, ref, major: major === undefined ? null : Number(major), repoKey: parts.slice(0, 2).join('/'), valid: parts.length >= 2 };
  }

  function checkWorkflow(file, files, out) {
    const text = textOf(file);
    const { value, errors } = parseYaml(text);
    const F = file.path;
    const add = (level, name, detail, ln) => out.push({ file: F, level, name, detail, ...(ln ? { line: ln } : {}) });
    for (const e of errors) add('error', 'YAML syntax', e.msg, e.line);
    if (!errors.length) add('pass', 'YAML syntax', 'The file reads as valid YAML.');
    if (errors.length || !isObj(value)) return null;

    const on = value.on !== undefined ? value.on : value.true;
    if (on === undefined || on === null) add('error', 'Has a trigger', 'A workflow needs an "on:" section that says what starts it.');
    if (!isObj(value.jobs) || !Object.keys(value.jobs).length) {
      add('error', 'Has jobs', 'A workflow needs a "jobs:" section with at least one job.');
      return null;
    }
    const jobs = value.jobs;
    const ev = eventsOf(on);
    add('pass', 'Has jobs', `${Object.keys(jobs).length} job(s): ${Object.keys(jobs).join(', ')}.`);

    // ---- events
    const bad = Object.keys(ev).filter((k) => !GHA_EVENTS.has(k));
    if (on !== undefined && on !== null) {
      if (bad.length) add('error', 'Events are real', `"${bad.join('", "')}" is not an event GitHub knows. Events use underscores, such as pull_request.`, keyLine(value, 'on'));
      else add('pass', 'Events are real', `Starts on: ${Object.keys(ev).join(', ')}.`);
    }
    if (isObj(ev.push) && (ev.push.branches !== undefined) && ev.push['branches-ignore'] !== undefined) add('error', 'Branch filters', 'push uses both "branches" and "branches-ignore". GitHub allows only one of them.', lineOf(ev.push));
    if (ev.schedule !== undefined) {
      const sch = isArr(ev.schedule) ? ev.schedule : [];
      if (!sch.length) add('error', 'Schedule has a time', 'schedule needs a list with "- cron: ...".', keyLine(isObj(on) ? on : value, 'schedule'));
      for (const s of sch) {
        const c = isObj(s) ? s.cron : null;
        const msg = c === undefined || c === null ? 'Each schedule entry needs "cron:".' : checkCron(c);
        if (msg) add('error', 'Cron time is valid', msg, lineOf(s));
        else {
          add('pass', 'Cron time is valid', `"${c}" is valid. GitHub reads it as UTC.`);
          if (/^\*\/[1-4]\s/.test(strOf(c)) || /^\*\s/.test(strOf(c))) add('info', 'Schedule is very frequent', 'GitHub runs scheduled workflows at most every 5 minutes, and may start them late.', lineOf(s));
        }
      }
    }

    // ---- permissions
    const perm = (p, where, ln) => {
      if (p === 'write-all') add('warn', 'Permissions are small', `${where} gives the token write access to everything ("write-all"). List only what is needed.`, ln);
    };
    const jobIds = Object.keys(jobs);
    const topPerm = value.permissions;
    perm(topPerm, 'The workflow', keyLine(value, 'permissions'));
    const noPerm = jobIds.filter((id) => isObj(jobs[id]) && jobs[id].permissions === undefined);
    if (topPerm === undefined && noPerm.length) add('warn', 'Permissions are set', 'No "permissions:" block. Depending on your repository settings the token may get broad write access. Add "permissions: contents: read" and raise it only where needed.');
    else add('pass', 'Permissions are set', 'The token’s rights are written down.');

    // ---- per job
    let missingTimeout = [];
    const ids = new Set(jobIds);
    const graph = {};
    for (const id of jobIds) {
      const j = jobs[id];
      const jl = keyLine(jobs, id);
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) add('error', 'Job names are valid', `The job ID "${id}" must start with a letter or underscore and use letters, digits, - and _ only.`, jl);
      if (!isObj(j)) { add('error', 'Job is a map', `Job "${id}" has nothing inside it.`, jl); continue; }
      permCheck: perm(j.permissions, `Job "${id}"`, keyLine(j, 'permissions'));
      const reusable = j.uses !== undefined;
      if (!reusable) {
        if (j['runs-on'] === undefined) add('error', 'Job has runs-on', `Job "${id}" has no "runs-on:". GitHub does not know which machine to use.`, jl);
        else {
          const ro = j['runs-on'];
          const names = isArr(ro) ? ro.map(strOf) : isObj(ro) ? [] : [strOf(ro)];
          for (const r of names) if (GHA_DEAD_RUNNERS.test(r)) add('error', 'Runner still exists', `Job "${id}" asks for ${r}. GitHub has retired that machine image, so the job would wait forever. Use ubuntu-latest or a newer version.`, keyLine(j, 'runs-on'));
        }
        if (!isArr(j.steps) || !j.steps.length) add('error', 'Job has steps', `Job "${id}" has no "steps:".`, jl);
        if (j['timeout-minutes'] === undefined) missingTimeout.push(id);
      }
      if (j['continue-on-error'] === true) add('info', 'continue-on-error', `Job "${id}" can fail without failing the run.`, keyLine(j, 'continue-on-error'));
      const needs = j.needs === undefined ? [] : isArr(j.needs) ? j.needs.map(strOf) : [strOf(j.needs)];
      graph[id] = needs;
      for (const n of needs) {
        if (n === id) add('error', 'needs is valid', `Job "${id}" waits for itself.`, keyLine(j, 'needs'));
        else if (!ids.has(n)) add('error', 'needs is valid', `Job "${id}" needs "${n}", but there is no job with that name.`, keyLine(j, 'needs'));
      }
      // matrix
      let mkeys = new Set();
      const strat = isObj(j.strategy) ? j.strategy : null;
      if (strat && isObj(strat.matrix)) {
        for (const k of Object.keys(strat.matrix)) if (k !== 'include' && k !== 'exclude') mkeys.add(k);
        for (const inc of isArr(strat.matrix.include) ? strat.matrix.include : []) if (isObj(inc)) for (const k of Object.keys(inc)) mkeys.add(k);
      }
      const stepIds = new Set((isArr(j.steps) ? j.steps : []).filter(isObj).map((s) => s.id).filter(Boolean));

      // steps
      (isArr(j.steps) ? j.steps : []).forEach((s, i) => {
        if (!isObj(s)) return;
        const sl = lineOf(s) || jl;
        const label = s.name ? `"${s.name}"` : `step ${i + 1}`;
        const hasRun = s.run !== undefined;
        const hasUses = s.uses !== undefined;
        if (!hasRun && !hasUses) add('error', 'Step does something', `In job "${id}", ${label} has neither "run:" nor "uses:".`, sl);
        if (hasRun && hasUses) add('error', 'Step does something', `In job "${id}", ${label} has both "run:" and "uses:". A step does one or the other.`, sl);
        if (hasUses) {
          const u = usesInfo(s.uses);
          const ul = keyLine(s, 'uses');
          if (u.kind === 'bad' || (u.kind === 'repo' && !u.valid)) add('error', 'Action name is valid', `"${strOf(s.uses)}" is not written as owner/name@version.`, ul);
          else if (u.kind === 'repo') {
            if (!u.ref) add('error', 'Actions have a version', `"${u.name}" has no @version. Write something like ${u.name}@v1, so the step cannot change under you.`, ul);
            else if (/^(main|master|latest|HEAD|develop|dev)$/.test(u.ref)) add('warn', 'Actions are pinned', `"${u.name}@${u.ref}" follows a moving branch. Whatever its owner pushes next will run in your workflow. Use a version tag or a full commit ID.`, ul);
            else {
              if (GHA_DEAD[u.repoKey] && u.major !== null && u.major <= GHA_DEAD[u.repoKey]) add('error', 'Action version is alive', `${u.name}@${u.ref} was switched off by GitHub, so the step fails. Use a newer major version.`, ul);
              else if (GHA_OLD[u.repoKey] && u.major !== null && u.major <= GHA_OLD[u.repoKey]) add('warn', 'Action version is current', `${u.name}@${u.ref} is old and runs on a Node version GitHub no longer supports. Move to a newer major version.`, ul);
            }
            if (/^actions\/(upload|download)-artifact$/.test(u.repoKey) && /^v\d+/.test(u.ref)) {
              /* nothing more to say */
            }
          }
        }
        if (hasRun) {
          const code = strOf(s.run);
          const rl = keyLine(s, 'run');
          const m = code.match(GHA_INJECT);
          if (m) add('error', 'No script injection', `Job "${id}": ${m[0].trim()} is pasted straight into a shell command. Text from other people (titles, comments, branch names) can then run as code. Put it in env: first and read it as a shell variable.`, rl);
          else if (/\$\{\{\s*inputs\./.test(code)) add('warn', 'Inputs go through env', `Job "${id}": an input is pasted straight into a shell command. Pass it through env: and read it as a variable.`, rl);
          if (/\$\{\{\s*secrets\./.test(code)) add(/\becho\b/.test(code) ? 'error' : 'warn', 'Secrets stay in env', `Job "${id}": a secret is written directly in a command${/\becho\b/.test(code) ? ' that prints it' : ''}. Put it in env: and read it as a shell variable. Anything printed to the log can leak.`, rl);
          if (/::(set-output|save-state)\b|\bset-env\b|::add-path\b/.test(code)) add('error', 'Retired commands', `Job "${id}": ::set-output, ::save-state, set-env and add-path stopped working. Write to $GITHUB_OUTPUT, $GITHUB_STATE, $GITHUB_ENV or $GITHUB_PATH instead.`, rl);
          if (/curl[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b/.test(code)) add('warn', 'No blind downloads', `Job "${id}": a script is downloaded and run in one go. If the site is hacked, so are you. Download it, check it, then run it.`, rl);
        }
        // literal secrets
        for (const sect of ['env', 'with']) {
          const m = s[sect];
          if (!isObj(m)) continue;
          for (const [k, v] of Object.entries(m)) {
            if (SECRET_NAME.test(k) && typeof v === 'string' && v && !/\$\{\{/.test(v) && !PLACEHOLDER.test(v)) add('error', 'No secrets in the file', `Job "${id}": ${k} holds a real-looking value written in the file. Use \${{ secrets.NAME }}. Treat this one as leaked and replace it.`, keyLine(m, k));
          }
        }
        // checkout of the pull request's own code under pull_request_target
        if (ev.pull_request_target && hasUses && /^actions\/checkout/.test(strOf(s.uses)) && isObj(s.with) && /github\.event\.pull_request\.head|github\.head_ref/.test(strOf(s.with.ref))) {
          add('error', 'Pull request code is not trusted', `Job "${id}": pull_request_target runs with your secrets, and this step checks out the pull request’s own code. A stranger’s code would run with your secrets.`, keyLine(s.with, 'ref'));
        }
        // expression checks on the whole step
        const stepText = JSON.stringify(s);
        for (const m2 of stepText.matchAll(/\bmatrix\.([A-Za-z_][\w-]*)/g)) {
          if (!mkeys.has(m2[1])) add('error', 'Matrix value exists', `Job "${id}" reads matrix.${m2[1]}, but its matrix has no "${m2[1]}".`, sl);
        }
        for (const m2 of stepText.matchAll(/\bneeds\.([A-Za-z_][\w-]*)/g)) {
          if (!needs.includes(m2[1])) add('error', 'needs lists what it reads', `Job "${id}" reads needs.${m2[1]}, but "${m2[1]}" is not in its needs: list.`, sl);
        }
        for (const m2 of stepText.matchAll(/\bsteps\.([A-Za-z_][\w-]*)\./g)) {
          if (!stepIds.has(m2[1])) add('warn', 'Step ID exists', `Job "${id}" reads steps.${m2[1]}, but no step in this job has "id: ${m2[1]}".`, sl);
        }
      });
    }
    // cycles
    const state = {};
    let cyc = null;
    const walk = (n, stack) => {
      if (cyc || !graph[n]) return;
      if (state[n] === 1) { cyc = [...stack.slice(stack.indexOf(n)), n]; return; }
      if (state[n] === 2) return;
      state[n] = 1;
      for (const m of graph[n]) walk(m, [...stack, n]);
      state[n] = 2;
    };
    for (const id of jobIds) walk(id, []);
    if (cyc) add('error', 'Jobs do not wait in a circle', `These jobs wait for each other forever: ${cyc.join(' → ')}.`);
    if (missingTimeout.length) add('info', 'Jobs have a time limit', `No timeout-minutes on: ${missingTimeout.join(', ')}. A stuck job can run for 6 hours and use your free minutes.`);

    // ${{ must close
    text.split('\n').forEach((l, i) => {
      const t = l.replace(/#.*$/, '');
      if ((t.match(/\$\{\{/g) || []).length !== (t.match(/\}\}/g) || []).length && !/\{\{[a-z]/.test(t)) add('error', 'Expressions are closed', 'A ${{ is not closed with }} on this line.', i + 1);
    });
    return { value, ev, jobs, text };
  }

  // ----- tiny evaluator for "if:" lines. Returns true, false or null (cannot tell).
  function evalCond(expr, ctx) {
    let e = strOf(expr).trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
    if (e === '') return true;
    const tokens = [];
    const re = /\s*(&&|\|\||==|!=|!|\(|\)|,|'(?:[^']|'')*'|[A-Za-z_][\w.\-]*|\d+)/y;
    let m;
    let pos = 0;
    while (pos < e.length && (m = (re.lastIndex = pos, re.exec(e)))) { tokens.push(m[1]); pos = re.lastIndex; }
    if (pos < e.length && e.slice(pos).trim()) return null;
    let i = 0;
    const lit = (t) => (t[0] === "'" ? t.slice(1, -1).replace(/''/g, "'") : t);
    const val = (t) => {
      if (t[0] === "'") return lit(t);
      if (t === 'true') return true;
      if (t === 'false') return false;
      if (/^\d+$/.test(t)) return Number(t);
      if (Object.prototype.hasOwnProperty.call(ctx.vars, t)) return ctx.vars[t];
      return undefined;
    };
    const unknown = Symbol('unknown');
    function primary() {
      const t = tokens[i++];
      if (t === undefined) throw unknown;
      if (t === '!') { const v = primary(); if (v === unknown) return unknown; return !v; }
      if (t === '(') { const v = or(); if (tokens[i++] !== ')') throw unknown; return v; }
      if (tokens[i] === '(') {
        i++;
        const args = [];
        while (tokens[i] !== ')') { if (tokens[i] === undefined) throw unknown; if (tokens[i] === ',') { i++; continue; } args.push(or()); }
        i++;
        const [a, b] = args;
        if (a === unknown || (b === unknown && args.length > 1)) return unknown;
        const fn = t.toLowerCase();
        if (fn === 'always') return true;
        if (fn === 'success') return ctx.success !== false;
        if (fn === 'failure') return false;
        if (fn === 'cancelled') return false;
        if (fn === 'startswith') return strOf(a).toLowerCase().startsWith(strOf(b).toLowerCase());
        if (fn === 'endswith') return strOf(a).toLowerCase().endsWith(strOf(b).toLowerCase());
        if (fn === 'contains') return strOf(a).toLowerCase().includes(strOf(b).toLowerCase());
        return unknown;
      }
      const v = val(t);
      return v === undefined ? unknown : v;
    }
    function eq() {
      let l = primary();
      while (tokens[i] === '==' || tokens[i] === '!=') {
        const op = tokens[i++];
        const r = primary();
        if (l === unknown || r === unknown) { l = unknown; continue; }
        const same = strOf(l).toLowerCase() === strOf(r).toLowerCase();
        l = op === '==' ? same : !same;
      }
      return l;
    }
    function and() {
      let l = eq();
      while (tokens[i] === '&&') { i++; const r = eq(); l = l === false || r === false ? false : l === unknown || r === unknown ? unknown : Boolean(l) && Boolean(r); }
      return l;
    }
    function or() {
      let l = and();
      while (tokens[i] === '||') { i++; const r = and(); l = l === true || r === true ? true : l === unknown || r === unknown ? unknown : Boolean(l) || Boolean(r); }
      return l;
    }
    try {
      const v = or();
      if (i < tokens.length) return null;
      return v === unknown ? null : Boolean(v);
    } catch (x) {
      return null;
    }
  }

  function expandMatrix(strat) {
    if (!strat || !isObj(strat.matrix)) return null;
    const m = strat.matrix;
    const keys = Object.keys(m).filter((k) => k !== 'include' && k !== 'exclude');
    let cells = [{}];
    for (const k of keys) {
      const vals = m[k];
      if (!isArr(vals)) return { unknown: true, keys };
      cells = cells.flatMap((c) => vals.map((v) => ({ ...c, [k]: v })));
    }
    for (const ex of isArr(m.exclude) ? m.exclude : []) {
      if (!isObj(ex)) continue;
      cells = cells.filter((c) => !Object.entries(ex).every(([k, v]) => strOf(c[k]) === strOf(v)));
    }
    for (const inc of isArr(m.include) ? m.include : []) {
      if (!isObj(inc)) continue;
      const hits = cells.filter((c) => keys.every((k) => inc[k] === undefined || strOf(c[k]) === strOf(inc[k])));
      if (hits.length && keys.some((k) => inc[k] !== undefined)) hits.forEach((c) => Object.assign(c, inc));
      else cells.push({ ...inc });
    }
    return { cells, keys };
  }

  const ACTION_NOTES = {
    'actions/checkout': 'copies your repository onto the machine',
    'actions/setup-node': 'installs Node.js',
    'actions/setup-python': 'installs Python',
    'actions/setup-java': 'installs Java',
    'actions/setup-go': 'installs Go',
    'actions/cache': 'restores or saves a cache',
    'actions/upload-artifact': 'saves files from this run for download',
    'actions/download-artifact': 'fetches files an earlier job saved',
    'docker/setup-buildx-action': 'sets up the Docker builder',
    'docker/setup-qemu-action': 'lets the machine build for ARM',
    'docker/login-action': 'signs in to the registry',
    'docker/metadata-action': 'works out image names and tags',
    'docker/build-push-action': 'builds the image (and pushes it when allowed)',
    'actions/configure-pages': 'reads the Pages settings',
    'actions/upload-pages-artifact': 'packs the site for Pages',
    'actions/deploy-pages': 'publishes the site to GitHub Pages',
    'github/codeql-action': 'runs the CodeQL security scan',
  };

  function dryWorkflow(info) {
    const { value, ev, jobs } = info;
    const L = [];
    const mainBranch = (isObj(ev.push) && isArr(ev.push.branches) && strOf(ev.push.branches.find((b) => !/[*!]/.test(strOf(b))))) || 'main';
    const scenarios = [];
    const filt = (e, kind, name) => {
      if (!isObj(e)) return true;
      const list = kind === 'tag' ? e.tags : e.branches;
      const ign = kind === 'tag' ? e['tags-ignore'] : e['branches-ignore'];
      if (kind === 'tag') { if (e.tags === undefined && e.branches !== undefined) return false; } else if (e.branches === undefined && e.tags !== undefined && !e['branches-ignore']) return false;
      if (list !== undefined && !globAny(list, name)) return false;
      if (ign !== undefined && globAny(ign, name)) return false;
      return true;
    };
    if (ev.push) {
      scenarios.push({ label: `A push to the "${mainBranch}" branch`, event: 'push', ref: `refs/heads/${mainBranch}`, name: mainBranch, type: 'branch', ok: filt(ev.push, 'branch', mainBranch) });
      scenarios.push({ label: 'A push to a feature branch ("feature-x")', event: 'push', ref: 'refs/heads/feature-x', name: 'feature-x', type: 'branch', ok: filt(ev.push, 'branch', 'feature-x') });
      if (isObj(ev.push) && (ev.push.tags !== undefined || ev.push['tags-ignore'] !== undefined)) scenarios.push({ label: 'A push of the tag "v1.0.0"', event: 'push', ref: 'refs/tags/v1.0.0', name: 'v1.0.0', type: 'tag', ok: filt(ev.push, 'tag', 'v1.0.0') });
    }
    if (ev.pull_request || ev.pull_request_target) {
      const e = ev.pull_request || ev.pull_request_target;
      scenarios.push({ label: `A pull request into "${mainBranch}"`, event: ev.pull_request ? 'pull_request' : 'pull_request_target', ref: 'refs/pull/7/merge', name: '7/merge', type: 'branch', ok: isObj(e) && e.branches !== undefined ? globAny(e.branches, mainBranch) : true });
    }
    if (ev.schedule) scenarios.push({ label: 'The schedule fires', event: 'schedule', ref: `refs/heads/${mainBranch}`, name: mainBranch, type: 'branch', ok: true });
    if (ev.workflow_dispatch) scenarios.push({ label: 'Someone presses "Run workflow"', event: 'workflow_dispatch', ref: `refs/heads/${mainBranch}`, name: mainBranch, type: 'branch', ok: true });
    for (const k of Object.keys(ev)) if (!['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_dispatch'].includes(k) && GHA_EVENTS.has(k) && scenarios.length < 6) scenarios.push({ label: `The "${k}" event`, event: k, ref: `refs/heads/${mainBranch}`, name: mainBranch, type: 'branch', ok: true, generic: true });

    for (const sc of scenarios) {
      L.push(line(`━━ ${sc.label} ━━`, 'head'));
      if (!sc.ok) {
        L.push(line('No run. This event does not match the branch or tag filters in "on:".', 'skip'));
        L.push(line('# GitHub starts nothing, so nothing appears in the Actions tab.', 'why'));
        continue;
      }
      if (sc.generic) L.push(line('# Stanza does not know this event’s details, so conditions that depend on them are shown as "cannot tell".', 'why'));
      const vars = { 'github.event_name': sc.event, 'github.ref': sc.ref, 'github.ref_name': sc.name, 'github.ref_type': sc.type, 'github.actor': 'you', 'github.repository': 'you/your-repo', 'github.workflow': strOf(value.name) || 'workflow', 'github.base_ref': sc.event.startsWith('pull_request') ? mainBranch : '', 'github.head_ref': sc.event.startsWith('pull_request') ? 'feature-x' : '' };
      const ctx = { vars, success: true };
      L.push(line(`Event: ${sc.event}  ·  ref: ${sc.ref}`, 'out'));
      const ids = Object.keys(jobs);
      const status = {};
      const done = new Set();
      let wave = 0;
      let guard = 0;
      while (done.size < ids.length && guard++ < 20) {
        const ready = ids.filter((id) => !done.has(id) && (isObj(jobs[id]) ? (jobs[id].needs === undefined ? [] : isArr(jobs[id].needs) ? jobs[id].needs.map(strOf) : [strOf(jobs[id].needs)]) : []).every((n) => done.has(n) || !jobs[n]));
        if (!ready.length) break;
        wave++;
        if (ids.length > 1) L.push(line(`# Round ${wave}: ${ready.join(', ')} ${ready.length > 1 ? 'start at the same time' : 'starts'}.`, 'why'));
        for (const id of ready) {
          done.add(id);
          const j = jobs[id];
          if (!isObj(j)) { status[id] = 'skip'; continue; }
          const needs = j.needs === undefined ? [] : isArr(j.needs) ? j.needs.map(strOf) : [strOf(j.needs)];
          const alwaysCond = /always\(\)|failure\(\)|cancelled\(\)/.test(strOf(j.if));
          const skippedNeed = needs.find((n) => status[n] === 'skip');
          if (skippedNeed && !alwaysCond) {
            L.push(line(`Job "${id}": skipped, because "${skippedNeed}" was skipped.`, 'skip'));
            status[id] = 'skip';
            continue;
          }
          if (j.if !== undefined) {
            const r = evalCond(j.if, ctx);
            if (r === false) { L.push(line(`Job "${id}": skipped, its "if:" is false here.`, 'skip')); status[id] = 'skip'; continue; }
            if (r === null) L.push(line(`# Job "${id}" has an "if:" Stanza cannot work out, so it is shown as running.`, 'why'));
          }
          const mx = expandMatrix(isObj(j.strategy) ? j.strategy : null);
          if (mx && mx.unknown) L.push(line(`# Job "${id}" builds its matrix from an expression, so it is shown once.`, 'why'));
          const cells = mx && mx.cells ? mx.cells : [null];
          if (mx && mx.cells) L.push(line(`# Job "${id}" is a matrix: ${cells.length} job(s) at the same time, one for each combination.`, 'why'));
          for (const cell of cells) {
            const sub = (s) => strOf(s).replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (all, k) => (cell && cell[k] !== undefined ? strOf(cell[k]) : all)).replace(/\$\{\{\s*(github\.[\w.]+)\s*\}\}/g, (all, k) => (vars[k] !== undefined ? strOf(vars[k]) : all));
            const suffix = cell && mx.keys.length ? ` (${mx.keys.map((k) => strOf(cell[k])).join(', ')})` : '';
            const jname = sub(strOf(j.name) || id) + (j.name ? '' : suffix);
            const runner = isArr(j['runs-on']) ? j['runs-on'].map(sub).join(', ') : j.uses ? 'a reusable workflow' : sub(strOf(j['runs-on']) || 'a machine');
            L.push(line(`▶ ${jname}`, 'head'));
            if (j.environment) L.push(line(`  # Uses environment "${strOf(isObj(j.environment) ? j.environment.name : j.environment)}". If it has required reviewers, the job waits here for approval.`, 'why'));
            L.push(line(`  Runner: ${runner}`, 'out'));
            if (j.uses) { L.push(line(`  Calls the reusable workflow ${strOf(j.uses)}`, 'ok')); continue; }
            L.push(line('  ✓ Set up job', 'ok'));
            for (const s of isArr(j.steps) ? j.steps : []) {
              if (!isObj(s)) continue;
              const cctx = { ...ctx };
              if (s.if !== undefined) {
                const r = evalCond(sub(s.if), cctx);
                if (r === false) { L.push(line(`  – ${stepLabel(s, sub)}  (skipped: "if:" is false)`, 'skip')); continue; }
                if (r === null) L.push(line(`  # The "if:" on the next step is not something Stanza can work out. Shown as running.`, 'why'));
              }
              if (s.uses !== undefined) {
                const u = usesInfo(s.uses);
                const note = u.kind === 'repo' ? ACTION_NOTES[u.repoKey] || ACTION_NOTES[u.name] || ACTION_NOTES[u.name.split('/').slice(0, 2).join('/')] : null;
                L.push(line(`  ✓ ${stepLabel(s, sub)}${note ? `  → ${note}` : ''}`, 'ok'));
              } else if (s.run !== undefined) {
                L.push(line(`  ✓ ${s.name ? sub(s.name) : 'Run'}`, 'ok'));
                for (const cmd of sub(s.run).split('\n').filter((c) => c.trim()).slice(0, 6)) L.push(line(`    $ ${cmd.trim()}`, 'cmd'));
              }
            }
            L.push(line('  ✓ Complete job', 'ok'));
            status[id] = 'ok';
          }
          if (!status[id]) status[id] = 'ok';
        }
      }
      L.push(line('# Simulated: every command is assumed to succeed. Nothing is run.', 'why'));
    }
    if (!scenarios.length) L.push(line('No scenario to show: this workflow has no events Stanza can walk through.', 'out'));
    return L;
  }

  function stepLabel(s, sub) {
    if (s.name) return sub(s.name);
    if (s.uses !== undefined) return `Run ${sub(s.uses)}`;
    return `Run ${sub(strOf(s.run).split('\n')[0])}`;
  }

  const DEP_ECO = new Set(['bundler', 'cargo', 'composer', 'devcontainers', 'docker', 'docker-compose', 'dotnet-sdk', 'elm', 'github-actions', 'gitsubmodule', 'gomod', 'gradle', 'helm', 'maven', 'mix', 'npm', 'nuget', 'pip', 'pub', 'swift', 'terraform', 'uv', 'bun', 'opentofu', 'conda', 'rust-toolchain', 'vcpkg']);

  function checkDependabot(file, out) {
    const { value, errors } = parseYaml(textOf(file));
    const F = file.path;
    const add = (level, name, detail, ln) => out.push({ file: F, level, name, detail, ...(ln ? { line: ln } : {}) });
    for (const e of errors) add('error', 'YAML syntax', e.msg, e.line);
    if (!errors.length) add('pass', 'YAML syntax', 'The file reads as valid YAML.');
    if (errors.length || !isObj(value)) return null;
    if (value.version !== 2) add('error', 'Version is 2', 'The first line must be "version: 2".', keyLine(value, 'version'));
    else add('pass', 'Version is 2', 'The file format version is right.');
    if (!isArr(value.updates) || !value.updates.length) { add('error', 'Has updates', 'A dependabot.yml needs an "updates:" list with at least one entry.'); return null; }
    for (const u of value.updates) {
      if (!isObj(u)) continue;
      const eco = strOf(u['package-ecosystem']);
      const ul = lineOf(u);
      if (!eco) add('error', 'Ecosystem is named', 'An entry has no "package-ecosystem:".', ul);
      else if (!DEP_ECO.has(eco)) add('error', 'Ecosystem is real', `"${eco}" is not an ecosystem Dependabot knows. Examples: npm, pip, maven, gomod, docker, github-actions.`, keyLine(u, 'package-ecosystem'));
      else add('pass', 'Ecosystem is real', `${eco} is a valid ecosystem.`);
      if (u.directory === undefined && u.directories === undefined) add('error', 'Directory is set', `${eco || 'An entry'} needs "directory:" (use "/" for the top of the project).`, ul);
      else if (typeof u.directory === 'string' && !u.directory.startsWith('/')) add('error', 'Directory starts with /', `directory "${u.directory}" must start with "/".`, keyLine(u, 'directory'));
      if (!isObj(u.schedule) || !u.schedule.interval) add('error', 'Schedule is set', `${eco || 'An entry'} needs "schedule:" with an "interval:".`, ul);
      else if (!['daily', 'weekly', 'monthly', 'quarterly', 'semiannually', 'yearly', 'cron'].includes(strOf(u.schedule.interval))) add('error', 'Interval is valid', `"${u.schedule.interval}" is not an interval. Use daily, weekly or monthly.`, keyLine(u.schedule, 'interval'));
    }
    return value;
  }

  function dryDependabot(value) {
    const L = [line('Dependabot reads .github/dependabot.yml on the default branch:', 'cmd')];
    for (const u of value.updates) {
      if (!isObj(u)) continue;
      const lim = u['open-pull-requests-limit'] === undefined ? 5 : u['open-pull-requests-limit'];
      L.push(line(`${isObj(u.schedule) ? strOf(u.schedule.interval) : '?'}: checks ${strOf(u['package-ecosystem'])} in ${strOf(u.directory || (isArr(u.directories) ? u.directories.join(', ') : '?'))}`, 'changed'));
      L.push(line(`    opens up to ${lim} pull request(s) when a newer version exists`, 'out'));
    }
    L.push(line('# Dependabot is run by GitHub. This is a description, not a real scan.', 'why'));
    return L;
  }

  /* ---------------------------------------------------------------- *
   *  Argo CD (Application, ApplicationSet, AppProject)
   * ---------------------------------------------------------------- */

  const AC_SYNC_OPTS = new Set(['Validate', 'CreateNamespace', 'PrunePropagationPolicy', 'PruneLast', 'Replace', 'ServerSideApply', 'ApplyOutOfSyncOnly', 'RespectIgnoreDifferences', 'FailOnSharedResource', 'SkipDryRunOnMissingResource', 'Force', 'Prune', 'Delete', 'ClientSideApplyMigration']);
  const AC_HOOKS = new Set(['PreSync', 'Sync', 'PostSync', 'SyncFail', 'Skip', 'PostDelete']);
  const AC_GEN = new Set(['list', 'git', 'clusters', 'cluster', 'matrix', 'merge', 'scmProvider', 'pullRequest', 'clusterDecisionResource', 'plugin']);
  const AC_DUR = /^\d+(ms|s|m|h)$/;
  const AC_BUILTIN = new Set(['name', 'server', 'path', 'metadata', 'values', 'nameNormalized', 'project', 'branch', 'number', 'head_sha', 'labels', 'basename', 'basenameNormalized', 'segments', 'index']);

  function acDocs(text) {
    const lines = text.split('\n');
    const docs = [];
    let cur = { start: 0, lines: [] };
    const real = (d) => d.lines.some((x) => x.trim() && !x.trim().startsWith('#'));
    for (let i = 0; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i])) {
        if (real(cur)) docs.push(cur);
        cur = { start: i + 1, lines: [] };
      } else cur.lines.push(lines[i]);
    }
    if (real(cur)) docs.push(cur);
    return docs;
  }

  function acRepoCheck(url, ln, add) {
    if (/^https?:\/\/[^/@\s]+:[^/@\s]*@/.test(url) || /^https?:\/\/[^/@\s]*(token|ghp_|glpat-)[^/@\s]*@/i.test(url)) add('error', 'No password in the address', 'The repository address contains a login. Anyone who can read Git can read it. Add the repository with a Secret instead.', ln);
    else if (/^http:\/\//.test(url)) add('warn', 'Repository uses https', `"${url}" is plain http. Use https:// so nothing travels unencrypted.`, ln);
    else if (!/^(https:\/\/[^/\s]+\/\S+|ssh:\/\/git@\S+|git@[\w.-]+:\S+)$/.test(url)) add('error', 'Repository address looks right', `"${url}" is not an address Argo CD can use. Use https://host/owner/repo.git or git@host:owner/repo.git.`, ln);
    else add('pass', 'Repository address looks right', 'The repository address has a valid shape.');
  }

  function acSpec(spec, where, add, tpl) {
    // `tpl` true: values may hold {{ }} placeholders, so format rules are relaxed.
    const holes = (s) => tpl && /\{\{/.test(String(s));
    if (!isObj(spec)) { add('error', 'Has a spec', `${where} has no "spec:" section.`); return; }
    if (spec.project === undefined) add('error', 'Project is set', 'spec.project is missing. Name a project, for example "default".', lineOf(spec));
    else add('pass', 'Project is set', `Belongs to project "${spec.project}".`);
    const srcs = isArr(spec.sources) ? spec.sources : null;
    if (spec.source !== undefined && spec.sources !== undefined) add('error', 'One kind of source', 'Use "source" or "sources", not both.', keyLine(spec, 'sources'));
    const list = srcs || (isObj(spec.source) ? [spec.source] : []);
    if (!list.length) add('error', 'Has a source', 'No "source:" (or "sources:") was found. Argo CD needs to know where the config is.', lineOf(spec));
    for (const s of list) {
      if (!isObj(s)) continue;
      const ln = keyLine(s, 'repoURL');
      if (!s.repoURL) add('error', 'Repository is set', 'A source has no "repoURL:".', lineOf(s));
      else if (!holes(s.repoURL)) acRepoCheck(strOf(s.repoURL), ln, add);
      if (!s.path && !s.chart && !s.ref) add('error', 'Path or chart is set', 'A source needs "path:" (a folder in Git) or "chart:" (a Helm chart).', lineOf(s));
      if (s.path && s.chart) add('error', 'Path or chart, not both', 'Use "path" for Git or "chart" for a Helm repository.', keyLine(s, 'chart'));
      if (s.path !== undefined && !holes(s.path)) {
        const p = strOf(s.path);
        if (p.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(p)) add('error', 'Path stays inside the repository', `path "${p}" must be relative to the repository and must not use "..".`, keyLine(s, 'path'));
        else add('pass', 'Path stays inside the repository', `Reads the folder "${p}".`);
      }
      if (s.chart && s.targetRevision === undefined) add('warn', 'Chart version is pinned', 'No targetRevision for the chart. Give a version, or the newest one is used.', lineOf(s));
      if (s.targetRevision === undefined && !s.chart && !s.ref) add('info', 'Revision is set', 'No targetRevision, so Argo CD uses HEAD (the default branch).', lineOf(s));
      else if (/^(HEAD|main|master)$/.test(strOf(s.targetRevision)) && !s.chart) add('info', 'Revision follows a branch', `"${s.targetRevision}" moves with every push. A tag or commit stays put.`, keyLine(s, 'targetRevision'));
    }
    const d = spec.destination;
    if (!isObj(d)) add('error', 'Destination is set', 'No "destination:". Say which cluster and namespace to deploy to.', lineOf(spec));
    else {
      if (d.server && d.name) add('error', 'Server or name, not both', 'A destination uses "server" or "name" to pick the cluster, not both.', keyLine(d, 'name'));
      else if (!d.server && !d.name) add('error', 'Cluster is named', 'destination needs "server:" or "name:".', lineOf(d));
      else add('pass', 'Cluster is named', 'The destination cluster is named.');
      const ns = strOf(d.namespace);
      if (!ns) add('warn', 'Namespace is set', 'No destination namespace. Resources without their own namespace land in "default".', lineOf(d));
      else if (['kube-system', 'argocd', 'kube-public'].includes(ns)) add('warn', 'Not a system namespace', `Deploying into "${ns}" mixes your app with the cluster's own parts.`, keyLine(d, 'namespace'));
    }
    const sp = spec.syncPolicy;
    if (isObj(sp)) {
      if (isObj(sp.automated)) {
        const a = sp.automated;
        if (a.prune === true) add('info', 'Prune is on', 'Resources removed from Git are deleted from the cluster. Check this before moving files around.', keyLine(a, 'prune'));
        if (a.allowEmpty === true) add('warn', 'allowEmpty is on', 'If the folder ever renders nothing, Argo CD will delete everything. Leave this off unless needed.', keyLine(a, 'allowEmpty'));
        if (a.selfHeal === true) add('info', 'Self-heal is on', 'Changes made by hand in the cluster are undone.', keyLine(a, 'selfHeal'));
      } else add('info', 'Sync is manual', 'No "automated:" block, so syncs happen only when you press Sync.', keyLine(sp, 'automated'));
      if (isArr(sp.syncOptions)) for (const o of sp.syncOptions) {
        const t = strOf(o);
        const m = /^([A-Za-z]+)=(.+)$/.exec(t);
        const ol = keyLine(sp, 'syncOptions');
        if (!m) add('error', 'Sync option format', `"${t}" must look like Name=value, for example CreateNamespace=true.`, ol);
        else if (!AC_SYNC_OPTS.has(m[1])) add('warn', 'Sync option is known', `"${m[1]}" is not a sync option Argo CD knows. Check the spelling (names are case-sensitive).`, ol);
        else if (m[1] === 'Replace' && m[2] === 'true') add('warn', 'Replace=true is risky', 'Argo CD deletes and re-creates resources instead of patching them. That can cause downtime.', ol);
        else if (!/^(true|false)$/.test(m[2]) && !['PrunePropagationPolicy'].includes(m[1])) add('warn', 'Sync option value', `"${t}": the value is normally true or false.`, ol);
      }
      if (isObj(sp.retry)) {
        const r = sp.retry;
        if (r.limit !== undefined && typeof r.limit !== 'number') add('error', 'Retry limit is a number', `retry.limit "${r.limit}" must be a number.`, keyLine(r, 'limit'));
        if (isObj(r.backoff)) for (const k of ['duration', 'maxDuration']) if (r.backoff[k] !== undefined && !AC_DUR.test(strOf(r.backoff[k]))) add('error', 'Backoff time format', `backoff.${k} "${r.backoff[k]}" must look like 5s, 3m or 1h.`, keyLine(r.backoff, k));
        if (isObj(r.backoff) && r.backoff.factor !== undefined && typeof r.backoff.factor !== 'number') add('error', 'Backoff factor is a number', 'backoff.factor must be a number, such as 2.', keyLine(r.backoff, 'factor'));
      }
    } else add('info', 'Sync is manual', 'No syncPolicy, so syncs happen only when you press Sync.', lineOf(spec));
    if (isArr(spec.ignoreDifferences)) for (const e of spec.ignoreDifferences) {
      if (!isObj(e)) continue;
      if (!e.kind && !e.jsonPointers && !e.jqPathExpressions && !e.managedFieldsManagers) add('error', 'ignoreDifferences is complete', 'An entry says nothing to ignore. Add jsonPointers, jqPathExpressions or managedFieldsManagers.', lineOf(e));
      if (e.kind === undefined && !e.managedFieldsManagers) add('warn', 'ignoreDifferences names a kind', 'Without "kind:" the rule applies to every resource.', lineOf(e));
      if (isArr(e.jsonPointers)) for (const p of e.jsonPointers) if (!String(p).startsWith('/')) add('error', 'JSON pointer starts with /', `"${p}" must start with "/", for example /spec/replicas.`, keyLine(e, 'jsonPointers'));
    }
  }

  function acMeta(v, out, add) {
    const m = isObj(v.metadata) ? v.metadata : {};
    const nm = strOf(m.name);
    if (!nm && !(isObj(m) && m.generateName)) add('error', 'Has a name', 'metadata.name is missing.', keyLine(v, 'metadata'));
    else if (nm && !/\{\{/.test(nm)) {
      if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(nm) || nm.length > 253) add('error', 'Name is valid', `"${nm}" must use lowercase letters, digits, "-" and "." only, and start and end with a letter or digit.`, keyLine(m, 'name'));
      else add('pass', 'Name is valid', `The name "${nm}" is fine.`);
    }
    if (m.namespace !== undefined && m.namespace !== 'argocd') add('warn', 'Lives in the Argo CD namespace', `Argo CD only reads these objects from its own namespace (normally "argocd"), not "${m.namespace}".`, keyLine(m, 'namespace'));
    const ann = isObj(m.annotations) ? m.annotations : {};
    const w = ann['argocd.argoproj.io/sync-wave'];
    if (w !== undefined && !/^-?\d+$/.test(strOf(w))) add('error', 'Sync wave is a whole number', `sync-wave "${w}" must be a whole number written as text, like "1".`, keyLine(m, 'annotations'));
    const h = ann['argocd.argoproj.io/hook'];
    if (h !== undefined) for (const x of strOf(h).split(',').map((s) => s.trim())) if (!AC_HOOKS.has(x)) add('error', 'Hook phase is valid', `hook "${x}" is not a phase. Use PreSync, Sync, PostSync or SyncFail.`, keyLine(m, 'annotations'));
    if (isArr(m.finalizers)) for (const f of m.finalizers) {
      const t = strOf(f);
      if (/^resources-finalizer\.argocd\.argoproj\.io(\/(background|foreground))?$/.test(t)) add('pass', 'Finalizer is spelled right', 'Deleting this app also deletes what it deployed.', keyLine(m, 'finalizers'));
      else if (/argocd/i.test(t) && /finalizer/i.test(t)) add('error', 'Finalizer is spelled right', `"${t}" is not the real name, so it is ignored. Use resources-finalizer.argocd.argoproj.io.`, keyLine(m, 'finalizers'));
    } else if (v.kind === 'Application') add('info', 'No finalizer', 'Deleting this Application leaves what it deployed running with nothing managing it. Add resources-finalizer.argocd.argoproj.io to delete both.', keyLine(v, 'metadata'));
  }

  function acProject(v, add) {
    const s = isObj(v.spec) ? v.spec : {};
    const pname = strOf(isObj(v.metadata) ? v.metadata.name : '');
    if (!isArr(s.sourceRepos) || !s.sourceRepos.length) add('warn', 'Repositories are limited', 'No sourceRepos: no application can use this project.', lineOf(s));
    else if (s.sourceRepos.includes('*')) add('warn', 'Repositories are limited', 'sourceRepos "*" lets any repository deploy through this project.', keyLine(s, 'sourceRepos'));
    else add('pass', 'Repositories are limited', `${s.sourceRepos.length} repository pattern(s) allowed.`);
    if (!isArr(s.destinations) || !s.destinations.length) add('warn', 'Destinations are limited', 'No destinations: no application can deploy through this project.', lineOf(s));
    else for (const d of s.destinations) {
      if (!isObj(d)) continue;
      if (d.namespace === '*' || d.server === '*' || d.name === '*') add('warn', 'Destinations are limited', 'A destination uses "*", so apps can deploy to every namespace or cluster.', lineOf(d));
      if (d.server && d.name) add('error', 'Server or name, not both', 'A destination uses "server" or "name", not both.', lineOf(d));
    }
    for (const k of ['clusterResourceWhitelist', 'namespaceResourceBlacklist', 'clusterResourceBlacklist', 'namespaceResourceWhitelist']) {
      if (isArr(s[k])) for (const e of s[k]) if (isObj(e) && e.group === '*' && e.kind === '*' && /Whitelist/.test(k)) add('warn', 'Resource kinds are limited', `${k} allows every kind, including cluster-wide ones such as ClusterRole.`, lineOf(e));
    }
    if (isArr(s.roles)) for (const r of s.roles) {
      if (!isObj(r)) continue;
      const rn = strOf(r.name);
      for (const p of isArr(r.policies) ? r.policies : []) {
        const parts = strOf(p).split(',').map((x) => x.trim());
        const pl = keyLine(r, 'policies');
        if (parts.length !== 6 || parts[0] !== 'p') { add('error', 'Policy has six parts', `"${p}" must be: p, proj:PROJECT:ROLE, resource, action, PROJECT/object, allow|deny.`, pl); continue; }
        if (parts[1] !== `proj:${pname}:${rn}`) add('error', 'Policy names its role', `"${parts[1]}" should be proj:${pname}:${rn}.`, pl);
        if (!/^(allow|deny)$/.test(parts[5])) add('error', 'Policy effect', `"${parts[5]}" must be allow or deny.`, pl);
        if (!parts[4].startsWith(`${pname}/`) && parts[4] !== '*') add('error', 'Policy stays in the project', `"${parts[4]}" should start with "${pname}/".`, pl);
        if (parts[3] === '*' && parts[5] === 'allow') add('warn', 'Policy is narrow', 'Action "*" allows everything, including delete and override.', pl);
      }
    }
    add('pass', 'Project is a fence', 'The project has the parts Argo CD expects.');
  }

  function acSet(v, add) {
    const s = isObj(v.spec) ? v.spec : {};
    const gens = isArr(s.generators) ? s.generators : [];
    if (!gens.length) add('error', 'Has a generator', 'An ApplicationSet needs "generators:" with at least one entry.', lineOf(s));
    for (const g of gens) {
      if (!isObj(g)) continue;
      const keys = Object.keys(g).filter((k) => AC_GEN.has(k));
      if (keys.length !== 1) add('error', 'One generator type per entry', `Each generator entry uses exactly one type (${[...AC_GEN].slice(0, 4).join(', ')}...). Found ${keys.length}.`, lineOf(g));
    }
    const t = isObj(s.template) ? s.template : null;
    if (!t) { add('error', 'Has a template', 'No "template:". It describes the Applications to make.', lineOf(s)); return null; }
    const tname = strOf(isObj(t.metadata) ? t.metadata.name : '');
    if (!tname) add('error', 'Template has a name', 'template.metadata.name is missing.', lineOf(t));
    else if (!/\{\{/.test(tname)) add('error', 'Template name varies', `"${tname}" has no placeholder, so every generated Application would get the same name.`, lineOf(t));
    else add('pass', 'Template name varies', 'The name uses a placeholder, so each Application is unique.');
    const raw = JSON.stringify(t);
    const go = s.goTemplate === true;
    if (go && /\{\{\s*[A-Za-z_][\w-]*\s*\}\}/.test(raw)) add('warn', 'Placeholder style', 'goTemplate is on, but a placeholder has no dot. Write {{ .name }}, not {{name}}.', keyLine(s, 'goTemplate'));
    if (!go && /\{\{\s*\./.test(raw)) add('warn', 'Placeholder style', 'A placeholder starts with a dot, but goTemplate is off. Add "goTemplate: true", or write {{name}}.', keyLine(s, 'goTemplate'));
    if (go && !(isArr(s.goTemplateOptions) && s.goTemplateOptions.includes('missingkey=error'))) add('info', 'Missing keys are caught', 'Add goTemplateOptions: ["missingkey=error"] so a typo in a placeholder fails loudly instead of making an empty name.', keyLine(s, 'goTemplate'));
    if (isObj(s.syncPolicy) && s.syncPolicy.preserveResourcesOnDeletion === true) add('info', 'Apps survive deletion', 'preserveResourcesOnDeletion keeps deployed resources when the ApplicationSet is deleted.', keyLine(s, 'syncPolicy'));
    acSpec(t.spec, 'The template', add, true);
    // list generator: names must be unique, and placeholders must exist
    const lg = gens.length === 1 && isObj(gens[0]) && isObj(gens[0].list) && isArr(gens[0].list.elements) ? gens[0].list.elements.filter(isObj) : null;
    if (lg) {
      const have = new Set();
      for (const e of lg) for (const k of Object.keys(e)) have.add(k);
      for (const m of raw.matchAll(/\{\{\s*\.([A-Za-z_]\w*)/g)) if (!have.has(m[1]) && !AC_BUILTIN.has(m[1])) { add('error', 'Placeholder has a value', `The template uses {{ .${m[1]} }}, but no list element has a "${m[1]}" key.`, lineOf(t)); break; }
      const nk = /^\{\{\s*\.(\w+)\s*\}\}$/.exec(tname) || /\{\{\s*\.(\w+)\s*\}\}/.exec(tname);
      if (nk) {
        const vals = lg.map((e) => strOf(e[nk[1]]));
        const dup = vals.find((x, i) => x && vals.indexOf(x) !== i);
        if (dup) add('error', 'Names are unique', `Two list elements give "${nk[1]}" the value "${dup}", so two Applications would share a name.`, lineOf(gens[0]));
      }
    }
    return { gens, t, lg, tname, go };
  }

  function checkArgo(file, out) {
    const text = textOf(file);
    const F = file.path;
    const results = [];
    for (const doc of acDocs(text)) {
      const off = doc.start;
      const add = (level, name, detail, ln) => out.push({ file: F, level, name, detail, ...(ln ? { line: ln + off } : {}) });
      const { value: v, errors } = parseYaml(doc.lines.join('\n'));
      for (const e of errors) add('error', 'YAML syntax', e.msg, e.line);
      if (errors.length || !isObj(v)) { if (!errors.length) add('error', 'YAML syntax', 'This part of the file is not a YAML mapping.'); continue; }
      if (!errors.length) add('pass', 'YAML syntax', 'The file reads as valid YAML.');
      const av = strOf(v.apiVersion);
      if (!av.startsWith('argoproj.io/')) { add('error', 'apiVersion is Argo CD', `apiVersion "${av}" should be argoproj.io/v1alpha1.`, keyLine(v, 'apiVersion')); continue; }
      if (av !== 'argoproj.io/v1alpha1') add('warn', 'apiVersion is known', `"${av}" is not the usual argoproj.io/v1alpha1.`, keyLine(v, 'apiVersion'));
      else add('pass', 'apiVersion is right', 'argoproj.io/v1alpha1 is the version Argo CD uses.');
      const kind = strOf(v.kind);
      if (!['Application', 'ApplicationSet', 'AppProject'].includes(kind)) { add('error', 'Kind is known', `"${kind}" is not an Application, ApplicationSet or AppProject.`, keyLine(v, 'kind')); continue; }
      add('pass', 'Kind is known', `This is an ${kind}.`);
      acMeta(v, out, add);
      let info = null;
      if (kind === 'Application') acSpec(v.spec, 'This Application', add, false);
      else if (kind === 'ApplicationSet') info = acSet(v, add);
      else acProject(v, add);
      results.push({ kind, v, info });
    }
    return results;
  }

  const acSub = (s, el) => String(s).replace(/\{\{\s*\.(\w+)\s*\}\}/g, (m, k) => (el && el[k] !== undefined ? strOf(el[k]) : m));

  function dryArgo(r) {
    const { kind, v } = r;
    const L = [];
    const name = strOf(v.metadata && v.metadata.name);
    if (kind === 'AppProject') {
      const s = isObj(v.spec) ? v.spec : {};
      L.push(line(`Project "${name}" is a fence. Applications in it may only:`, 'cmd'));
      for (const x of isArr(s.sourceRepos) ? s.sourceRepos : []) L.push(line(`  read from   ${x}`, 'out'));
      for (const d of isArr(s.destinations) ? s.destinations : []) if (isObj(d)) L.push(line(`  deploy to   ${strOf(d.server || d.name)}  namespace ${strOf(d.namespace)}`, 'out'));
      L.push(line(isArr(s.clusterResourceWhitelist) && s.clusterResourceWhitelist.length ? '  create cluster-wide: ' + s.clusterResourceWhitelist.map((e) => `${strOf(e.group) || 'core'}/${strOf(e.kind)}`).join(', ') : '  create cluster-wide resources: none (Namespaces, ClusterRoles... are refused)', 'out'));
      for (const ro of isArr(s.roles) ? s.roles : []) if (isObj(ro)) L.push(line(`  role ${strOf(ro.name)}: ${(isArr(ro.policies) ? ro.policies : []).length} rule(s)`, 'out'));
      L.push(line('An application that asks for anything else is refused: "not permitted in project".', 'why'));
      return L;
    }
    if (kind === 'ApplicationSet') {
      const info = r.info;
      L.push(line(`ApplicationSet "${name}" makes Applications from its generator:`, 'cmd'));
      if (info && info.lg) {
        for (const e of info.lg) L.push(line(`  creates Application  ${acSub(info.tname, e)}`, 'changed'));
      } else if (info && info.gens[0] && isObj(info.gens[0].git)) {
        const g = info.gens[0].git;
        L.push(line(`  looks in ${strOf(g.repoURL)} (${strOf(g.revision)})`, 'out'));
        for (const d of isArr(g.directories) ? g.directories : []) if (isObj(d)) L.push(line(`  one Application for each folder matching ${strOf(d.path)}`, 'changed'));
        L.push(line('  adding a folder adds an Application. Deleting a folder removes one.', 'why'));
      } else if (info && info.gens[0] && isObj(info.gens[0].clusters)) L.push(line('  one Application for each cluster registered in Argo CD', 'changed'));
      else L.push(line('  one Application for every item the generator returns', 'out'));
      L.push(line('Deleting the ApplicationSet deletes the Applications it made.', 'why'));
      return L;
    }
    const spec = v.spec;
    const sp = isObj(spec.syncPolicy) ? spec.syncPolicy : {};
    const auto = isObj(sp.automated) ? sp.automated : null;
    const src = isObj(spec.source) ? spec.source : isArr(spec.sources) && isObj(spec.sources[0]) ? spec.sources[0] : {};
    const fin = isObj(v.metadata) && isArr(v.metadata.finalizers) && v.metadata.finalizers.some((f) => /^resources-finalizer/.test(strOf(f)));
    L.push(line(`Application "${name}":`, 'cmd'));
    L.push(line(`  reads   ${strOf(src.repoURL)}  at ${strOf(src.targetRevision || 'HEAD')}  folder ${strOf(src.path || src.chart || '')}`, 'out'));
    L.push(line(`  target  ${strOf(isObj(spec.destination) ? spec.destination.server || spec.destination.name : '')}  namespace ${strOf(isObj(spec.destination) ? spec.destination.namespace : '')}`, 'out'));
    L.push(line('', 'out'));
    L.push(line('When you push a change to Git:', 'cmd'));
    L.push(line(auto ? '  Argo CD sees it within about 3 minutes and syncs by itself.' : '  Status turns OutOfSync. Nothing changes until you press Sync (argocd app sync).', 'changed'));
    L.push(line('When someone edits a resource by hand in the cluster:', 'cmd'));
    L.push(line(auto && auto.selfHeal ? '  Argo CD puts it back to what Git says (self-heal).' : '  Status turns OutOfSync, but the hand edit stays until the next sync.', 'changed'));
    L.push(line('When a file is deleted from Git:', 'cmd'));
    L.push(line(auto && auto.prune ? '  The resource is deleted from the cluster (prune).' : '  The resource stays in the cluster, shown as needing pruning.', 'changed'));
    L.push(line('When a sync fails:', 'cmd'));
    L.push(line(isObj(sp.retry) ? `  Argo CD tries again, up to ${strOf(sp.retry.limit)} time(s), waiting longer each time.` : '  The sync stops with Failed. Fix Git or the cluster, then sync again.', 'changed'));
    L.push(line('When this Application is deleted:', 'cmd'));
    L.push(line(fin ? '  Everything it deployed is deleted too (finalizer).' : '  The deployed resources keep running, with nothing managing them.', 'changed'));
    L.push(line('# Argo CD runs in your cluster. This is a description, not a real sync.', 'why'));
    return L;
  }

  /* ---------------------------------------------------------------- *
   *  Entry point
   * ---------------------------------------------------------------- */

  function test(files) {
    const checks = [];
    const runs = [];
    const skipped = [];
    const inv = inventoryOf(files);
    let tf = null;
    let tfDone = false;

    const roleTasks = (name) => {
      const f = files.find((x) => new RegExp(`roles/${name}/tasks/main\\.ya?ml$`).test(x.path));
      if (!f) return null;
      const v = parseYaml(textOf(f)).value;
      return isArr(v) ? v : null;
    };

    for (const f of files) {
      const p = f.path;
      const b = base(p);
      try {
        if (b === 'inventory.ini') {
          checkInventory(f, checks);
          if (inv) runs.push({ title: 'What Ansible sees in this inventory', note: 'Simulated: shows how Ansible would group your machines.', lines: dryInventory(f, inv) });
        } else if (b === 'ansible.cfg') checkAnsibleCfg(f, checks);
        else if (/\.tf$/.test(p)) {
          if (!tfDone) {
            tfDone = true;
            tf = checkTerraform(files, checks);
            if (tf) runs.push({ title: 'What Terraform would do', note: 'Simulated: Stanza reads your .tf files and shows init, validate and plan. It never contacts AWS.', lines: dryTerraform(tf, files) });
          }
        } else if (b === 'terraform.tfvars') checkTfvars(f, checks);
        else if (b === '.gitignore') checkGitignore(f, files, checks);
        else if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) {
          const w = checkWorkflow(f, files, checks);
          if (w) runs.push({ title: 'What GitHub would do', note: 'Simulated: Stanza walks through your triggers and jobs the way GitHub would. Your own commands are not run.', lines: dryWorkflow(w) });
        } else if (/(^|\/)\.github\/dependabot\.ya?ml$/.test(p)) {
          const d = checkDependabot(f, checks);
          if (d) runs.push({ title: 'What Dependabot would do', note: 'Simulated: describes what Dependabot would watch.', lines: dryDependabot(d) });
        } else if (/\.ya?ml$/.test(p) && /^apiVersion:\s*argoproj\.io\//m.test(textOf(f))) {
          for (const r of checkArgo(f, checks)) runs.push({ title: `What Argo CD would do: ${r.kind} ${strOf(r.v.metadata && r.v.metadata.name)}`.trim(), note: 'Simulated: describes what Argo CD would do with this file. Nothing contacts a cluster.', lines: dryArgo(r) });
        } else if (b === 'Jenkinsfile') {
          const info = checkJenkinsfile(f, checks);
          if (info && info.pipe) runs.push({ title: 'What Jenkins would do', note: 'Simulated: Stanza walks through your stages the way Jenkins would. Your own commands are not run.', lines: dryJenkins(info) });
        } else if (/\.groovy$/.test(p)) checkGroovyLib(f, checks);
        else if (b === 'plugins.txt') checkPlugins(f, checks);
        else if (b === 'Dockerfile') checkDockerfile(f, files, checks);
        else if (b === 'docker-compose.yml' || /docker-compose\..*\.ya?ml$/.test(b)) {
          const c = checkCompose(f, files, checks);
          if (c) runs.push({ title: 'What Docker Compose would do', note: 'Simulated: shows what "docker compose up -d" would create.', lines: dryCompose(f, c) });
        } else if (b === 'jenkins.yaml') {
          const v = checkCasc(f, files, checks);
          if (v) runs.push({ title: 'What Jenkins would configure', note: 'Simulated: lists what the Configuration as Code file sets up when Jenkins starts.', lines: dryCasc(v) });
        } else if (b === '.env.example') checkEnvExample(f, checks);
        else if (/\.sh$/.test(p)) {
          if (b === 'adhoc-command.sh') {
            const info = checkAdhoc(f, checks);
            if (info) runs.push({ title: 'What this ad-hoc command would do', note: 'Simulated: shows the kind of output Ansible prints for each machine.', lines: dryAdhoc(info, inv) });
          } else {
            checkShell(f, checks);
            runs.push({ title: 'What this script would do', note: 'Simulated: lists the commands in order. Nothing is run.', lines: dryShell(f) });
          }
        } else if (/\.ya?ml$/.test(p)) {
          const r = checkAnsibleYaml(f, files, checks);
          if (r && r.kind === 'plays' && r.info) {
            for (const play of r.info.plays) if (play.hosts) runs.push({ title: `What Ansible would do: ${play.name || play.hosts}`, note: 'Simulated "check mode": shows what each task would report. Nothing is changed.', lines: dryAnsiblePlay(play, files, inv, roleTasks) });
          } else if (r && r.kind === 'tasks' && r.info && r.info.taskFile) {
            skipped.push(p + ' (the role runs when a play uses it)');
          }
        } else if (/\.(md|j2|txt)$/.test(p)) skipped.push(p);
      } catch (e) {
        checks.push({ file: p, level: 'warn', name: 'Could not check', detail: 'The checker hit a problem reading this file: ' + e.message });
      }
    }
    const counts = { pass: 0, warn: 0, error: 0, info: 0 };
    for (const c of checks) counts[c.level]++;
    return { checks, runs, counts, skipped };
  }

  return { test, parseYaml };
})();

if (typeof module !== 'undefined') module.exports = { Tester };

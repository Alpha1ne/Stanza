'use strict';

/*
  app.js — the page logic.
  Reads the tool definitions from tools.js, draws the explorer and the form,
  and redraws the file every time an answer changes. It never uses innerHTML,
  so whatever a person types can only ever be shown as plain text.
*/

(() => {
  const $ = (sel) => document.querySelector(sel);

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'for') node.htmlFor = value;
      else if (key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
      else node[key] = value;
    }
    for (const kid of kids) if (kid != null) node.append(kid);
    return node;
  }

  /* ---------- Icons (drawn here, no files needed) ---------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    inventory: [
      'M4.5 4h15A1.5 1.5 0 0 1 21 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 8.5v-3A1.5 1.5 0 0 1 4.5 4z',
      'M4.5 14h15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-3A1.5 1.5 0 0 1 4.5 14z',
      'M7 7h.01',
      'M7 17h.01',
    ],
    adhoc: ['M4 6l6 6-6 6', 'M13 18h7'],
    playbook: [
      'M9 6h11',
      'M9 12h11',
      'M9 18h11',
      'M3.5 6.2l1.3 1.3 2.2-2.4',
      'M3.5 12.2l1.3 1.3 2.2-2.4',
      'M3.5 18.2l1.3 1.3 2.2-2.4',
    ],
    role: ['M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.2h7.5A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z'],
    chevron: ['M9 6l6 6-6 6'],
    sun: [
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
      'M12 2v2',
      'M12 20v2',
      'M4.9 4.9l1.4 1.4',
      'M17.7 17.7l1.4 1.4',
      'M2 12h2',
      'M20 12h2',
      'M4.9 19.1l1.4-1.4',
      'M17.7 6.3l1.4-1.4',
    ],
    moon: ['M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2z'],
    copy: [
      'M9.5 9h8.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
      'M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16',
    ],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
    archive: ['M4 8h16v12H4z', 'M3 4h18v4H3z', 'M10 12.5h4'],
    notes: ['M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'],
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
    commands: ['M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z', 'M8 9.5l2.6 2.5L8 14.5', 'M13 15h3.5'],
    provider: ['M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5z'],
    sg: ['M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z', 'M9 12l2 2 4-4'],
    ec2: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M9 3v4', 'M15 3v4', 'M9 17v4', 'M15 17v4', 'M3 9h4', 'M3 15h4', 'M17 9h4', 'M17 15h4'],
    s3: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
    modules: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9'],
    resources: ['M12 3l9 4.5-9 4.5-9-4.5z', 'M3 12l9 4.5 9-4.5', 'M3 16.5l9 4.5 9-4.5'],
    concepts: ['M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5z', 'M5 5.5v16', 'M9 8h6'],
  };

  function icon(name, cls = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `icon ${cls}`.trim());
    for (const d of ICONS[name] || []) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  // Safe local storage: private windows and blocked storage must not break the page.
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* the page works without it */
      }
    },
  };

  let suite = SUITES[0];
  let tool = suite.tools[0];
  let view = 'tool'; // 'tool' (a generator), 'reference' (Commands, Modules, Concepts) or 'planned'
  let refId = null;
  let currentFiles = null; // [{ path, label, lines }] or null when the form has errors
  let activePath = null;
  let currentValues = null;
  let compileNext = false; // play the line-by-line reveal on the next draw only
  const prevText = {}; // the last text of each file, so we can see what an edit changed
  const changedTabs = new Set(); // files that changed while you were looking at another one

  /* ---------- Theme ---------- */

  const root = document.documentElement;
  const systemDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const currentTheme = () => root.dataset.theme || (systemDark() ? 'dark' : 'light');

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const next = theme === 'dark' ? 'light' : 'dark';
    const btn = $('#theme');
    btn.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', `Switch to the ${next} theme`);
    btn.title = `Switch to the ${next} theme`;
    // Match the browser's own chrome to the top bar.
    $('#theme-color').setAttribute('content', getComputedStyle(root).getPropertyValue('--panel').trim() || '#ffffff');
  }

  function wireTheme() {
    applyTheme(currentTheme());
    $('#theme').addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      store.set('stanza-theme', next);
    });
  }

  /* ---------- Explorer: tools, and the generators inside each one ---------- */

  const hrefFor = (s, t) => `#/${s.id}${t ? '/' + t.id : ''}`;

  function renderNav() {
    const nav = $('#explorer');
    nav.replaceChildren();

    for (const s of SUITES) {
      const open = s === suite && s.tools.length > 0;
      const group = el('div', { class: 'group' });

      const link = el('a', { class: 'suite', href: hrefFor(s) });
      link.append(el('img', { src: s.icon, alt: '', width: 24, height: 24 }), el('span', { text: s.label }));
      if (!s.tools.length) link.append(el('span', { class: 'soon', text: 'soon' }));
      else link.append(icon('chevron', 'chev'));
      if (open) link.dataset.open = 'true';
      if (s === suite && view === 'planned') link.setAttribute('aria-current', 'page');
      group.append(link);

      if (open) {
        const list = el('ul', { class: 'tree' });
        for (const t of s.tools) {
          const leaf = el('a', { class: 'leaf', href: hrefFor(s, t) });
          leaf.append(icon(t.id), el('span', { text: t.label }));
          if (t === tool) leaf.setAttribute('aria-current', 'page');
          list.append(el('li', {}, leaf));
        }
        for (const r of s.references || []) {
          const ref = el('a', { class: 'leaf', href: `#/${s.id}/${r.id}` });
          ref.append(icon(r.id), el('span', { text: r.label }));
          if (view === 'reference' && s === suite && refId === r.id) ref.setAttribute('aria-current', 'page');
          list.append(el('li', {}, ref));
        }
        group.append(list);
      }
      nav.append(group);
    }
  }

  // On wide screens the file tabs live in the top bar, like a nav row. On phones they
  // stay on top of the editor. They are hidden on pages that have no files.
  const wideTabs = window.matchMedia ? matchMedia('(min-width: 48.01rem)') : { matches: true };
  function placeTabs() {
    const row = $('#tabrow');
    if (wideTabs.matches) $('.topbar').insertBefore(row, $('.top-actions'));
    else $('.editor').prepend(row);
  }

  function setTabsShown(on) {
    $('#tabrow').hidden = !on;
    $('.topbar').dataset.tabs = String(on);
  }

  function showPlanned() {
    setTabsShown(false);
    $('.bench').hidden = true;
    $('#reference').hidden = true;
    const box = $('#planned');
    box.hidden = false;
    box.replaceChildren(
      el('h2', { text: `${suite.label} generators are coming next` }),
      el('p', { class: 'lede', text: suite.plannedIntro }),
      el(
        'ul',
        { class: 'plan' },
        ...suite.planned.map((item) =>
          el(
            'li',
            {},
            el('span', { class: 'name', text: item.name }),
            el('span', { class: 'pill', text: 'Planned' }),
            el('span', { class: 'text', text: item.text })
          )
        )
      ),
      el('p', {}, el('a', { href: hrefFor(SUITES[0]), text: 'Open the Ansible generators' }))
    );
  }

  function showBench() {
    setTabsShown(true);
    $('#planned').hidden = true;
    $('#reference').hidden = true;
    $('.bench').hidden = false;
  }

  // The address (#/ansible/playbook) decides what is on screen, so refresh and
  // the back button both land where you were.
  function route() {
    const m = location.hash.match(/^#\/([a-z]+)(?:\/([a-z0-9]+))?/) || [];
    suite = SUITES.find((s) => s.id === m[1]) || SUITES[0];
    const ref = (suite.references || []).find((r) => r.id === m[2]) || null;
    tool = ref ? null : suite.tools.find((t) => t.id === m[2]) || suite.tools[0] || null;
    refId = ref ? ref.id : null;
    view = ref ? 'reference' : tool ? 'tool' : 'planned';
    changedTabs.clear();
    activePath = null;
    renderNav();
    document.title =
      view === 'reference'
        ? `${suite.label} ${ref.label} | Stanza`
        : tool
          ? `${suite.label} ${tool.label} | Stanza`
          : `${suite.label} | Stanza`;
    if (view === 'reference') {
      showReference(suite.id, refId);
      return;
    }
    if (view === 'planned') {
      showPlanned();
      return;
    }
    showBench();
    renderForm();
    compileNext = true;
    update();
  }

  /* ---------- Reference pages: Commands, Modules, Playbook concepts ---------- */

  // Each page is plain data (commands.js, modules.js, concepts.js) drawn by the same code.
  const REFS = {
    'ansible/commands': {
      groups: COMMAND_GROUPS,
      title: 'Ansible commands, explained',
      lede: 'Every command here is a real example you can copy. Press the ? next to a command to see what it does, when to use it, and what each piece of it means.',
      find: 'Find a command, such as copy, ping or vault',
      noun: 'commands',
      piece: 'The command, piece by piece',
      col: 'Part',
      copy: 'Copy command',
      words: WORDS,
    },
    'ansible/modules': {
      groups: MODULE_GROUPS,
      title: 'Ansible modules, explained',
      lede: 'A module is the small tool one task uses to do one job, such as installing a package or copying a file. Each example is a task you can paste into a playbook. Press the ? to see what it does and what every option means.',
      find: 'Find a module, such as copy, apt or user',
      noun: 'modules',
      piece: 'The task, option by option',
      col: 'Option',
      copy: 'Copy example',
    },
    'ansible/concepts': {
      groups: CONCEPT_GROUPS,
      title: 'Playbook concepts, explained',
      lede: 'Modules do the work. These are the ideas that tie tasks together: variables, loops, conditions, handlers and more. Press the ? to see what each example does, line by line.',
      find: 'Find an idea, such as loop, when or handlers',
      noun: 'ideas',
      piece: 'The example, line by line',
      col: 'Line',
      copy: 'Copy example',
    },
    'terraform/commands': {
      groups: TF_COMMAND_GROUPS,
      title: 'Terraform commands, explained',
      lede: 'Every command here works the same in OpenTofu, just type tofu instead of terraform. Press the ? next to a command to see what it does, when to use it, and what each piece means.',
      find: 'Find a command, such as plan, init or state',
      noun: 'commands',
      piece: 'The command, piece by piece',
      col: 'Part',
      copy: 'Copy command',
      words: TF_WORDS,
      wordsTitle: 'New to Terraform? Words you will see',
    },
    'terraform/concepts': {
      groups: TF_CONCEPT_GROUPS,
      title: 'Terraform language, explained',
      lede: 'Terraform code is written in HCL. These are the ideas you will use in every project: variables, loops, conditions, modules and state. Press the ? to see what each example does, line by line.',
      find: 'Find an idea, such as variable, for_each or module',
      noun: 'ideas',
      piece: 'The example, line by line',
      col: 'Line',
      copy: 'Copy example',
    },
    'terraform/resources': {
      groups: TF_RESOURCE_GROUPS,
      title: 'AWS resources, explained',
      lede: 'The common AWS building blocks, each as a small block you can paste into a .tf file. Press the ? to see what it makes and what every argument means. Some of these cost money while they exist, and the warnings say which.',
      find: 'Find a resource, such as vpc, subnet or s3',
      noun: 'resources',
      piece: 'The block, argument by argument',
      col: 'Argument',
      copy: 'Copy example',
    },
  };

  function buildCard(ref, group, c) {
    const panelId = `${ref.id}-${group.id}-${c.id}`;
    const yaml = Boolean(group.kind);
    const q = el('button', { type: 'button', class: 'qbtn', 'aria-expanded': 'false', 'aria-controls': panelId, title: 'What does this do?' });
    q.setAttribute('aria-label', `Explain: ${c.title}`);
    q.append(el('span', { text: '?', 'aria-hidden': 'true' }));

    const copy = el('button', { type: 'button', class: 'copy-cmd', title: ref.copy });
    copy.dataset.cmd = c.cmd;
    copy.setAttribute('aria-label', `${ref.copy}: ${c.title}`);
    copy.append(icon('copy'));

    const line = el('div', { class: yaml ? 'cmdline yaml' : 'cmdline' });
    if (yaml) {
      line.append(el('pre', { tabIndex: 0 }, el('code', { text: c.cmd })), copy);
    } else {
      line.append(el('span', { class: 'prompt', text: '$', 'aria-hidden': 'true' }), el('code', { text: c.cmd }), copy);
    }

    const panel = el('div', { class: 'cmd-panel', id: panelId, hidden: true });
    panel.append(el('h4', { text: 'What it does' }), el('p', { text: c.what }), el('h4', { text: 'When you would use it' }), el('p', { text: c.use }));

    const table = el('table');
    table.append(el('caption', { class: 'sr-only', text: `${c.title}, taken apart` }));
    table.append(el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: ref.col }), el('th', { scope: 'col', text: 'What it means' }))));
    const body = el('tbody');
    for (const [part, meaning] of c.parts) {
      body.append(el('tr', {}, el('td', {}, el('code', { text: part })), el('td', { text: meaning })));
    }
    table.append(body);
    panel.append(el('h4', { text: ref.piece }), el('div', { class: 'scroll' }, table));

    if (c.tips && c.tips.length) {
      panel.append(el('h4', { text: 'Good to know' }), el('ul', { class: 'tips' }, ...c.tips.map((t) => el('li', { text: t }))));
    }
    if (c.careful) {
      const warn = el('p', { class: 'careful', role: 'note' });
      warn.append(el('strong', { text: 'Careful: ' }), c.careful);
      panel.append(warn);
    }

    const li = el('li', { class: 'cmd' }, el('div', { class: 'cmd-top' }, el('p', { class: 'cmd-title', text: c.title }), q), line, panel);
    li.dataset.find = `${c.cmd} ${c.title} ${c.what} ${group.tool}`.toLowerCase();
    return li;
  }

  function buildReference(ref) {
    const total = ref.groups.reduce((n, g) => n + g.commands.length, 0);
    const page = el('section', { class: 'refpage', id: `ref-${ref.id}`, 'aria-labelledby': `ref-${ref.id}-title` });

    const search = el('input', { type: 'search', id: `q-${ref.id}`, placeholder: ref.find, autocomplete: 'off', spellcheck: false });
    const toggleAll = el('button', { type: 'button', class: 'btn quiet', text: 'Open all explanations' });
    const count = el('p', { class: 'cmd-count', text: `${total} ${ref.noun}` });
    const tools = el('div', { class: 'cmd-tools' }, el('label', { for: `q-${ref.id}`, class: 'sr-only', text: ref.find }), search, toggleAll);

    const chips = el('nav', { class: 'chips', 'aria-label': 'Jump to a group' });
    const groups = [];
    for (const g of ref.groups) {
      const chip = el('button', { type: 'button', class: 'chip', text: g.tool });
      const hid = `${ref.id}-cg-${g.id}-h`;
      const sec = el('section', { class: 'cgroup', 'aria-labelledby': hid });
      const list = el('ul', { class: 'clist' });
      const cards = g.commands.map((c) => buildCard(ref, g, c));
      list.append(...cards);
      sec.append(el('h3', { id: hid, text: g.title }), el('p', { class: 'blurb', text: g.blurb }), list);
      chip.addEventListener('click', () => sec.scrollIntoView({ block: 'start' }));
      chips.append(chip);
      groups.push({ sec, cards });
    }
    const none = el('p', { class: 'cmd-none', text: `Nothing matches that. Try a shorter word.`, hidden: true });

    page.append(el('h2', { id: `ref-${ref.id}-title`, text: ref.title }), el('p', { class: 'lede', text: ref.lede }));
    if (ref.words) {
      const words = el('details', { class: 'words' }, el('summary', { text: ref.wordsTitle || 'New to Ansible? Words you will see' }));
      words.append(el('dl', {}, ...ref.words.flatMap(([w, d]) => [el('dt', { text: w }), el('dd', { text: d })])));
      page.append(words);
    }
    page.append(tools, count, chips, ...groups.map((g) => g.sec), none);

    const visibleCards = () => groups.flatMap((g) => g.cards).filter((c) => !c.hidden);
    const isOpen = (c) => c.querySelector('.qbtn').getAttribute('aria-expanded') === 'true';
    function syncToggleAll() {
      const cards = visibleCards();
      const allOpen = cards.length > 0 && cards.every(isOpen);
      toggleAll.textContent = allOpen ? 'Close all explanations' : 'Open all explanations';
      toggleAll.dataset.open = String(allOpen);
    }

    page.addEventListener('click', async (e) => {
      const q = e.target.closest('.qbtn');
      if (q) {
        const open = q.getAttribute('aria-expanded') !== 'true';
        q.setAttribute('aria-expanded', String(open));
        document.getElementById(q.getAttribute('aria-controls')).hidden = !open;
        syncToggleAll();
        return;
      }
      const btn = e.target.closest('.copy-cmd');
      if (!btn) return;
      const ok = await copyText(btn.dataset.cmd);
      say(ok ? 'Copied.' : 'Copy failed. Select the text and copy it by hand.');
      if (!ok) return;
      btn.dataset.done = 'true';
      btn.replaceChildren(icon('check'));
      setTimeout(() => {
        delete btn.dataset.done;
        btn.replaceChildren(icon('copy'));
      }, 1500);
    });

    toggleAll.addEventListener('click', () => {
      const open = toggleAll.dataset.open !== 'true';
      for (const c of visibleCards()) {
        c.querySelector('.qbtn').setAttribute('aria-expanded', String(open));
        c.querySelector('.cmd-panel').hidden = !open;
      }
      syncToggleAll();
    });

    // Search: hide what does not match, and hide groups left empty.
    search.addEventListener('input', () => {
      const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const g of groups) {
        let any = false;
        for (const c of g.cards) {
          const hit = terms.every((w) => c.dataset.find.includes(w));
          c.hidden = !hit;
          if (hit) {
            any = true;
            shown += 1;
          }
        }
        g.sec.hidden = !any;
      }
      chips.hidden = terms.length > 0;
      none.hidden = shown > 0;
      const msg = terms.length ? `${shown} of ${total} ${ref.noun} match` : `${total} ${ref.noun}`;
      count.textContent = msg;
      say(msg);
      syncToggleAll();
    });

    return page;
  }

  function showReference(suiteId, id) {
    setTabsShown(false);
    $('.bench').hidden = true;
    $('#planned').hidden = true;
    const box = $('#reference');
    const pid = `${suiteId}-${id}`;
    let page = document.getElementById(`ref-${pid}`);
    if (!page) {
      page = buildReference({ id: pid, ...REFS[`${suiteId}/${id}`] });
      box.append(page);
    }
    for (const p of box.children) p.hidden = p !== page;
    box.hidden = false;
    window.scrollTo(0, 0);
  }

  /* ---------- Form ---------- */

  const allFields = () => tool.groups.flatMap((g) => g.fields);

  function buildField(f) {
    const id = `f-${f.id}`;
    const hintId = `${id}-hint`;
    const errId = `${id}-err`;
    const wrap = el('div', { class: 'field', id: `w-${f.id}` });
    const describedBy = [f.hint ? hintId : '', errId].filter(Boolean).join(' ');
    const hint = f.hint ? el('p', { class: 'hint', id: hintId, text: f.hint }) : null;
    const error = el('p', { class: 'error', id: errId, hidden: true });

    if (f.type === 'check') {
      const box = el('input', { type: 'checkbox', id, checked: f.default });
      box.setAttribute('aria-describedby', describedBy);
      wrap.append(...[el('label', { class: 'check', for: id }, box, el('span', { text: f.label })), hint, error].filter(Boolean));
      return wrap;
    }

    wrap.append(el('label', { for: id, text: f.label }));

    if (f.type === 'area') {
      const ta = el('textarea', { id, value: f.default, rows: f.rows || 4, autocomplete: 'off', spellcheck: false });
      ta.setAttribute('aria-describedby', describedBy);
      wrap.append(...[ta, hint, error].filter(Boolean));
      return wrap;
    }

    if (f.type === 'select') {
      const sel = el('select', { id });
      for (const [value, label] of f.options) sel.append(el('option', { value, text: label }));
      sel.value = f.default;
      sel.setAttribute('aria-describedby', describedBy);
      wrap.append(...[sel, hint, error].filter(Boolean));
      return wrap;
    }

    const input = el('input', {
      type: 'text',
      id,
      value: f.default,
      autocomplete: 'off',
      spellcheck: false,
    });
    input.setAttribute('aria-describedby', describedBy);
    wrap.append(...[input, hint, error].filter(Boolean));
    return wrap;
  }

  function renderForm() {
    const form = $('#form');
    form.replaceChildren(
      el('h2', { id: 'form-title', text: tool.title }),
      el('p', { class: 'lede', text: tool.intro })
    );

    for (const group of tool.groups) {
      let box;
      if (group.optional) {
        box = el(
          'details',
          { class: 'optional' },
          el('summary', {}, el('span', { text: group.legend }), el('span', { class: 'opt', text: 'optional' }))
        );
      } else {
        box = el('fieldset', {}, el('legend', { text: group.legend }));
      }
      for (const f of group.fields) box.append(buildField(f));
      form.append(box);
    }
  }

  function readValues() {
    const values = {};
    for (const f of allFields()) {
      const node = document.getElementById(`f-${f.id}`);
      values[f.id] = f.type === 'check' ? node.checked : node.value;
    }
    return values;
  }

  function showErrors(errors) {
    for (const f of allFields()) {
      const node = document.getElementById(`f-${f.id}`);
      const msg = document.getElementById(`f-${f.id}-err`);
      const text = errors[f.id];
      msg.textContent = text || '';
      msg.hidden = !text;
      node.setAttribute('aria-invalid', text ? 'true' : 'false');
      // An error hiding inside a closed optional section would be invisible.
      if (text) {
        const details = node.closest('details');
        if (details) details.open = true;
      }
    }
  }

  /* ---------- The file ---------- */

  const isYaml = (path) => /\.ya?ml$/.test(path);

  // Splits one YAML line into coloured pieces: indent, dash, key, colon, value.
  function colourYaml(text) {
    const frag = document.createDocumentFragment();
    const span = (cls, str) => frag.append(el('span', { class: cls, text: str }));

    if (text === '---') {
      span('doc', text);
      return frag;
    }
    if (text.startsWith('#')) {
      span('doc', text);
      return frag;
    }

    const keyed = text.match(/^(\s*)(- )?([A-Za-z0-9_.-]+)(:)(\s.*)?$/);
    if (keyed) {
      const [, indent, dash, key, colon, value] = keyed;
      frag.append(indent);
      if (dash) span('d', dash);
      span('k', key);
      span('p', colon);
      if (value) span('v', value);
      return frag;
    }

    const item = text.match(/^(\s*)(- )(.*)$/);
    if (item) {
      frag.append(item[1]);
      span('d', item[2]);
      span('v', item[3]);
      return frag;
    }

    frag.append(text);
    return frag;
  }

  // INI and cfg: [section] headers, key=value pairs, # comments.
  function colourIni(text) {
    const frag = document.createDocumentFragment();
    const span = (cls, str) => frag.append(el('span', { class: cls, text: str }));
    if (text.startsWith('#')) {
      span('doc', text);
      return frag;
    }
    if (/^\[.*\]$/.test(text)) {
      span('k', text);
      return frag;
    }
    let afterEquals = false;
    for (const tok of text.split(/(\s+)/)) {
      if (!tok.trim()) frag.append(tok);
      else if (tok === '=') {
        span('p', tok);
        afterEquals = true;
      } else if (tok.includes('=')) {
        const at = tok.indexOf('=');
        span('k', tok.slice(0, at));
        span('p', '=');
        if (tok.slice(at + 1)) span('v', tok.slice(at + 1));
      } else if (afterEquals) {
        span('v', tok);
        afterEquals = false;
      } else frag.append(tok);
    }
    return frag;
  }

  // Terraform (HCL): # and // comments, block headers, name = value, and closing brackets.
  function colourHcl(text) {
    const frag = document.createDocumentFragment();
    const span = (cls, str) => frag.append(el('span', { class: cls, text: str }));
    const trimmed = text.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      span('doc', text);
      return frag;
    }
    const block = text.match(/^(\s*)([A-Za-z_][\w-]*)((?:\s+"[^"]*")*)(\s*\{)(\}?)$/);
    if (block) {
      frag.append(block[1]);
      span('k', block[2]);
      if (block[3]) span('v', block[3]);
      span('p', block[4] + block[5]);
      return frag;
    }
    const attr = text.match(/^(\s*)([A-Za-z_"][\w".-]*)(\s*=\s*)(.*)$/);
    if (attr) {
      frag.append(attr[1]);
      span('k', attr[2]);
      span('p', attr[3]);
      if (attr[4]) span('v', attr[4]);
      return frag;
    }
    if (/^\s*[}\])]+\s*$/.test(text)) {
      span('p', text);
      return frag;
    }
    frag.append(text);
    return frag;
  }

  function colourFor(path, text) {
    if (/\.(tf|tfvars)$/.test(path)) return colourHcl(text);
    if (isYaml(path)) return colourYaml(text);
    if (/\.(ini|cfg)$/.test(path)) return colourIni(text);
    return text;
  }

  function languageOf(path) {
    if (/\.ya?ml$/.test(path)) return 'YAML';
    if (/\.(ini|cfg)$/.test(path)) return 'INI';
    if (/\.(tf|tfvars)$/.test(path)) return 'Terraform (HCL)';
    if (/(^|\/)\.gitignore$/.test(path)) return 'gitignore';
    if (/\.sh$/.test(path)) return 'Shell';
    if (/\.md$/.test(path)) return 'Markdown';
    if (/\.j2$/.test(path)) return 'Jinja2';
    return 'Text';
  }

  function renderSheet(file, changed) {
    const sheet = $('#sheet');
    sheet.replaceChildren();

    file.lines.forEach((line, i) => {
      const cls = ['row'];
      if (line.n) cls.push('annotated');
      if (changed && changed.has(i)) cls.push('flash');
      const row = el('div', { class: cls.join(' ') });
      row.style.setProperty('--i', Math.min(i, 22));
      if (line.n) row.tabIndex = 0;
      row.append(
        el('span', { class: 'num', text: String(i + 1), 'aria-hidden': 'true' }),
        el('div', { class: 'code' }, el('span', { class: 'ln' }, colourFor(file.path, line.t)))
      );
      if (line.n) row.append(el('p', { class: 'note', text: line.n }));
      sheet.append(row);
    });

    if (compileNext) {
      compileNext = false;
      sheet.classList.add('compile');
      setTimeout(() => sheet.classList.remove('compile'), 900);
    }
  }

  function renderEmpty() {
    $('#sheet').replaceChildren(
      el('p', {
        class: 'empty',
        text: 'Fix the field marked in red on the left and your file will appear here.',
      })
    );
    $('#file-name').textContent = '';
    $('#crumb').replaceChildren();
    $('#files').replaceChildren(el('span', { class: 'none', text: 'No file yet' }));
    updateTabFade();
  }

  function setStatus(errorCount, file, fileCount) {
    $('#statusbar').dataset.state = errorCount ? 'error' : 'ok';
    $('#st-state').textContent = errorCount
      ? `${errorCount} ${errorCount === 1 ? 'field needs' : 'fields need'} attention`
      : 'Answers valid';
    $('#st-lang').textContent = file ? languageOf(file.path) : '';
    $('#st-lines').textContent = file ? `${file.lines.length} lines` : '';
    $('#st-files').textContent = fileCount > 1 ? `${fileCount} files` : '';
  }

  /* ---------- File tabs ---------- */

  // Which lines are new or different compared with the last version of this file?
  function changedLines(beforeText, lines) {
    const pool = new Map();
    for (const l of beforeText.split('\n')) pool.set(l, (pool.get(l) || 0) + 1);
    const out = new Set();
    lines.forEach((line, i) => {
      const n = pool.get(line.t) || 0;
      if (n > 0) pool.set(line.t, n - 1);
      else out.add(i);
    });
    return out;
  }

  // roles / webserver / tasks / main.yml, with the file name in full ink.
  function renderCrumb(path) {
    const crumb = $('#crumb');
    const parts = path.split('/');
    crumb.replaceChildren();
    parts.forEach((part, i) => {
      if (i) crumb.append(el('span', { class: 's', text: '/' }));
      crumb.append(el('span', { class: i === parts.length - 1 ? 'here' : 'dir', text: part }));
    });
  }

  // Soft fades at the edges of the tab strip show that more tabs are out of view.
  function updateTabFade() {
    const nav = $('#files');
    const row = $('#tabrow');
    row.dataset.fadeL = String(nav.scrollLeft > 4);
    row.dataset.fadeR = String(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
  }

  function wireTabFade() {
    $('#files').addEventListener('scroll', updateTabFade, { passive: true });
    window.addEventListener('resize', updateTabFade);
  }

  function renderFileTabs() {
    const nav = $('#files');
    nav.replaceChildren();
    for (const f of currentFiles) {
      const btn = el('button', { type: 'button', class: 'file', text: f.label });
      if (f.path === activePath) btn.setAttribute('aria-current', 'true');
      if (changedTabs.has(f.path)) {
        btn.dataset.changed = 'true';
        btn.setAttribute('aria-label', `${f.label} (changed)`);
      }
      btn.addEventListener('click', () => {
        if (f.path === activePath) return;
        activePath = f.path;
        compileNext = true;
        showActiveFile();
      });
      nav.append(btn);
    }

    // Keep the open file's tab in view when there are more tabs than fit.
    const cur = nav.querySelector('[aria-current="true"]');
    if (cur) {
      const left = cur.offsetLeft;
      const right = left + cur.offsetWidth;
      if (left < nav.scrollLeft) nav.scrollLeft = Math.max(left - 8, 0);
      else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth + 8;
    }
    updateTabFade();
  }

  function showActiveFile(changed) {
    const file = currentFiles.find((f) => f.path === activePath);
    changedTabs.delete(file.path);
    $('#file-name').textContent = file.path;
    renderCrumb(file.path);
    renderFileTabs();
    renderSheet(file, changed);
    setStatus(0, file, currentFiles.length);
  }

  /* ---------- Terminal: commands and flags ---------- */

  function renderRun(values) {
    const run = $('#run');
    const r = typeof tool.run === 'function' ? tool.run(values) : tool.run;

    const cmdRows = r.commands.map((c) => {
      const copy = el('button', { type: 'button', class: 'copy-cmd', title: 'Copy this command' }, icon('copy'));
      copy.dataset.cmd = c.cmd;
      copy.setAttribute('aria-label', `Copy command: ${c.cmd}`);
      return el(
        'tr',
        {},
        el(
          'td',
          {},
          el('div', { class: 'cmdrow' }, el('span', { class: 'prompt', text: '$', 'aria-hidden': 'true' }), el('code', { text: c.cmd }), copy)
        ),
        el('td', { text: c.what })
      );
    });
    const flagRows = r.flags.map((f) =>
      el('tr', {}, el('td', {}, el('code', { text: f.flag })), el('td', { text: f.meaning }))
    );

    const table = (caption, head, rows) =>
      el(
        'div',
        { class: 'scroll' },
        el(
          'table',
          {},
          el('caption', { text: caption }),
          el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { scope: 'col', text: h })))),
          el('tbody', {}, ...rows)
        )
      );

    run.replaceChildren(
      el('div', { class: 'term-head' }, el('h3', { id: 'run-title', text: 'Check it, then run it' }), el('p', { text: r.where })),
      el(
        'div',
        { class: 'term-body' },
        table('Commands, in the order to use them', ['Command', 'What it does'], cmdRows),
        table('The flags and parts used above', ['Flag or part', 'Meaning'], flagRows)
      )
    );
  }

  /* ---------- Update loop ---------- */

  function setButtons(on) {
    $('#copy').disabled = !on;
    $('#download').disabled = !on;
    $('#download-all').disabled = !on;
    $('#download-all').hidden = !on || !currentFiles || currentFiles.length < 2;
  }

  // A field with showIf is only shown when another answer has one of the listed values.
  function applyShowIf(values) {
    for (const f of allFields()) {
      if (!f.showIf) continue;
      document.getElementById(`w-${f.id}`).hidden = !f.showIf.in.includes(values[f.showIf.field]);
    }
  }

  function update() {
    const values = readValues();
    applyShowIf(values);
    const errors = tool.validate(values);
    showErrors(errors);

    const errorCount = Object.keys(errors).length;
    if (errorCount) {
      currentFiles = null;
      renderEmpty();
      setButtons(false);
      setStatus(errorCount, null, 0);
      return;
    }

    // An edit made by you flashes what changed. Opening a tool or a tab replays the reveal instead.
    const userEdit = !compileNext;
    currentValues = values;
    currentFiles = tool.build(values);
    if (!currentFiles.some((f) => f.path === activePath)) activePath = currentFiles[0].path;
    let changed = null;
    for (const f of currentFiles) {
      const text = textOf(f);
      const before = prevText[f.path];
      if (userEdit && before !== undefined && before !== text) {
        if (f.path === activePath) changed = changedLines(before, f.lines);
        else changedTabs.add(f.path);
      }
      prevText[f.path] = text;
    }
    showActiveFile(changed);
    renderRun(values);
    setButtons(true);
  }

  /* ---------- Copy and download ---------- */

  const textOf = (file) => file.lines.map((l) => l.t).join('\n') + '\n';
  const activeFile = () => currentFiles.find((f) => f.path === activePath);

  function say(message) {
    $('#status').textContent = message;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers, or a page opened straight from disk.
      const box = el('textarea', { value: text });
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.append(box);
      box.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      box.remove();
      return ok;
    }
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function wireButtons() {
    // Fill in the icons that sit inside the toolbar buttons.
    document.querySelectorAll('[data-icon]').forEach((node) => node.replaceChildren(icon(node.dataset.icon)));

    const copyBtn = $('#copy');
    const copyLabel = copyBtn.querySelector('.label');
    let timer;

    copyBtn.addEventListener('click', async () => {
      if (!currentFiles) return;
      const ok = await copyText(textOf(activeFile()));
      copyLabel.textContent = ok ? 'Copied' : 'Copy failed';
      say(ok ? 'Copied to clipboard.' : 'Copy failed. Use Download instead.');
      clearTimeout(timer);
      timer = setTimeout(() => {
        copyLabel.textContent = 'Copy';
      }, 1800);
    });

    $('#download').addEventListener('click', () => {
      if (!currentFiles) return;
      const file = activeFile();
      const name = file.path.split('/').pop();
      saveBlob(new Blob([textOf(file)], { type: 'text/plain' }), name);
      say(`Downloaded ${name}.`);
    });

    $('#download-all').addEventListener('click', () => {
      if (!currentFiles) return;
      const bytes = makeZip(currentFiles.map((f) => ({ path: f.path, text: textOf(f) })));
      const name = tool.zipName ? tool.zipName(currentValues) : `${tool.id}.zip`;
      saveBlob(new Blob([bytes], { type: 'application/zip' }), name);
      say(`Downloaded ${name}.`);
    });

    // Notes on or off. The choice is remembered.
    const notesBtn = $('#notes');
    const setNotes = (on) => {
      notesBtn.setAttribute('aria-pressed', String(on));
      $('#sheet').classList.toggle('no-notes', !on);
    };
    setNotes(store.get('stanza-notes') !== 'off');
    notesBtn.addEventListener('click', () => {
      const on = notesBtn.getAttribute('aria-pressed') !== 'true';
      setNotes(on);
      store.set('stanza-notes', on ? 'on' : 'off');
    });

    // One handler for every "copy this command" button in the terminal.
    $('#run').addEventListener('click', async (e) => {
      const btn = e.target.closest('.copy-cmd');
      if (!btn) return;
      const ok = await copyText(btn.dataset.cmd);
      say(ok ? 'Command copied.' : 'Copy failed. Select the command and copy it by hand.');
      if (!ok) return;
      btn.dataset.done = 'true';
      btn.replaceChildren(icon('check'));
      setTimeout(() => {
        delete btn.dataset.done;
        btn.replaceChildren(icon('copy'));
      }, 1500);
    });
  }

  /* ---------- Jump to: Ctrl+K opens a quick list of every generator ---------- */

  function wirePalette() {
    const dlg = $('#palette');
    const input = $('#pal-q');
    const list = $('#pal-list');
    const jump = $('#jump');
    if (typeof dlg.showModal !== 'function') {
      jump.hidden = true;
      return;
    }

    $('#kbd').dataset.key = /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd K' : 'Ctrl K';

    const items = SUITES.flatMap((s) =>
      s.tools.length
        ? [
            ...s.tools.map((t) => ({ s, label: t.label, sub: s.label, href: hrefFor(s, t) })),
            ...(s.references || []).map((r) => ({ s, label: r.label, sub: `${s.label} reference`, href: `#/${s.id}/${r.id}` })),
          ]
        : [{ s, label: s.label, sub: 'planned', href: hrefFor(s) }]
    );
    let shown = items;
    let active = 0;

    function mark() {
      [...list.children].forEach((li, i) => {
        if (li.getAttribute('role') !== 'option') return;
        li.setAttribute('aria-selected', String(i === active));
        if (i === active) li.scrollIntoView({ block: 'nearest' });
      });
      input.setAttribute('aria-activedescendant', shown.length ? `pal-${active}` : '');
    }

    function go(it) {
      dlg.close();
      if (location.hash !== it.href) location.hash = it.href;
    }

    function draw() {
      list.replaceChildren();
      if (!shown.length) {
        list.append(el('li', { class: 'none', text: 'Nothing matches. Try inventory, playbook, role, commands, modules or terraform.' }));
      }
      shown.forEach((it, i) => {
        const li = el('li', { class: 'opt', id: `pal-${i}`, role: 'option' });
        li.append(
          el('img', { src: it.s.icon, alt: '', width: 18, height: 18 }),
          el('span', { class: 'lab', text: it.label }),
          el('span', { class: 'sub', text: it.sub })
        );
        li.addEventListener('mousemove', () => {
          if (active !== i) {
            active = i;
            mark();
          }
        });
        li.addEventListener('click', () => go(it));
        list.append(li);
      });
      mark();
    }

    function filter() {
      const q = input.value.trim().toLowerCase();
      shown = items.filter((it) => `${it.sub} ${it.label}`.toLowerCase().includes(q));
      active = 0;
      draw();
    }

    function open() {
      input.value = '';
      filter();
      dlg.showModal();
      input.focus();
    }

    jump.addEventListener('click', open);
    input.addEventListener('input', filter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!shown.length) return;
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
        mark();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (shown[active]) go(shown[active]);
      }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (dlg.open) dlg.close();
        else open();
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing && !dlg.open) {
        e.preventDefault();
        open();
      }
    });
  }

  /* ---------- Start ---------- */

  wireTheme();
  wireButtons();
  wirePalette();
  wireTabFade();
  $('#form').addEventListener('input', update);
  $('#form').addEventListener('submit', (e) => e.preventDefault());
  window.addEventListener('hashchange', route);
  placeTabs();
  if (wideTabs.addEventListener) wideTabs.addEventListener('change', () => { placeTabs(); updateTabFade(); });
  route();
})();

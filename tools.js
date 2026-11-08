'use strict';

/*
  tools.js — the "cookbook".

  Each tool is a plain object that describes:
    - groups      the questions to ask (a group can be optional = collapsed)
    - validate()  checks the answers and returns { fieldId: "message" }
    - build()     turns answers into FILES: [{ path, label, lines: [{ t, n }] }]
                  (t = the text of the line, n = the margin note or null)
    - run         the commands to show underneath (object, or function of the answers)

  Nothing here touches the page, so it can be tested on its own with Node.
  To add a tool (Terraform, Dockerfile, ...) add one more object to TOOLS.
*/

/* ---------- Allowed characters ----------
   Tight patterns mean a typo can never break the YAML. */

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.,()\/-]{0,79}$/;
const HOST_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:*-]{0,63}$/;
const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9+._-]{0,63}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const ROLE_RE = /^[a-z][a-z0-9_]{0,39}$/;
const VERSION_RE = /^\d{1,2}\.\d{1,2}$/;
const FW_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const BASE_RE = /^[A-Za-z0-9_.-]+$/;
const baseName = (p) => p.split('/').filter(Boolean).pop() || '';

const isAbsDir = (p) => /^\/[A-Za-z0-9_.\/-]{1,200}$/.test(p) && !p.includes('..');
const isAbsFile = (p) =>
  isAbsDir(p) && !p.endsWith('/') && BASE_RE.test(baseName(p)) && !/^\.+$/.test(baseName(p));
const isSrcPath = (p) =>
  /^[A-Za-z0-9_.\/-]{1,200}$/.test(p) && !p.includes('..') && !p.endsWith('/');

const splitList = (text) =>
  text.split(',').map((s) => s.trim()).filter(Boolean);

/* ---------- Wording shared by both tools ---------- */

const PKG_STATES = [
  ['present', 'Install if missing (present)'],
  ['latest', 'Install and keep up to date (latest)'],
  ['absent', 'Remove (absent)'],
];

const PKG_STATE_NOTE = {
  present: 'present installs the packages if they are missing and leaves them alone if they are already there.',
  latest:
    'latest installs the packages and upgrades them whenever a newer version exists. ansible-lint warns about it because surprise upgrades can break production.',
  absent: 'absent removes the packages if they are installed.',
};

const PKG_TASK_NAME = {
  present: 'Install packages',
  latest: 'Install or upgrade packages',
  absent: 'Remove packages',
};

const SVC_STATES = [
  ['started', 'Running (started)'],
  ['stopped', 'Stopped (stopped)'],
  ['restarted', 'Restart every run (restarted)'],
];

const SVC_STATE_NOTE = {
  started: 'started makes sure the service is running now. If it already is, nothing changes.',
  stopped: 'stopped makes sure the service is not running. If it is already stopped, nothing changes.',
  restarted:
    'restarted stops and starts the service on every run, even when nothing changed. Use it on purpose.',
};

const SVC_TASK_VERB = { started: 'Start', stopped: 'Stop', restarted: 'Restart' };

const DOC_START_NOTE =
  'Marks the start of a YAML document. Ansible works without it, but linters expect it, so keep the habit.';

/* =====================================================================
   Tool 1: Ansible playbook
   ===================================================================== */

const playbook = {
  id: 'playbook',
  label: 'Playbook',
  ready: true,
  title: 'Ansible playbook',
  intro: 'One file that sets up packages, users, files and services on the machines you pick.',

  groups: [
    {
      legend: 'Where it runs',
      fields: [
        {
          id: 'playName',
          type: 'text',
          label: 'What should the play be called?',
          hint: 'Only a label. Ansible prints it while the play runs.',
          default: 'Install and start nginx',
        },
        {
          id: 'hosts',
          type: 'text',
          label: 'Which hosts should it run on?',
          hint: 'A host or group name from your inventory file.',
          default: 'webservers',
        },
        {
          id: 'become',
          type: 'check',
          label: 'Run with sudo (become)',
          hint: 'Needed for installing packages and managing services.',
          default: true,
        },
      ],
    },
    {
      legend: 'Packages',
      fields: [
        {
          id: 'packages',
          type: 'text',
          label: 'Packages to manage',
          hint: 'Separate several with commas. Leave empty to skip this task.',
          default: 'nginx',
        },
        {
          id: 'pkgState',
          type: 'select',
          label: 'What should happen to them?',
          options: PKG_STATES,
          default: 'present',
        },
      ],
    },
    {
      legend: 'Service',
      fields: [
        {
          id: 'service',
          type: 'text',
          label: 'Service to manage',
          hint: 'Leave empty to skip this task.',
          default: 'nginx',
        },
        {
          id: 'svcState',
          type: 'select',
          label: 'What state should it be in?',
          options: SVC_STATES,
          default: 'started',
        },
        {
          id: 'svcEnabled',
          type: 'check',
          label: 'Start it at boot (enabled)',
          hint: 'Leave unticked to keep whatever the boot setting is now.',
          default: true,
        },
      ],
    },
    {
      legend: 'Add a user',
      optional: true,
      fields: [
        {
          id: 'userName',
          type: 'text',
          label: 'User name',
          hint: 'Lowercase, for example deploy. Leave empty to skip this task.',
          default: '',
        },
        {
          id: 'userShell',
          type: 'select',
          label: 'Login shell',
          options: [
            ['/bin/bash', 'Bash (/bin/bash)'],
            ['/bin/sh', 'Plain sh (/bin/sh)'],
            ['/sbin/nologin', 'No login (/sbin/nologin)'],
          ],
          default: '/bin/bash',
        },
        {
          id: 'userGroups',
          type: 'text',
          label: 'Extra groups',
          hint: 'Separate several with commas, for example wheel. Optional.',
          default: '',
        },
      ],
    },
    {
      legend: 'Files and folders',
      optional: true,
      fields: [
        {
          id: 'dirPath',
          type: 'text',
          label: 'Folder to create on the target',
          hint: 'A full path, for example /opt/app. Leave empty to skip.',
          default: '',
        },
        {
          id: 'dirMode',
          type: 'select',
          label: 'Folder permissions',
          options: [
            ['0755', '0755: everyone can read'],
            ['0750', '0750: owner and group only'],
            ['0700', '0700: owner only'],
          ],
          default: '0755',
        },
        {
          id: 'copySrc',
          type: 'text',
          label: 'File to copy: where it is now',
          hint: 'On the machine you run Ansible from, for example files/nginx.conf. Leave empty to skip.',
          default: '',
        },
        {
          id: 'copyDest',
          type: 'text',
          label: 'File to copy: where it should go',
          hint: 'A full path on the target, for example /etc/nginx/nginx.conf.',
          default: '',
        },
        {
          id: 'copyMode',
          type: 'select',
          label: 'File permissions',
          options: [
            ['0644', '0644: everyone can read'],
            ['0640', '0640: owner and group only'],
            ['0600', '0600: owner only'],
          ],
          default: '0644',
        },
        {
          id: 'restartOnCopy',
          type: 'check',
          label: 'Restart the service when this file changes',
          hint: 'Adds a handler. It only fires when the copy really changed the file.',
          default: false,
        },
      ],
    },
    {
      legend: 'Firewall (firewalld)',
      optional: true,
      fields: [
        {
          id: 'fwService',
          type: 'text',
          label: 'Service to allow through the firewall',
          hint: 'A firewalld service name, for example http or https. Leave empty to skip.',
          default: '',
        },
      ],
    },
  ],

  validate(v) {
    const e = {};

    if (!NAME_RE.test(v.playName.trim())) {
      e.playName =
        'Start with a letter or digit. Use up to 80 characters: letters, digits, spaces and , . ( ) / _ -';
    }
    if (!HOST_RE.test(v.hosts.trim())) {
      e.hosts = 'Use a host or group name: letters, digits and . _ : * -   (no spaces).';
    }

    const pkgs = splitList(v.packages);
    const badPkg = pkgs.find((p) => !PKG_RE.test(p));
    if (badPkg) e.packages = `"${badPkg}" is not a valid package name. Use letters, digits and + . _ -`;

    const svc = v.service.trim();
    if (svc && !PKG_RE.test(svc)) e.service = 'Use letters, digits and + . _ -   (no spaces).';

    const user = v.userName.trim();
    if (user && !USER_RE.test(user)) {
      e.userName = 'Use lowercase letters, digits, _ and - (up to 32). Start with a letter or _.';
    }
    const badGroup = splitList(v.userGroups).find((g) => !USER_RE.test(g));
    if (badGroup) e.userGroups = `"${badGroup}" is not a valid group name. Use lowercase letters, digits, _ and -`;

    const dir = v.dirPath.trim();
    if (dir && !isAbsDir(dir)) e.dirPath = 'Use a full path starting with /, for example /opt/app (no spaces, no ..).';

    const src = v.copySrc.trim();
    const dest = v.copyDest.trim();
    if (src && !isSrcPath(src)) e.copySrc = 'Use letters, digits and . _ - / only (no spaces, no ..).';
    if (dest && !isAbsFile(dest)) e.copyDest = 'Use a full path to a file, for example /etc/nginx/nginx.conf.';
    if (src && !dest && !e.copyDest) e.copyDest = 'Say where the file should go on the target.';
    if (dest && !src && !e.copySrc) e.copySrc = 'Say which file to copy.';

    if (v.restartOnCopy) {
      if (!src && !dest) e.restartOnCopy = 'Fill in a file to copy first, or untick this.';
      else if (!svc) e.restartOnCopy = 'Add a service above so there is something to restart, or untick this.';
    }

    const fw = v.fwService.trim();
    if (fw && !FW_RE.test(fw)) e.fwService = 'Use lowercase letters, digits and - (for example http).';

    const hasWork = pkgs.length || svc || user || dir || (src && dest) || fw;
    if (!hasWork && !Object.keys(e).length) {
      e.packages = 'Add at least one task: a package, a service, a user, a file or a firewall rule.';
    }

    return e;
  },

  build(v) {
    const lines = [];
    const add = (t, n = null) => lines.push({ t, n });

    const pkgs = splitList(v.packages);
    const svc = v.service.trim();
    const user = v.userName.trim();
    const groups = splitList(v.userGroups);
    const dir = v.dirPath.trim();
    const src = v.copySrc.trim();
    const dest = v.copyDest.trim();
    const fw = v.fwService.trim();
    const hasCopy = Boolean(src && dest);
    const needsHandler = Boolean(v.restartOnCopy && hasCopy && svc);
    const handlerName = `Restart ${svc}`;

    add('---', DOC_START_NOTE);
    add(
      `- name: ${v.playName.trim()}`,
      'The dash starts a list item. A playbook is a list of plays, and this is the first one. name is only a label.'
    );
    add(`  hosts: ${v.hosts.trim()}`, 'Which machines this play runs on. It must match a host or group in your inventory.');
    if (v.become) {
      add('  become: true', 'Run the tasks with root rights (sudo). Installing packages and managing services need it.');
    }
    add('  tasks:', 'The jobs for this play. Ansible runs them from top to bottom.');

    if (pkgs.length) {
      add(`    - name: ${PKG_TASK_NAME[v.pkgState]}`, 'A task label. It is printed during the run, so say what the job does.');
      add(
        '      ansible.builtin.package:',
        'The module that does the work. package picks apt, dnf or yum for you, so one task fits Ubuntu and RHEL. The long name is the fully qualified name that linters ask for.'
      );
      add('        name:', 'Which packages to act on.');
      pkgs.forEach((p) => add(`          - ${p}`));
      add(`        state: ${v.pkgState}`, PKG_STATE_NOTE[v.pkgState]);
    }

    if (user) {
      add(`    - name: Create user ${user}`, 'Label for the user task.');
      add(
        '      ansible.builtin.user:',
        'Creates and manages user accounts. Safe to run again: if the account already matches, nothing changes.'
      );
      add(`        name: ${user}`, 'The account name.');
      add(
        `        shell: ${v.userShell}`,
        'The login shell. /sbin/nologin makes an account nobody can log in with, which suits service accounts.'
      );
      if (groups.length) {
        add('        groups:', 'Extra groups for this user. wheel is the admin group on RHEL; on Ubuntu the equivalent is sudo.');
        groups.forEach((g) => add(`          - ${g}`));
        add(
          '        append: true',
          'Add the user to these groups and keep their other groups. Without it, Ansible would remove every other extra group.'
        );
      }
      add('        state: present', 'present creates the user if it does not exist yet.');
    }

    if (dir) {
      add(`    - name: Create directory ${dir}`, 'Label for the folder task.');
      add(
        '      ansible.builtin.file:',
        'The module for files, folders and links. With state: directory it makes the folder if it is missing.'
      );
      add(`        path: ${dir}`, 'The folder on the target machine.');
      add('        state: directory', 'directory means this path should be a folder. Missing parent folders are created too.');
      add(
        `        mode: "${v.dirMode}"`,
        'Permissions in octal. Keep the quotes: an unquoted number can be read as decimal, which gives the wrong permissions.'
      );
    }

    if (hasCopy) {
      add(`    - name: Copy ${baseName(dest)}`, 'Label for the copy task.');
      add(
        '      ansible.builtin.copy:',
        'Copies a file from the machine running Ansible to the target. If the target already has the same content, nothing changes.'
      );
      add(`        src: ${src}`, 'Read on the control node (where you run ansible-playbook), not on the target.');
      add(`        dest: ${dest}`, 'Where the file lands on the target machine.');
      add(`        mode: "${v.copyMode}"`, 'Permissions in octal, quoted for the same reason as above.');
      if (needsHandler) {
        add(
          `      notify: ${handlerName}`,
          'Run the handler with this exact name, but only if this task changed the file. Handlers run once, at the end of the play.'
        );
      }
    }

    if (svc) {
      add(`    - name: ${SVC_TASK_VERB[v.svcState]} ${svc}`, 'Label for the service task.');
      add(
        '      ansible.builtin.service:',
        'The module for starting, stopping and restarting services on any init system.'
      );
      add(`        name: ${svc}`, 'The service name, as the system knows it.');
      add(`        state: ${v.svcState}`, SVC_STATE_NOTE[v.svcState]);
      if (v.svcEnabled) {
        add('        enabled: true', 'Also start the service automatically when the machine boots.');
      }
    }

    if (fw) {
      add(`    - name: Allow ${fw} through the firewall`, 'Label for the firewall task.');
      add(
        '      ansible.posix.firewalld:',
        'Manages firewalld rules. It lives in the ansible.posix collection, so install that first (see the commands below). firewalld must be running on the target.'
      );
      add(`        service: ${fw}`, 'The firewalld service to open. Run firewall-cmd --get-services on the target to see the names.');
      add('        permanent: true', 'Save the rule so it survives a reboot.');
      add('        immediate: true', 'Also apply the rule right now, without a reload.');
      add('        state: enabled', 'enabled opens the service. disabled would close it.');
    }

    if (needsHandler) {
      add('  handlers:', 'Tasks that only run when another task asks for them with notify. They run at the end of the play.');
      add(`    - name: ${handlerName}`, 'This name must match the notify line exactly, including capital letters.');
      add('      ansible.builtin.service:');
      add(`        name: ${svc}`);
      add('        state: restarted', 'A restart here is fine: it only happens when the file changed.');
    }

    return [{ path: 'site.yml', label: 'site.yml', lines }];
  },

  run(v) {
    const usesFirewall = Boolean(v.fwService.trim());
    const commands = [];
    const flags = [];

    if (usesFirewall) {
      commands.push({
        cmd: 'ansible-galaxy collection install ansible.posix',
        what: 'Downloads the collection that contains the firewalld module. Needed once on the control node.',
      });
      flags.push({
        flag: 'collection install',
        meaning: 'Subcommand of ansible-galaxy that installs a collection (a bundle of modules).',
      });
    }

    commands.push(
      {
        cmd: 'ansible-playbook --syntax-check site.yml',
        what: 'Reads the file and reports YAML or structure mistakes. Changes nothing.',
      },
      {
        cmd: 'ansible-lint site.yml',
        what: 'Checks style and best practices. Install it once with: pip install ansible-lint',
      },
      {
        cmd: 'ansible-playbook -i inventory.ini site.yml --check',
        what: 'Dry run. Shows what would change without changing anything.',
      },
      {
        cmd: 'ansible-playbook -i inventory.ini site.yml',
        what: 'The real run.',
      }
    );

    flags.push(
      { flag: '-i inventory.ini', meaning: 'Path to the inventory file that lists your hosts and groups.' },
      { flag: '--syntax-check', meaning: 'Parse the playbook and stop. Nothing runs on any host.' },
      {
        flag: '--check',
        meaning:
          'Dry run mode. Ansible predicts changes without making them. Some tasks cannot predict their result, so treat it as a guide.',
      }
    );

    return {
      where:
        'Run these in a terminal on your Ansible control node (VM console or SSH). Save the file there first.',
      commands,
      flags,
    };
  },
};

/* =====================================================================
   Tool 2: Ansible role
   ===================================================================== */

const role = {
  id: 'role',
  label: 'Role',
  ready: true,
  title: 'Ansible role',
  intro:
    'A reusable bundle: tasks, default settings, handlers and metadata in the standard folders, plus a playbook that uses it.',

  groups: [
    {
      legend: 'About the role',
      fields: [
        {
          id: 'roleName',
          type: 'text',
          label: 'Role name',
          hint: 'Lowercase letters, digits and underscores. It is also the prefix for the role variables.',
          default: 'webserver',
        },
        {
          id: 'description',
          type: 'text',
          label: 'One-line description',
          hint: 'Shown in meta/main.yml and the README.',
          default: 'Install and configure nginx',
        },
        {
          id: 'author',
          type: 'text',
          label: 'Author',
          hint: 'Your name or GitHub username.',
          default: 'Your Name',
        },
        {
          id: 'license',
          type: 'select',
          label: 'License',
          options: [
            ['MIT', 'MIT'],
            ['Apache-2.0', 'Apache 2.0'],
            ['GPL-2.0-or-later', 'GPL 2.0 or later'],
            ['BSD-3-Clause', 'BSD 3-Clause'],
          ],
          default: 'MIT',
        },
        {
          id: 'minAnsible',
          type: 'text',
          label: 'Oldest ansible-core version it supports',
          hint: 'For example 2.14. Run ansible --version to see what you have.',
          default: '2.14',
        },
        {
          id: 'platUbuntu',
          type: 'check',
          label: 'Works on Ubuntu',
          hint: '',
          default: true,
        },
        {
          id: 'platEL',
          type: 'check',
          label: 'Works on RHEL, Rocky and AlmaLinux (EL)',
          hint: 'Tick only what you have tested.',
          default: true,
        },
      ],
    },
    {
      legend: 'Where to use it',
      fields: [
        {
          id: 'hosts',
          type: 'text',
          label: 'Which hosts should the example playbook target?',
          hint: 'A host or group name from your inventory file.',
          default: 'webservers',
        },
      ],
    },
    {
      legend: 'What the role does',
      fields: [
        {
          id: 'packages',
          type: 'text',
          label: 'Packages to install',
          hint: 'Separate several with commas. Leave empty to skip.',
          default: 'nginx',
        },
        {
          id: 'service',
          type: 'text',
          label: 'Service to manage',
          hint: 'Leave empty to skip.',
          default: 'nginx',
        },
        {
          id: 'svcState',
          type: 'select',
          label: 'Default state for the service',
          options: [
            ['started', 'Running (started)'],
            ['stopped', 'Stopped (stopped)'],
          ],
          default: 'started',
        },
        {
          id: 'svcEnabled',
          type: 'check',
          label: 'Start it at boot by default',
          hint: 'Anyone using the role can change this.',
          default: true,
        },
      ],
    },
    {
      legend: 'Config file from a template',
      optional: true,
      fields: [
        {
          id: 'confDest',
          type: 'text',
          label: 'Where the config file should go on the target',
          hint: 'A full path, for example /etc/nginx/conf.d/site.conf. Leave empty to skip.',
          default: '',
        },
        {
          id: 'confMode',
          type: 'select',
          label: 'File permissions',
          options: [
            ['0644', '0644: everyone can read'],
            ['0640', '0640: owner and group only'],
            ['0600', '0600: owner only'],
          ],
          default: '0644',
        },
      ],
    },
  ],

  validate(v) {
    const e = {};

    if (!ROLE_RE.test(v.roleName.trim())) {
      e.roleName = 'Use lowercase letters, digits and _ only (up to 40). Start with a letter. No hyphens.';
    }
    if (!NAME_RE.test(v.description.trim())) {
      e.description =
        'Start with a letter or digit. Use up to 80 characters: letters, digits, spaces and , . ( ) / _ -';
    }
    if (!NAME_RE.test(v.author.trim())) {
      e.author = 'Start with a letter or digit. Use up to 80 characters: letters, digits, spaces and , . ( ) / _ -';
    }
    if (!VERSION_RE.test(v.minAnsible.trim())) {
      e.minAnsible = 'Use a version like 2.14.';
    }
    if (!v.platUbuntu && !v.platEL) {
      e.platEL = 'Tick at least one platform.';
    }
    if (!HOST_RE.test(v.hosts.trim())) {
      e.hosts = 'Use a host or group name: letters, digits and . _ : * -   (no spaces).';
    }

    const pkgs = splitList(v.packages);
    const badPkg = pkgs.find((p) => !PKG_RE.test(p));
    if (badPkg) e.packages = `"${badPkg}" is not a valid package name. Use letters, digits and + . _ -`;

    const svc = v.service.trim();
    if (svc && !PKG_RE.test(svc)) e.service = 'Use letters, digits and + . _ -   (no spaces).';

    const conf = v.confDest.trim();
    if (conf && !isAbsFile(conf)) e.confDest = 'Use a full path to a file, for example /etc/nginx/conf.d/site.conf.';

    if (!pkgs.length && !svc && !conf && !e.packages && !e.service && !e.confDest) {
      e.packages = 'Add a package, a service or a config file, or the role has nothing to do.';
    }

    return e;
  },

  build(v) {
    const r = v.roleName.trim();
    const base = `roles/${r}`;
    const pkgs = splitList(v.packages);
    const svc = v.service.trim();
    const conf = v.confDest.trim();
    const tmplName = conf ? `${baseName(conf)}.j2` : '';
    const needsHandler = Boolean(conf && svc);
    const handlerName = `Restart ${r} service`;

    const mk = (path, label, lines) => ({ path, label, lines });
    const files = [];

    /* site.yml: how to use the role */
    {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      add('---', DOC_START_NOTE);
      add(`- name: Apply the ${r} role`, 'An ordinary play. The role does the real work, so the play stays short.');
      add(`  hosts: ${v.hosts.trim()}`, 'Which machines get the role. It must match a host or group in your inventory.');
      add('  become: true', 'The role installs packages and manages services, so it needs root rights.');
      add('  roles:', 'Roles to run on these hosts, in order.');
      add(
        `    - role: ${r}`,
        'Ansible finds this folder at roles/' + r + ' next to site.yml. It runs tasks/main.yml and loads defaults, handlers and templates for you.'
      );
      files.push(mk('site.yml', 'site.yml', lines));
    }

    /* tasks/main.yml */
    {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      add('---', DOC_START_NOTE);
      let first = true;
      const taskNote = () => {
        if (!first) return 'A task label. It is printed during the run.';
        first = false;
        return 'In a role, tasks/main.yml is just a list of tasks. There is no play, hosts or tasks: key, because the playbook that uses the role supplies them.';
      };

      if (pkgs.length) {
        add('- name: Install packages', taskNote());
        add(
          '  ansible.builtin.package:',
          'package picks apt, dnf or yum for you, so the role fits Ubuntu and RHEL.'
        );
        add(
          `    name: "{{ ${r}_packages }}"`,
          'Reads the list from defaults/main.yml. A value that starts with {{ must be in quotes, or YAML reads it as a dictionary and fails.'
        );
        add('    state: present', PKG_STATE_NOTE.present);
      }

      if (conf) {
        add('- name: Deploy the configuration file', taskNote());
        add(
          '  ansible.builtin.template:',
          `Fills in templates/${tmplName} with your variables and copies the result to the target. Use it instead of copy when the file needs variables.`
        );
        add(`    src: ${tmplName}`, "A template name. Ansible looks for it in this role's templates/ folder.");
        add(`    dest: "{{ ${r}_config_dest }}"`, 'Where the file lands on the target. The value comes from defaults/main.yml.');
        add(`    mode: "{{ ${r}_config_mode }}"`, 'File permissions, also taken from defaults/main.yml.');
        if (needsHandler) {
          add(
            `  notify: ${handlerName}`,
            'Run the handler with this exact name, but only if the file changed. Handlers run once, at the end of the play.'
          );
        }
      }

      if (svc) {
        add(`- name: Manage the ${svc} service`, taskNote());
        add(
          '  ansible.builtin.service:',
          'Starts, stops and enables services on any init system.'
        );
        add(`    name: "{{ ${r}_service_name }}"`, 'The service name, taken from defaults/main.yml.');
        add(`    state: "{{ ${r}_service_state }}"`, 'Running or stopped, also from defaults/main.yml. Users of the role can override it.');
        add(`    enabled: "{{ ${r}_service_enabled }}"`, 'Whether the service starts at boot.');
      }
      files.push(mk(`${base}/tasks/main.yml`, 'tasks/main.yml', lines));
    }

    /* defaults/main.yml */
    {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      add('---', DOC_START_NOTE);
      let first = true;
      const defNote = (text) => {
        if (first) {
          first = false;
          return 'Defaults have the lowest priority, so anyone using the role can override them from a playbook, the inventory or the command line. Every variable starts with the role name so it never clashes with others.';
        }
        return text;
      };

      if (pkgs.length) {
        add(`${r}_packages:`, defNote('The packages the role installs.'));
        pkgs.forEach((p) => add(`  - ${p}`));
      }
      if (svc) {
        add(`${r}_service_name: ${svc}`, defNote('Name of the service to manage.'));
        add(`${r}_service_state: ${v.svcState}`, SVC_STATE_NOTE[v.svcState]);
        add(`${r}_service_enabled: ${v.svcEnabled ? 'true' : 'false'}`, 'Whether the service starts at boot.');
      }
      if (conf) {
        add(`${r}_config_dest: ${conf}`, defNote('Where the templated config file is written.'));
        add(`${r}_config_mode: "${v.confMode}"`, 'Permissions for that file, quoted so YAML keeps it as text.');
      }
      files.push(mk(`${base}/defaults/main.yml`, 'defaults/main.yml', lines));
    }

    /* handlers/main.yml */
    if (needsHandler) {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      add('---', DOC_START_NOTE);
      add(
        `- name: ${handlerName}`,
        'A handler is a task that only runs when another task calls it with notify. The name must match exactly.'
      );
      add('  ansible.builtin.service:');
      add(`    name: "{{ ${r}_service_name }}"`);
      add('    state: restarted', 'Restart is safe here: it only happens when the config file changed.');
      files.push(mk(`${base}/handlers/main.yml`, 'handlers/main.yml', lines));
    }

    /* templates/<file>.j2 */
    if (conf) {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      add(
        '# {{ ansible_managed }}',
        'Jinja2 fills in anything inside double curly braces. ansible_managed is a built-in variable that warns people the file is generated.'
      );
      add(`# Written by the ${r} role from templates/${tmplName}.`);
      add('# Edit the template, not this file: Ansible overwrites changes on the next run.');
      if (pkgs.length) {
        add(
          `# Packages installed by the role: {{ ${r}_packages | join(', ') }}`,
          'An example of using a role variable inside a template. Delete this line once you add your own settings.'
        );
      }
      files.push(mk(`${base}/templates/${tmplName}`, `templates/${tmplName}`, lines));
    }

    /* meta/main.yml */
    {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      add('---', DOC_START_NOTE);
      add('galaxy_info:', 'Information about the role. Ansible Galaxy reads this block; ansible-lint checks that it is filled in.');
      add(`  author: ${v.author.trim()}`);
      add(`  description: ${v.description.trim()}`);
      add(`  license: ${v.license}`);
      add(
        `  min_ansible_version: "${v.minAnsible.trim()}"`,
        'The oldest ansible-core you promise to support. Quoted, so 2.10 does not turn into the number 2.1.'
      );
      add('  platforms:', 'The operating systems you have tested the role on.');
      if (v.platUbuntu) {
        add('    - name: Ubuntu');
        add('      versions:');
        add('        - all');
      }
      if (v.platEL) {
        add('    - name: EL', 'EL means Enterprise Linux: RHEL, Rocky Linux and AlmaLinux.');
        add('      versions:');
        add('        - all');
      }
      add('  galaxy_tags: []', 'Search keywords for Galaxy. Add lowercase words if you publish the role.');
      add('dependencies: []', 'Other roles that must run before this one. None here.');
      files.push(mk(`${base}/meta/main.yml`, 'meta/main.yml', lines));
    }

    /* README.md */
    {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      const platforms = [v.platUbuntu && 'Ubuntu', v.platEL && 'RHEL, Rocky Linux and AlmaLinux'].filter(Boolean).join(', ');
      add(`# ${r}`, 'GitHub and Galaxy show this file as the role\'s front page.');
      add('');
      add(v.description.trim());
      add('');
      add('## Requirements');
      add('');
      add(`- ansible-core ${v.minAnsible.trim()} or newer`);
      add(`- Tested on: ${platforms}`);
      add('');
      add('## Role variables');
      add('');
      add('| Variable | Default | What it does |');
      add('| --- | --- | --- |');
      if (pkgs.length) add(`| \`${r}_packages\` | \`${pkgs.join(', ')}\` | Packages to install |`);
      if (svc) {
        add(`| \`${r}_service_name\` | \`${svc}\` | Service to manage |`);
        add(`| \`${r}_service_state\` | \`${v.svcState}\` | Whether the service runs |`);
        add(`| \`${r}_service_enabled\` | \`${v.svcEnabled}\` | Start the service at boot |`);
      }
      if (conf) {
        add(`| \`${r}_config_dest\` | \`${conf}\` | Where the config file is written |`);
        add(`| \`${r}_config_mode\` | \`${v.confMode}\` | Permissions of the config file |`);
      }
      add('');
      add('## Example playbook');
      add('');
      add('```yaml');
      add(`- hosts: ${v.hosts.trim()}`);
      add('  become: true');
      add('  roles:');
      add(`    - role: ${r}`);
      add('```');
      add('');
      add('## License');
      add('');
      add(v.license);
      files.push(mk(`${base}/README.md`, 'README.md', lines));
    }

    return files;
  },

  zipName(v) {
    return `${v.roleName.trim()}-role.zip`;
  },

  run(v) {
    const r = v.roleName.trim();
    return {
      where:
        'Run these in a terminal on your Ansible control node (VM console or SSH). Unzip the download there so site.yml sits next to the roles folder.',
      commands: [
        {
          cmd: 'ansible-playbook --syntax-check site.yml',
          what: 'Reads site.yml and the role, and reports YAML or structure mistakes. Changes nothing.',
        },
        {
          cmd: 'ansible-lint site.yml',
          what: 'Checks the role against best practices, including the role name and the meta file. Install it once with: pip install ansible-lint',
        },
        {
          cmd: 'ansible-playbook -i inventory.ini site.yml --check',
          what: 'Dry run. Shows what would change without changing anything.',
        },
        {
          cmd: 'ansible-playbook -i inventory.ini site.yml',
          what: 'The real run.',
        },
        {
          cmd: `ansible-galaxy role init --init-path roles ${r}`,
          what: 'Optional, for comparison. Makes an empty role with the same folder layout, so you can see what Stanza filled in for you.',
        },
      ],
      flags: [
        { flag: '-i inventory.ini', meaning: 'Path to the inventory file that lists your hosts and groups.' },
        { flag: '--syntax-check', meaning: 'Parse the playbook and stop. Nothing runs on any host.' },
        {
          flag: '--check',
          meaning:
            'Dry run mode. Ansible predicts changes without making them. Some tasks cannot predict their result, so treat it as a guide.',
        },
        { flag: 'role init', meaning: 'Subcommand of ansible-galaxy that creates an empty role skeleton.' },
        { flag: '--init-path roles', meaning: 'Create the new role inside the roles folder instead of the current folder.' },
      ],
    };
  },
};

/* =====================================================================
   Shared helpers for the Inventory and Ad-hoc tools
   ===================================================================== */

const GROUP_RE = /^[a-z][a-z0-9_]{0,31}$/;
const RESERVED_GROUPS = ['all', 'ungrouped'];
const INV_HOST_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
const ADDR_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const KEYPATH_RE = /^[A-Za-z0-9_.\/~-]{1,200}$/;
const REL_PATH_RE = /^[A-Za-z0-9_.\/-]{1,200}$/;
const PATTERN_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
// Characters that stay special even inside double quotes in bash. We refuse them
// so the generated command can be pasted into a terminal without surprises.
const BAD_IN_QUOTES = /["$`\\!\r\n]/;

const isIPv4Like = (s) => /^\d+\.\d+\.\d+\.\d+$/.test(s);
const validIPv4 = (s) => s.split('.').every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);

// "web1 192.168.1.10" per line -> [{ name, addr }]  (addr is optional)
function parseHosts(text) {
  const hosts = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length > 2) return { error: `"${line}" has too many parts. Write a name, then an address: web1 192.168.1.10` };
    const [name, addr] = parts;
    if (!INV_HOST_RE.test(name)) {
      return { error: `"${name}" is not a valid host name. Use letters, digits and . _ -   (no spaces).` };
    }
    if (addr !== undefined) {
      const ok = isIPv4Like(addr) ? validIPv4(addr) : ADDR_RE.test(addr) && /[A-Za-z]/.test(addr);
      if (!ok) return { error: `"${addr}" is not a valid IP address or DNS name.` };
    }
    hosts.push({ name, addr });
  }
  return { hosts };
}

const hostLine = (h) => (h.addr && h.addr !== h.name ? `${h.name} ansible_host=${h.addr}` : h.name);

/* =====================================================================
   Tool: Inventory  (inventory.ini + ansible.cfg + a starter site.yml)
   ===================================================================== */

const inventory = {
  id: 'inventory',
  label: 'Inventory',
  ready: true,
  title: 'Inventory and project setup',
  intro:
    'The list of machines Ansible manages, how to log in to them, and a first playbook that checks the connection. Start here.',

  groups: [
    {
      legend: 'First group of machines',
      fields: [
        {
          id: 'groupA',
          type: 'text',
          label: 'Group name',
          hint: 'Lowercase letters, digits and underscores. Playbooks target this name.',
          default: 'webservers',
        },
        {
          id: 'hostsA',
          type: 'area',
          rows: 3,
          label: 'Machines in this group',
          hint: 'One per line: a name, then its IP address or DNS name. The address is optional if the name already resolves.',
          default: 'web1 192.168.1.11\nweb2 192.168.1.12',
        },
      ],
    },
    {
      legend: 'Second group of machines',
      optional: true,
      fields: [
        {
          id: 'groupB',
          type: 'text',
          label: 'Group name',
          hint: 'Leave this and the machines empty to skip the group.',
          default: 'dbservers',
        },
        {
          id: 'hostsB',
          type: 'area',
          rows: 3,
          label: 'Machines in this group',
          hint: 'Same format: name, then address.',
          default: 'db1 192.168.1.21',
        },
      ],
    },
    {
      legend: 'Parent group',
      optional: true,
      fields: [
        {
          id: 'parentName',
          type: 'text',
          label: 'Group that holds the groups above',
          hint: 'For example production. Lets you target every machine in both groups at once. Leave empty to skip.',
          default: 'production',
        },
      ],
    },
    {
      legend: 'How Ansible logs in',
      fields: [
        {
          id: 'ansibleUser',
          type: 'text',
          label: 'SSH user',
          hint: 'The account on the machines. Leave empty to use your current user name.',
          default: 'ansible',
        },
        {
          id: 'sshPort',
          type: 'text',
          label: 'SSH port',
          hint: '22 unless you changed it.',
          default: '22',
        },
        {
          id: 'keyPath',
          type: 'text',
          label: 'Path to your private SSH key',
          hint: 'A path only. Never put a password or key contents in an inventory: it usually ends up in git. Leave empty to use your default key.',
          default: '~/.ssh/id_ed25519',
        },
        {
          id: 'python',
          type: 'select',
          label: 'Python on the machines',
          options: [
            ['auto_silent', 'Let Ansible find it (auto_silent)'],
            ['/usr/bin/python3', 'Python 3 at /usr/bin/python3'],
            ['/usr/libexec/platform-python', 'RHEL 8 system Python (platform-python)'],
          ],
          default: 'auto_silent',
        },
      ],
    },
    {
      legend: 'Extra files',
      fields: [
        {
          id: 'makeCfg',
          type: 'check',
          label: 'Also make ansible.cfg',
          hint: 'So you can leave out -i inventory.ini on every command.',
          default: true,
        },
        {
          id: 'makeSite',
          type: 'check',
          label: 'Also make a starter site.yml',
          hint: 'A playbook that logs in to every machine and prints its operating system.',
          default: true,
        },
        {
          id: 'siteHosts',
          type: 'text',
          label: 'Which machines should site.yml check?',
          hint: 'all, or one of your group names.',
          default: 'all',
          showIf: { field: 'makeSite', in: [true] },
        },
      ],
    },
  ],

  validate(v) {
    const e = {};
    const seen = new Set();
    const GROUP_MSG = 'Use lowercase letters, digits and _ (up to 32). Start with a letter. Not "all" or "ungrouped".';
    const groupOk = (g) => GROUP_RE.test(g) && !RESERVED_GROUPS.includes(g);
    const noDupes = (hosts, key) => {
      for (const h of hosts) {
        if (seen.has(h.name)) {
          e[key] = `"${h.name}" is listed twice. Stanza lets a machine sit in one group only.`;
          return;
        }
        seen.add(h.name);
      }
    };

    const gA = v.groupA.trim();
    const gB = v.groupB.trim();
    const parent = v.parentName.trim();

    if (!groupOk(gA)) e.groupA = GROUP_MSG;
    const pa = parseHosts(v.hostsA);
    if (pa.error) e.hostsA = pa.error;
    else if (!pa.hosts.length) e.hostsA = 'Add at least one machine.';
    else noDupes(pa.hosts, 'hostsA');

    if (gB || v.hostsB.trim()) {
      if (!gB) e.groupB = 'Name this group, or clear its machines to skip it.';
      else if (!groupOk(gB)) e.groupB = GROUP_MSG;
      else if (gB === gA) e.groupB = 'Use a different name from the first group.';
      const pb = parseHosts(v.hostsB);
      if (pb.error) e.hostsB = pb.error;
      else if (!pb.hosts.length) e.hostsB = 'Add at least one machine, or clear the group name to skip this group.';
      else noDupes(pb.hosts, 'hostsB');
    }

    if (parent) {
      if (!groupOk(parent)) e.parentName = GROUP_MSG;
      else if (parent === gA || parent === gB) e.parentName = 'Use a different name from the groups it holds.';
    }

    const user = v.ansibleUser.trim();
    if (user && !USER_RE.test(user)) e.ansibleUser = 'Use lowercase letters, digits, _ and - (up to 32). Start with a letter or _.';

    const port = v.sshPort.trim();
    if (port && !(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
      e.sshPort = 'Use a number from 1 to 65535.';
    }

    const key = v.keyPath.trim();
    if (key && (!KEYPATH_RE.test(key) || key.includes('..') || key.endsWith('/'))) {
      e.keyPath = 'Use a path to a key file. Letters, digits and . _ - / ~ only (no spaces, no ..).';
    }

    if (v.makeSite && !HOST_RE.test(v.siteHosts.trim())) {
      e.siteHosts = 'Use all or a group name: letters, digits and . _ -   (no spaces).';
    }

    return e;
  },

  build(v) {
    const gA = v.groupA.trim();
    const gB = v.groupB.trim();
    const parent = v.parentName.trim();
    const user = v.ansibleUser.trim();
    const port = v.sshPort.trim();
    const key = v.keyPath.trim();
    const hostsA = parseHosts(v.hostsA).hosts;
    const hostsB = gB ? parseHosts(v.hostsB).hosts : [];
    const files = [];

    /* inventory.ini */
    {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });

      add(
        '# Inventory: the machines Ansible manages.',
        'A line that starts with # is a comment. Ansible ignores it. This is the INI format; Ansible also reads YAML inventories.'
      );
      add('');
      add(
        `[${gA}]`,
        'A group. Square brackets name it, and every line under it is a machine in that group. A playbook says hosts: ' + gA + ' to run on all of them.'
      );
      hostsA.forEach((h, i) =>
        add(
          hostLine(h),
          i === 0
            ? 'The first word is the name Ansible uses in its output. ansible_host is the real address to connect to. Leave it out and the name itself is used.'
            : null
        )
      );

      if (gB) {
        add('');
        add(`[${gB}]`, 'A second group. Machines can have a different job, so you can target them separately.');
        hostsB.forEach((h) => add(hostLine(h)));
      }

      if (parent) {
        add('');
        add(
          `[${parent}:children]`,
          ':children means the names below are groups, not machines. Targeting ' + parent + ' now reaches every machine in them.'
        );
        add(gA);
        if (gB) add(gB);
      }

      add('');
      add('[all:vars]', 'Variables for every machine. all is a built-in group that holds everything in the file.');
      if (user) add(`ansible_user=${user}`, 'The account Ansible logs in as over SSH.');
      if (port) add(`ansible_port=${port}`, 'The SSH port.');
      if (key) {
        add(
          `ansible_ssh_private_key_file=${key}`,
          'The private key on the machine where you run Ansible. A path only. Never write a password or key text in this file.'
        );
      }
      add(
        `ansible_python_interpreter=${v.python}`,
        v.python === 'auto_silent'
          ? 'Ansible runs Python on each machine. auto_silent lets Ansible find it and stay quiet about it.'
          : 'The Python that Ansible uses on each machine. Wrong path means every task fails, so check it with: which python3'
      );

      files.push({ path: 'inventory.ini', label: 'inventory.ini', lines });
    }

    /* ansible.cfg */
    if (v.makeCfg) {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      add(
        '[defaults]',
        'Ansible reads ansible.cfg from the folder you run commands in. It ignores one in a folder that anyone can write to, such as /tmp, so keep your project in your home folder.'
      );
      add('inventory = inventory.ini', 'Where your inventory is. With this set you can leave out -i inventory.ini on every command.');
      add(
        'host_key_checking = True',
        'Ansible checks each machine against ~/.ssh/known_hosts, so you notice if one is replaced. True is already the default. Keep it: turning it off removes that protection.'
      );
      files.push({ path: 'ansible.cfg', label: 'ansible.cfg', lines });
    }

    /* site.yml */
    if (v.makeSite) {
      const lines = [];
      const add = (t, n = null) => lines.push({ t, n });
      add('---', DOC_START_NOTE);
      add('- name: Check that Ansible can reach every machine', 'A play. A playbook is a list of plays.');
      add(`  hosts: ${v.siteHosts.trim()}`, 'Which machines to check. They come from inventory.ini.');
      add(
        '  gather_facts: true',
        'Collects facts about each machine first: operating system, memory, network. The task below uses them.'
      );
      add('  tasks:');
      add('    - name: Test the connection', 'A task label.');
      add(
        '      ansible.builtin.ping:',
        'Not a network ping. It logs in over SSH and runs Python on the machine. If it works, Ansible can manage that machine.'
      );
      add('    - name: Show the operating system');
      add('      ansible.builtin.debug:', 'Prints a message in the output. It changes nothing on the machine.');
      add(
        `        msg: "{{ inventory_hostname }} runs {{ ansible_facts['distribution'] }} {{ ansible_facts['distribution_version'] }}"`,
        'The double curly braces insert a value. inventory_hostname is the name from your inventory. The value starts with {{, so it must be in quotes.'
      );
      files.push({ path: 'site.yml', label: 'site.yml', lines });
    }

    return files;
  },

  zipName() {
    return 'ansible-project.zip';
  },

  run(v) {
    const user = v.ansibleUser.trim();
    const port = v.sshPort.trim();
    const key = v.keyPath.trim();
    const first = parseHosts(v.hostsA).hosts[0];
    const target = `${user ? user + '@' : ''}${first.addr || first.name}`;
    const commands = [];
    const flags = [];

    if (key) {
      commands.push({
        cmd: `ssh-keygen -t ed25519 -f ${key}`,
        what: 'Only if you do not have this key yet. Makes the key pair. It asks you for a passphrase, and asks before overwriting an existing key.',
      });
      commands.push({
        cmd: `ssh-copy-id -i ${key}.pub${port && port !== '22' ? ' -p ' + port : ''} ${target}`,
        what: 'Puts your public key on the first machine so Ansible can log in without a password. It asks for that machine\'s password once. Repeat for each machine.',
      });
      flags.push(
        { flag: 'ssh-keygen -t ed25519', meaning: 'Key type. ed25519 is short and modern, and a good default.' },
        { flag: 'ssh-keygen -f', meaning: 'File name for the new private key. The public key gets the same name plus .pub.' },
        { flag: 'ssh-copy-id -i', meaning: 'Which public key to copy to the machine.' }
      );
      if (port && port !== '22') flags.push({ flag: 'ssh-copy-id -p', meaning: 'The SSH port, when it is not 22.' });
    }

    commands.push(
      {
        cmd: 'ansible-inventory -i inventory.ini --graph',
        what: 'Draws your groups and machines as a tree. Use it to check the file reads the way you meant.',
      },
      {
        cmd: 'ansible all -i inventory.ini -m ansible.builtin.ping',
        what: 'Logs in to every machine and tests it. Green SUCCESS with "pong" means it works.',
      }
    );
    flags.push(
      { flag: 'ansible-inventory --graph', meaning: 'Show the inventory as a tree and stop. Nothing connects to any machine.' },
      { flag: 'all', meaning: 'The pattern: every machine in the inventory. You can use a group name here instead.' },
      { flag: '-i inventory.ini', meaning: 'Path to the inventory file. Not needed when ansible.cfg sets it.' },
      { flag: '-m ansible.builtin.ping', meaning: 'The module to run. ping checks that Ansible can log in and run Python.' }
    );

    if (v.makeSite) {
      commands.push({
        cmd: 'ansible-playbook -i inventory.ini site.yml',
        what: 'Runs the starter playbook. It prints the operating system of each machine.',
      });
    }

    return {
      where:
        'Run these in a terminal on your Ansible control node (VM console or SSH). Save the downloaded files together in one folder in your home directory, then run the commands from that folder.',
      commands,
      flags,
    };
  },
};

/* =====================================================================
   Tool: Ad-hoc command
   ===================================================================== */

const MODULE_LABEL = {
  'ansible.builtin.ping': 'ping',
  'ansible.builtin.setup': 'setup',
  'ansible.builtin.command': 'command',
  'ansible.builtin.shell': 'shell',
  'ansible.builtin.package': 'package',
  'ansible.builtin.service': 'service',
  'ansible.builtin.copy': 'copy',
};

const MODULE_NOTE = {
  'ansible.builtin.ping': 'ping is not a network ping. It logs in over SSH and runs Python, so it proves Ansible can manage the machine.',
  'ansible.builtin.setup': 'setup collects facts about each machine: operating system, memory, network and more.',
  'ansible.builtin.command':
    'command runs a program directly, without a shell, so pipes and variables do not work. That makes it the safer choice. It reports "changed" every time, because Ansible cannot know if it changed anything.',
  'ansible.builtin.shell':
    'shell runs the text through /bin/sh, so pipes and redirects work. It also runs anything in the text as is, so never put untrusted input in it. Use command when you can.',
  'ansible.builtin.package': 'package picks apt, dnf or yum for you. Safe to run again: if the software is already in the wanted state, nothing changes.',
  'ansible.builtin.service': 'service starts, stops and restarts services on any init system. Safe to run again.',
  'ansible.builtin.copy': 'copy sends a file from this machine to the targets. If the target already has the same content, nothing changes.',
};

const adhoc = {
  id: 'adhoc',
  label: 'Ad-hoc command',
  ready: true,
  title: 'Ad-hoc command',
  intro:
    'A one-off command typed straight into the terminal. Good for quick checks and quick fixes. Use a playbook when you want to repeat the job.',

  groups: [
    {
      legend: 'Where it runs',
      fields: [
        {
          id: 'pattern',
          type: 'text',
          label: 'Which machines?',
          hint: 'A machine name, a group name, or all. It must exist in your inventory.',
          default: 'webservers',
        },
        {
          id: 'inventory',
          type: 'text',
          label: 'Inventory file',
          hint: 'Leave empty if ansible.cfg already points to your inventory.',
          default: 'inventory.ini',
        },
      ],
    },
    {
      legend: 'What to run',
      fields: [
        {
          id: 'module',
          type: 'select',
          label: 'Module (the tool that does the job)',
          options: [
            ['ansible.builtin.ping', 'ping: test the login'],
            ['ansible.builtin.setup', 'setup: show machine facts'],
            ['ansible.builtin.command', 'command: run a program'],
            ['ansible.builtin.shell', 'shell: run with pipes'],
            ['ansible.builtin.package', 'package: install or remove'],
            ['ansible.builtin.service', 'service: start or stop'],
            ['ansible.builtin.copy', 'copy: send a file'],
          ],
          default: 'ansible.builtin.ping',
        },
        {
          id: 'cmd',
          type: 'text',
          label: 'Command to run',
          hint: 'For example uptime or df -h.',
          default: 'uptime',
          showIf: { field: 'module', in: ['ansible.builtin.command', 'ansible.builtin.shell'] },
        },
        {
          id: 'filter',
          type: 'text',
          label: 'Only show facts that match',
          hint: 'For example ansible_distribution*. Leave empty to show everything (a lot).',
          default: 'ansible_distribution*',
          showIf: { field: 'module', in: ['ansible.builtin.setup'] },
        },
        {
          id: 'packages',
          type: 'text',
          label: 'Packages',
          hint: 'Separate several with commas.',
          default: 'nginx',
          showIf: { field: 'module', in: ['ansible.builtin.package'] },
        },
        {
          id: 'pkgState',
          type: 'select',
          label: 'What should happen to them?',
          options: PKG_STATES,
          default: 'present',
          showIf: { field: 'module', in: ['ansible.builtin.package'] },
        },
        {
          id: 'service',
          type: 'text',
          label: 'Service',
          hint: 'The service name, for example nginx.',
          default: 'nginx',
          showIf: { field: 'module', in: ['ansible.builtin.service'] },
        },
        {
          id: 'svcState',
          type: 'select',
          label: 'What state should it be in?',
          options: SVC_STATES,
          default: 'started',
          showIf: { field: 'module', in: ['ansible.builtin.service'] },
        },
        {
          id: 'copySrc',
          type: 'text',
          label: 'File to send: where it is now',
          hint: 'On this machine, for example files/motd.txt.',
          default: 'files/motd.txt',
          showIf: { field: 'module', in: ['ansible.builtin.copy'] },
        },
        {
          id: 'copyDest',
          type: 'text',
          label: 'File to send: where it should go',
          hint: 'A full path on the targets, for example /etc/motd.',
          default: '/etc/motd',
          showIf: { field: 'module', in: ['ansible.builtin.copy'] },
        },
        {
          id: 'copyMode',
          type: 'select',
          label: 'File permissions',
          options: [
            ['0644', '0644: everyone can read'],
            ['0640', '0640: owner and group only'],
            ['0600', '0600: owner only'],
          ],
          default: '0644',
          showIf: { field: 'module', in: ['ansible.builtin.copy'] },
        },
      ],
    },
    {
      legend: 'Options',
      fields: [
        {
          id: 'become',
          type: 'check',
          label: 'Run with sudo (--become)',
          hint: 'Needed to install packages and manage services. Not needed for ping or setup.',
          default: false,
          showIf: {
            field: 'module',
            in: [
              'ansible.builtin.command',
              'ansible.builtin.shell',
              'ansible.builtin.package',
              'ansible.builtin.service',
              'ansible.builtin.copy',
            ],
          },
        },
        {
          id: 'dryRun',
          type: 'check',
          label: 'Dry run only (--check)',
          hint: 'Shows what would change without changing it. command and shell are skipped in a dry run.',
          default: false,
          showIf: {
            field: 'module',
            in: ['ansible.builtin.package', 'ansible.builtin.service', 'ansible.builtin.copy', 'ansible.builtin.command', 'ansible.builtin.shell'],
          },
        },
      ],
    },
  ],

  validate(v) {
    const e = {};
    const m = v.module;

    if (!PATTERN_RE.test(v.pattern.trim())) {
      e.pattern = 'Use a machine or group name, or all: letters, digits and . _ -   (no spaces).';
    }

    const inv = v.inventory.trim();
    if (inv && (!REL_PATH_RE.test(inv) || inv.includes('..') || inv.endsWith('/'))) {
      e.inventory = 'Use a file path: letters, digits and . _ - / only (no spaces, no ..).';
    }

    if (m === 'ansible.builtin.command' || m === 'ansible.builtin.shell') {
      const c = v.cmd.trim();
      if (!c) e.cmd = 'Type the command to run.';
      else if (c.length > 200) e.cmd = 'Keep it under 200 characters. For longer jobs, write a playbook.';
      else if (BAD_IN_QUOTES.test(c)) {
        e.cmd = 'Remove these characters: " $ ` \\ !   Your terminal treats them as special even inside quotes, so they would change the command.';
      }
    }

    if (m === 'ansible.builtin.setup') {
      const f = v.filter.trim();
      if (f && !/^[A-Za-z0-9_*]{1,60}$/.test(f)) e.filter = 'Use letters, digits, _ and * only.';
    }

    if (m === 'ansible.builtin.package') {
      const pkgs = splitList(v.packages);
      const bad = pkgs.find((p) => !PKG_RE.test(p));
      if (!pkgs.length) e.packages = 'Add at least one package.';
      else if (bad) e.packages = `"${bad}" is not a valid package name. Use letters, digits and + . _ -`;
    }

    if (m === 'ansible.builtin.service') {
      if (!PKG_RE.test(v.service.trim())) e.service = 'Use letters, digits and + . _ -   (no spaces).';
    }

    if (m === 'ansible.builtin.copy') {
      const src = v.copySrc.trim();
      const dest = v.copyDest.trim();
      if (!isSrcPath(src)) e.copySrc = 'Use a file path: letters, digits and . _ - / only (no spaces, no ..).';
      if (!isAbsFile(dest)) e.copyDest = 'Use a full path to a file, for example /etc/motd.';
    }

    if ((m === 'ansible.builtin.package' || m === 'ansible.builtin.service') && !v.become) {
      e.become = 'This changes the system, so it needs root rights. Tick "Run with sudo", or the command will fail.';
    }

    return e;
  },

  build(v) {
    const m = v.module;
    const rootless = m === 'ansible.builtin.ping' || m === 'ansible.builtin.setup';
    const parts = [];
    const add = (t, n = null) => parts.push({ t, n });
    const inv = v.inventory.trim();

    add(
      `ansible ${v.pattern.trim()}`,
      'ansible is the ad-hoc command. The word after it is the pattern: which machines to run on. A name or group from your inventory, or all.'
    );
    if (inv) add(`  -i ${inv}`, 'The inventory file. Leave it out if ansible.cfg sets the inventory.');
    add(`  -m ${m}`, MODULE_NOTE[m]);

    if (m === 'ansible.builtin.setup' && v.filter.trim()) {
      add(`  -a "filter=${v.filter.trim()}"`, 'Module arguments, as key=value pairs inside quotes. filter keeps only the facts whose names match. The * matches any characters.');
    }
    if (m === 'ansible.builtin.command' || m === 'ansible.builtin.shell') {
      add(`  -a "${v.cmd.trim()}"`, '-a gives the module its arguments. For command and shell the argument is the command line itself, in quotes.');
    }
    if (m === 'ansible.builtin.package') {
      const pkgs = splitList(v.packages).join(',');
      add(
        `  -a "name=${pkgs} state=${v.pkgState}"`,
        'Module arguments as key=value pairs. name lists the packages (comma between several). ' + PKG_STATE_NOTE[v.pkgState]
      );
    }
    if (m === 'ansible.builtin.service') {
      add(`  -a "name=${v.service.trim()} state=${v.svcState}"`, 'Module arguments as key=value pairs. ' + SVC_STATE_NOTE[v.svcState]);
    }
    if (m === 'ansible.builtin.copy') {
      add(
        `  -a "src=${v.copySrc.trim()} dest=${v.copyDest.trim()} mode=${v.copyMode}"`,
        'src is read on this machine, dest is written on the targets. mode is the permissions in octal.'
      );
    }

    if (!rootless && v.become) {
      add('  --become', 'Run on the targets with root rights (sudo). Without it the command runs as the SSH user.');
    }
    if (!rootless && v.dryRun) {
      add('  --check', 'Dry run. Ansible reports what would change and changes nothing.');
    }

    const lines = parts.map((p, i) => ({ t: i < parts.length - 1 ? `${p.t} \\` : p.t, n: p.n }));
    return [{ path: 'adhoc-command.sh', label: 'adhoc-command.sh', lines }];
  },

  run(v) {
    const m = v.module;
    const rootless = m === 'ansible.builtin.ping' || m === 'ansible.builtin.setup';
    const inv = v.inventory.trim();
    const commands = [];
    const flags = [
      { flag: 'ansible', meaning: 'The ad-hoc command. It runs one module on the machines you pick.' },
      { flag: `${v.pattern.trim()} (the pattern)`, meaning: 'Right after ansible: which machines. A name, a group, or all.' },
      { flag: '-m', meaning: 'The module to run.' },
    ];

    if (inv) {
      commands.push({
        cmd: `ansible-inventory -i ${inv} --graph`,
        what: 'Run this first. It shows your groups and machines, so you can check the name you chose exists.',
      });
      flags.push({ flag: '-i', meaning: 'Path to the inventory file.' });
      flags.push({ flag: '--graph', meaning: 'Show the inventory as a tree and stop.' });
    }
    commands.push({
      cmd: `ansible-doc ${m}`,
      what: 'The manual for the module you chose, right in the terminal: every option, with examples.',
    });
    flags.push({ flag: 'ansible-doc', meaning: 'Shows module documentation. Press q to leave it.' });

    if (m === 'ansible.builtin.setup' || m === 'ansible.builtin.command' || m === 'ansible.builtin.shell' || m === 'ansible.builtin.package' || m === 'ansible.builtin.service' || m === 'ansible.builtin.copy') {
      flags.push({ flag: '-a', meaning: 'Arguments for the module, in quotes.' });
    }
    if (!rootless && v.become) flags.push({ flag: '--become', meaning: 'Run with root rights (sudo) on the targets.' });
    if (!rootless && v.dryRun) flags.push({ flag: '--check', meaning: 'Dry run. Report what would change, change nothing.' });

    return {
      where:
        'Run these in a terminal on your Ansible control node (VM console or SSH), in the folder that holds your inventory. Copy the command from the sheet and paste it as is: the backslashes at the line ends are part of it.',
      commands,
      flags,
    };
  },
};

/* =====================================================================
   The page is organised as SUITES (Ansible, Terraform, Docker). Each suite
   holds its own generators. A suite with no tools yet shows its planned list.
   ===================================================================== */

// terraform.js defines the Terraform generators. A browser loads it first; Node needs require().
// jenkins.js defines the Jenkins generators, loaded the same way.
const JENKINS_TOOLS_ALL = [
  ...(typeof JENKINS_TOOLS !== 'undefined' ? JENKINS_TOOLS : require('./jenkins.js').JENKINS_TOOLS),
  ...(typeof JENKINS_MORE_TOOLS !== 'undefined' ? JENKINS_MORE_TOOLS : require('./jenkins-more.js').JENKINS_MORE_TOOLS),
];
const JENKINS_ORDER = ['pipeline', 'multibranch', 'matrix', 'deploy', 'library', 'setup', 'agent'];
const JENKINS_TOOLS_LIST = JENKINS_ORDER.map((id) => JENKINS_TOOLS_ALL.find((x) => x.id === id));
const TERRAFORM_TOOLS_LIST = typeof TERRAFORM_TOOLS !== 'undefined' ? TERRAFORM_TOOLS : require('./terraform.js').TERRAFORM_TOOLS;

const SUITES = [
  {
    id: 'ansible',
    label: 'Ansible',
    icon: 'brand/tools/ansible.svg',
    tools: [inventory, adhoc, playbook, role],
    references: [
      { id: 'commands', label: 'Commands' },
      { id: 'modules', label: 'Modules' },
      { id: 'concepts', label: 'Concepts' },
    ],
  },
  {
    id: 'terraform',
    label: 'Terraform',
    icon: 'brand/tools/terraform.svg',
    tools: TERRAFORM_TOOLS_LIST,
    references: [
      { id: 'commands', label: 'Commands' },
      { id: 'concepts', label: 'Concepts' },
      { id: 'resources', label: 'Resources' },
    ],
  },
  {
    id: 'jenkins',
    label: 'Jenkins',
    icon: 'brand/tools/jenkins.svg',
    tools: JENKINS_TOOLS_LIST,
    references: [
      { id: 'concepts', label: 'Concepts' },
      { id: 'steps', label: 'Steps' },
      { id: 'variables', label: 'Variables' },
      { id: 'plugins', label: 'Plugins' },
      { id: 'errors', label: 'Errors' },
      { id: 'admin', label: 'Admin and CLI' },
    ],
  },
  {
    id: 'docker',
    label: 'Docker',
    icon: 'brand/tools/docker.svg',
    tools: [],
    plannedIntro:
      'Docker packages an app and everything it needs into one unit. These generators are planned for the next builds.',
    planned: [
      { name: 'Dockerfile', text: 'Pick a language and get a Dockerfile that follows best practice, with every line explained.' },
      { name: 'Docker Compose', text: 'An app and its database in one file, with ports, volumes and settings.' },
    ],
  },
];

// Every generator that exists today, in one flat list (the tests use this).
const TOOLS = SUITES.flatMap((s) => s.tools).map((tool) => ({ ready: true, ...tool }));

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { TOOLS, SUITES, splitList };

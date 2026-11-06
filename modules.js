'use strict';

/*
  modules.js — the Ansible module reference.

  A module is the small tool a task uses to do one job. Each entry shows a
  real task you can copy, then explains it option by option. Only modules that
  ship with Ansible itself (ansible.builtin) are listed, so every example works
  on a plain install. Same shape as commands.js, except `cmd` is YAML.
*/

const MODULE_GROUPS = [
  /* ------------------------------------------------------------------ */
  {
    id: 'check',
    tool: 'Check and debug',
    kind: 'yaml',
    title: 'Checking, showing and deciding',
    blurb: 'Small helpers for testing a connection, printing a message, saving a value and stopping when something is wrong.',
    commands: [
      {
        id: 'ping',
        cmd: `- name: Check the machine answers
  ansible.builtin.ping:`,
        title: 'ping: can Ansible log in and use Python?',
        what: 'Connects to the machine and replies "pong". It changes nothing.',
        use: 'The first task of a new playbook, to prove the connection works.',
        parts: [
          ['name: …', 'A label you choose. Ansible prints it while it runs, so write what the task does in plain words.'],
          ['ansible.builtin.ping:', 'The module. The full name is namespace.collection.module. This one takes no options, so nothing follows the colon.'],
        ],
        tips: ['This is not the network ping. It does a real login, so it also proves SSH and Python work.'],
      },
      {
        id: 'debug',
        cmd: `- name: Show which machine this is
  ansible.builtin.debug:
    msg: "This is {{ inventory_hostname }}"`,
        title: 'debug: print a message or a variable',
        what: 'Prints text to your screen while the playbook runs. It changes nothing on the machine.',
        use: 'To see what a variable holds, or to mark progress in a long playbook.',
        parts: [
          ['msg: "…"', 'The text to print. Put it in quotes when it contains {{ }}.'],
          ['{{ inventory_hostname }}', 'A variable. The double curly braces tell Ansible to swap in the real value. inventory_hostname is the machine’s name from your inventory.'],
          ['var: result', 'Another way: print a whole variable by name, with no braces. Use it instead of msg.'],
        ],
        tips: ['Use msg for sentences and var for looking inside a variable. Never print passwords with it.'],
      },
      {
        id: 'setup',
        cmd: `- name: Collect only the OS facts
  ansible.builtin.setup:
    gather_subset:
      - '!all'
      - min
    filter: ansible_distribution*`,
        title: 'setup: collect facts about the machine',
        what: 'Reads the OS name and version, addresses, memory and more, and stores them as variables such as ansible_facts.',
        use: 'Normally a playbook does this by itself at the start (gather_facts). Call it by hand when you turned that off, or want it again later.',
        parts: [
          ['gather_subset:', 'Which groups of facts to collect. A shorter list makes the playbook faster.'],
          ["- '!all'", 'The ! means "not". Start by leaving everything out…'],
          ['- min', '…then add back only the small basic set.'],
          ['filter: ansible_distribution*', 'Keep only facts whose names match. The * is a wildcard.'],
        ],
      },
      {
        id: 'set-fact',
        cmd: `- name: Remember the app address
  ansible.builtin.set_fact:
    app_url: "http://{{ inventory_hostname }}:8080"`,
        title: 'set_fact: save a value for later tasks',
        what: 'Creates a variable in the middle of a playbook. Later tasks can use it.',
        use: 'When a value is worked out from other values and you want to use it several times.',
        parts: [
          ['app_url:', 'The new variable’s name. Use lowercase letters, numbers and underscores.'],
          ['"http://…:8080"', 'Its value. It can include other variables in {{ }}.'],
        ],
      },
      {
        id: 'assert',
        cmd: `- name: Stop if this is not Debian-based
  ansible.builtin.assert:
    that:
      - ansible_facts['os_family'] == 'Debian'
    fail_msg: "This playbook only supports Debian and Ubuntu."
    success_msg: "OS check passed."`,
        title: 'assert: stop early if something is wrong',
        what: 'Checks that a statement is true. If it is not, the playbook stops on that machine and shows your message.',
        use: 'At the top of a playbook, to fail early with a clear reason instead of halfway through.',
        parts: [
          ['that:', 'A list of statements that must all be true.'],
          ["ansible_facts['os_family'] == 'Debian'", 'A yes/no test. == means "is equal to". os_family is a fact from the machine.'],
          ['fail_msg:', 'What to print when the test fails.'],
          ['success_msg:', 'What to print when it passes.'],
        ],
      },
      {
        id: 'fail',
        cmd: `- name: Refuse to run without a version
  ansible.builtin.fail:
    msg: "Set app_version first, for example -e app_version=1.2"
  when: app_version is not defined`,
        title: 'fail: stop on purpose',
        what: 'Stops the playbook with your message, but only when the "when" test is true.',
        use: 'Guarding against a missing value or a risky situation.',
        parts: [
          ['msg:', 'The reason to show.'],
          ['when: app_version is not defined', 'Only run this task if the variable app_version has no value.'],
        ],
      },
      {
        id: 'pause',
        cmd: `- name: Give the service time to start
  ansible.builtin.pause:
    seconds: 10`,
        title: 'pause: wait, or ask a person',
        what: 'Waits for 10 seconds. With prompt: instead, it waits for someone to press Enter.',
        use: 'A short wait, or a "are you sure?" before a risky step.',
        parts: [
          ['seconds: 10', 'How long to wait.'],
          ['prompt: "Press Enter to continue"', 'Use instead of seconds to wait for a person.'],
        ],
        tips: ['If you are waiting for a port or a file, wait_for is better than a fixed pause. It continues as soon as the thing is ready.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'run',
    tool: 'Run commands',
    kind: 'yaml',
    title: 'Running commands and scripts',
    blurb: 'When no ready-made module exists, these run a command for you. Reach for a real module first, because modules know when nothing needs to change.',
    commands: [
      {
        id: 'command',
        cmd: `- name: Read the uptime
  ansible.builtin.command: uptime
  register: uptime_out
  changed_when: false`,
        title: 'command: run one program',
        what: 'Runs the program directly and saves what it prints.',
        use: 'Looking at the machine, or running a program that has no module.',
        parts: [
          ['ansible.builtin.command: uptime', 'The program to run, written right after the colon.'],
          ['register: uptime_out', 'Save the result in a variable called uptime_out. Use uptime_out.stdout to read what it printed.'],
          ['changed_when: false', 'Tell Ansible this only looks and never changes anything. Without it, the recap would say "changed" every run.'],
        ],
        tips: ['No pipes (|), redirects (>) or $variables here. Use the shell module when you need those.'],
      },
      {
        id: 'shell',
        cmd: `- name: Count the logged-in users
  ansible.builtin.shell: who | wc -l
  register: user_count
  changed_when: false`,
        title: 'shell: run a line in the shell',
        what: 'Runs your text through the machine’s shell, so pipes, redirects and wildcards work.',
        use: 'When you need a pipe, such as "list things, then count them".',
        parts: [
          ['who | wc -l', 'who lists the logged-in users. The | passes that list to wc -l, which counts the lines.'],
          ['register: user_count', 'Save the answer.'],
          ['changed_when: false', 'This only reads, so never report "changed".'],
        ],
        careful: 'Shell runs exactly what you write, so a typo can do real damage. Use it only when command and the real modules cannot do the job.',
      },
      {
        id: 'script',
        cmd: `- name: Run my setup script on the machine
  ansible.builtin.script: scripts/setup.sh
  args:
    creates: /etc/setup-done`,
        title: 'script: run a script from your computer',
        what: 'Sends a script from your computer to the machine, runs it there, and removes it. The script does not need to be installed first.',
        use: 'Running an existing shell script on many machines.',
        parts: [
          ['scripts/setup.sh', 'The path of the script on your computer.'],
          ['args:', 'Extra settings for the module, in a small block below.'],
          ['creates: /etc/setup-done', 'If this file already exists, skip the task. Your script should create it when it finishes, so the task runs once.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'files',
    tool: 'Files',
    kind: 'yaml',
    title: 'Working with files',
    blurb: 'Copy files, fill in templates, change a single line, download things and look at what is on disk.',
    commands: [
      {
        id: 'copy',
        cmd: `- name: Send the login banner
  ansible.builtin.copy:
    src: files/motd
    dest: /etc/motd
    owner: root
    group: root
    mode: "0644"
  become: true`,
        title: 'copy: send a file to the machine',
        what: 'Copies a file from your computer to the machine. If the same file is already there, nothing changes.',
        use: 'Config files, scripts, keys and banners.',
        parts: [
          ['src: files/motd', 'Source. The file on your computer. A relative path is looked up in the files folder next to your playbook or role.'],
          ['dest: /etc/motd', 'Destination. Where the file goes on the machine.'],
          ['owner: root / group: root', 'Who owns the file afterwards.'],
          ['mode: "0644"', 'Permissions. Keep the quotes, so it stays a text value. 0644 means the owner edits, everyone reads.'],
          ['become: true', 'Run as admin (sudo). Writing in /etc needs it.'],
        ],
        tips: ['To write short text without a source file, use content: "hello" instead of src.'],
      },
      {
        id: 'template',
        cmd: `- name: Write the web server config from a template
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: "0644"
    validate: nginx -t -c %s
  become: true`,
        title: 'template: fill in a file, then send it',
        what: 'Takes a template file (.j2), replaces the {{ variables }} inside it, and puts the result on the machine.',
        use: 'Config files that differ per machine, such as a different port or hostname in each.',
        parts: [
          ['src: nginx.conf.j2', 'The template, on your computer. Ordinary text with {{ variable }} holes in it. The .j2 ending stands for Jinja2, the template language.'],
          ['dest:', 'Where the finished file goes.'],
          ['mode: "0644"', 'Permissions of the finished file.'],
          ['validate: nginx -t -c %s', 'Test the new file before putting it in place. %s stands for the file being checked. If the test fails, the old file stays and the task fails.'],
        ],
        tips: ['If you add notify: Restart nginx, Ansible restarts the service only when the file really changed. See "Handlers" under Playbook concepts.'],
      },
      {
        id: 'file',
        cmd: `- name: Make the app folder
  ansible.builtin.file:
    path: /opt/myapp
    state: directory
    owner: deploy
    group: deploy
    mode: "0755"
  become: true`,
        title: 'file: folders, permissions, links, delete',
        what: 'Makes sure a path is what you say: a folder, an empty file, a link, or gone.',
        use: 'Creating folders and fixing permissions.',
        parts: [
          ['path: /opt/myapp', 'The folder or file to manage.'],
          ['state: directory', 'The goal. Others: touch (empty file), link (symlink), absent (delete), file (must already exist).'],
          ['owner / group', 'Who owns it. The user must already exist.'],
          ['mode: "0755"', 'Owner can do everything, others can look and enter.'],
        ],
        careful: 'state: absent deletes the path for good, including everything inside a folder. Double-check the path.',
      },
      {
        id: 'lineinfile',
        cmd: `- name: Turn off SSH root login
  ansible.builtin.lineinfile:
    path: /etc/ssh/sshd_config
    regexp: '^#?PermitRootLogin'
    line: PermitRootLogin no
    backup: true
    validate: /usr/sbin/sshd -t -f %s
  become: true`,
        title: 'lineinfile: make sure one line is in a file',
        what: 'Finds a line that matches a pattern and replaces it. If nothing matches, it adds the line at the end.',
        use: 'Changing one setting in a file you do not want to replace as a whole.',
        parts: [
          ['path:', 'The file to edit, on the machine.'],
          ["regexp: '^#?PermitRootLogin'", 'A pattern that finds the old line. ^ means "start of line" and #? means "maybe a # first", so it also matches a commented-out line.'],
          ['line: PermitRootLogin no', 'The line that must exist after the task.'],
          ['backup: true', 'Keep a dated copy of the old file first.'],
          ['validate: /usr/sbin/sshd -t -f %s', 'Test the edited file before using it. A broken SSH config can lock you out, so this matters.'],
        ],
        careful: 'Always keep a second login open while you change SSH settings. A bad pattern can add a second, conflicting line.',
      },
      {
        id: 'blockinfile',
        cmd: `- name: Add the lab machines to /etc/hosts
  ansible.builtin.blockinfile:
    path: /etc/hosts
    marker: "# {mark} ANSIBLE MANAGED: lab machines"
    block: |
      192.168.1.11 web1
      192.168.1.12 web2
  become: true`,
        title: 'blockinfile: manage a group of lines',
        what: 'Keeps a block of several lines inside a file, wrapped in two marker comments so Ansible can find it again.',
        use: 'Adding several related lines, such as hosts entries, without touching the rest of the file.',
        parts: [
          ['marker: "# {mark} …"', 'The comment lines placed around the block. {mark} turns into BEGIN and END.'],
          ['block: |', 'The lines to keep. The | means "keep these lines exactly as written, line breaks included".'],
        ],
        tips: ['Run it again with a changed block and Ansible replaces the old block. It never stacks copies.'],
      },
      {
        id: 'replace',
        cmd: `- name: Change the app port everywhere in a file
  ansible.builtin.replace:
    path: /etc/myapp/app.conf
    regexp: 'port = 8000'
    replace: 'port = 8080'
  become: true`,
        title: 'replace: change text everywhere in a file',
        what: 'Replaces every piece of text that matches the pattern.',
        use: 'Find and replace across a whole file. lineinfile only handles one line.',
        parts: [
          ['regexp:', 'What to look for. It is a pattern (regular expression), so characters like . and * are special.'],
          ['replace:', 'What to put in its place.'],
        ],
      },
      {
        id: 'stat',
        cmd: `- name: Does the config file exist?
  ansible.builtin.stat:
    path: /etc/nginx/nginx.conf
  register: nginx_conf

- name: Say so
  ansible.builtin.debug:
    msg: "Found it"
  when: nginx_conf.stat.exists`,
        title: 'stat: look at a file without changing it',
        what: 'Reports whether a path exists, how big it is, who owns it, and more. Changes nothing.',
        use: 'Making a decision: only do something if the file is there, or is not.',
        parts: [
          ['path:', 'What to inspect.'],
          ['register: nginx_conf', 'Save the report in a variable.'],
          ['nginx_conf.stat.exists', 'True when the path exists. The other answers sit beside it: .stat.isdir, .stat.size, .stat.mode and more.'],
          ['when:', 'Run the second task only when the test is true.'],
        ],
      },
      {
        id: 'find',
        cmd: `- name: Find log files older than a week
  ansible.builtin.find:
    paths: /var/log/myapp
    patterns: "*.log"
    age: 7d
  register: old_logs`,
        title: 'find: search for files',
        what: 'Looks in a folder for files that match, and returns the list.',
        use: 'Clean-up jobs: find the old files first, then delete them in a second task.',
        parts: [
          ['paths:', 'Where to look.'],
          ['patterns: "*.log"', 'Names to match. The * is a wildcard.'],
          ['age: 7d', 'Only files older than 7 days. Use h for hours, w for weeks.'],
          ['register: old_logs', 'The list is in old_logs.files.'],
        ],
        tips: ['Add recurse: true to search inside sub-folders too.'],
      },
      {
        id: 'fetch',
        cmd: `- name: Bring a log file back to my computer
  ansible.builtin.fetch:
    src: /var/log/syslog
    dest: logs/
    flat: false`,
        title: 'fetch: copy a file from the machine to you',
        what: 'The opposite of copy. It downloads a file from each machine to your computer.',
        use: 'Collecting logs or configs for review.',
        parts: [
          ['src:', 'The file on the machine.'],
          ['dest: logs/', 'The folder on your computer.'],
          ['flat: false', 'Keep each machine’s files in its own sub-folder, so they do not overwrite each other.'],
        ],
      },
      {
        id: 'unarchive',
        cmd: `- name: Unpack the app download
  ansible.builtin.unarchive:
    src: /tmp/myapp.tar.gz
    dest: /opt/myapp
    remote_src: true`,
        title: 'unarchive: unpack a .zip or .tar.gz',
        what: 'Unpacks an archive into a folder.',
        use: 'Installing software that is delivered as an archive.',
        parts: [
          ['src:', 'The archive file.'],
          ['dest:', 'The folder to unpack into. It must already exist.'],
          ['remote_src: true', 'The archive is already on the machine. Without this, Ansible copies it from your computer first.'],
        ],
      },
      {
        id: 'get-url',
        cmd: `- name: Download the installer
  ansible.builtin.get_url:
    url: https://example.com/myapp-1.2.tar.gz
    dest: /tmp/myapp.tar.gz
    mode: "0644"
    checksum: sha256:PUT_THE_REAL_CHECKSUM_HERE`,
        title: 'get_url: download a file to the machine',
        what: 'Downloads from a web address onto the machine. It skips the download if the file is already there.',
        use: 'Fetching installers and archives.',
        parts: [
          ['url:', 'Where to download from. The example address is made up, so replace it.'],
          ['dest:', 'Where to save it on the machine.'],
          ['checksum: sha256:…', 'A fingerprint of the correct file. Ansible refuses a file that does not match, which protects you from a damaged or swapped download.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'packages',
    tool: 'Packages and services',
    kind: 'yaml',
    title: 'Packages and services',
    blurb: 'Install software, then make sure it is running. The module depends on the machine’s operating system, or use package, which picks for you.',
    commands: [
      {
        id: 'apt',
        cmd: `- name: Install nginx
  ansible.builtin.apt:
    name: nginx
    state: present
    update_cache: true
    cache_valid_time: 3600
  become: true`,
        title: 'apt: install software (Debian and Ubuntu)',
        what: 'Makes sure the package is installed. If it is already there, nothing changes.',
        use: 'Installing, upgrading and removing packages on Debian, Ubuntu and Kali.',
        parts: [
          ['name: nginx', 'The package. You can give a list to install several at once.'],
          ['state: present', 'The goal. present = installed, latest = installed and up to date, absent = removed.'],
          ['update_cache: true', 'Refresh the package list first, like apt update.'],
          ['cache_valid_time: 3600', 'Skip that refresh if it already happened in the last 3600 seconds (an hour). Saves time on repeat runs.'],
          ['become: true', 'Installing needs admin rights.'],
        ],
        careful: 'state: latest can upgrade a package you did not mean to change. present is the safe choice.',
      },
      {
        id: 'dnf',
        cmd: `- name: Install nginx
  ansible.builtin.dnf:
    name: nginx
    state: present
  become: true`,
        title: 'dnf: install software (Red Hat family)',
        what: 'Does the same job as apt, for Fedora, Rocky, AlmaLinux and RHEL.',
        use: 'Red Hat family machines.',
        parts: [
          ['name:', 'The package name. Names can differ from Debian’s, for example httpd instead of apache2.'],
          ['state: present', 'Installed.'],
        ],
      },
      {
        id: 'package',
        cmd: `- name: Install git on any Linux
  ansible.builtin.package:
    name: git
    state: present
  become: true`,
        title: 'package: install software on any Linux',
        what: 'Looks at the machine and hands the job to apt, dnf or whatever it uses.',
        use: 'Playbooks that run on mixed machines. Use it for packages with the same name everywhere, like git or curl.',
        parts: [
          ['name: git', 'The package.'],
          ['state: present', 'Installed.'],
        ],
        tips: ['When the package has different names on different systems, use apt or dnf with a when: test instead.'],
      },
      {
        id: 'pip',
        cmd: `- name: Install Flask in its own environment
  ansible.builtin.pip:
    name: flask
    virtualenv: /opt/myapp/venv
    virtualenv_command: python3 -m venv`,
        title: 'pip: install Python packages',
        what: 'Installs Python libraries, optionally into a private "virtual environment" folder.',
        use: 'Deploying Python apps.',
        parts: [
          ['name: flask', 'The Python package.'],
          ['virtualenv: /opt/myapp/venv', 'Install into this private folder, so it does not mix with the system’s Python.'],
          ['virtualenv_command: python3 -m venv', 'How to create that folder if it does not exist yet.'],
        ],
      },
      {
        id: 'service',
        cmd: `- name: Start nginx and keep it on after reboots
  ansible.builtin.service:
    name: nginx
    state: started
    enabled: true
  become: true`,
        title: 'service: start, stop, restart',
        what: 'Makes sure a service is running, and that it starts again after a reboot.',
        use: 'After installing software, and after changing its config.',
        parts: [
          ['name: nginx', 'The service.'],
          ['state: started', 'The goal. Others: stopped, restarted, reloaded.'],
          ['enabled: true', 'Also start it automatically at boot.'],
        ],
        tips: ['state: started does nothing if it is already running, so it is safe to repeat. state: restarted always restarts.'],
      },
      {
        id: 'systemd',
        cmd: `- name: Reload unit files, then start the app
  ansible.builtin.systemd:
    name: myapp
    state: started
    enabled: true
    daemon_reload: true
  become: true`,
        title: 'systemd: manage services the modern way',
        what: 'Like service, with extra options that only systemd has.',
        use: 'When you just wrote or changed a .service file.',
        parts: [
          ['name / state / enabled', 'Same meaning as in the service module.'],
          ['daemon_reload: true', 'Tell systemd to re-read its service files first. Needed after you add or change one.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'system',
    tool: 'Users and system',
    kind: 'yaml',
    title: 'Users, scheduling and the system',
    blurb: 'People, groups, scheduled jobs, names, restarts, waiting, web requests and git.',
    commands: [
      {
        id: 'user',
        cmd: `- name: Create the deploy user
  ansible.builtin.user:
    name: deploy
    shell: /bin/bash
    groups: sudo
    append: true
    create_home: true
  become: true`,
        title: 'user: create or change an account',
        what: 'Makes sure the account exists with the settings you give.',
        use: 'Adding the same admin or service account to many machines.',
        parts: [
          ['name: deploy', 'The account name.'],
          ['shell: /bin/bash', 'The login shell.'],
          ['groups: sudo', 'Extra groups to join.'],
          ['append: true', 'Add to those groups and keep the user’s other groups. Leave it out and the user is removed from every group not listed.'],
          ['create_home: true', 'Make the home folder.'],
        ],
        careful: 'Do not write a plain-text password here. A password: must be a hashed value, and secrets belong in ansible-vault. SSH keys are better.',
      },
      {
        id: 'group',
        cmd: `- name: Create the devops group
  ansible.builtin.group:
    name: devops
    state: present
  become: true`,
        title: 'group: create a group',
        what: 'Makes sure a group exists.',
        use: 'Before a user or a file needs that group.',
        parts: [
          ['name: devops', 'The group name.'],
          ['state: present', 'It should exist. absent removes it.'],
        ],
      },
      {
        id: 'hostname',
        cmd: `- name: Name the machine
  ansible.builtin.hostname:
    name: web1
  become: true`,
        title: 'hostname: set the machine’s name',
        what: 'Changes the machine’s hostname, now and after a reboot.',
        use: 'Naming new servers to match your inventory.',
        parts: [['name: web1', 'The new hostname. Letters, numbers and dashes.']],
      },
      {
        id: 'cron',
        cmd: `- name: Run the backup every night at 02:30
  ansible.builtin.cron:
    name: Nightly backup
    minute: "30"
    hour: "2"
    job: /usr/local/bin/backup.sh
    user: root
  become: true`,
        title: 'cron: schedule a job',
        what: 'Adds a scheduled job to a user’s crontab. Run again and it updates the same job. It does not add a second one.',
        use: 'Backups, clean-ups and reports that must run on a timetable.',
        parts: [
          ['name: Nightly backup', 'A label. Ansible uses it to recognise the job next time, so keep it unique and stable.'],
          ['minute: "30" / hour: "2"', 'When to run: 02:30. Leave out day, month and weekday and they mean "every".'],
          ['job:', 'The command to run.'],
          ['user: root', 'Whose crontab to use.'],
        ],
      },
      {
        id: 'reboot',
        cmd: `- name: Restart the machine and wait for it
  ansible.builtin.reboot:
    reboot_timeout: 300
    msg: "Rebooting for a kernel update"
  become: true`,
        title: 'reboot: restart and wait until it is back',
        what: 'Restarts the machine, then waits until SSH answers again before the next task.',
        use: 'After kernel updates, or any change that needs a restart.',
        parts: [
          ['reboot_timeout: 300', 'Give up after 300 seconds (5 minutes) if the machine does not come back.'],
          ['msg:', 'A message shown to anyone logged in.'],
        ],
        careful: 'The machine goes offline. Use serial (see Playbook concepts) so you do not restart every server at once.',
      },
      {
        id: 'wait-for',
        cmd: `- name: Wait until the web server answers
  ansible.builtin.wait_for:
    port: 80
    delay: 5
    timeout: 60`,
        title: 'wait_for: wait until something is ready',
        what: 'Waits until a port is open or a file exists, then moves on. It fails if the time runs out.',
        use: 'After starting a service, before the next step needs it.',
        parts: [
          ['port: 80', 'Wait for this network port to accept connections. Use path: to wait for a file instead.'],
          ['delay: 5', 'Wait 5 seconds before the first check.'],
          ['timeout: 60', 'Give up after 60 seconds.'],
        ],
      },
      {
        id: 'git',
        cmd: `- name: Get the app code
  ansible.builtin.git:
    repo: https://github.com/example/myapp.git
    dest: /opt/myapp
    version: main`,
        title: 'git: clone or update a repository',
        what: 'Downloads a repository, or updates it if it is already there.',
        use: 'Deploying code from git.',
        parts: [
          ['repo:', 'The repository address. This one is an example, so replace it.'],
          ['dest: /opt/myapp', 'Where to put it on the machine.'],
          ['version: main', 'The branch, tag or commit to check out.'],
        ],
        tips: ['The machine needs git installed. Install it first with the package module.'],
      },
      {
        id: 'uri',
        cmd: `- name: Check the health page
  ansible.builtin.uri:
    url: http://localhost:8080/health
    method: GET
    status_code: 200
    return_content: true
  register: health`,
        title: 'uri: talk to a web address',
        what: 'Sends a web request and checks the answer. Good for health checks and APIs.',
        use: 'Checking that a site works after a deploy, or calling an API.',
        parts: [
          ['url:', 'The address to call.'],
          ['method: GET', 'The kind of request. Others: POST, PUT, DELETE.'],
          ['status_code: 200', 'The answer that counts as success. 200 means OK. Any other code fails the task.'],
          ['return_content: true', 'Keep the page text, in health.content.'],
        ],
      },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { MODULE_GROUPS };

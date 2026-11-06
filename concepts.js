'use strict';

/*
  concepts.js — the playbook ideas reference.

  Modules do the work. These are the ideas that tie tasks together: variables,
  loops, conditions, handlers, tags, error handling and splitting a big
  playbook up. Same shape as commands.js, `cmd` is YAML.

  noRun: true means the example is a piece that cannot run alone (it needs a
  role folder, or it is the content of a separate file). Every other example
  was run on a real machine while this was written.
*/

const CONCEPT_GROUPS = [
  /* ------------------------------------------------------------------ */
  {
    id: 'shape',
    tool: 'Shape of a playbook',
    kind: 'yaml',
    title: 'The shape of a playbook',
    blurb: 'A playbook is a list of plays. A play says which machines to use and what to do on them.',
    commands: [
      {
        id: 'anatomy',
        cmd: `- name: Set up the web servers
  hosts: webservers
  become: true
  gather_facts: true

  tasks:
    - name: Say hello
      ansible.builtin.debug:
        msg: "Hello from {{ inventory_hostname }}"`,
        title: 'A whole playbook, line by line',
        what: 'One play with one task. It picks the machines, asks for admin rights, collects facts, then runs the task.',
        use: 'Every playbook you will write has this shape. Learn it first.',
        parts: [
          ['- name: Set up the web servers', 'The play’s label. The leading dash means "this is one item in a list of plays".'],
          ['hosts: webservers', 'Which machines. A group name, a single host, or all. These names come from your inventory.'],
          ['become: true', 'Run everything in this play as admin (sudo).'],
          ['gather_facts: true', 'Start by collecting facts about each machine. Turn it off to run faster when you do not need them.'],
          ['tasks:', 'The list of jobs. They run top to bottom.'],
          ['- name: Say hello', 'One task. Each task has a name, then a module.'],
        ],
        tips: [
          'Indentation is the grammar of YAML. Use spaces, never tabs. Two spaces per level is the habit.',
          'The same file can hold several plays, one after another, for different groups of machines.',
        ],
      },
      {
        id: 'vars',
        cmd: `- name: Use a variable
  hosts: webservers
  gather_facts: false
  vars:
    http_port: 8080
    app_name: myapp

  tasks:
    - name: Show the settings
      ansible.builtin.debug:
        msg: "{{ app_name }} listens on port {{ http_port }}"`,
        title: 'Variables: name a value once, use it everywhere',
        what: 'Defines two variables at the top of the play, then uses them inside the message.',
        use: 'Anything that appears more than once, or that you might change: ports, folder names, versions.',
        parts: [
          ['vars:', 'A block of variables for this play.'],
          ['http_port: 8080', 'A variable called http_port with the value 8080. Name, colon, value.'],
          ['{{ app_name }}', 'Use a variable. Double curly braces, with the name inside.'],
          ['msg: "{{ … }}"', 'If a value starts with {{, put quotes around the whole thing. Otherwise YAML gets confused.'],
        ],
        tips: ['Run with -e "http_port=9090" and that value wins over the one in the file.'],
      },
      {
        id: 'magic',
        cmd: `- name: Built-in variables
  hosts: webservers
  gather_facts: false
  tasks:
    - name: Who and where am I?
      ansible.builtin.debug:
        msg:
          - "My name: {{ inventory_hostname }}"
          - "Machines in this play: {{ ansible_play_hosts }}"
          - "Everything in the webservers group: {{ groups['webservers'] }}"`,
        title: 'Built-in variables you get for free',
        what: 'Prints a few variables that Ansible fills in for you. You never define them.',
        use: 'Writing tasks that adapt to the machine they run on.',
        parts: [
          ['inventory_hostname', 'The machine’s name, exactly as in your inventory.'],
          ['ansible_play_hosts', 'The machines this play is running on right now.'],
          ["groups['webservers']", 'Every machine in a group, found by name. Handy for building lists of servers.'],
          ['msg: - "…"', 'msg can be a list. Each item prints on its own line.'],
        ],
        tips: ['Others worth knowing: hostvars (the variables of any other machine) and ansible_facts (what setup collected).'],
      },
      {
        id: 'group-vars',
        cmd: `# File: group_vars/webservers.yml
# Everything here applies to every machine in the webservers group.
http_port: 8080
app_user: deploy
packages:
  - nginx
  - git`,
        title: 'group_vars and host_vars: variables in their own files',
        what: 'A file named after a group holds that group’s variables. Ansible finds it by name, so you do not have to import it.',
        use: 'Keeping settings out of your playbooks, so one playbook works for several environments.',
        parts: [
          ['group_vars/webservers.yml', 'A folder called group_vars next to your inventory or playbook, holding a file named after the group.'],
          ['http_port: 8080', 'Plain variables. No vars: heading is needed in these files.'],
          ['packages: - nginx - git', 'A list. Use it later with a loop.'],
          ['host_vars/web1.yml', 'The same idea for one machine. It wins over the group’s value.'],
        ],
        tips: ['This is a separate file, not part of the playbook, so you cannot run it by itself.'],
        noRun: true,
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'decisions',
    tool: 'Decisions',
    kind: 'yaml',
    title: 'Making decisions',
    blurb: 'Run a task only sometimes, save what a task found, and decide what counts as a failure.',
    commands: [
      {
        id: 'when',
        cmd: `- name: Only on Debian-family machines
  ansible.builtin.debug:
    msg: "This is Debian or Ubuntu"
  when: ansible_facts['os_family'] == 'Debian'`,
        title: 'when: run a task only if something is true',
        what: 'Skips the task unless the test is true. Skipped tasks are shown as "skipping".',
        use: 'Different commands for different operating systems, or tasks that depend on an earlier result.',
        parts: [
          ['when:', 'The test. It does not use {{ }}.'],
          ["ansible_facts['os_family']", 'A fact about the machine. Needs gather_facts to be on.'],
          ["== 'Debian'", 'Is equal to. Others: != (is not), > < >= <=, in, and, or, not, is defined.'],
        ],
        tips: ['Several tests: put them in a list. All must be true. when: - a == 1 - b == 2'],
      },
      {
        id: 'register',
        cmd: `- name: Look at the date
  ansible.builtin.command: date +%Y
  register: year
  changed_when: false

- name: Use what it found
  ansible.builtin.debug:
    msg: "The year is {{ year.stdout }}"`,
        title: 'register: save what a task found',
        what: 'Stores a task’s whole result in a variable. A later task can read it.',
        use: 'Any time one step needs to know what another step found.',
        parts: [
          ['register: year', 'Save the result as "year".'],
          ['year.stdout', 'What the command printed. Other parts: .rc (exit code, 0 means success), .stderr, .changed, .failed.'],
          ['changed_when: false', 'This task only reads, so it should never count as a change.'],
        ],
        tips: ['Not sure what is inside? Print it all: debug with var: year.'],
      },
      {
        id: 'failed-when',
        cmd: `- name: Run a check that prints a warning word
  ansible.builtin.command: echo "status WARNING"
  register: check
  changed_when: false
  failed_when: "'ERROR' in check.stdout"
  ignore_errors: false`,
        title: 'failed_when, changed_when, ignore_errors',
        what: 'Overrides how Ansible decides that a task failed, changed something, or should be allowed to fail.',
        use: 'Commands that return odd exit codes, or print "ERROR" yet exit with 0.',
        parts: [
          ['failed_when: "\'ERROR\' in check.stdout"', 'Treat the task as failed only if the output contains ERROR.'],
          ['changed_when: false', 'Never report this task as a change.'],
          ['ignore_errors: false', 'The default. Set it to true to carry on even if the task fails.'],
        ],
        careful: 'ignore_errors: true hides real problems. Use failed_when for the exact case you expect, instead.',
      },
      {
        id: 'block',
        cmd: `- name: Try something, handle failure, always clean up
  block:
    - name: The risky step
      ansible.builtin.command: "false"
  rescue:
    - name: Runs only if the block failed
      ansible.builtin.debug:
        msg: "It failed, so we recovered"
  always:
    - name: Runs no matter what
      ansible.builtin.debug:
        msg: "Cleaning up"`,
        title: 'block, rescue, always: try, recover, clean up',
        what: 'Groups tasks. If one fails, the rescue tasks run. The always tasks run in every case.',
        use: 'Upgrades and deployments where you want to roll back or clean up after a failure.',
        parts: [
          ['block:', 'The tasks to try, as one group.'],
          ['rescue:', 'Runs only if something in the block failed. Like "catch" in a programming language.'],
          ['always:', 'Runs every time, success or failure.'],
        ],
        tips: ['You can also put become: true or when: on the block once, and it applies to all the tasks inside.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'repeat',
    tool: 'Repeating',
    kind: 'yaml',
    title: 'Repeating things',
    blurb: 'Do the same task for a list of items, or keep trying until it works.',
    commands: [
      {
        id: 'loop',
        cmd: `- name: Show each package name
  ansible.builtin.debug:
    msg: "Would install {{ item }}"
  loop:
    - nginx
    - git
    - curl`,
        title: 'loop: do one task for each item in a list',
        what: 'Runs the task three times, once for each name. Inside, the current name is called item.',
        use: 'Installing several packages, creating several users, copying several files.',
        parts: [
          ['loop:', 'The list to go through.'],
          ['- nginx / - git / - curl', 'The items. One per line, each starting with a dash.'],
          ['{{ item }}', 'The current item. This name is always "item".'],
        ],
        tips: [
          'For packages, the apt and dnf modules accept a list in name: directly, which is faster than a loop.',
          'Rename item with loop_control: loop_var: pkg if you do not like the name.',
        ],
      },
      {
        id: 'loop-dict',
        cmd: `- name: Loop over items that have several parts
  ansible.builtin.debug:
    msg: "{{ item.name }} gets shell {{ item.shell }}"
  loop:
    - { name: alice, shell: /bin/bash }
    - { name: bob, shell: /bin/zsh }`,
        title: 'loop over items with several fields',
        what: 'Each item has a name and a shell, and you read them as item.name and item.shell.',
        use: 'Creating several users, each with their own settings.',
        parts: [
          ['{ name: alice, shell: /bin/bash }', 'One item with two fields, written on a single line in curly braces.'],
          ['{{ item.name }}', 'Read one field from the current item with a dot.'],
        ],
      },
      {
        id: 'until',
        cmd: `- name: Keep trying until it works
  ansible.builtin.command: echo ready
  register: result
  until: result.rc == 0
  retries: 5
  delay: 2
  changed_when: false`,
        title: 'until, retries, delay: try again',
        what: 'Runs the task again and again until the test is true or the retries run out.',
        use: 'Waiting for something that needs a moment, such as a service after a restart.',
        parts: [
          ['until: result.rc == 0', 'Stop when this is true. rc is the exit code, and 0 means success.'],
          ['retries: 5', 'Try at most 5 times.'],
          ['delay: 2', 'Wait 2 seconds between tries.'],
        ],
      },
      {
        id: 'serial',
        cmd: `- name: Update two machines at a time
  hosts: webservers
  serial: 2
  gather_facts: false
  tasks:
    - name: Pretend to update
      ansible.builtin.debug:
        msg: "Updating {{ inventory_hostname }}"`,
        title: 'serial: roll out a few machines at a time',
        what: 'Finishes the whole play on 2 machines, then the next 2, and so on, instead of all machines at once.',
        use: 'Updating live servers, so the whole site never goes down together.',
        parts: [
          ['serial: 2', 'The batch size. A percentage like "25%" also works.'],
        ],
        tips: ['Pair it with max_fail_percentage: 0 to stop the rollout if any machine fails.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'react',
    tool: 'Reacting and ordering',
    kind: 'yaml',
    title: 'Reacting to changes, and picking parts to run',
    blurb: 'Restart a service only when its config changed, and run just the part of a playbook you want.',
    commands: [
      {
        id: 'handlers',
        cmd: `- name: Handlers run only after a change
  hosts: webservers
  gather_facts: false
  tasks:
    - name: Write a small file
      ansible.builtin.copy:
        content: "hello"
        dest: /tmp/stanza-demo.txt
        mode: "0644"
      notify: Tell me it changed

  handlers:
    - name: Tell me it changed
      ansible.builtin.debug:
        msg: "The file changed, so the handler ran"`,
        title: 'handlers and notify: react only when something changed',
        what: 'The handler runs at the end, and only if the task that notified it really changed something.',
        use: 'Restarting a service after its config file changed, and not otherwise.',
        parts: [
          ['notify: Tell me it changed', 'If this task changes something, ring the handler with this name.'],
          ['handlers:', 'A separate list at the end of the play. Handlers are tasks that wait to be notified.'],
          ['- name: Tell me it changed', 'The handler’s name. It must match the notify text exactly.'],
        ],
        tips: [
          'Run it twice. The second run shows no change, so the handler does not run. That is the whole point.',
          'Handlers run once at the end, even if five tasks notified them. Use the module meta: flush_handlers to run them sooner.',
        ],
      },
      {
        id: 'tags',
        cmd: `- name: Tag tasks so you can run only some
  hosts: webservers
  gather_facts: false
  tasks:
    - name: Install step
      ansible.builtin.debug:
        msg: "installing"
      tags: [install]

    - name: Configure step
      ansible.builtin.debug:
        msg: "configuring"
      tags:
        - config
        - never_skip`,
        title: 'tags: run only part of a playbook',
        what: 'Marks tasks with labels. Later you can run only the tasks that carry a label.',
        use: 'Big playbooks, where you only want to redo one step.',
        parts: [
          ['tags: [install]', 'Give this task one label. Square brackets or a dash list both work.'],
          ['ansible-playbook site.yml --tags config', 'Run only tasks tagged config.'],
          ['ansible-playbook site.yml --skip-tags install', 'Run everything except the install tasks.'],
        ],
      },
      {
        id: 'delegate',
        cmd: `- name: Do one task from a different machine
  hosts: webservers
  gather_facts: false
  tasks:
    - name: Runs on my computer, once
      ansible.builtin.debug:
        msg: "Told the load balancer about {{ inventory_hostname }}"
      delegate_to: localhost

    - name: Runs on only the first machine
      ansible.builtin.debug:
        msg: "Only one machine does this"
      run_once: true`,
        title: 'delegate_to and run_once',
        what: 'delegate_to runs a task on another machine. run_once runs it a single time, however many machines are in the play.',
        use: 'Talking to a load balancer, adding a monitoring entry, or running a database change one time.',
        parts: [
          ['delegate_to: localhost', 'Run this task on another machine. localhost means your own computer, the control node.'],
          ['run_once: true', 'Do it for one machine only. The result is shared with the others.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'safe',
    tool: 'Safety and secrets',
    kind: 'yaml',
    title: 'Safety, secrets and admin rights',
    blurb: 'Who a task runs as, how to keep secrets out of the screen, and how to try a task without risk.',
    commands: [
      {
        id: 'become',
        cmd: `- name: Choose who a task runs as
  hosts: webservers
  gather_facts: false
  tasks:
    - name: Runs as the login user
      ansible.builtin.command: whoami
      register: me
      changed_when: false

    - name: Runs as admin only if you need it
      ansible.builtin.debug:
        msg: "Login user is {{ me.stdout }}"
      become: false`,
        title: 'become: run as admin (sudo) or as another user',
        what: 'Decides if a task runs as the login user or as another user, usually root.',
        use: 'Installing software and editing system files needs it. Everything else is safer without it.',
        parts: [
          ['become: true', 'Run as root (sudo). Put it on a task, a block or a whole play.'],
          ['become: false', 'Run as the normal login user, even if the play says otherwise.'],
          ['become_user: postgres', 'Become this user instead of root, for example to run a database command.'],
        ],
        tips: ['Rule of thumb: ask for admin rights only where the task needs them.'],
      },
      {
        id: 'no-log',
        cmd: `- name: Handle a secret without printing it
  ansible.builtin.command: echo "pretend this sets the password"
  vars:
    db_password: "not-a-real-password"
  no_log: true
  changed_when: false`,
        title: 'no_log: keep secrets off the screen',
        what: 'Hides the task’s details from the output and from logs. Ansible shows only that it ran.',
        use: 'Any task that handles a password, token or key.',
        parts: [
          ['no_log: true', 'Do not print this task’s arguments or results, even with -vvv.'],
          ['db_password:', 'In a real project this value would come from an ansible-vault file. Never type a real one into the playbook.'],
        ],
        careful: 'Hidden output also hides real errors, which makes debugging harder. Turn no_log off only while testing with fake data.',
      },
      {
        id: 'environment',
        cmd: `- name: Give a task extra environment variables
  ansible.builtin.shell: echo "$APP_ENV"
  environment:
    APP_ENV: production
  register: env_out
  changed_when: false`,
        title: 'environment: set variables for one task',
        what: 'Sets operating-system environment variables, such as a proxy or a mode, for this task only.',
        use: 'Programs that read settings from the environment.',
        parts: [
          ['environment:', 'A block of NAME: value pairs.'],
          ['APP_ENV: production', 'Becomes the environment variable $APP_ENV for this task only.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'split',
    tool: 'Splitting work up',
    kind: 'yaml',
    title: 'Splitting a big playbook into pieces',
    blurb: 'Roles and task files keep playbooks short, so each piece does one job and can be reused.',
    commands: [
      {
        id: 'roles',
        cmd: `- name: Use roles in a play
  hosts: webservers
  become: true
  roles:
    - common
    - role: webserver
      vars:
        http_port: 8080`,
        title: 'roles: use a packaged set of tasks',
        what: 'Runs everything inside the role folder (tasks, handlers, templates, defaults) on the machines.',
        use: 'Reusing the same setup, such as "a web server", in many playbooks.',
        parts: [
          ['roles:', 'The list of roles to run, in order, before the play’s own tasks.'],
          ['- common', 'A role called "common", found in the roles folder.'],
          ['- role: webserver / vars:', 'The longer form, so you can hand the role settings of its own.'],
        ],
        tips: ['Make a role with ansible-galaxy role init, or use the Role generator in Stanza.'],
        noRun: true,
      },
      {
        id: 'import-tasks',
        cmd: `- name: Pull in task files
  hosts: webservers
  tasks:
    - name: Always the same steps
      ansible.builtin.import_tasks: tasks/common.yml

    - name: Steps picked while running
      ansible.builtin.include_tasks: "tasks/{{ ansible_facts['os_family'] }}.yml"`,
        title: 'import_tasks and include_tasks: share task files',
        what: 'Both pull another file of tasks into your play. They differ in when Ansible reads the file.',
        use: 'A long playbook that you want to cut into readable pieces.',
        parts: [
          ['import_tasks:', 'Read at the start, before anything runs. Use it for a fixed file name.'],
          ['include_tasks:', 'Read only when this step is reached. Use it when the file name depends on a variable.'],
          ['tasks/common.yml', 'A file holding a plain list of tasks, with no play heading.'],
        ],
        noRun: true,
      },
      {
        id: 'jinja',
        cmd: `- name: Change values with filters
  ansible.builtin.debug:
    msg:
      - "{{ 'shout' | upper }}"
      - "{{ missing_var | default('fallback value') }}"
      - "{{ ['a', 'b', 'c'] | join(', ') }}"
      - "{{ 'ubuntu' if ansible_facts is defined else 'unknown' }}"`,
        title: 'Jinja2 filters: change a value as you use it',
        what: 'A filter is added after a pipe | and changes the value before it is used.',
        use: 'Giving a variable a default, changing case, joining a list into text. They work in tasks and in templates.',
        parts: [
          ['| upper', 'Make the text capital letters. lower does the opposite.'],
          ["| default('fallback value')", 'If the variable does not exist, use this instead of stopping with an error.'],
          ["| join(', ')", 'Turn a list into one piece of text, with this between the items.'],
          ["'a' if test else 'b'", 'A short either-or choice inside the braces.'],
        ],
        tips: ['The same {{ }} and filters work inside .j2 template files used by the template module.'],
      },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { CONCEPT_GROUPS };

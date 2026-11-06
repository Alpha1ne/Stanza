'use strict';

/*
  commands.js — the Ansible command reference.

  Plain data, no page code. app.js draws it. Every command has:
    cmd    a real example you can copy
    title  what it is for, in everyday words
    what   what happens when you press Enter
    use    when you would reach for it
    parts  the example taken apart, piece by piece: [piece, what it means]
    tips   (optional) things that trip beginners up
    careful (optional) a warning, shown for commands that change machines

  Everything here was checked against ansible-core 2.22.
*/

const WORDS = [
  ['Control node', 'The computer you type Ansible commands on. Your laptop or a management server.'],
  ['Managed node', 'A machine Ansible controls. It needs SSH and Python. It does not need Ansible installed.'],
  ['Inventory', 'The list of managed nodes, kept in a file such as inventory.ini.'],
  ['Module', 'A small built-in tool for one job, such as ping, apt, copy or service.'],
  ['Playbook', 'A YAML file that lists the jobs to run, in order.'],
  ['Role', 'A folder that packages tasks, files and settings so you can reuse them.'],
  ['Become', 'Ansible’s word for "run as an admin" (sudo). The flag is -b.'],
  ['Idempotent', 'Safe to run twice. If the machine is already right, Ansible changes nothing.'],
];

const COMMAND_GROUPS = [
  /* ------------------------------------------------------------------ */
  {
    id: 'adhoc',
    tool: 'ansible',
    title: 'One-line jobs: ansible',
    blurb:
      'The ansible command runs one module on one or many machines, right now, without writing a playbook. Good for quick checks and one-off fixes.',
    commands: [
      {
        id: 'version',
        cmd: 'ansible --version',
        title: 'Check Ansible is installed',
        what: 'Prints the Ansible version, which config file it is using, where it looks for modules, and which Python it runs on.',
        use: 'First thing to run after installing. Also the first thing to paste when you ask someone for help.',
        parts: [
          ['ansible', 'The command. It runs one job on your machines.'],
          ['--version', 'Do not run a job. Just print information about Ansible itself.'],
        ],
        tips: ['If you see "config file = None", Ansible found no ansible.cfg and is using built-in defaults. That is fine while learning.'],
      },
      {
        id: 'ping',
        cmd: 'ansible all -i inventory.ini -m ping',
        title: 'Check Ansible can reach every machine',
        what: 'Logs in to each machine over SSH, checks Python works there, and answers "pong".',
        use: 'Run this before anything else. If ping fails, nothing else will work either.',
        parts: [
          ['ansible', 'The command.'],
          ['all', 'The target: every machine in the inventory. You can also use a group name such as webservers, or one host name.'],
          ['-i inventory.ini', 'Inventory. Use this file as the list of machines.'],
          ['-m ping', 'Module. Run the ping module.'],
        ],
        tips: [
          'This is not the network ping. It does a real login, so it also proves your SSH key and Python are fine.',
          'Green "SUCCESS" with "pong" is good. "UNREACHABLE" means Ansible could not log in. Check the address, user and key.',
        ],
      },
      {
        id: 'ping-user',
        cmd: 'ansible webservers -i inventory.ini -m ping -u ubuntu --private-key ~/.ssh/id_ed25519',
        title: 'Ping with a specific user and SSH key',
        what: 'The same check, but you tell Ansible which login name and key file to use.',
        use: 'When the inventory does not already say who to log in as.',
        parts: [
          ['webservers', 'Only the machines in the webservers group.'],
          ['-u ubuntu', 'User. Log in as "ubuntu". Use the account your server really has.'],
          ['--private-key ~/.ssh/id_ed25519', 'Use this private key file for SSH. The ~ means your home folder.'],
        ],
        tips: ['Never put a password in the command. It would stay in your shell history. Use SSH keys, or -k to be asked for it.'],
      },
      {
        id: 'list-hosts',
        cmd: 'ansible all -i inventory.ini --list-hosts',
        title: 'See which machines a target matches',
        what: 'Prints the machines the target would pick, then stops. Nothing runs on them.',
        use: 'Before a risky command, to check "who will this touch?".',
        parts: [
          ['all', 'The target pattern to test. Try webservers or web1 instead.'],
          ['--list-hosts', 'Only list the matching machines. Do not connect to them.'],
        ],
      },
      {
        id: 'command',
        cmd: 'ansible all -i inventory.ini -m command -a "uptime"',
        title: 'Run a command on every machine',
        what: 'Runs the program "uptime" on each machine and shows you the answer from each one.',
        use: 'Quick looks at the machines: disk space, uptime, who is logged in.',
        parts: [
          ['-m command', 'Module. The command module runs one program directly. It is also the default if you leave -m out.'],
          ['-a "uptime"', 'Arguments. What to hand to the module. Here it is the program to run.'],
        ],
        tips: ['The command module cannot use pipes (|), redirects (>) or variables like $HOME. For those use the shell module (next one).'],
      },
      {
        id: 'shell',
        cmd: 'ansible all -i inventory.ini -m shell -a "df -h | grep /dev"',
        title: 'Run a shell line with pipes',
        what: 'Runs your text through the machine’s shell, so pipes, redirects and wildcards work.',
        use: 'When one program is not enough, such as "list disks, then keep only some lines".',
        parts: [
          ['-m shell', 'Module. Runs through /bin/sh, like typing in a terminal.'],
          ['df -h | grep /dev', 'The shell line: show disk space, then keep only lines containing /dev.'],
        ],
        careful: 'Shell runs exactly what you write and always reports "changed". Prefer a real module (apt, copy, service) when one exists.',
      },
      {
        id: 'setup',
        cmd: 'ansible web1 -i inventory.ini -m setup -a "filter=ansible_distribution*"',
        title: 'Read facts about a machine',
        what: 'Collects "facts" such as the OS name, version, IP addresses and memory. The filter keeps only the facts whose names match.',
        use: 'To learn what a machine is before writing tasks for it. Facts are also the variables playbooks use in conditions.',
        parts: [
          ['web1', 'One machine, by its inventory name.'],
          ['-m setup', 'Module. setup gathers facts.'],
          ['-a "filter=ansible_distribution*"', 'Only show facts starting with ansible_distribution. The * is a wildcard.'],
        ],
        tips: ['Drop the -a part to see every fact. It is a very long list.'],
      },
      {
        id: 'apt',
        cmd: 'ansible webservers -i inventory.ini -m apt -a "name=nginx state=present update_cache=yes" -b',
        title: 'Install a package (Debian and Ubuntu)',
        what: 'Makes sure nginx is installed. If it already is, nothing changes.',
        use: 'Installing one package on many machines without logging in to each.',
        parts: [
          ['-m apt', 'Module. apt manages packages on Debian and Ubuntu. Red Hat family systems use dnf instead.'],
          ['name=nginx', 'Which package.'],
          ['state=present', 'The goal: it should be installed. Other goals: absent (remove), latest (upgrade).'],
          ['update_cache=yes', 'Refresh the package list first, like apt update.'],
          ['-b', 'Become. Run as admin (sudo). Installing software needs it.'],
        ],
        careful: 'This changes real machines. Add --check first to see what would happen.',
      },
      {
        id: 'service',
        cmd: 'ansible webservers -i inventory.ini -m service -a "name=nginx state=restarted enabled=yes" -b',
        title: 'Start, stop or restart a service',
        what: 'Restarts nginx, and makes sure it starts by itself after a reboot.',
        use: 'After changing a config file, or to bring a stopped service back.',
        parts: [
          ['-m service', 'Module. Manages services.'],
          ['name=nginx', 'Which service.'],
          ['state=restarted', 'The action. Others: started, stopped, reloaded.'],
          ['enabled=yes', 'Also start it at boot.'],
          ['-b', 'Become. Run as admin.'],
        ],
        careful: 'Restarting drops live connections for a moment. Do not run this on all your servers at once in production.',
      },
      {
        id: 'copy',
        cmd: 'ansible all -i inventory.ini -m copy -a "src=./motd dest=/etc/motd mode=0644" -b',
        title: 'Send a file to every machine',
        what: 'Copies a file from your computer to each machine. If the file there is already identical, nothing happens.',
        use: 'Pushing a config file, a script or a login banner.',
        parts: [
          ['-m copy', 'Module. Copies files from the control node to the managed nodes.'],
          ['src=./motd', 'Source. The file on your computer. ./ means the current folder.'],
          ['dest=/etc/motd', 'Destination. Where it goes on the machine.'],
          ['mode=0644', 'File permissions. 0644 means the owner can edit, everyone can read.'],
          ['-b', 'Become. /etc needs admin rights.'],
        ],
      },
      {
        id: 'file',
        cmd: 'ansible all -i inventory.ini -m file -a "path=/tmp/demo state=directory mode=0755"',
        title: 'Create a folder, or set permissions',
        what: 'Makes sure the folder /tmp/demo exists with the permissions you set.',
        use: 'Making folders, changing permissions or owners, deleting files.',
        parts: [
          ['-m file', 'Module. Manages files, folders and links.'],
          ['path=/tmp/demo', 'Which path.'],
          ['state=directory', 'Make it a folder. Others: touch (empty file), absent (delete), link (symlink).'],
          ['mode=0755', 'Permissions: owner full, others read and enter.'],
        ],
        careful: 'state=absent deletes the path for good, including everything inside a folder.',
      },
      {
        id: 'user',
        cmd: 'ansible all -i inventory.ini -m user -a "name=deploy state=present groups=sudo append=yes" -b',
        title: 'Create a user account',
        what: 'Makes sure a user named "deploy" exists and is in the sudo group.',
        use: 'Setting up the same account on many servers.',
        parts: [
          ['-m user', 'Module. Manages user accounts.'],
          ['name=deploy', 'The account name.'],
          ['state=present', 'It should exist.'],
          ['groups=sudo', 'Put it in the sudo group.'],
          ['append=yes', 'Add to that group without removing the user from its other groups. Leave this out and the user loses them.'],
          ['-b', 'Become. Needs admin rights.'],
        ],
      },
      {
        id: 'check-mode',
        cmd: 'ansible webservers -i inventory.ini -m apt -a "upgrade=dist" -b --check',
        title: 'Dry run: see what would change',
        what: 'Goes through the motions and reports what would change, but changes nothing.',
        use: 'Before any change you are not sure about. Your seat belt.',
        parts: [
          ['upgrade=dist', 'The package upgrade to try.'],
          ['--check', 'Check mode. Predict only. Nothing is changed on the machines.'],
        ],
        tips: ['Check mode is a good guess, not a promise. Modules like shell and command are skipped, because Ansible cannot predict them.'],
      },
      {
        id: 'limit',
        cmd: 'ansible all -i inventory.ini -m ping --limit web1',
        title: 'Run on just one machine or group',
        what: 'Starts from the target (all), then narrows it to web1 only.',
        use: 'Trying a change on one machine before the rest. Re-running on the one that failed.',
        parts: [
          ['all', 'The wide target.'],
          ['--limit web1', 'Narrow it. Only keep web1. Short form: -l web1. Accepts group names and comma lists: web1,web2.'],
        ],
      },
      {
        id: 'reboot',
        cmd: 'ansible web1 -i inventory.ini -m reboot -b',
        title: 'Reboot a machine and wait for it',
        what: 'Restarts the machine, then waits until it is back and answers over SSH.',
        use: 'After a kernel update, or when a change asks for a restart.',
        parts: [
          ['-m reboot', 'Module. Reboots and waits, so a playbook can carry on safely afterwards.'],
          ['-b', 'Become. Rebooting needs admin rights.'],
        ],
        careful: 'The machine goes offline. Never aim this at all servers at once, and check with --list-hosts first.',
      },
      {
        id: 'ask-pass',
        cmd: 'ansible all -i inventory.ini -m ping -k -K',
        title: 'Type passwords when asked',
        what: 'Asks you for the SSH password (-k) and the sudo password (-K) before it runs. Nothing is shown in your shell history.',
        use: 'Servers that do not use SSH keys yet.',
        parts: [
          ['-k', 'Ask for the SSH connection password (lowercase k).'],
          ['-K', 'Ask for the sudo (become) password (uppercase K).'],
        ],
        tips: ['Password login needs the sshpass program on your computer. SSH keys are safer and need nothing extra.'],
      },
      {
        id: 'forks-verbose',
        cmd: 'ansible all -i inventory.ini -m ping -f 10 -vvv',
        title: 'Run faster, or see everything it does',
        what: 'Talks to 10 machines at the same time, and prints a lot of detail about every step.',
        use: 'Big inventories (forks), or tracking down why a connection fails (verbose).',
        parts: [
          ['-f 10', 'Forks. How many machines to handle at once. The default is 5.'],
          ['-vvv', 'Verbose. Each v adds detail. -v shows results, -vvv shows the SSH connection, -vvvv shows even more.'],
        ],
        tips: ['Add -vvv when you see UNREACHABLE. The SSH lines in the output usually name the real cause.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'playbook',
    tool: 'ansible-playbook',
    title: 'Running playbooks: ansible-playbook',
    blurb: 'A playbook is a YAML file of jobs. ansible-playbook runs it. These are the flags you will use every week.',
    commands: [
      {
        id: 'run',
        cmd: 'ansible-playbook -i inventory.ini site.yml',
        title: 'Run a playbook',
        what: 'Reads site.yml and does each task, in order, on the machines it names.',
        use: 'The main command of Ansible.',
        parts: [
          ['ansible-playbook', 'The command that runs playbooks.'],
          ['-i inventory.ini', 'The inventory file. Skip it if ansible.cfg already names one.'],
          ['site.yml', 'The playbook file to run.'],
        ],
        tips: [
          'Read the PLAY RECAP at the bottom. "ok" means already right, "changed" means Ansible fixed something, "failed" and "unreachable" need your attention.',
          'Run it twice. The second time should show changed=0. That is idempotence working.',
        ],
      },
      {
        id: 'syntax',
        cmd: 'ansible-playbook -i inventory.ini site.yml --syntax-check',
        title: 'Check the YAML is valid',
        what: 'Reads the playbook and complains about typos or bad indentation. It does not connect to any machine.',
        use: 'Right after you edit a playbook. It is instant and free.',
        parts: [['--syntax-check', 'Only test that the file can be read. Do not run anything.']],
        tips: ['It passes if the file is valid YAML. It cannot tell you if your logic is right.'],
      },
      {
        id: 'check',
        cmd: 'ansible-playbook -i inventory.ini site.yml --check --diff',
        title: 'Dry run and show the changes',
        what: 'Pretends to run the playbook. For file changes it shows the lines that would be added or removed.',
        use: 'The safest way to review a change before it touches a server.',
        parts: [
          ['--check', 'Check mode. Predict only. Change nothing.'],
          ['--diff', 'Show the before and after of files, with - for removed lines and + for added lines.'],
        ],
        tips: ['Tasks that need an earlier step to have really happened may show errors in check mode. That is normal.'],
      },
      {
        id: 'list-tasks',
        cmd: 'ansible-playbook -i inventory.ini site.yml --list-tasks',
        title: 'See the steps without running them',
        what: 'Prints every task in the playbook, in order, and stops.',
        use: 'To read a playbook someone else wrote.',
        parts: [['--list-tasks', 'List the task names. Run nothing.']],
        tips: ['Related: --list-hosts shows the machines it would touch, --list-tags shows the tags you can use.'],
      },
      {
        id: 'limit',
        cmd: 'ansible-playbook -i inventory.ini site.yml --limit web1',
        title: 'Run on only some machines',
        what: 'Runs the whole playbook, but only on web1.',
        use: 'Test on one server first. Fix just the machine that failed.',
        parts: [['--limit web1', 'Only these machines. Short form: -l. A group name or a comma list also works.']],
      },
      {
        id: 'tags',
        cmd: 'ansible-playbook -i inventory.ini site.yml --tags nginx',
        title: 'Run only tagged tasks',
        what: 'Runs only the tasks marked with the tag "nginx" in the playbook.',
        use: 'Re-run one part of a big playbook.',
        parts: [
          ['--tags nginx', 'Run only tasks that have this tag. Separate several with commas.'],
        ],
        tips: ['The opposite is --skip-tags: run everything except the tagged tasks.', 'See which tags exist with --list-tags.'],
      },
      {
        id: 'extra-vars',
        cmd: 'ansible-playbook -i inventory.ini site.yml -e "http_port=8080"',
        title: 'Change a variable for this run',
        what: 'Sets a variable called http_port to 8080 for this run only. It beats the same variable set anywhere else.',
        use: 'Trying a different value without editing files.',
        parts: [
          ['-e "http_port=8080"', 'Extra variable, in the form name=value. Long form: --extra-vars.'],
          ['-e @vars.yml', 'The @ means "read the variables from this file".'],
        ],
        tips: ['Extra vars have the highest priority. They win over everything else.'],
      },
      {
        id: 'ask-become',
        cmd: 'ansible-playbook -i inventory.ini site.yml -K',
        title: 'Be asked for the sudo password',
        what: 'Prompts you for the sudo password before running, so it is never saved in a file or in your history.',
        use: 'When the remote user needs a password for sudo.',
        parts: [['-K', 'Ask for the become (sudo) password. Long form: --ask-become-pass.']],
      },
      {
        id: 'start-at',
        cmd: 'ansible-playbook -i inventory.ini site.yml --start-at-task "Install nginx"',
        title: 'Skip ahead to a task',
        what: 'Skips every task before the one named, and starts from there.',
        use: 'A long playbook failed halfway and you fixed the problem.',
        parts: [['--start-at-task "Install nginx"', 'The exact name of the task to start at. Put it in quotes.']],
        tips: ['Skipped tasks do not run, so variables they would have set will be missing.'],
      },
      {
        id: 'step',
        cmd: 'ansible-playbook -i inventory.ini site.yml --step',
        title: 'Confirm each task, one by one',
        what: 'Asks before every task: run it (y), skip it (n) or continue without asking (c).',
        use: 'Learning, or running a risky playbook carefully.',
        parts: [['--step', 'Step through. Ask before each task.']],
      },
      {
        id: 'verbose',
        cmd: 'ansible-playbook -i inventory.ini site.yml -vvv',
        title: 'Show much more detail',
        what: 'Prints the full result of every task, and the SSH details with more v’s.',
        use: 'When a task fails and the short message does not explain why.',
        parts: [['-vvv', 'Verbose. -v shows task results, -vv adds more, -vvv shows connection details.']],
      },
      {
        id: 'vault-pass',
        cmd: 'ansible-playbook -i inventory.ini site.yml --ask-vault-pass',
        title: 'Run a playbook that uses encrypted files',
        what: 'Asks for your vault password, so Ansible can read secrets that were locked with ansible-vault.',
        use: 'Any playbook that uses encrypted variables.',
        parts: [
          ['--ask-vault-pass', 'Type the vault password when asked. Nothing is stored.'],
          ['--vault-password-file ~/.vault_pass', 'Instead, read the password from a file. Keep that file out of git.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inventory',
    tool: 'ansible-inventory',
    title: 'Looking at your inventory: ansible-inventory',
    blurb: 'Shows how Ansible reads your inventory. Use it when a group or a variable is not what you expected.',
    commands: [
      {
        id: 'graph',
        cmd: 'ansible-inventory -i inventory.ini --graph',
        title: 'Draw the inventory as a tree',
        what: 'Prints groups and the machines inside them as a small tree.',
        use: 'To see at a glance which machine is in which group.',
        parts: [
          ['ansible-inventory', 'The command that inspects inventories.'],
          ['--graph', 'Show groups as a tree. Add --vars to also show each group’s variables.'],
        ],
        tips: ['Every inventory has two built-in groups: all (everything) and ungrouped (machines in no group).'],
      },
      {
        id: 'list',
        cmd: 'ansible-inventory -i inventory.ini --list',
        title: 'Dump everything as JSON',
        what: 'Prints every group, machine and variable, in JSON.',
        use: 'To see the final values after Ansible merged all your variable files.',
        parts: [['--list', 'Show all inventory data. The default format is JSON.']],
      },
      {
        id: 'list-yaml',
        cmd: 'ansible-inventory -i inventory.ini --list -y',
        title: 'Dump it as YAML',
        what: 'The same as --list, in the YAML format that is easier to read.',
        use: 'To convert an inventory.ini into an inventory.yml. Add --output inventory.yml to save it as a file.',
        parts: [
          ['--list', 'Show all inventory data.'],
          ['-y', 'YAML format. Long form: --yaml.'],
        ],
      },
      {
        id: 'host',
        cmd: 'ansible-inventory -i inventory.ini --host web1',
        title: 'Show everything about one machine',
        what: 'Prints all the variables that apply to web1, with group variables already merged in.',
        use: 'Finding out why a machine is using the wrong port, user or address.',
        parts: [['--host web1', 'Only this machine, by its inventory name.']],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'galaxy',
    tool: 'ansible-galaxy',
    title: 'Roles and collections: ansible-galaxy',
    blurb:
      'Galaxy is Ansible’s sharing site. This command makes new roles, and downloads roles and collections other people wrote. A collection is a bundle of modules and roles.',
    commands: [
      {
        id: 'role-init',
        cmd: 'ansible-galaxy role init webserver',
        title: 'Create an empty role',
        what: 'Makes a folder called webserver with the standard role layout inside: tasks, handlers, defaults, templates and more.',
        use: 'Starting a new role. See the Role generator in Stanza for one that is filled in for you.',
        parts: [
          ['ansible-galaxy', 'The command for Galaxy things.'],
          ['role', 'We are working with roles.'],
          ['init', 'Make a new, empty one.'],
          ['webserver', 'The name of the role, and of the new folder.'],
        ],
      },
      {
        id: 'role-install',
        cmd: 'ansible-galaxy role install geerlingguy.nginx',
        title: 'Download a role from Galaxy',
        what: 'Downloads the role from Galaxy into your roles folder, so your playbooks can use it.',
        use: 'Reusing a role that someone has already built and tested.',
        parts: [
          ['role install', 'Download and install a role.'],
          ['geerlingguy.nginx', 'The role’s full name: author, a dot, then the role name.'],
        ],
        tips: ['Read a downloaded role before you run it as admin. It runs with your permissions.'],
      },
      {
        id: 'role-requirements',
        cmd: 'ansible-galaxy install -r requirements.yml',
        title: 'Install everything a project needs',
        what: 'Reads requirements.yml and installs every role and collection listed there.',
        use: 'Setting up a project on a new computer, or in a pipeline.',
        parts: [
          ['install', 'Install.'],
          ['-r requirements.yml', 'Requirements file. A YAML list of the roles and collections to fetch.'],
        ],
        tips: ['Commit requirements.yml to git. Then everyone gets the same roles.'],
      },
      {
        id: 'role-list',
        cmd: 'ansible-galaxy role list',
        title: 'See the roles you have installed',
        what: 'Prints each installed role and its version.',
        use: 'To check what is installed, or whether an install worked.',
        parts: [['role list', 'List installed roles.']],
      },
      {
        id: 'role-search',
        cmd: 'ansible-galaxy role search nginx --author geerlingguy',
        title: 'Search for roles',
        what: 'Looks on Galaxy for roles that match your search, optionally only from one author.',
        use: 'Finding a role before you write your own.',
        parts: [
          ['role search nginx', 'Search for roles about nginx.'],
          ['--author geerlingguy', 'Only roles by this author.'],
        ],
      },
      {
        id: 'role-info',
        cmd: 'ansible-galaxy role info geerlingguy.nginx',
        title: 'Read about a role first',
        what: 'Shows a role’s description, author, supported systems and dependencies.',
        use: 'Before installing, to decide if the role fits.',
        parts: [['role info', 'Show details about this role.']],
      },
      {
        id: 'role-remove',
        cmd: 'ansible-galaxy role remove geerlingguy.nginx',
        title: 'Remove an installed role',
        what: 'Deletes the downloaded role from your roles folder.',
        use: 'Cleaning up, or forcing a fresh download.',
        parts: [['role remove', 'Delete this installed role.']],
      },
      {
        id: 'col-install',
        cmd: 'ansible-galaxy collection install community.general',
        title: 'Install a collection',
        what: 'Downloads a collection: a bundle of extra modules, plugins and roles.',
        use: 'When a module you need is not built in. For example ansible.posix has firewalld, and community.general has hundreds more.',
        parts: [
          ['collection install', 'Download and install a collection.'],
          ['community.general', 'Its full name: namespace, a dot, then the collection name.'],
        ],
      },
      {
        id: 'col-list',
        cmd: 'ansible-galaxy collection list',
        title: 'See your installed collections',
        what: 'Prints every collection on your computer with its version.',
        use: 'To check if a module’s collection is installed.',
        parts: [['collection list', 'List installed collections.']],
      },
      {
        id: 'col-init',
        cmd: 'ansible-galaxy collection init my_namespace.my_collection',
        title: 'Start your own collection',
        what: 'Creates the standard folder layout for a new collection.',
        use: 'When you want to package your own modules and roles to share.',
        parts: [['my_namespace.my_collection', 'namespace.name. Use lowercase letters, numbers and underscores.']],
        tips: ['Related: "ansible-galaxy collection build" packs it into a .tar.gz file ready to share.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'vault',
    tool: 'ansible-vault',
    title: 'Keeping secrets safe: ansible-vault',
    blurb:
      'Vault encrypts files and values, so passwords and keys can sit in your project (and in git) without anyone being able to read them.',
    commands: [
      {
        id: 'create',
        cmd: 'ansible-vault create secrets.yml',
        title: 'Make a new encrypted file',
        what: 'Asks for a password, opens your editor on an empty file, and saves it encrypted.',
        use: 'Storing passwords or API keys that a playbook needs.',
        parts: [
          ['ansible-vault', 'The command for encryption.'],
          ['create', 'Make a new encrypted file.'],
          ['secrets.yml', 'The file name.'],
        ],
        tips: ['Forget the vault password and the file cannot be recovered. Keep the password in a password manager.'],
      },
      {
        id: 'view',
        cmd: 'ansible-vault view secrets.yml',
        title: 'Read an encrypted file',
        what: 'Asks for the password and prints the content, without changing the file.',
        use: 'To check what is inside.',
        parts: [['view', 'Show the decrypted content. Do not change the file.']],
      },
      {
        id: 'edit',
        cmd: 'ansible-vault edit secrets.yml',
        title: 'Change an encrypted file',
        what: 'Decrypts to a temporary copy, opens your editor, and encrypts again when you save.',
        use: 'Changing a secret safely.',
        parts: [['edit', 'Open for editing. It stays encrypted on disk.']],
      },
      {
        id: 'encrypt',
        cmd: 'ansible-vault encrypt vars.yml',
        title: 'Lock a file that already exists',
        what: 'Turns a normal file into an encrypted one, in place.',
        use: 'You wrote a vars file with passwords in it. Lock it before you commit.',
        parts: [['encrypt', 'Encrypt this file. The original text is replaced.']],
      },
      {
        id: 'decrypt',
        cmd: 'ansible-vault decrypt vars.yml',
        title: 'Unlock a file for good',
        what: 'Turns an encrypted file back into plain text, in place.',
        use: 'Rare. Usually "view" or "edit" is better.',
        parts: [['decrypt', 'Decrypt this file. It will be readable by anyone afterwards.']],
        careful: 'Do not commit the file after decrypting it. The secrets would be visible in git.',
      },
      {
        id: 'rekey',
        cmd: 'ansible-vault rekey secrets.yml',
        title: 'Change the vault password',
        what: 'Asks for the old password, then a new one, and re-encrypts the file.',
        use: 'Someone left the team, or the password may have leaked.',
        parts: [['rekey', 'Re-encrypt with a new password.']],
      },
      {
        id: 'encrypt-string',
        cmd: "ansible-vault encrypt_string 's3cr3t' --name 'db_password'",
        title: 'Encrypt a single value',
        what: 'Prints an encrypted block you can paste into a normal vars file.',
        use: 'Keeping one secret inside a mostly readable file.',
        parts: [
          ['encrypt_string', 'Encrypt one piece of text, not a whole file.'],
          ["'s3cr3t'", 'The secret itself. Use a placeholder when you learn.'],
          ["--name 'db_password'", 'The variable name to put on the output.'],
        ],
        careful: 'A real secret typed here stays in your shell history. Leave the value out and it asks you to type it, hidden.',
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'doc',
    tool: 'ansible-doc',
    title: 'Built-in help: ansible-doc',
    blurb: 'The manual is already on your computer. No browser needed. It works offline and always matches the version you have.',
    commands: [
      {
        id: 'list',
        cmd: 'ansible-doc -l',
        title: 'List every module',
        what: 'Prints every module and a one-line description.',
        use: 'Finding out what Ansible can do. Pipe it into grep to search, e.g. ansible-doc -l | grep -i user.',
        parts: [
          ['ansible-doc', 'The command that shows documentation.'],
          ['-l', 'List. Show all plugins of the chosen type. The default type is modules.'],
        ],
      },
      {
        id: 'module',
        cmd: 'ansible-doc ansible.builtin.copy',
        title: 'Read a module’s manual',
        what: 'Shows what the module does, every option it takes, and examples at the bottom.',
        use: 'Whenever you meet a module you do not know. Scroll to EXAMPLES and copy one.',
        parts: [['ansible.builtin.copy', 'The module’s full name. Shorter names like copy work too.']],
        tips: ['Press q to leave. Press the space bar to go down a page. Options marked with = are required.'],
      },
      {
        id: 'snippet',
        cmd: 'ansible-doc -s ansible.builtin.copy',
        title: 'Get a ready-to-edit snippet',
        what: 'Prints a short template with all the options of the module, ready to paste into a playbook.',
        use: 'Starting a task without remembering the option names.',
        parts: [['-s', 'Snippet. Show a playbook snippet instead of the full manual.']],
      },
      {
        id: 'type',
        cmd: 'ansible-doc -t keyword -l',
        title: 'Read about other kinds of things',
        what: 'Lists playbook keywords such as become, when and loop. Other types include connection, lookup, inventory and callback.',
        use: 'Learning what words you can put in a playbook.',
        parts: [
          ['-t keyword', 'Type. Look at keywords instead of modules.'],
          ['-l', 'List them.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'config',
    tool: 'ansible-config',
    title: 'Ansible’s own settings: ansible-config',
    blurb: 'Ansible has dozens of settings (forks, timeouts, paths). This command shows them, and where each value came from.',
    commands: [
      {
        id: 'dump-changed',
        cmd: 'ansible-config dump --only-changed',
        title: 'Show settings that are not default',
        what: 'Prints only the settings you changed, and the file that changed them.',
        use: 'Finding out why Ansible behaves differently on your machine.',
        parts: [
          ['ansible-config', 'The command for Ansible’s settings.'],
          ['dump', 'Print the current values.'],
          ['--only-changed', 'Hide the defaults. Show only what was changed.'],
        ],
      },
      {
        id: 'view',
        cmd: 'ansible-config view',
        title: 'Show the config file in use',
        what: 'Prints the contents of the ansible.cfg file Ansible loaded.',
        use: 'Checking which ansible.cfg is really being read. Ansible reads one: ANSIBLE_CONFIG, then ./ansible.cfg, then ~/.ansible.cfg, then /etc/ansible/ansible.cfg.',
        parts: [['view', 'Show the active config file.']],
        tips: ['If it says "Invalid or no config file was supplied", you simply have no ansible.cfg yet. Make one with the init command below.'],
      },
      {
        id: 'list',
        cmd: 'ansible-config list',
        title: 'List every setting and what it does',
        what: 'Prints all settings with their descriptions, default values and the environment variable names.',
        use: 'Looking up a setting name before you add it to ansible.cfg.',
        parts: [['list', 'List every available setting.']],
      },
      {
        id: 'init',
        cmd: 'ansible-config init --disabled > ansible.cfg',
        title: 'Create a starter ansible.cfg',
        what: 'Writes a full config file, with every line commented out. You un-comment only what you want to change.',
        use: 'Starting a project config.',
        parts: [
          ['init', 'Print a new config file.'],
          ['--disabled', 'Put a # before every line, so nothing changes until you remove it.'],
          ['> ansible.cfg', 'Save the output into a file called ansible.cfg. The > is your shell’s redirect.'],
        ],
        careful: 'The > replaces a file that already has that name. Check the folder first.',
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'console',
    tool: 'ansible-console',
    title: 'Interactive mode: ansible-console',
    blurb: 'A prompt where you type modules one after another, instead of re-typing the whole ansible command each time.',
    commands: [
      {
        id: 'console',
        cmd: 'ansible-console -i inventory.ini webservers',
        title: 'Open an Ansible prompt',
        what: 'Opens a prompt aimed at the webservers group. You then type things like ping or "apt name=nginx state=present", with no ansible, -m or -a.',
        use: 'Poking around a few machines and trying modules out.',
        parts: [
          ['ansible-console', 'Start the interactive prompt.'],
          ['-i inventory.ini', 'The inventory.'],
          ['webservers', 'The group to work on. Leave it out for all.'],
        ],
        tips: [
          'Inside the console: "cd databases" changes the group, "list" shows hosts, "forks 10" sets forks, "become" switches sudo on, "exit" leaves.',
          'Use -b -K when starting it if your jobs need admin rights.',
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'pull',
    tool: 'ansible-pull',
    title: 'Machines that configure themselves: ansible-pull',
    blurb: 'Normally you push changes out from one computer. With ansible-pull each machine fetches a playbook from git and applies it to itself.',
    commands: [
      {
        id: 'pull',
        cmd: 'ansible-pull -U https://github.com/example/my-config.git -C main -o site.yml',
        title: 'Apply a playbook straight from git',
        what: 'Clones the repository onto this machine, then runs site.yml on this machine only.',
        use: 'Many machines that need to stay up to date by themselves, such as servers that start from a template. Usually run from cron.',
        parts: [
          ['-U https://…/my-config.git', 'URL. The git repository that holds your playbook. This one is an example, so replace it.'],
          ['-C main', 'Checkout. The branch or tag to use.'],
          ['-o', 'Only if changed. Run the playbook only when the repository has new commits.'],
          ['site.yml', 'The playbook to run. Defaults to the machine’s hostname.yml or local.yml.'],
        ],
        tips: ['Needs Ansible and git installed on every machine that pulls. Add -d /path to choose where the repo is cloned.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'extras',
    tool: 'extra tools',
    title: 'Extra tools you install separately',
    blurb:
      'These come in their own packages, so you may not have them yet. They are common in real jobs, so you should know what they are.',
    commands: [
      {
        id: 'lint',
        cmd: 'ansible-lint site.yml',
        title: 'Check your playbook for bad habits',
        what: 'Reads the playbook and warns about risky or old-fashioned practices, such as not naming tasks or using shell where a module exists.',
        use: 'Before you commit. Teams often run it in their CI pipeline. Install it with: pip install ansible-lint.',
        parts: [
          ['ansible-lint', 'The linter.'],
          ['site.yml', 'What to check. Leave it out to check the whole project.'],
          ['-L', 'Optional. Lists all the rules it knows.'],
          ['--fix', 'Optional. Fixes the simple problems for you, so check the changes afterwards.'],
        ],
      },
      {
        id: 'navigator',
        cmd: 'ansible-navigator run site.yml -m stdout',
        title: 'Run playbooks with a terminal screen',
        what: 'Runs the playbook, normally inside a container, with a menu-driven screen. -m stdout gives plain output instead.',
        use: 'Teams that want the same Ansible version everywhere. Needs Podman or Docker.',
        parts: [
          ['ansible-navigator run site.yml', 'Run this playbook.'],
          ['-m stdout', 'Mode. Print normal output, like ansible-playbook, instead of the full-screen view.'],
        ],
      },
      {
        id: 'builder',
        cmd: 'ansible-builder build -t my-ee',
        title: 'Build your own Ansible container',
        what: 'Builds a container image (an "execution environment") with Ansible, your collections and your Python packages inside.',
        use: 'Advanced. Needs Podman or Docker, and an execution-environment.yml file that lists what goes inside.',
        parts: [
          ['build', 'Build the image.'],
          ['-t my-ee', 'Tag. The name to give the image.'],
        ],
      },
      {
        id: 'test',
        cmd: 'ansible-test sanity',
        title: 'Test a collection you are writing',
        what: 'Runs Ansible’s own quality checks on a collection’s code.',
        use: 'Advanced. Only when you are building modules or collections to share. Run it from inside the collection folder.',
        parts: [['sanity', 'Run the style and correctness checks. Other test types are units and integration.']],
      },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { COMMAND_GROUPS, WORDS };

'use strict';

/*
  terraform.js — the Terraform generators.

  Same shape as the Ansible tools in tools.js: groups of questions, validate(),
  build() returning files made of { t: text, n: margin note } lines, and run().
  The output follows `terraform fmt`, so the equals signs line up the way
  Terraform itself would write them.

  Every value that lands inside quotes is checked against a tight pattern first,
  so nothing typed into the form can break out of its quotes.
*/

/* ---------- Allowed shapes ---------- */

const TF_LABEL_RE = /^[a-z][a-z0-9_]{0,39}$/; // names Terraform uses inside a file
const TF_PROJECT_RE = /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/;
const TF_TAGNAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$/;
const TF_SGNAME_RE = /^[a-z][a-z0-9-]{0,62}$/;
const TF_TEXT_RE = /^[A-Za-z0-9][A-Za-z0-9 .,_:()\/-]{0,99}$/;
const TF_KEY_RE = /^[A-Za-z0-9._-]{1,255}$/;
const TF_VPC_RE = /^vpc-[0-9a-f]{8,17}$/;
const TF_SUBNET_RE = /^subnet-[0-9a-f]{8,17}$/;

const TF_REGIONS = [
  ['ap-south-1', 'Mumbai (ap-south-1)'],
  ['ap-southeast-1', 'Singapore (ap-southeast-1)'],
  ['ap-southeast-2', 'Sydney (ap-southeast-2)'],
  ['ap-northeast-1', 'Tokyo (ap-northeast-1)'],
  ['eu-west-1', 'Ireland (eu-west-1)'],
  ['eu-west-2', 'London (eu-west-2)'],
  ['eu-central-1', 'Frankfurt (eu-central-1)'],
  ['us-east-1', 'N. Virginia (us-east-1)'],
  ['us-east-2', 'Ohio (us-east-2)'],
  ['us-west-2', 'Oregon (us-west-2)'],
];

// Ports that should never be open to the whole internet.
const TF_RISKY_PORTS = {
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  445: 'SMB file sharing',
  1433: 'Microsoft SQL Server',
  1521: 'Oracle database',
  2375: 'the Docker API',
  3306: 'MySQL',
  3389: 'Remote Desktop',
  5432: 'PostgreSQL',
  5900: 'VNC remote screen',
  6379: 'Redis',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  27017: 'MongoDB',
};

// "203.0.113.10/32" -> { prefix: 32 }, or null when it is not a valid IPv4 range.
function parseCidr(text) {
  const octet = '(0|[1-9]\\d{0,2})';
  const m = text.match(new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}/(\\d{1,2})$`));
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  if (parts.some((n) => n > 255) || prefix > 32) return null;
  return { prefix };
}

const CIDR_MSG = 'Use an IPv4 range such as 203.0.113.10/32. The number after the slash is 0 to 32.';

function riskyPortIn(from, to) {
  return Object.keys(TF_RISKY_PORTS)
    .map(Number)
    .find((p) => p >= from && p <= to);
}

// One line per rule: "8080 tcp 10.0.0.0/16" or "8000-8100 tcp 10.0.0.0/16".
function parseExtraRules(text) {
  const rules = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const m = line.match(/^(\d{1,5})(?:-(\d{1,5}))?\s+(tcp|udp)\s+(\S+)$/);
    if (!m) return { error: `Line ${i + 1}: write it as  port protocol range  for example  8080 tcp 10.0.0.0/16` };
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to > 65535 || from > to) return { error: `Line ${i + 1}: ports run from 1 to 65535, and the first number must not be bigger than the second.` };
    const cidr = parseCidr(m[4]);
    if (!cidr) return { error: `Line ${i + 1}: ${CIDR_MSG}` };
    if (cidr.prefix === 0) {
      const bad = riskyPortIn(from, to);
      if (bad) {
        return {
          error: `Line ${i + 1}: port ${bad} is ${TF_RISKY_PORTS[bad]}. Do not open it to the whole internet (0.0.0.0/0). Use your own address with /32, or a private range.`,
        };
      }
    }
    rules.push({ from, to, proto: m[3], cidr: m[4] });
  }
  if (new Set(rules.map((r) => `${r.from}-${r.to}-${r.proto}`)).size !== rules.length) {
    return { error: 'The same port and protocol is listed twice. List each one once.' };
  }
  return { rules };
}

const portName = (r) => (r.from === r.to ? `${r.from}` : `${r.from}_${r.to}`);
const portText = (r) => (r.from === r.to ? `port ${r.from}` : `ports ${r.from} to ${r.to}`);

/* ---------- Writing HCL ---------- */

function writer() {
  const lines = [];
  const add = (t, n = null) => lines.push({ t, n });
  // Attributes written one after another line up their = signs, as `terraform fmt` does.
  const attrs = (indent, rows) => {
    const width = Math.max(...rows.map((r) => r[0].length));
    for (const [key, value, note] of rows) add(`${indent}${key.padEnd(width)} = ${value}`, note || null);
  };
  return { lines, add, attrs };
}

const hcl = (s) => `"${s}"`;

/* ---------- Commands shown under every tool ---------- */

const TF_INIT = {
  cmd: 'terraform init',
  what: 'Run once in the folder, and again when you add a provider. Downloads the AWS provider, the plug-in that knows how to talk to AWS, and creates the .terraform folder and .terraform.lock.hcl.',
};
const TF_VALIDATE = {
  cmd: 'terraform fmt -check && terraform validate',
  what: 'fmt -check says whether the files are tidy. validate checks that the configuration makes sense. Neither one touches AWS.',
};
const TF_PLAN = {
  cmd: 'terraform plan -out=tfplan',
  what: 'A dry run. Terraform compares your files with what exists in AWS and lists what it would add (+), change (~) or destroy (-). Nothing is built. Read it before you continue.',
};
const TF_APPLY = {
  cmd: 'terraform apply tfplan',
  what: 'Builds exactly what the saved plan showed. Because it uses the saved plan, nothing can change between your review and the build.',
};
const TF_DESTROY = {
  cmd: 'terraform destroy',
  what: 'Deletes everything this configuration created. It shows the list and asks you to type yes. Run it when you are done experimenting, so nothing keeps costing money.',
};

const TF_FLAGS = {
  init: { flag: 'terraform init', meaning: 'Set up the folder: download providers and prepare the working files. Safe to run again.' },
  fmt: { flag: 'terraform fmt -check', meaning: 'Check that the files follow Terraform’s standard layout. It reports and changes nothing. Without -check it fixes the layout for you.' },
  validate: { flag: 'terraform validate', meaning: 'Check the syntax and the arguments. Works offline and never contacts AWS.' },
  plan: { flag: 'terraform plan', meaning: 'Show what would change, without changing anything.' },
  out: { flag: '-out=tfplan', meaning: 'Save the plan to a file called tfplan, so apply can run exactly that plan.' },
  apply: { flag: 'terraform apply tfplan', meaning: 'Carry out a saved plan. Without a plan file, apply makes a new plan and asks you to confirm.' },
  destroy: { flag: 'terraform destroy', meaning: 'Delete everything in this configuration’s state. It asks for confirmation first.' },
  and: { flag: '&&', meaning: 'Run the second command only if the first one worked. This is shell syntax, not Terraform.' },
};

const TF_WHERE =
  'Run these in a terminal on a computer with Terraform (or OpenTofu: type tofu instead of terraform) installed. That can be your laptop or a VM, through its console or SSH. Save the downloaded files together in one empty folder, and run the commands from inside that folder. The only GUI step is creating AWS access in the AWS web console.';

const TF_COST =
  ' Resources on AWS can cost money while they exist. Run terraform destroy when you have finished.';

/* =====================================================================
   Tool 1: Provider and variables
   ===================================================================== */

const tfProvider = {
  id: 'provider',
  label: 'Provider setup',
  ready: true,
  title: 'Provider and variables',
  intro:
    'The starting files for any Terraform project: which cloud to talk to, which version of everything, and the settings you will reuse. Start here.',

  groups: [
    {
      legend: 'Your project',
      fields: [
        {
          id: 'project',
          type: 'text',
          label: 'Project name',
          hint: 'Lowercase letters, digits and hyphens. Used in tags, so you can find your resources later.',
          default: 'stanza-demo',
        },
        {
          id: 'environment',
          type: 'select',
          label: 'Which environment is this?',
          options: [
            ['dev', 'Development (dev)'],
            ['staging', 'Staging (staging)'],
            ['prod', 'Production (prod)'],
          ],
          default: 'dev',
        },
        {
          id: 'region',
          type: 'select',
          label: 'AWS region',
          hint: 'Where your resources will live. Pick one close to you or to your users.',
          options: TF_REGIONS,
          default: 'ap-south-1',
        },
      ],
    },
    {
      legend: 'Versions',
      fields: [
        {
          id: 'tfVersion',
          type: 'select',
          label: 'Terraform version',
          options: [
            ['>= 1.5.0', '1.5.0 or newer'],
            ['>= 1.9.0', '1.9.0 or newer'],
          ],
          default: '>= 1.5.0',
        },
        {
          id: 'awsVersion',
          type: 'select',
          label: 'AWS provider version',
          hint: 'The ~> sign allows updates inside the same major version, but never jumps to the next one.',
          options: [
            ['~> 6.0', '6.x (current)'],
            ['~> 5.0', '5.x (older)'],
          ],
          default: '~> 6.0',
        },
      ],
    },
    {
      legend: 'Extras',
      fields: [
        {
          id: 'defaultTags',
          type: 'check',
          label: 'Tag every resource automatically',
          hint: 'Adds Project, Environment and ManagedBy tags to everything Terraform creates.',
          default: true,
        },
        {
          id: 'accountCheck',
          type: 'check',
          label: 'Add a check that shows your AWS account ID',
          hint: 'Creates nothing. After apply it prints your account ID, which proves your credentials work.',
          default: true,
        },
        {
          id: 'gitignore',
          type: 'check',
          label: 'Also make a .gitignore',
          hint: 'Keeps state files and plugins out of git.',
          default: true,
        },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!TF_PROJECT_RE.test(v.project.trim())) {
      e.project = 'Use 3 to 30 lowercase letters, digits and hyphens. Start with a letter and end with a letter or digit.';
    }
    return e;
  },

  build(v) {
    const project = v.project.trim();
    const files = [];

    /* providers.tf */
    {
      const { lines, add, attrs } = writer();
      add('terraform {', 'A terraform block holds settings about Terraform itself, not about your infrastructure.');
      attrs('  ', [
        [
          'required_version',
          hcl(v.tfVersion),
          'Terraform refuses to run if it is older than this. That protects your team from "works on my machine" surprises.',
        ],
      ]);
      add('');
      add('  required_providers {', 'A provider is a plug-in that knows how to talk to one service. This block says which ones this project needs.');
      add('    aws = {', 'The local name for the provider. Resources such as aws_instance use it.');
      attrs('      ', [
        ['source', '"hashicorp/aws"', 'Where to download it from: publisher / name. hashicorp/aws is the official AWS provider.'],
        ['version', hcl(v.awsVersion), 'Which versions are allowed. Pinning it means a new release cannot change your results without you choosing it.'],
      ]);
      add('    }');
      add('  }');
      add('}');
      add('');
      add('provider "aws" {', 'Settings for the AWS provider: how to connect to AWS.');
      attrs('  ', [
        [
          'region',
          'var.region',
          'Which AWS region to use. var.region reads the variable defined in variables.tf, so the value lives in one place.',
        ],
      ]);
      if (v.defaultTags) {
        add('');
        add('  default_tags {', 'Tags that the provider adds to every resource it creates. Tags help you find, group and bill things.');
        add('    tags = {');
        attrs('      ', [
          ['Project', 'var.project', null],
          ['Environment', 'var.environment', null],
          ['ManagedBy', '"Terraform"', 'Tells anyone looking at the AWS console that this was made by code, so they do not edit it by hand.'],
        ]);
        add('    }');
        add('  }');
      }
      add('}');
      files.push({ path: 'providers.tf', label: 'providers.tf', lines });
    }

    /* variables.tf */
    {
      const { lines, add, attrs } = writer();
      add('variable "region" {', 'A variable is an input. Declare it here, give it a value elsewhere.');
      attrs('  ', [
        ['description', '"AWS region to build in."', 'Shown in prompts and docs. Always write one, so the next person knows what it is for.'],
        ['type', 'string', 'What kind of value: string, number, bool, list or map. Terraform rejects the wrong kind.'],
        ['default', hcl(v.region), 'Used when you do not set the variable. A variable without a default must be given a value.'],
      ]);
      add('}');
      add('');
      add('variable "project" {');
      attrs('  ', [
        ['description', '"Short project name, used in tags."', null],
        ['type', 'string', null],
      ]);
      add('}', 'No default here, so you must supply it. This project gets it from terraform.tfvars.');
      add('');
      add('variable "environment" {');
      attrs('  ', [
        ['description', '"Which environment this is."', null],
        ['type', 'string', null],
        ['default', hcl(v.environment), null],
      ]);
      add('');
      add('  validation {', 'A rule the value must pass. If it fails, Terraform stops at once with your message, before anything is built.');
      attrs('    ', [
        ['condition', 'contains(["dev", "staging", "prod"], var.environment)', 'The test. contains(list, value) is true when the value is in the list.'],
        ['error_message', '"environment must be dev, staging or prod."', 'What to show when the test fails.'],
      ]);
      add('  }');
      add('}');
      files.push({ path: 'variables.tf', label: 'variables.tf', lines });
    }

    /* terraform.tfvars */
    {
      const { lines, add, attrs } = writer();
      add(
        '# Values for the variables in variables.tf.',
        'Terraform reads terraform.tfvars by itself. Same names as in variables.tf, with the values you want.'
      );
      attrs('', [
        ['project', hcl(project), 'Sets the project variable. This is the one with no default.'],
        ['environment', hcl(v.environment), null],
        ['region', hcl(v.region), null],
      ]);
      add('');
      add(
        '# Never put passwords or keys in this file.',
        'Anything here can end up in git. Pass secrets through environment variables or a secrets manager instead.'
      );
      files.push({ path: 'terraform.tfvars', label: 'terraform.tfvars', lines });
    }

    if (v.accountCheck) {
      /* main.tf */
      {
        const { lines, add } = writer();
        add(
          '# Asks AWS which account these credentials belong to. Creates nothing.',
          'A comment. A data block, below, only reads information. It never creates, changes or deletes anything.'
        );
        add(
          'data "aws_caller_identity" "current" {}',
          'data "type" "name". The type aws_caller_identity returns your account ID. The braces are empty because it needs no settings.'
        );
        files.push({ path: 'main.tf', label: 'main.tf', lines });
      }
    }

    /* outputs.tf */
    {
      const { lines, add, attrs } = writer();
      add('output "region" {', 'An output prints a value after apply, and lets other Terraform code read it.');
      attrs('  ', [
        ['description', '"The region this project builds in."', null],
        ['value', 'var.region', 'The value to show.'],
      ]);
      add('}');
      if (v.accountCheck) {
        add('');
        add('output "account_id" {');
        attrs('  ', [
          ['description', '"The AWS account Terraform is connected to."', null],
          ['value', 'data.aws_caller_identity.current.account_id', 'data.TYPE.NAME.ATTRIBUTE reads a value from a data block. This is the account ID from main.tf.'],
        ]);
        add('}');
      }
      files.push({ path: 'outputs.tf', label: 'outputs.tf', lines });
    }

    if (v.gitignore) {
      const { lines, add } = writer();
      add('# Plug-ins Terraform downloads', 'Lines starting with # are comments. Each line below is a pattern git should skip.');
      add('.terraform/', 'The folder terraform init fills with downloaded providers. It is big and anyone can re-create it.');
      add('');
      add('# State: Terraform’s record of what it built');
      add('*.tfstate', 'State files can contain secret values in plain text. Never commit them. Teams keep state in a remote backend.');
      add('*.tfstate.*');
      add('');
      add('# Saved plans and crash logs');
      add('tfplan', 'The file made by plan -out=tfplan. It can contain secrets too.');
      add('crash.log');
      add('');
      add('# Files that hold secrets');
      add('secrets.tfvars', 'Name any variables file with real secrets exactly this, and git will skip it.');
      add('');
      add('# Do commit .terraform.lock.hcl', 'That file records the exact provider versions you used, so everyone gets the same ones.');
      files.push({ path: '.gitignore', label: '.gitignore', lines });
    }

    return files;
  },

  zipName() {
    return 'terraform-provider.zip';
  },

  run(v) {
    return {
      where: TF_WHERE,
      commands: [
        {
          cmd: 'read -rp "AWS access key ID: " AWS_ACCESS_KEY_ID; export AWS_ACCESS_KEY_ID',
          what: 'Bash. Asks for your access key ID and keeps it in this terminal session only. Create the key in the AWS web console under IAM, and give that user only the permissions you need.',
        },
        {
          cmd: 'read -rsp "AWS secret access key: " AWS_SECRET_ACCESS_KEY; echo; export AWS_SECRET_ACCESS_KEY',
          what: 'Bash. Asks for the secret key with the typing hidden, so it never shows on screen or in your command history. Do not paste keys into .tf files or into a command.',
        },
        TF_INIT,
        TF_VALIDATE,
        TF_PLAN,
        TF_APPLY,
        {
          cmd: 'unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY',
          what: 'When you finish, remove the keys from this session. Also delete the access key in the AWS console if you will not use it again.',
        },
      ],
      flags: [
        { flag: 'read -r', meaning: 'Read the typed text as it is, without treating backslashes as special.' },
        { flag: 'read -p "text"', meaning: 'Show this prompt first.' },
        { flag: 'read -s', meaning: 'Silent. Do not show what is typed. Use it for secrets.' },
        { flag: 'export NAME', meaning: 'Make the variable visible to programs you start from this terminal, such as Terraform.' },
        TF_FLAGS.init,
        TF_FLAGS.fmt,
        TF_FLAGS.and,
        TF_FLAGS.validate,
        TF_FLAGS.plan,
        TF_FLAGS.out,
        TF_FLAGS.apply,
        { flag: 'unset NAME', meaning: 'Delete a variable from this session.' },
      ],
    };
  },
};

/* =====================================================================
   Tool 2: Security group (a firewall for your servers)
   ===================================================================== */

const tfSecurityGroup = {
  id: 'sg',
  label: 'Security group',
  ready: true,
  title: 'Security group',
  intro:
    'A firewall for your servers. Choose who may connect on which port. Everything you do not allow stays blocked.',

  groups: [
    {
      legend: 'The group',
      fields: [
        {
          id: 'sgName',
          type: 'text',
          label: 'Name in AWS',
          hint: 'Lowercase letters, digits and hyphens. Cannot start with sg-.',
          default: 'web-sg',
        },
        {
          id: 'label',
          type: 'text',
          label: 'Name Terraform uses for it',
          hint: 'Lowercase letters, digits and underscores. Other files refer to it as aws_security_group.NAME.',
          default: 'web',
        },
        {
          id: 'description',
          type: 'text',
          label: 'Description',
          hint: 'Say what the group is for. AWS shows it in the console.',
          default: 'Web server access',
        },
        {
          id: 'vpcId',
          type: 'text',
          label: 'VPC ID',
          hint: 'Leave empty to use your default network. Otherwise something like vpc-0abc1234.',
          default: '',
        },
      ],
    },
    {
      legend: 'Who can connect',
      fields: [
        { id: 'ssh', type: 'check', label: 'Allow SSH (port 22) for logging in', default: true },
        {
          id: 'sshCidr',
          type: 'text',
          label: 'Which address may use SSH?',
          hint: 'Your own public address followed by /32. Find it with: curl https://checkip.amazonaws.com . The value filled in is an example, so replace it.',
          default: '203.0.113.10/32',
          showIf: { field: 'ssh', in: [true] },
        },
        { id: 'http', type: 'check', label: 'Allow web traffic (HTTP, port 80)', default: true },
        {
          id: 'httpCidr',
          type: 'text',
          label: 'Who may reach the website?',
          hint: '0.0.0.0/0 means everyone. That is normal for a public website.',
          default: '0.0.0.0/0',
          showIf: { field: 'http', in: [true] },
        },
        { id: 'https', type: 'check', label: 'Allow secure web traffic (HTTPS, port 443)', default: false },
        {
          id: 'httpsCidr',
          type: 'text',
          label: 'Who may reach it over HTTPS?',
          default: '0.0.0.0/0',
          showIf: { field: 'https', in: [true] },
        },
      ],
    },
    {
      legend: 'More rules',
      optional: true,
      fields: [
        {
          id: 'extra',
          type: 'area',
          rows: 3,
          label: 'Other ports',
          hint: 'One per line: port, protocol, then who. For example  8080 tcp 10.0.0.0/16  or  8000-8100 tcp 10.0.0.0/16 . Databases and remote-access ports cannot be opened to everyone here.',
          default: '',
        },
        {
          id: 'egress',
          type: 'check',
          label: 'Allow all outbound traffic',
          hint: 'Lets the server reach the internet for updates. This is also what AWS does by default.',
          default: true,
        },
      ],
    },
  ],

  validate(v) {
    const e = {};
    const name = v.sgName.trim();
    if (!TF_SGNAME_RE.test(name) || name.startsWith('sg-')) {
      e.sgName = 'Use lowercase letters, digits and hyphens. Start with a letter. Do not start with sg-.';
    }
    if (!TF_LABEL_RE.test(v.label.trim())) {
      e.label = 'Use lowercase letters, digits and underscores (up to 40). Start with a letter.';
    }
    if (!TF_TEXT_RE.test(v.description.trim())) {
      e.description = 'Use plain letters, digits and spaces (up to 100). Start with a letter or digit.';
    }
    if (v.vpcId.trim() && !TF_VPC_RE.test(v.vpcId.trim())) {
      e.vpcId = 'A VPC ID looks like vpc-0abc1234. Leave it empty to use the default network.';
    }

    if (v.ssh) {
      const c = parseCidr(v.sshCidr.trim());
      if (!c) e.sshCidr = CIDR_MSG;
      else if (c.prefix === 0) {
        e.sshCidr =
          'SSH open to the whole internet (0.0.0.0/0) gets attacked within minutes. Use your own address with /32. Find it with: curl https://checkip.amazonaws.com';
      }
    }
    if (v.http && !parseCidr(v.httpCidr.trim())) e.httpCidr = CIDR_MSG;
    if (v.https && !parseCidr(v.httpsCidr.trim())) e.httpsCidr = CIDR_MSG;

    if (v.extra.trim()) {
      const parsed = parseExtraRules(v.extra);
      if (parsed.error) e.extra = parsed.error;
      else {
        const clash = parsed.rules.find((r) => (v.http && r.from <= 80 && r.to >= 80 && r.proto === 'tcp') || (v.https && r.from <= 443 && r.to >= 443 && r.proto === 'tcp') || (v.ssh && r.from <= 22 && r.to >= 22 && r.proto === 'tcp'));
        if (clash) e.extra = `${portText(clash)} overlaps a rule you already ticked above. Remove one of them.`;
      }
    }
    return e;
  },

  build(v) {
    const name = v.sgName.trim();
    const label = v.label.trim();
    const { lines, add, attrs } = writer();

    add(
      `resource "aws_security_group" "${label}" {`,
      `A resource block: resource "type" "name". aws_security_group is the type, and ${label} is the name you use to refer to it elsewhere in your files.`
    );
    const rows = [
      ['name', hcl(name), 'The name shown in AWS.'],
      ['description', hcl(v.description.trim()), 'Say what it is for. AWS cannot change this later without replacing the group.'],
    ];
    if (v.vpcId.trim()) rows.push(['vpc_id', hcl(v.vpcId.trim()), 'Which network the group belongs to. Leave it out and AWS uses your default VPC.']);
    attrs('  ', rows);
    add('');
    add('  tags = {', 'Labels for finding things. Name is the one the AWS console shows in its list.');
    attrs('    ', [['Name', hcl(name), null]]);
    add('  }');
    add('}');

    const ingress = (key, title, cidr, from, to, proto, note) => {
      add('');
      add(
        `resource "aws_vpc_security_group_ingress_rule" "${label}_${key}" {`,
        note
      );
      attrs('  ', [
        ['security_group_id', `aws_security_group.${label}.id`, `Attach this rule to the group above. TYPE.NAME.id reads the ID that AWS gives the group once it exists, so Terraform builds the group first.`],
        ['description', hcl(title), null],
        ['cidr_ipv4', hcl(cidr), 'Who is allowed. A /32 range is exactly one address. 0.0.0.0/0 is every address on the internet.'],
        ['from_port', String(from), 'First port in the range. A single port uses the same number twice.'],
        ['to_port', String(to), 'Last port in the range.'],
        ['ip_protocol', hcl(proto), 'tcp for web and SSH. udp for things like DNS. -1 means every protocol.'],
      ]);
      add('}');
    };

    if (v.ssh) {
      ingress(
        'ssh',
        'SSH from my address',
        v.sshCidr.trim(),
        22,
        22,
        'tcp',
        'One rule per block. Inbound (ingress) means traffic coming in to your server. This one lets you log in over SSH, from one address only.'
      );
    }
    if (v.http) {
      ingress('http', 'HTTP web traffic', v.httpCidr.trim(), 80, 80, 'tcp', 'Lets browsers load your website over plain HTTP, port 80.');
    }
    if (v.https) {
      ingress('https', 'HTTPS web traffic', v.httpsCidr.trim(), 443, 443, 'tcp', 'Lets browsers use the secure version, port 443.');
    }
    if (v.extra.trim()) {
      for (const r of parseExtraRules(v.extra).rules) {
        ingress(`port_${portName(r)}_${r.proto}`, `Allow ${portText(r)} (${r.proto})`, r.cidr, r.from, r.to, r.proto, `An extra inbound rule for ${portText(r)}.`);
      }
    }

    if (v.egress) {
      add('');
      add(
        `resource "aws_vpc_security_group_egress_rule" "${label}_all_out" {`,
        'Egress is traffic leaving your server. Terraform removes the "allow everything out" rule that AWS adds by default, so you write it yourself if you want it.'
      );
      attrs('  ', [
        ['security_group_id', `aws_security_group.${label}.id`, null],
        ['description', '"Allow all outbound traffic"', null],
        ['cidr_ipv4', '"0.0.0.0/0"', 'To anywhere.'],
        ['ip_protocol', '"-1"', '-1 means every protocol and every port.'],
      ]);
      add('}');
    }

    add('');
    add(`output "${label}_security_group_id" {`, 'Prints the group’s ID after apply. You need it when you attach the group to a server.');
    attrs('  ', [
      ['description', `"ID of the ${name} security group."`, null],
      ['value', `aws_security_group.${label}.id`, null],
    ]);
    add('}');

    return [{ path: 'security_group.tf', label: 'security_group.tf', lines }];
  },

  zipName() {
    return 'terraform-security-group.zip';
  },

  run() {
    return {
      where: TF_WHERE + ' Put security_group.tf next to the files from the Provider and variables generator.' + TF_COST,
      commands: [TF_INIT, TF_VALIDATE, TF_PLAN, TF_APPLY, TF_DESTROY],
      flags: [TF_FLAGS.init, TF_FLAGS.fmt, TF_FLAGS.and, TF_FLAGS.validate, TF_FLAGS.plan, TF_FLAGS.out, TF_FLAGS.apply, TF_FLAGS.destroy],
    };
  },
};

/* =====================================================================
   Tool 3: EC2 instance (a virtual server)
   ===================================================================== */

const TF_OS = {
  ubuntu2404: {
    label: 'Ubuntu 24.04',
    data: 'ubuntu',
    owner: '"099720109477"',
    ownerNote: 'The account ID of Canonical, the company that publishes Ubuntu. Filtering by owner stops you from picking up someone else’s lookalike image.',
    pattern: '"ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"',
    user: 'ubuntu',
    install: ['apt-get update -y', 'apt-get install -y nginx'],
  },
  ubuntu2204: {
    label: 'Ubuntu 22.04',
    data: 'ubuntu',
    owner: '"099720109477"',
    ownerNote: 'The account ID of Canonical, the company that publishes Ubuntu. Filtering by owner stops you from picking up someone else’s lookalike image.',
    pattern: '"ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"',
    user: 'ubuntu',
    install: ['apt-get update -y', 'apt-get install -y nginx'],
  },
  al2023: {
    label: 'Amazon Linux 2023',
    data: 'amazon_linux',
    owner: '"amazon"',
    ownerNote: 'amazon means images published by AWS itself.',
    pattern: '"al2023-ami-2023.*-x86_64"',
    user: 'ec2-user',
    install: ['dnf install -y nginx'],
  },
};

const tfEc2 = {
  id: 'ec2',
  label: 'EC2 instance',
  ready: true,
  title: 'EC2 instance',
  intro: 'A virtual server on AWS. Pick the operating system and size, and Terraform finds the newest image for you.',

  groups: [
    {
      legend: 'The server',
      fields: [
        {
          id: 'instName',
          type: 'text',
          label: 'Name tag',
          hint: 'The name AWS shows in the console list.',
          default: 'web-1',
        },
        {
          id: 'label',
          type: 'text',
          label: 'Name Terraform uses for it',
          hint: 'Lowercase letters, digits and underscores. Other files refer to it as aws_instance.NAME.',
          default: 'web',
        },
        {
          id: 'os',
          type: 'select',
          label: 'Operating system',
          options: Object.entries(TF_OS).map(([k, o]) => [k, o.label]),
          default: 'ubuntu2404',
        },
        {
          id: 'instanceType',
          type: 'select',
          label: 'Size',
          hint: 'Bigger sizes cost more. t3.micro is small and cheap, and suits learning.',
          options: [
            ['t3.micro', 't3.micro: 2 CPUs, 1 GB memory'],
            ['t3.small', 't3.small: 2 CPUs, 2 GB memory'],
            ['t3.medium', 't3.medium: 2 CPUs, 4 GB memory'],
            ['t2.micro', 't2.micro: 1 CPU, 1 GB memory (older)'],
          ],
          default: 't3.micro',
        },
        {
          id: 'volumeSize',
          type: 'text',
          label: 'Disk size in GB',
          hint: 'A number from 8 to 500.',
          default: '20',
        },
      ],
    },
    {
      legend: 'Network and access',
      fields: [
        {
          id: 'sgLabel',
          type: 'text',
          label: 'Security group to attach',
          hint: 'The "Name Terraform uses" from the Security group generator. Leave empty to use the default security group.',
          default: 'web',
        },
        {
          id: 'keyName',
          type: 'text',
          label: 'Key pair name for SSH',
          hint: 'The name of a key pair you already created in the EC2 console. Leave empty for none.',
          default: '',
        },
        {
          id: 'publicIp',
          type: 'check',
          label: 'Give it a public IP address',
          hint: 'Needed to reach it from the internet.',
          default: true,
        },
      ],
    },
    {
      legend: 'Extras',
      optional: true,
      fields: [
        {
          id: 'nginx',
          type: 'check',
          label: 'Install a web server (nginx) on first boot',
          hint: 'Adds a start-up script. Open port 80 in the security group to see it.',
          default: false,
        },
        {
          id: 'imdsv2',
          type: 'check',
          label: 'Require the safer metadata service (IMDSv2)',
          hint: 'Blocks a common way for attackers to steal a server’s credentials. Keep it on.',
          default: true,
        },
        {
          id: 'encrypted',
          type: 'check',
          label: 'Encrypt the disk',
          default: true,
        },
        {
          id: 'subnetId',
          type: 'text',
          label: 'Subnet ID',
          hint: 'Leave empty for the default. Otherwise something like subnet-0abc1234.',
          default: '',
        },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!TF_TAGNAME_RE.test(v.instName.trim())) {
      e.instName = 'Use letters, digits, spaces, dots, underscores and hyphens (up to 63). Start with a letter or digit.';
    }
    if (!TF_LABEL_RE.test(v.label.trim())) e.label = 'Use lowercase letters, digits and underscores (up to 40). Start with a letter.';
    const size = v.volumeSize.trim();
    if (!/^\d{1,3}$/.test(size) || Number(size) < 8 || Number(size) > 500) e.volumeSize = 'Enter a whole number from 8 to 500.';
    if (v.sgLabel.trim() && !TF_LABEL_RE.test(v.sgLabel.trim())) {
      e.sgLabel = 'Use lowercase letters, digits and underscores. It must match the name from the Security group generator. Leave empty to skip.';
    }
    if (v.keyName.trim() && !TF_KEY_RE.test(v.keyName.trim())) e.keyName = 'Use letters, digits, dots, underscores and hyphens. Leave empty for none.';
    if (v.subnetId.trim() && !TF_SUBNET_RE.test(v.subnetId.trim())) e.subnetId = 'A subnet ID looks like subnet-0abc1234. Leave it empty for the default.';
    return e;
  },

  build(v) {
    const os = TF_OS[v.os];
    const label = v.label.trim();
    const name = v.instName.trim();
    const sg = v.sgLabel.trim();
    const { lines, add, attrs } = writer();

    add(
      `data "aws_ami" "${os.data}" {`,
      'A data block looks something up instead of building it. This one finds an AMI: the disk image a server starts from. Looking it up means you always get the newest patched one.'
    );
    attrs('  ', [
      ['most_recent', 'true', 'If several images match, take the newest.'],
      ['owners', `[${os.owner}]`, os.ownerNote],
    ]);
    add('');
    add('  filter {', 'A filter narrows the search. All the filters must match.');
    attrs('    ', [
      ['name', '"name"', 'Filter on the image’s name.'],
      ['values', `[${os.pattern}]`, 'The * is a wildcard, so the date at the end can be anything. Each new build has a new date.'],
    ]);
    add('  }');
    add('');
    add('  filter {');
    if (v.os === 'al2023') {
      attrs('    ', [
        ['name', '"architecture"', null],
        ['values', '["x86_64"]', 'The kind of processor. x86_64 matches the t3 and t2 sizes.'],
      ]);
    } else {
      attrs('    ', [
        ['name', '"virtualization-type"', null],
        ['values', '["hvm"]', 'The virtualization type that all current instance sizes use.'],
      ]);
    }
    add('  }');
    add('}');
    add('');

    add(
      `resource "aws_instance" "${label}" {`,
      `A resource block builds something. aws_instance is an EC2 server, and ${label} is the name you use for it in other files.`
    );
    const top = [
      ['ami', `data.aws_ami.${os.data}.id`, 'Which image to start from: the ID found by the data block above.'],
      ['instance_type', hcl(v.instanceType), 'The size: how many CPUs and how much memory. It decides most of the cost.'],
    ];
    if (v.keyName.trim()) top.push(['key_name', hcl(v.keyName.trim()), 'The key pair that lets you log in over SSH. It must already exist in this region. Only the public half is stored on the server.']);
    if (v.subnetId.trim()) top.push(['subnet_id', hcl(v.subnetId.trim()), 'Which subnet (a slice of a network) to place it in. Leave it out and AWS picks one from your default network.']);
    top.push([
      'vpc_security_group_ids',
      sg ? `[aws_security_group.${sg}.id]` : '[]',
      sg
        ? `The firewall groups to attach. aws_security_group.${sg}.id is the group from the Security group generator, and it also makes Terraform build that group first.`
        : 'An empty list means no extra groups, so AWS uses the default security group for the network.',
    ]);
    top.push(['associate_public_ip_address', String(v.publicIp), v.publicIp ? 'Give it an address reachable from the internet.' : 'Keep it private. Only other machines in the network can reach it.']);
    if (v.nginx) {
      top.push(['user_data', '<<-EOT', 'user_data is a script that runs once, the first time the server starts. <<-EOT starts a block of text that ends at the line EOT.']);
    }
    // A heredoc takes several lines, so the attributes after it are a new group.
    if (v.nginx) {
      const first = top.slice(0, -1);
      attrs('  ', first);
      const ud = top[top.length - 1];
      const width = Math.max(...top.map((r) => r[0].length));
      add(`  ${ud[0].padEnd(width)} = ${ud[1]}`, ud[2]);
      add('    #!/bin/bash', 'The first line says which program runs the script: bash.');
      os.install.forEach((cmd, i) => add(`    ${cmd}`, i === 0 ? 'Installs the nginx web server when the machine first starts.' : null));
      add('    systemctl enable --now nginx', 'Start nginx now, and every time the machine boots.');
      add('  EOT');
      attrs('  ', [['user_data_replace_on_change', 'true', 'If you edit the script later, replace the server so the new script runs. A running server does not run it twice.']]);
    } else {
      attrs('  ', top);
    }

    if (v.imdsv2) {
      add('');
      add('  metadata_options {', 'Settings for the metadata service: an address inside the server that tells programs about the server, including temporary credentials.');
      attrs('    ', [
        ['http_endpoint', '"enabled"', null],
        ['http_tokens', '"required"', 'required switches on IMDSv2, which needs a session token. That blocks a common attack that tricks a web app into leaking credentials.'],
      ]);
      add('  }');
    }

    add('');
    add('  root_block_device {', 'The main disk, which holds the operating system.');
    attrs('    ', [
      ['volume_size', v.volumeSize.trim(), 'Size in GB.'],
      ['volume_type', '"gp3"', 'gp3 is the current general-purpose SSD, and cheaper than the older gp2.'],
      ['encrypted', String(v.encrypted), v.encrypted ? 'Encrypt the disk. It costs nothing and you do not notice it.' : 'The disk is not encrypted. Anyone who got hold of the raw disk could read it.'],
    ]);
    add('  }');
    add('');
    add('  tags = {', 'Labels for finding things. Name is shown in the AWS console list.');
    attrs('    ', [['Name', hcl(name), null]]);
    add('  }');
    add('}');
    add('');

    add(`output "${label}_instance_id" {`, 'Print the server’s ID after apply.');
    attrs('  ', [
      ['description', `"ID of the ${name} server."`, null],
      ['value', `aws_instance.${label}.id`, null],
    ]);
    add('}');
    add('');
    add(`output "${label}_public_ip" {`);
    attrs('  ', [
      ['description', `"Public IP address of the ${name} server."`, null],
      ['value', `aws_instance.${label}.public_ip`, v.publicIp ? 'The address to connect to. It changes if you stop and start the server.' : 'Empty, because this server has no public address.'],
    ]);
    add('}');

    return [{ path: 'ec2.tf', label: 'ec2.tf', lines }];
  },

  zipName() {
    return 'terraform-ec2.zip';
  },

  run(v) {
    const os = TF_OS[v.os];
    const label = v.label.trim();
    const commands = [TF_INIT, TF_VALIDATE, TF_PLAN, TF_APPLY];
    const flags = [TF_FLAGS.init, TF_FLAGS.fmt, TF_FLAGS.and, TF_FLAGS.validate, TF_FLAGS.plan, TF_FLAGS.out, TF_FLAGS.apply];
    if (v.keyName.trim() && v.publicIp) {
      commands.push({
        cmd: `ssh -i ~/.ssh/${v.keyName.trim()}.pem ${os.user}@$(terraform output -raw ${label}_public_ip)`,
        what: `Logs in over SSH. ${os.user} is the default user for ${os.label}. Change the key path to where your key file really is. The server needs a minute to finish starting, and the security group must allow SSH from your address.`,
      });
      flags.push(
        { flag: 'ssh -i FILE', meaning: 'Which private key file to log in with.' },
        { flag: 'terraform output -raw NAME', meaning: 'Print one output value with no quotes or extra text, so a script can use it.' },
        { flag: '$( … )', meaning: 'Shell syntax: run the command inside, and put its output here.' }
      );
    }
    commands.push(TF_DESTROY);
    flags.push(TF_FLAGS.destroy);
    return {
      where: TF_WHERE + ' Put ec2.tf next to the files from the Provider and variables generator.' + TF_COST,
      commands,
      flags,
    };
  },
};

/* =====================================================================
   Tool 4: S3 bucket (file storage)
   ===================================================================== */

const tfS3 = {
  id: 's3',
  label: 'S3 bucket',
  ready: true,
  title: 'S3 bucket',
  intro: 'Storage for files on AWS. This builds a private bucket with the safe settings already switched on.',

  groups: [
    {
      legend: 'The bucket',
      fields: [
        {
          id: 'bucketName',
          type: 'text',
          label: 'Bucket name',
          hint: '3 to 63 characters: lowercase letters, digits and hyphens. Every bucket name in the world is shared, so make it unusual.',
          default: 'stanza-demo-bucket',
        },
        {
          id: 'usePrefix',
          type: 'check',
          label: 'Let Terraform add a random ending',
          hint: 'Uses your name as the start, then adds random characters so it is unique. Up to 36 characters.',
          default: true,
        },
        {
          id: 'label',
          type: 'text',
          label: 'Name Terraform uses for it',
          hint: 'Lowercase letters, digits and underscores.',
          default: 'main',
        },
      ],
    },
    {
      legend: 'Safety',
      fields: [
        {
          id: 'blockPublic',
          type: 'check',
          label: 'Block all public access',
          hint: 'Keep it on unless you are hosting a public website. Public buckets are a top cause of data leaks.',
          default: true,
        },
        {
          id: 'versioning',
          type: 'check',
          label: 'Keep old versions of files',
          hint: 'Overwrite or delete a file by mistake and you can get the old one back.',
          default: true,
        },
        {
          id: 'encryption',
          type: 'select',
          label: 'Encryption at rest',
          options: [
            ['AES256', 'AWS-managed keys (AES256, free)'],
            ['aws:kms', 'AWS KMS key (aws:kms, small fee)'],
          ],
          default: 'AES256',
        },
      ],
    },
    {
      legend: 'Housekeeping',
      optional: true,
      fields: [
        {
          id: 'lifecycle',
          type: 'check',
          label: 'Clean up old data automatically',
          default: false,
          hint: 'Deletes old file versions and unfinished uploads after a while.',
        },
        {
          id: 'keepDays',
          type: 'text',
          label: 'Delete old versions after how many days?',
          hint: 'A whole number from 1 to 3650.',
          default: '90',
          showIf: { field: 'lifecycle', in: [true] },
        },
        {
          id: 'forceDestroy',
          type: 'check',
          label: 'Allow terraform destroy to delete a bucket that still has files',
          hint: 'Off is safer. Turn it on for throw-away practice buckets.',
          default: false,
        },
      ],
    },
  ],

  validate(v) {
    const e = {};
    const name = v.bucketName.trim();
    const max = v.usePrefix ? 36 : 63;
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) || name.length < 3) {
      e.bucketName = 'Use 3 or more lowercase letters, digits and hyphens. Start and end with a letter or digit.';
    } else if (name.length > max) {
      e.bucketName = v.usePrefix ? 'With a random ending the name can be up to 36 characters. Shorten it, or turn the random ending off.' : 'A bucket name can be at most 63 characters.';
    } else if (/^\d+-\d+-\d+-\d+$/.test(name) || /^xn--|^sthree-|^amzn-s3-demo-|-s3alias$|--ol-s3$|--x-s3$/.test(name)) {
      e.bucketName = 'AWS reserves names that look like an IP address or start or end with certain words (xn--, sthree-, amzn-s3-demo-, -s3alias). Choose another name.';
    }
    if (!TF_LABEL_RE.test(v.label.trim())) e.label = 'Use lowercase letters, digits and underscores (up to 40). Start with a letter.';
    if (v.lifecycle) {
      const d = v.keepDays.trim();
      if (!/^\d{1,4}$/.test(d) || Number(d) < 1 || Number(d) > 3650) e.keepDays = 'Enter a whole number from 1 to 3650.';
    }
    return e;
  },

  build(v) {
    const name = v.bucketName.trim();
    const label = v.label.trim();
    const { lines, add, attrs } = writer();

    add(
      `resource "aws_s3_bucket" "${label}" {`,
      `A resource block builds something. aws_s3_bucket is the bucket itself, and ${label} is the name you use for it in other files. Since version 4 of the provider, each bucket setting is its own resource, below.`
    );
    if (v.usePrefix) {
      attrs('  ', [
        ['bucket_prefix', hcl(`${name}-`), 'The start of the name. Terraform adds a random ending, so the name is unique across all of AWS.'],
        ['force_destroy', String(v.forceDestroy), v.forceDestroy ? 'terraform destroy will delete this bucket even if it holds files. Fine for practice, dangerous for real data.' : 'terraform destroy refuses to delete the bucket while it holds files. That is a safety net.'],
      ]);
    } else {
      attrs('  ', [
        ['bucket', hcl(name), 'The bucket name. It must be unique across all of AWS, and cannot change later without replacing the bucket.'],
        ['force_destroy', String(v.forceDestroy), v.forceDestroy ? 'terraform destroy will delete this bucket even if it holds files. Fine for practice, dangerous for real data.' : 'terraform destroy refuses to delete the bucket while it holds files. That is a safety net.'],
      ]);
    }
    add('}');

    if (v.blockPublic) {
      add('');
      add(`resource "aws_s3_bucket_public_access_block" "${label}" {`, 'A set of switches that stop the bucket from ever becoming public, even if someone later makes a mistake in a policy.');
      attrs('  ', [
        ['bucket', `aws_s3_bucket.${label}.id`, 'Which bucket these settings belong to. Reading its id also makes Terraform build the bucket first.'],
        ['block_public_acls', 'true', 'Reject any request that tries to add a public access list.'],
        ['block_public_policy', 'true', 'Reject any bucket policy that would make the bucket public.'],
        ['ignore_public_acls', 'true', 'Ignore public access lists that already exist.'],
        ['restrict_public_buckets', 'true', 'Even with a public policy, only AWS services and approved users can get in.'],
      ]);
      add('}');
    } else {
      add('');
      add(
        '# Public access block left out on purpose.',
        'Without it, one wrong policy or access list can expose every file. Only do this for a bucket that really hosts public files.'
      );
    }

    if (v.versioning) {
      add('');
      add(`resource "aws_s3_bucket_versioning" "${label}" {`, 'Versioning keeps every version of every file.');
      attrs('  ', [['bucket', `aws_s3_bucket.${label}.id`, null]]);
      add('');
      add('  versioning_configuration {');
      attrs('    ', [['status', '"Enabled"', 'Enabled turns it on. Suspended keeps the old versions but stops making new ones.']]);
      add('  }');
      add('}');
    }

    add('');
    add(`resource "aws_s3_bucket_server_side_encryption_configuration" "${label}" {`, 'Encrypts every file stored in the bucket. AWS does it for you, and you do not notice it.');
    attrs('  ', [['bucket', `aws_s3_bucket.${label}.id`, null]]);
    add('');
    add('  rule {');
    add('    apply_server_side_encryption_by_default {');
    attrs('      ', [
      [
        'sse_algorithm',
        hcl(v.encryption),
        v.encryption === 'AES256'
          ? 'AES256 means keys that AWS manages for you, at no charge.'
          : 'aws:kms uses a key in AWS Key Management Service, which is logged and can be controlled closely. It has a small fee.',
      ],
    ]);
    add('    }');
    add('  }');
    add('}');

    if (v.lifecycle) {
      add('');
      add(`resource "aws_s3_bucket_lifecycle_configuration" "${label}" {`, 'Rules that tidy the bucket over time, so storage costs do not creep up.');
      const head = [['bucket', `aws_s3_bucket.${label}.id`, null]];
      if (v.versioning) {
        head.push(['depends_on', `[aws_s3_bucket_versioning.${label}]`, 'Build the versioning setting first. Terraform cannot always see this order on its own, so you say it.']);
      }
      attrs('  ', head);
      add('');
      add('  rule {');
      attrs('    ', [
        ['id', '"clean-up"', 'A name for the rule.'],
        ['status', '"Enabled"', null],
      ]);
      add('');
      add('    filter {}', 'An empty filter means the rule applies to every file in the bucket.');
      if (v.versioning) {
        add('');
        add('    noncurrent_version_expiration {', 'A "noncurrent" version is an old one that a newer upload has replaced.');
        attrs('      ', [['noncurrent_days', v.keepDays.trim(), 'Delete old versions this many days after they were replaced.']]);
        add('    }');
      }
      add('');
      add('    abort_incomplete_multipart_upload {', 'Big files upload in pieces. If an upload stops halfway, the pieces stay and are billed until removed.');
      attrs('      ', [['days_after_initiation', '7', 'Remove unfinished uploads after 7 days.']]);
      add('    }');
      add('  }');
      add('}');
    }

    add('');
    add(`output "${label}_bucket_name" {`, 'Prints the real bucket name after apply. It is useful with a random ending, because you cannot guess it.');
    attrs('  ', [
      ['description', '"Name of the bucket."', null],
      ['value', `aws_s3_bucket.${label}.id`, null],
    ]);
    add('}');
    add('');
    add(`output "${label}_bucket_arn" {`);
    attrs('  ', [
      ['description', '"ARN of the bucket."', null],
      ['value', `aws_s3_bucket.${label}.arn`, 'An ARN is an address that identifies one thing in AWS. Policies use it.'],
    ]);
    add('}');

    return [{ path: 's3.tf', label: 's3.tf', lines }];
  },

  zipName() {
    return 'terraform-s3.zip';
  },

  run(v) {
    const label = v.label.trim();
    return {
      where: TF_WHERE + ' Put s3.tf next to the files from the Provider and variables generator.' + TF_COST,
      commands: [
        TF_INIT,
        TF_VALIDATE,
        TF_PLAN,
        TF_APPLY,
        {
          cmd: `terraform output ${label}_bucket_name`,
          what: 'Shows the real bucket name, including the random ending if you chose one.',
        },
        TF_DESTROY,
      ],
      flags: [
        TF_FLAGS.init,
        TF_FLAGS.fmt,
        TF_FLAGS.and,
        TF_FLAGS.validate,
        TF_FLAGS.plan,
        TF_FLAGS.out,
        TF_FLAGS.apply,
        { flag: 'terraform output NAME', meaning: 'Print one of the output values from the last apply.' },
        TF_FLAGS.destroy,
      ],
    };
  },
};

const TERRAFORM_TOOLS = [tfProvider, tfSecurityGroup, tfEc2, tfS3];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { TERRAFORM_TOOLS, parseCidr, parseExtraRules };

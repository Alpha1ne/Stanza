'use strict';

/*
  tf-commands.js — the Terraform command reference.

  Same shape as commands.js. Every command works the same in OpenTofu
  (replace `terraform` with `tofu`). Flags were checked against
  `tofu <command> -help` and the safe ones were run on a local-only project.
*/

const TF_WORDS = [
  ['Configuration', 'Your .tf files. They describe the infrastructure you want.'],
  ['Provider', 'A plugin that talks to one service, such as AWS. terraform init downloads it.'],
  ['Resource', 'One thing Terraform builds and looks after: a server, a bucket, a firewall.'],
  ['State', 'Terraform’s notebook (terraform.tfstate). It records what it built so it knows what to change next time.'],
  ['Plan', 'A preview. It lists what Terraform would create, change or destroy, without doing it.'],
  ['Apply', 'Do the plan for real.'],
  ['Backend', 'Where the state file is kept. By default it is a file in your folder. Teams use a bucket.'],
  ['Workspace', 'A separate copy of the state inside one folder, for example dev and prod.'],
  ['OpenTofu', 'An open-source fork of Terraform. The commands are the same: type tofu instead of terraform.'],
];

const TF_COMMAND_GROUPS = [
  /* ------------------------------------------------------------------ */
  {
    id: 'start',
    tool: 'Get started',
    title: 'Get started: init, fmt and validate',
    blurb: 'The three commands you run first, in this order, every time you start a project or change its settings.',
    commands: [
      {
        id: 'version',
        cmd: 'terraform version',
        title: 'Check Terraform is installed',
        what: 'Prints the Terraform version and the version of every provider the folder has downloaded.',
        use: 'To confirm the install worked, or to say which version you use when asking for help.',
        parts: [
          ['terraform', 'The program.'],
          ['version', 'Ask it to print its version and stop. Nothing is changed.'],
        ],
        tips: ['terraform -version does the same thing.'],
      },
      {
        id: 'init',
        cmd: 'terraform init',
        title: 'Set up the folder',
        what: 'Reads your .tf files, downloads the providers they need into a hidden .terraform folder, sets up the backend, and writes .terraform.lock.hcl.',
        use: 'First command in any new project. Run it again whenever you add a provider, a module or change the backend.',
        parts: [
          ['terraform', 'The program.'],
          ['init', 'Prepare this folder. It changes only the .terraform folder and the lock file, never your real infrastructure.'],
        ],
        tips: [
          'Commit .terraform.lock.hcl to git. It pins exact provider versions so everyone gets the same ones.',
          'Do not commit the .terraform folder. It is large and Terraform rebuilds it.',
          'If plan says "Inconsistent dependency lock file" or "provider not installed", you forgot to run init.',
        ],
      },
      {
        id: 'init-upgrade',
        cmd: 'terraform init -upgrade',
        title: 'Move to newer provider versions',
        what: 'Does init again, but ignores the versions pinned in the lock file and picks the newest ones your version rules allow.',
        use: 'When you want newer providers on purpose, for example after raising the version in required_providers.',
        parts: [
          ['init', 'Prepare the folder.'],
          ['-upgrade', 'Update to the newest allowed provider and module versions and rewrite the lock file.'],
        ],
        tips: ['Run plan afterwards and read it. A new provider version can change what Terraform wants to do.'],
      },
      {
        id: 'init-reconfigure',
        cmd: 'terraform init -reconfigure',
        title: 'Switch backend without moving state',
        what: 'Re-runs init and uses the backend settings as written now. It forgets the saved backend setup and does not copy any state.',
        use: 'When you changed the backend block and want to start fresh against the new place.',
        parts: [
          ['init', 'Prepare the folder.'],
          ['-reconfigure', 'Ignore the previous backend setup. The old state is left where it was and is not copied.'],
        ],
        careful: 'If the new place is empty, Terraform will think nothing exists yet and plan to create everything again. Use -migrate-state if you want to keep your state.',
      },
      {
        id: 'init-migrate',
        cmd: 'terraform init -migrate-state',
        title: 'Move state to a new backend',
        what: 'After you change the backend block, copies your existing state to the new backend. It asks you to confirm before copying.',
        use: 'Moving from a local file to an S3 bucket, or from one bucket to another.',
        parts: [
          ['init', 'Prepare the folder.'],
          ['-migrate-state', 'Copy the existing state into the newly configured backend.'],
        ],
        tips: ['Keep a copy of terraform.tfstate before you do this. It is your only record of what exists.'],
      },
      {
        id: 'init-backend-config',
        cmd: 'terraform init -backend-config=backend.hcl',
        title: 'Give backend settings from a file',
        what: 'Fills in the backend block from a separate file, so the .tf files do not hold bucket names or keys.',
        use: 'When one codebase uses different state buckets for dev and prod.',
        parts: [
          ['init', 'Prepare the folder.'],
          ['-backend-config=backend.hcl', 'Read extra backend settings from backend.hcl. Use it more than once for more files, or pass key=value pairs.'],
        ],
        tips: ['Never put access keys in this file. Use the AWS CLI profile or environment variables.'],
      },
      {
        id: 'get',
        cmd: 'terraform get',
        title: 'Download modules only',
        what: 'Downloads the modules your configuration calls into .terraform/modules. It does not install providers.',
        use: 'Rarely. init already does this. Handy when you only changed a module source.',
        parts: [
          ['get', 'Fetch modules.'],
          ['-update', 'Add this flag to re-download modules that already exist.'],
        ],
      },
      {
        id: 'fmt',
        cmd: 'terraform fmt',
        title: 'Tidy the formatting',
        what: 'Rewrites the .tf files in this folder in the standard style: two-space indents and aligned equals signs.',
        use: 'Before every commit, so the whole team’s files look alike and diffs stay small.',
        parts: [
          ['fmt', 'Format. It prints the name of each file it changed.'],
          ['-recursive', 'Add this to also tidy files in sub-folders.'],
        ],
        tips: ['It only changes spacing and alignment. It never changes what your code means.'],
      },
      {
        id: 'fmt-check',
        cmd: 'terraform fmt -check -recursive -diff',
        title: 'Check formatting without changing files',
        what: 'Lists files that are not tidy and shows what would change, but leaves the files alone. The exit code is non-zero if any file needs tidying.',
        use: 'In an automated pipeline, so a badly formatted commit fails the build.',
        parts: [
          ['-check', 'Only check. Do not write changes.'],
          ['-recursive', 'Include sub-folders.'],
          ['-diff', 'Show the lines that would change.'],
        ],
      },
      {
        id: 'validate',
        cmd: 'terraform validate',
        title: 'Check the files make sense',
        what: 'Checks the syntax and that every argument and reference is valid. It does not contact AWS and does not read state.',
        use: 'After you edit a file. It is quick and catches typos, a missing variable or a wrong argument name.',
        parts: [
          ['validate', 'Check the configuration for mistakes.'],
          ['-json', 'Add this to get the result as JSON for scripts.'],
        ],
        tips: [
          'It needs init to have run first, because it reads the provider’s list of valid arguments.',
          'A pass does not mean the apply will work. AWS may still say no, for example when a bucket name is already taken.',
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'change',
    tool: 'Plan and apply',
    title: 'Plan, apply and destroy',
    blurb: 'The loop at the heart of Terraform: preview the change, read it, then do it.',
    commands: [
      {
        id: 'plan',
        cmd: 'terraform plan',
        title: 'Preview what will change',
        what: 'Compares your files with the state and with the real world, then lists what it would create (+), change (~) or destroy (-). Nothing is changed.',
        use: 'Always before apply. Read it. This is your chance to catch a surprise.',
        parts: [
          ['plan', 'Work out the changes and print them.'],
          ['+ create', 'A new thing will be built.'],
          ['~ update in-place', 'An existing thing will be edited.'],
          ['-/+ replace', 'The thing will be destroyed and built again. Check why.'],
          ['- destroy', 'The thing will be deleted.'],
        ],
        tips: ['The last line, "Plan: 2 to add, 1 to change, 0 to destroy", is the one to read first.'],
      },
      {
        id: 'plan-out',
        cmd: 'terraform plan -out=tfplan',
        title: 'Save the plan to a file',
        what: 'Runs the plan and saves it to a file called tfplan, so apply can do exactly that and nothing else.',
        use: 'When the plan is reviewed by someone else, or when time passes between reviewing and applying.',
        parts: [
          ['plan', 'Work out the changes.'],
          ['-out=tfplan', 'Write the plan to a file named tfplan.'],
        ],
        careful: 'A saved plan file can hold secret values in plain form. Do not commit it or share it.',
      },
      {
        id: 'plan-var',
        cmd: 'terraform plan -var="region=ap-south-1" -var-file="prod.tfvars"',
        title: 'Give input values',
        what: 'Sets input variables for this run, one by one with -var or many at once from a file with -var-file.',
        use: 'To use the same code with different settings, for example a different region or size.',
        parts: [
          ['-var="region=ap-south-1"', 'Set one variable called region. Repeat the flag for more.'],
          ['-var-file="prod.tfvars"', 'Read many variables from a file. Files named terraform.tfvars or *.auto.tfvars load by themselves.'],
        ],
        careful: 'Do not type a password or token after -var. It stays in your shell history. Use an environment variable named TF_VAR_name, or a tfvars file you keep out of git.',
      },
      {
        id: 'plan-target',
        cmd: 'terraform plan -target=aws_instance.web',
        title: 'Plan just one thing',
        what: 'Limits the plan to one resource and whatever it depends on.',
        use: 'To get out of a broken state, or to recover from a failed apply. Not for everyday work.',
        parts: [
          ['-target=aws_instance.web', 'Only this resource, written as type.name, plus the things it needs.'],
        ],
        careful: 'Terraform itself warns that this is for exceptional use. Leaving things out can leave the rest of your setup out of step.',
      },
      {
        id: 'plan-destroy',
        cmd: 'terraform plan -destroy',
        title: 'Preview a full teardown',
        what: 'Shows everything that terraform destroy would delete, without deleting it.',
        use: 'Before destroying, to see exactly what will go.',
        parts: [['-destroy', 'Plan for deleting everything instead of building.']],
      },
      {
        id: 'plan-refresh-only',
        cmd: 'terraform plan -refresh-only',
        title: 'See drift without changing anything',
        what: 'Compares the state with what really exists and reports differences, such as something changed by hand in the AWS console.',
        use: 'To find out whether someone changed your infrastructure outside Terraform.',
        parts: [['-refresh-only', 'Only update the notebook to match reality. Propose no changes to infrastructure.']],
        tips: ['Run terraform apply -refresh-only afterwards to accept the real values into the state.'],
      },
      {
        id: 'plan-ci',
        cmd: 'terraform plan -input=false -no-color -detailed-exitcode',
        title: 'Plan for scripts and pipelines',
        what: 'A plan that never stops to ask a question, prints plain text, and reports its result through the exit code.',
        use: 'In CI, or any script that must not hang waiting for a person.',
        parts: [
          ['-input=false', 'Never prompt. If a value is missing, fail instead.'],
          ['-no-color', 'Plain text with no colour codes, so logs are readable.'],
          ['-detailed-exitcode', 'Exit code 0 means no changes, 2 means there are changes, 1 means an error.'],
        ],
        tips: ['-lock=false skips the state lock. Avoid it, except for a read-only plan when the lock is stuck.'],
      },
      {
        id: 'apply',
        cmd: 'terraform apply',
        title: 'Make the changes',
        what: 'Makes a new plan, shows it, asks you to type yes, then creates, changes or destroys things to match your files. The state is updated as it goes.',
        use: 'When the plan looks right.',
        parts: [
          ['apply', 'Build what the files describe.'],
          ['yes', 'You type this at the prompt. Anything else cancels.'],
        ],
        careful: 'This changes real infrastructure and can cost money. Read the plan before typing yes.',
        tips: ['If it fails half way, fix the cause and run apply again. Terraform carries on from what already exists.'],
      },
      {
        id: 'apply-plan',
        cmd: 'terraform apply tfplan',
        title: 'Apply a saved plan',
        what: 'Applies exactly the plan saved earlier with -out. It does not ask for confirmation, because you already reviewed the plan.',
        use: 'The safe pipeline pattern: plan, review, then apply the same file.',
        parts: [
          ['apply', 'Build.'],
          ['tfplan', 'The plan file to use. No re-planning happens.'],
        ],
        careful: 'If the state changed since you made the plan, Terraform refuses it as stale. Make a new plan.',
      },
      {
        id: 'apply-auto',
        cmd: 'terraform apply -auto-approve',
        title: 'Apply without asking',
        what: 'Skips the "type yes" question and goes straight ahead.',
        use: 'In automation. Not for typing by hand against anything you care about.',
        parts: [['-auto-approve', 'Do not ask for confirmation.']],
        careful: 'There is no second chance. A mistake is applied immediately.',
      },
      {
        id: 'apply-replace',
        cmd: 'terraform apply -replace=aws_instance.web',
        title: 'Force one thing to be rebuilt',
        what: 'Destroys the named resource and creates it again, even if the files did not change.',
        use: 'When a server is broken or needs a fresh start. It replaces the old taint command.',
        parts: [['-replace=aws_instance.web', 'The resource to rebuild, written as type.name.']],
        careful: 'Anything stored only on that resource, such as data on a server’s disk, is lost.',
      },
      {
        id: 'destroy',
        cmd: 'terraform destroy',
        title: 'Delete everything',
        what: 'Shows a plan to delete every resource in this state, asks you to type yes, then deletes them.',
        use: 'To clean up after practice so nothing keeps charging you.',
        parts: [
          ['destroy', 'Delete everything Terraform manages here.'],
          ['-target=aws_instance.web', 'Add this to delete only one resource.'],
        ],
        careful: 'This is permanent. Check you are in the right folder and, if you use workspaces, the right workspace.',
        tips: ['It is the same as terraform apply -destroy.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'inspect',
    tool: 'Look at things',
    title: 'Look at what you have',
    blurb: 'These only read. They are safe to run any time.',
    commands: [
      {
        id: 'show',
        cmd: 'terraform show',
        title: 'Print the current state',
        what: 'Prints every resource in the state with all its values in readable form.',
        use: 'To see what Terraform believes exists, including values AWS chose for you, such as an instance ID.',
        parts: [
          ['show', 'Print the state.'],
          ['tfplan', 'Add a plan file name to print a saved plan instead.'],
          ['-json', 'Print as JSON for scripts.'],
        ],
      },
      {
        id: 'output',
        cmd: 'terraform output',
        title: 'Print your outputs',
        what: 'Prints the values of the outputs your configuration defines, such as a server’s IP address.',
        use: 'To find the thing you need after apply, such as the address to SSH to.',
        parts: [
          ['output', 'Print all outputs.'],
          ['public_ip', 'Add an output name to print just that one.'],
          ['-raw', 'Print one text value with no quotes. Perfect for scripts: ssh ubuntu@$(terraform output -raw public_ip).'],
          ['-json', 'Print as JSON.'],
        ],
        tips: ['Outputs marked sensitive show as <sensitive>. Ask for them by name, with -raw or -json, to see the value.'],
      },
      {
        id: 'graph',
        cmd: 'terraform graph',
        title: 'Draw the dependency map',
        what: 'Prints the order in which Terraform will build things, in a text format called DOT.',
        use: 'To understand why one resource waits for another. Paste the output into a Graphviz viewer to see a picture.',
        parts: [['graph', 'Print the dependency graph. Nothing is changed.']],
      },
      {
        id: 'console',
        cmd: 'terraform console',
        title: 'Try expressions interactively',
        what: 'Opens a prompt where you can type any Terraform expression and see its answer straight away, using your real variables and state.',
        use: 'To test a function or a for expression before putting it in a file.',
        parts: [
          ['console', 'Open the prompt.'],
          ['upper("hello")', 'Type this at the prompt and it answers "HELLO".'],
          ['exit', 'Leave the prompt. Ctrl+D also works.'],
        ],
        tips: ['It can read the state, so it may take the lock briefly.'],
      },
      {
        id: 'providers',
        cmd: 'terraform providers',
        title: 'List the providers you use',
        what: 'Shows which providers the configuration needs and which modules ask for them.',
        use: 'To check provider versions or find out why a provider was installed.',
        parts: [['providers', 'List them.']],
      },
      {
        id: 'providers-lock',
        cmd: 'terraform providers lock -platform=linux_amd64 -platform=darwin_arm64',
        title: 'Lock providers for other computers',
        what: 'Records the provider checksums for several operating systems in .terraform.lock.hcl.',
        use: 'When teammates use Mac or Windows and your pipeline uses Linux, so everyone passes the lock check.',
        parts: [
          ['providers lock', 'Write checksums into the lock file.'],
          ['-platform=linux_amd64', 'One kind of computer to include. Repeat for others, such as darwin_arm64 or windows_amd64.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'state',
    tool: 'State',
    title: 'The state file: terraform state',
    blurb: 'The state is Terraform’s notebook. These commands read or edit it. Reading is safe. Editing is for repair work.',
    commands: [
      {
        id: 'state-list',
        cmd: 'terraform state list',
        title: 'List what is tracked',
        what: 'Prints one line per resource in the state, such as aws_instance.web.',
        use: 'To find the exact name of a resource for other commands.',
        parts: [
          ['state list', 'List every tracked resource.'],
          ['aws_instance.web', 'Add part of an address to show only matching ones.'],
        ],
      },
      {
        id: 'state-show',
        cmd: 'terraform state show aws_instance.web',
        title: 'Show one resource',
        what: 'Prints every value stored for one resource.',
        use: 'To read a single resource without scrolling through terraform show.',
        parts: [
          ['state show', 'Show one.'],
          ['aws_instance.web', 'The resource address, written as type.name.'],
        ],
      },
      {
        id: 'state-mv',
        cmd: 'terraform state mv aws_instance.web aws_instance.app',
        title: 'Rename a resource in the state',
        what: 'Changes the name Terraform has recorded, so it does not destroy and rebuild the thing when you rename it in the code.',
        use: 'After renaming a resource block, or moving it into a module.',
        parts: [
          ['state mv', 'Move an entry inside the state.'],
          ['aws_instance.web', 'The old address.'],
          ['aws_instance.app', 'The new address, matching your renamed code.'],
        ],
        careful: 'Edits the state. A moved block in your code does the same job and can be reviewed in a plan, so prefer that where you can.',
      },
      {
        id: 'state-rm',
        cmd: 'terraform state rm aws_instance.web',
        title: 'Make Terraform forget a resource',
        what: 'Removes the entry from the state. The real server is not touched and keeps running.',
        use: 'When you want something to carry on existing but no longer be managed by Terraform.',
        parts: [
          ['state rm', 'Remove from the notebook only.'],
          ['aws_instance.web', 'The resource address.'],
        ],
        careful: 'If the resource is still in your code, the next plan will try to create it again. Remove it from the code too.',
      },
      {
        id: 'state-pull',
        cmd: 'terraform state pull > backup.tfstate',
        title: 'Save a copy of the state',
        what: 'Prints the full state as JSON. The > sends it into a file.',
        use: 'Before any risky state work, make a backup.',
        parts: [
          ['state pull', 'Print the current state, even from a remote backend.'],
          ['> backup.tfstate', 'Your shell saves the output in this file.'],
        ],
        tips: ['State can contain secrets such as database passwords. Treat the backup like a password.'],
      },
      {
        id: 'import',
        cmd: 'terraform import aws_s3_bucket.logs my-existing-bucket',
        title: 'Bring an existing thing under control',
        what: 'Attaches a real resource that already exists to a resource block in your code, by adding it to the state.',
        use: 'For something created by hand in the console that you now want Terraform to manage.',
        parts: [
          ['import', 'Adopt an existing thing.'],
          ['aws_s3_bucket.logs', 'The resource block in your code that will own it. Write the block first.'],
          ['my-existing-bucket', 'The real thing’s ID. What counts as the ID is listed on each resource’s docs page.'],
        ],
        tips: ['Newer versions can do this inside your code with an import block, so the import appears in a plan first. See Concepts.'],
      },
      {
        id: 'force-unlock',
        cmd: 'terraform force-unlock LOCK_ID',
        title: 'Clear a stuck lock',
        what: 'Releases a state lock that was left behind, for example when a run was killed half way.',
        use: 'Only when plan or apply says "Error acquiring the state lock" and you are sure nobody else is running.',
        parts: [
          ['force-unlock', 'Release the lock.'],
          ['LOCK_ID', 'The ID printed in the lock error message.'],
        ],
        careful: 'If another person is really applying, unlocking can corrupt the state. Ask first.',
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'more',
    tool: 'Workspaces and more',
    title: 'Workspaces, testing and sign-in',
    blurb: 'Less common commands. You will want workspaces once you have a dev and a prod copy.',
    commands: [
      {
        id: 'ws-list',
        cmd: 'terraform workspace list',
        title: 'List workspaces',
        what: 'Prints every workspace. A star marks the one you are in. You start in one called default.',
        use: 'To check which workspace you are in before you apply or destroy.',
        parts: [
          ['workspace list', 'List them.'],
          ['workspace show', 'Print only the current name.'],
        ],
      },
      {
        id: 'ws-new',
        cmd: 'terraform workspace new dev',
        title: 'Create a workspace',
        what: 'Makes a new, empty state called dev and switches to it.',
        use: 'To keep two copies of the same setup apart without copying the folder.',
        parts: [
          ['workspace new', 'Create and switch.'],
          ['dev', 'The name of the new workspace.'],
        ],
        tips: ['Inside your code, terraform.workspace gives the current name, useful for naming things.'],
      },
      {
        id: 'ws-select',
        cmd: 'terraform workspace select dev',
        title: 'Switch workspace',
        what: 'Changes which state the next commands use.',
        use: 'Before working on a different environment.',
        parts: [
          ['workspace select', 'Switch.'],
          ['dev', 'The workspace to switch to.'],
        ],
      },
      {
        id: 'ws-delete',
        cmd: 'terraform workspace delete dev',
        title: 'Delete a workspace',
        what: 'Removes the workspace and its state. You cannot delete the one you are in.',
        use: 'After you have destroyed everything in it.',
        parts: [
          ['workspace delete', 'Remove it.'],
          ['-force', 'Add this to delete even if it still holds resources.'],
        ],
        careful: 'With -force, the resources keep existing in AWS but Terraform forgets them. They can keep costing money.',
      },
      {
        id: 'test',
        cmd: 'terraform test',
        title: 'Run your test files',
        what: 'Runs the .tftest.hcl files in your project. They make a plan or apply and check conditions you wrote.',
        use: 'To test a module before other people use it.',
        parts: [
          ['test', 'Find and run test files.'],
          ['-verbose', 'Add this to print the plan or state for each test.'],
        ],
        careful: 'A test that applies builds real resources, then deletes them at the end.',
      },
      {
        id: 'login',
        cmd: 'terraform login',
        title: 'Sign in to a Terraform service',
        what: 'Opens a sign-in so Terraform can use HCP Terraform or a private module registry. It stores an API token on your computer.',
        use: 'Only if you use HCP Terraform. You do not need it for AWS.',
        parts: [['login', 'Fetch and save a sign-in token.']],
        careful: 'The token is saved in a file in your home folder. Run terraform logout when finished, and revoke it in the website if the computer is shared.',
      },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { TF_COMMAND_GROUPS, TF_WORDS };

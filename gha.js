'use strict';

/*
  gha.js — GitHub Actions generators.

  Seven generators: CI, test matrix, Docker image publish, release, deploy,
  scheduled/manual job and security (CodeQL + Dependabot).

  Rules every generator follows:
    - Every typed value is checked before it reaches the file, so a bad value
      shows an error instead of breaking the YAML.
    - No secret is ever typed here. Passwords, tokens and keys are read from
      GitHub "secrets" with ${{ secrets.NAME }}.
    - Permissions are written out and kept small (least privilege).
    - Values from outside (branch names, tag names) go through an environment
      variable, never straight into a shell line.
*/

/* Action versions live in ONE place. Each is a major version tag.
   Dependabot (see the Security generator) keeps them current. */
const GHA_ACTIONS = {
  checkout: 'actions/checkout@v6',
  setupNode: 'actions/setup-node@v6',
  setupPython: 'actions/setup-python@v6',
  setupJava: 'actions/setup-java@v5',
  setupGo: 'actions/setup-go@v6',
  upload: 'actions/upload-artifact@v6',
  qemu: 'docker/setup-qemu-action@v4',
  buildx: 'docker/setup-buildx-action@v4',
  login: 'docker/login-action@v4',
  meta: 'docker/metadata-action@v6',
  build: 'docker/build-push-action@v7',
  pagesConfig: 'actions/configure-pages@v5',
  pagesUpload: 'actions/upload-pages-artifact@v4',
  pagesDeploy: 'actions/deploy-pages@v4',
  codeqlInit: 'github/codeql-action/init@v4',
  codeqlRun: 'github/codeql-action/analyze@v4',
};

const GH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,39}$/;
const GH_BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/;
const GH_TAG_RE = /^[A-Za-z0-9._*-]{1,20}$/;
const GH_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,79}$/;
const GH_CMD_RE = /^[A-Za-z0-9 ._\/:=@%+,~&|<>*"'-]{1,120}$/;
const GH_SAFE_CMD_RE = /^[A-Za-z0-9 ._\/=@%+,~-]+$/; // can be written on one plain line
const GH_REMOTE_RE = /^[A-Za-z0-9 ._\/=@%+,~-]{1,100}$/;
const GH_URL_RE = /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]{0,100}(:\d{2,5})?(\/[A-Za-z0-9._~\/-]{0,80})?$/;
const GH_VER_RE = /^[A-Za-z0-9][A-Za-z0-9._*-]{0,15}$/;
const GH_IMAGE_RE = /^[a-z0-9][a-z0-9._-]{0,60}$/;

function ghYaml() {
  const lines = [];
  const add = (t, n = null) => lines.push({ t, n });
  return { lines, add };
}

const dq = (s) => `"${s}"`; // a YAML double-quoted string (values are pre-checked)
const noDotDot = (p) => !p.split('/').includes('..');
const pathOk = (p) => GH_PATH_RE.test(p) && noDotDot(p);

/* A command on one plain line when that is safe, otherwise a block. */
function ghRun(add, indent, cmd, note) {
  if (GH_SAFE_CMD_RE.test(cmd)) {
    add(`${indent}run: ${cmd}`, note);
  } else {
    add(`${indent}run: |`, note);
    add(`${indent}  ${cmd}`, 'Your command is written as a block so special characters cannot break the YAML.');
  }
}

const WHEN = 'Pick the "when" that fits you. Every choice is explained in the file.';

/* ---------- Languages ---------- */

const GH_LANGS = [
  ['node', 'Node.js (npm)'],
  ['python', 'Python (pip and pytest)'],
  ['maven', 'Java with Maven'],
  ['go', 'Go'],
];

const GH_LANG = {
  node: { name: 'Node.js', install: 'npm ci', test: 'npm test', lint: 'npm run lint', build: 'npm run build', art: 'dist' },
  python: { name: 'Python', install: 'pip install -r requirements.txt', test: 'pytest', lint: 'ruff check .', build: 'python -m build', art: 'dist' },
  maven: { name: 'Java', install: '', test: 'mvn -B verify', lint: '', build: 'mvn -B package -DskipTests', art: 'target' },
  go: { name: 'Go', install: 'go mod download', test: 'go test ./...', lint: 'go vet ./...', build: 'go build ./...', art: 'bin' },
};

const verField = (lang, id, label, options, def) => ({
  id,
  type: 'select',
  label,
  options,
  default: def,
  showIf: { field: 'language', in: [lang] },
});

const LANG_VERSION_FIELDS = [
  verField('node', 'nodeV', 'Node.js version', [['20', '20 (maintenance)'], ['22', '22 (LTS)'], ['24', '24 (current LTS)']], '22'),
  verField('python', 'pyV', 'Python version', [['3.11', '3.11'], ['3.12', '3.12'], ['3.13', '3.13']], '3.13'),
  verField('maven', 'javaV', 'Java version', [['17', '17 (LTS)'], ['21', '21 (LTS)']], '21'),
  verField('go', 'goV', 'Go version', [['1.24', '1.24'], ['1.25', '1.25']], '1.25'),
];

const verOf = (v) => ({ node: v.nodeV, python: v.pyV, maven: v.javaV, go: v.goV }[v.language]);

/* Steps that install the language. `ver` is a YAML value such as "22" or ${{ matrix.version }}. */
function ghSetup(add, lang, ver, withCache) {
  if (lang === 'node') {
    add(`      - uses: ${GHA_ACTIONS.setupNode}`, 'Installs Node.js on the runner.');
    add('        with:');
    add(`          node-version: ${ver}`, 'Which Node.js to install.');
    if (withCache) add('          cache: npm', 'Saves downloaded packages between runs, so later runs are faster. Reads package-lock.json to know when to refresh.');
  } else if (lang === 'python') {
    add(`      - uses: ${GHA_ACTIONS.setupPython}`, 'Installs Python on the runner.');
    add('        with:');
    add(`          python-version: ${ver}`, 'Which Python to install. It is quoted, because 3.10 written without quotes would be read as the number 3.1.');
    if (withCache) add('          cache: pip', 'Saves downloaded packages between runs.');
  } else if (lang === 'maven') {
    add(`      - uses: ${GHA_ACTIONS.setupJava}`, 'Installs Java on the runner.');
    add('        with:');
    add('          distribution: temurin', 'Which Java build to install. Temurin is the free Eclipse build.');
    add(`          java-version: ${ver}`, 'Which Java to install.');
    if (withCache) add('          cache: maven', 'Saves the downloaded Maven libraries between runs.');
  } else {
    add(`      - uses: ${GHA_ACTIONS.setupGo}`, 'Installs Go on the runner. It caches modules by itself.');
    add('        with:');
    add(`          go-version: ${ver}`, 'Which Go to install.');
  }
}

/* ---------- The steps shown under every generator ---------- */

const GH_WHERE =
  'Workflow files live in your project’s git repository, in the folder .github/workflows (the dot at the start matters). Save the downloaded file there, then use a terminal (your laptop, or a VM through its console or SSH) to commit and push it. After that, everything you watch happens on github.com in the Actions tab (GUI).';

const ghCommands = (file, message) => [
  { cmd: 'mkdir -p .github/workflows', what: 'Make the folder GitHub looks in. The name must be exactly .github/workflows. -p means "no error if it already exists".' },
  { cmd: `git add .github/workflows/${file}`, what: 'Tell git to include the new file in your next commit.' },
  { cmd: `git commit -m "${message}"`, what: 'Save the file in your project’s history, with a short message saying why.' },
  { cmd: 'git push', what: 'Send the commit to GitHub. GitHub reads the file and the workflow is live.' },
];

const GH_GIT_FLAGS = [
  { flag: 'mkdir -p', meaning: 'Make a folder, and any missing parent folders, without an error if it is already there.' },
  { flag: 'git add <file>', meaning: 'Pick the file to be saved in the next commit.' },
  { flag: 'git commit -m "..."', meaning: '-m gives the commit message in quotes, so git does not open an editor.' },
  { flag: 'git push', meaning: 'Upload your commits to GitHub.' },
  { flag: 'Actions tab', meaning: 'On your repository page on github.com. Shows every run, and the log of every step.' },
];

const GH_SECRET_FLAGS = [
  { flag: 'Settings > Secrets and variables > Actions', meaning: 'Where secrets are stored on github.com (GUI). You type the value there once. It is hidden afterwards.' },
  { flag: 'New repository secret', meaning: 'The button that adds one secret: a name (exactly as in the file) and its value.' },
];

/* =====================================================================
   1. CI workflow
   ===================================================================== */

const ghCI = {
  id: 'ci',
  label: 'CI workflow',
  ready: true,
  title: 'CI workflow',
  intro: 'Run your tests on every push and pull request. GitHub starts a fresh machine, installs your language, runs your commands and shows a green tick or a red cross.',

  groups: [
    {
      legend: 'Your project',
      fields: [
        { id: 'wfName', type: 'text', label: 'Workflow name', hint: 'Shown in the Actions tab. Letters, digits, spaces and . _ ( ) -', default: 'CI' },
        { id: 'language', type: 'select', label: 'What kind of project is it?', options: GH_LANGS, default: 'node' },
        ...LANG_VERSION_FIELDS,
        { id: 'branch', type: 'text', label: 'Main branch', hint: 'Usually main. Pushes to it, and pull requests into it, start the workflow.', default: 'main' },
      ],
    },
    {
      legend: 'When it runs',
      fields: [
        { id: 'onPush', type: 'check', label: 'On every push to the main branch', default: true },
        { id: 'onPR', type: 'check', label: 'On every pull request into the main branch', default: true },
        { id: 'onManual', type: 'check', label: 'Also let me start it by hand (Run workflow button)', default: false },
      ],
    },
    {
      legend: 'What it does',
      fields: [
        { id: 'lint', type: 'check', label: 'Run a linter first', default: false, hint: 'A linter finds style problems and some bugs without running the code.' },
        { id: 'testCmd', type: 'text', label: 'Test command', hint: 'Leave empty for the usual one for your language. No $ sign. Quotes and & are fine.', default: '' },
        { id: 'build', type: 'check', label: 'Build the project after the tests pass', default: false },
        { id: 'upload', type: 'check', label: 'Keep the build output (artifact)', default: false, hint: 'Saves a folder from the run so you can download it from the run page.', showIf: { field: 'build', in: [true] } },
        { id: 'artPath', type: 'text', label: 'Folder to keep', hint: 'A path inside the project, such as dist. No leading slash.', default: 'dist', showIf: { field: 'upload', in: [true] } },
      ],
    },
    {
      legend: 'Speed and safety',
      optional: true,
      fields: [
        { id: 'cache', type: 'check', label: 'Cache downloaded packages', default: true },
        { id: 'concurrency', type: 'check', label: 'Cancel an older run when a newer push arrives', default: true },
        { id: 'runner', type: 'select', label: 'Machine to run on', options: [['ubuntu-latest', 'Linux (ubuntu-latest)'], ['windows-latest', 'Windows'], ['macos-latest', 'macOS (uses more minutes)']], default: 'ubuntu-latest' },
        { id: 'timeout', type: 'select', label: 'Stop the job if it takes longer than', options: [['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '60 minutes']], default: '15', hint: 'Stops a stuck job from burning your free minutes.' },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!GH_NAME_RE.test(v.wfName.trim())) e.wfName = 'Use 1 to 40 characters: letters, digits, spaces and . _ ( ) -. Start with a letter or digit.';
    if (!GH_BRANCH_RE.test(v.branch.trim())) e.branch = 'Use letters, digits and . _ / - only. For example main.';
    if (v.testCmd.trim() && !GH_CMD_RE.test(v.testCmd.trim())) e.testCmd = 'Use letters, digits, spaces and . _ / : = @ % + , ~ & | < > * " \' - only. No $ sign.';
    if (v.upload && !pathOk(v.artPath.trim())) e.artPath = 'Write a path inside the project, such as dist. Letters, digits and . _ / - only, no .. and no leading slash.';
    if (!v.onPush && !v.onPR && !v.onManual) e.onPush = 'Choose at least one way to start the workflow.';
    return e;
  },

  build(v) {
    const L = GH_LANG[v.language];
    const branch = v.branch.trim();
    const { lines, add } = ghYaml();
    add('# Runs your tests on GitHub’s machines. Save as .github/workflows/ci.yml', 'Lines starting with # are comments. GitHub ignores them.');
    add(`name: ${v.wfName.trim()}`, 'The name shown in the Actions tab.');
    add('');
    add('on:', 'What starts this workflow. Each line below is an event.');
    if (v.onPush) {
      add('  push:', 'When someone pushes commits.');
      add(`    branches: [${branch}]`, 'Only for this branch. Without this, a push to any branch would run it.');
    }
    if (v.onPR) {
      add('  pull_request:', 'When a pull request is opened or updated.');
      add(`    branches: [${branch}]`, 'Only pull requests that aim at this branch.');
    }
    if (v.onManual) add('  workflow_dispatch:', 'Adds a "Run workflow" button on the Actions tab, so you can start it by hand.');
    add('');
    add('permissions:', 'What the built-in GITHUB_TOKEN may do during this run.');
    add('  contents: read', 'Read-only. Tests only need to read the code. Keeping it small limits the damage if a step is ever tricked.');
    if (v.concurrency) {
      add('');
      add('concurrency:', 'Stops two runs of the same thing from piling up.');
      add('  group: ${{ github.workflow }}-${{ github.ref }}', 'One group per workflow and branch. ${{ }} is an expression: GitHub fills in the value.');
      add('  cancel-in-progress: true', 'A new push cancels the older run that is still going.');
    }
    add('');
    add('jobs:', 'A workflow is a list of jobs. Each job gets its own fresh machine.');
    add('  test:', 'The job’s ID. You choose the name.');
    add(`    runs-on: ${v.runner}`, 'The kind of machine. GitHub provides it and throws it away afterwards.');
    add(`    timeout-minutes: ${v.timeout}`, 'The job is stopped after this long.');
    add('    steps:', 'The steps run one after another, in order.');
    add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine. Without it the machine has no code.');
    ghSetup(add, v.language, dq(verOf(v)), v.cache);
    if (L.install) {
      add('      - name: Install dependencies', 'A label for this step, shown in the log.');
      ghRun(add, '        ', L.install, 'Installs what your project needs. npm ci installs exactly what package-lock.json lists.');
    }
    if (v.lint && L.lint === '') add('      # (No linter command is set for Maven. Add one to the pom.xml and a step here.)');
    if (v.lint && L.lint) {
      add('      - name: Lint', 'Checks style and common mistakes.');
      ghRun(add, '        ', L.lint, 'If this fails, the run stops here and the tests do not run.');
    }
    const testCmd = v.testCmd.trim() || L.test;
    add('      - name: Test', 'The step most people care about.');
    ghRun(add, '        ', testCmd, 'Your tests. A non-zero exit code makes the step, the job and the run fail.');
    if (v.build) {
      add('      - name: Build', 'Runs only if everything above passed.');
      ghRun(add, '        ', L.build, 'Builds the project.');
      if (v.upload) {
        add(`      - uses: ${GHA_ACTIONS.upload}`, 'Saves files from this run so you can download them later.');
        add('        with:');
        add('          name: build-output', 'The name of the download on the run page.');
        add(`          path: ${v.artPath.trim()}`, 'The folder to keep.');
        add('          retention-days: 7', 'GitHub deletes it after 7 days, which saves storage.');
      }
    }
    return [{ path: '.github/workflows/ci.yml', label: 'ci.yml', lines }];
  },

  zipName: () => 'github-actions-ci.zip',

  run() {
    return {
      where: GH_WHERE + ' To see it: open your repository on github.com, click Actions, and open the newest run. Each step has its own log.',
      commands: ghCommands('ci.yml', 'Add CI workflow'),
      flags: GH_GIT_FLAGS,
    };
  },
};

/* =====================================================================
   2. Test matrix
   ===================================================================== */

const ghMatrix = {
  id: 'matrix',
  label: 'Test matrix',
  ready: true,
  title: 'Test matrix',
  intro: 'Run the same tests on several versions and systems at once. GitHub makes one job for every combination, side by side.',

  groups: [
    {
      legend: 'Your project',
      fields: [
        { id: 'wfName', type: 'text', label: 'Workflow name', hint: 'Letters, digits, spaces and . _ ( ) -', default: 'Test matrix' },
        { id: 'language', type: 'select', label: 'What kind of project is it?', options: GH_LANGS, default: 'node' },
        { id: 'branch', type: 'text', label: 'Main branch', default: 'main', hint: 'Pushes to it, and pull requests into it, start the workflow.' },
      ],
    },
    {
      legend: 'Versions to test',
      fields: [
        { id: 'nodeVs', type: 'text', label: 'Node.js versions', hint: 'Separate with commas, such as 20, 22, 24. Up to 6.', default: '20, 22, 24', showIf: { field: 'language', in: ['node'] } },
        { id: 'pyVs', type: 'text', label: 'Python versions', hint: 'Separate with commas, such as 3.11, 3.12, 3.13. Up to 6.', default: '3.11, 3.12, 3.13', showIf: { field: 'language', in: ['python'] } },
        { id: 'javaVs', type: 'text', label: 'Java versions', hint: 'Separate with commas, such as 17, 21. Up to 6.', default: '17, 21', showIf: { field: 'language', in: ['maven'] } },
        { id: 'goVs', type: 'text', label: 'Go versions', hint: 'Separate with commas, such as 1.24, 1.25. Up to 6.', default: '1.24, 1.25', showIf: { field: 'language', in: ['go'] } },
      ],
    },
    {
      legend: 'Systems to test on',
      fields: [
        { id: 'osLinux', type: 'check', label: 'Linux', default: true },
        { id: 'osWin', type: 'check', label: 'Windows', default: false },
        { id: 'osMac', type: 'check', label: 'macOS', default: false, hint: 'macOS minutes cost more than Linux on private repositories.' },
      ],
    },
    {
      legend: 'Behaviour',
      optional: true,
      fields: [
        { id: 'failFast', type: 'check', label: 'Stop everything when one combination fails', default: false, hint: 'Off is better for learning: you see every failure, not just the first.' },
        { id: 'testCmd', type: 'text', label: 'Test command', hint: 'Leave empty for the usual one. No $ sign.', default: '' },
        { id: 'cache', type: 'check', label: 'Cache downloaded packages', default: true },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!GH_NAME_RE.test(v.wfName.trim())) e.wfName = 'Use 1 to 40 characters: letters, digits, spaces and . _ ( ) -. Start with a letter or digit.';
    if (!GH_BRANCH_RE.test(v.branch.trim())) e.branch = 'Use letters, digits and . _ / - only. For example main.';
    const key = { node: 'nodeVs', python: 'pyVs', maven: 'javaVs', go: 'goVs' }[v.language];
    const list = v[key].split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) e[key] = 'Write at least one version.';
    else if (list.length > 6) e[key] = 'Use 6 versions or fewer. Every version multiplies the number of jobs.';
    else if (list.some((s) => !GH_VER_RE.test(s))) e[key] = 'Each version may use letters, digits and . _ * - only, such as 22 or 3.13.';
    else if (new Set(list).size !== list.length) e[key] = 'Each version should appear once.';
    if (!v.osLinux && !v.osWin && !v.osMac) e.osLinux = 'Choose at least one system.';
    if (v.testCmd.trim() && !GH_CMD_RE.test(v.testCmd.trim())) e.testCmd = 'Use letters, digits, spaces and . _ / : = @ % + , ~ & | < > * " \' - only. No $ sign.';
    return e;
  },

  build(v) {
    const L = GH_LANG[v.language];
    const branch = v.branch.trim();
    const key = { node: 'nodeVs', python: 'pyVs', maven: 'javaVs', go: 'goVs' }[v.language];
    const vers = v[key].split(',').map((s) => s.trim()).filter(Boolean);
    const oses = [];
    if (v.osLinux) oses.push('ubuntu-latest');
    if (v.osWin) oses.push('windows-latest');
    if (v.osMac) oses.push('macos-latest');
    const { lines, add } = ghYaml();
    add('# Tests every combination of version and system. Save as .github/workflows/matrix.yml', 'Lines starting with # are comments.');
    add(`name: ${v.wfName.trim()}`, 'The name shown in the Actions tab.');
    add('');
    add('on:', 'What starts this workflow.');
    add('  push:');
    add(`    branches: [${branch}]`, 'Pushes to this branch.');
    add('  pull_request:');
    add(`    branches: [${branch}]`, 'Pull requests into this branch.');
    add('');
    add('permissions:', 'What the built-in GITHUB_TOKEN may do.');
    add('  contents: read', 'Read-only is enough for tests.');
    add('');
    add('jobs:');
    add('  test:');
    add('    runs-on: ${{ matrix.os }}', 'Each job runs on the system its matrix row names.');
    add('    timeout-minutes: 20', 'Stops a stuck job.');
    add('    strategy:', 'This is what turns one job into many.');
    add(`      fail-fast: ${v.failFast ? 'true' : 'false'}`, v.failFast ? 'When one combination fails, GitHub cancels the others.' : 'Every combination finishes, even if one fails, so you see all the failures at once.');
    add('      matrix:', 'GitHub runs one job for every combination of the lists below.');
    add(`        os: [${oses.join(', ')}]`, `${oses.length} system${oses.length > 1 ? 's' : ''}.`);
    add(`        version: [${vers.map(dq).join(', ')}]`, `${vers.length} version${vers.length > 1 ? 's' : ''}. They are quoted so 3.10 is not read as 3.1. That makes ${oses.length * vers.length} job${oses.length * vers.length > 1 ? 's' : ''} in all.`);
    add('    steps:');
    add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine.');
    ghSetup(add, v.language, '${{ matrix.version }}', v.cache);
    const lines2 = lines;
    // The line above puts the matrix value in the setup step. Add a note on it.
    for (const l of lines2) if (/\$\{\{ matrix\.version \}\}$/.test(l.t) && !l.n) l.n = 'Uses the version from this job’s matrix row.';
    if (L.install) {
      add('      - name: Install dependencies');
      ghRun(add, '        ', L.install, 'Installs what the project needs.');
    }
    add('      - name: Test');
    ghRun(add, '        ', v.testCmd.trim() || L.test, 'Your tests, run once per combination.');
    return [{ path: '.github/workflows/matrix.yml', label: 'matrix.yml', lines }];
  },

  zipName: () => 'github-actions-matrix.zip',

  run() {
    return {
      where: GH_WHERE + ' On the run page you will see one job for each combination, such as "test (ubuntu-latest, 22)".',
      commands: ghCommands('matrix.yml', 'Add test matrix workflow'),
      flags: [...GH_GIT_FLAGS, { flag: 'matrix', meaning: 'A table of choices. GitHub makes one job for every combination.' }, { flag: 'fail-fast', meaning: 'Whether one failure cancels the other jobs.' }],
    };
  },
};

/* =====================================================================
   3. Docker image publish
   ===================================================================== */

const ghDocker = {
  id: 'docker',
  label: 'Docker image',
  ready: true,
  title: 'Build and publish a Docker image',
  intro: 'Build an image from your Dockerfile and push it to a registry. Pushes to main give the image a "latest" label, and version tags give it a version number.',

  groups: [
    {
      legend: 'Where it goes',
      fields: [
        { id: 'wfName', type: 'text', label: 'Workflow name', hint: 'Letters, digits, spaces and . _ ( ) -', default: 'Publish image' },
        {
          id: 'registry',
          type: 'select',
          label: 'Registry',
          options: [
            ['ghcr', 'GitHub Container Registry (no extra secret needed)'],
            ['hub', 'Docker Hub (needs two secrets)'],
          ],
          default: 'ghcr',
          hint: 'The GitHub one signs in with the built-in token. Docker Hub needs DOCKERHUB_USERNAME and DOCKERHUB_TOKEN as secrets.',
        },
        { id: 'image', type: 'text', label: 'Image name', hint: 'Lowercase letters, digits, dots, hyphens and underscores. On GitHub it goes after your user name.', default: 'my-app' },
      ],
    },
    {
      legend: 'What to build',
      fields: [
        { id: 'context', type: 'text', label: 'Build folder', hint: 'The folder Docker builds from. A dot means the top of the project.', default: '.' },
        { id: 'dockerfile', type: 'text', label: 'Dockerfile path', hint: 'Relative to the top of the project.', default: 'Dockerfile' },
        { id: 'arm', type: 'check', label: 'Also build for ARM (Apple chips, Raspberry Pi)', default: false, hint: 'Slower: the ARM build is emulated.' },
        { id: 'cache', type: 'check', label: 'Reuse build layers between runs', default: true },
      ],
    },
    {
      legend: 'When it runs',
      fields: [
        { id: 'branch', type: 'text', label: 'Main branch', default: 'main', hint: 'A push to it publishes the "latest" image.' },
        { id: 'onMain', type: 'check', label: 'Publish on every push to the main branch', default: true },
        { id: 'onTags', type: 'check', label: 'Publish when I push a version tag (v1.2.3)', default: true },
        { id: 'onPR', type: 'check', label: 'Build, but do not publish, on pull requests', default: true, hint: 'Catches a broken Dockerfile before it is merged.' },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!GH_NAME_RE.test(v.wfName.trim())) e.wfName = 'Use 1 to 40 characters: letters, digits, spaces and . _ ( ) -. Start with a letter or digit.';
    if (!GH_IMAGE_RE.test(v.image.trim())) e.image = 'Use lowercase letters, digits, dots, hyphens and underscores. Docker image names cannot have capitals.';
    const c = v.context.trim();
    if (c !== '.' && !pathOk(c)) e.context = 'Write . or a folder path such as app. Letters, digits and . _ / - only, no .. and no leading slash.';
    if (!pathOk(v.dockerfile.trim())) e.dockerfile = 'Write a path such as Dockerfile or app/Dockerfile. Letters, digits and . _ / - only.';
    if (!GH_BRANCH_RE.test(v.branch.trim())) e.branch = 'Use letters, digits and . _ / - only. For example main.';
    if (!v.onMain && !v.onTags && !v.onPR) e.onMain = 'Choose at least one way to start the workflow.';
    return e;
  },

  build(v) {
    const ghcr = v.registry === 'ghcr';
    const branch = v.branch.trim();
    const image = v.image.trim();
    const { lines, add } = ghYaml();
    add('# Builds a Docker image and pushes it to a registry. Save as .github/workflows/docker.yml', 'Lines starting with # are comments.');
    add(`name: ${v.wfName.trim()}`);
    add('');
    add('on:', 'What starts this workflow.');
    if (v.onMain) {
      add('  push:', 'When someone pushes.');
      add(`    branches: [${branch}]`, 'A push to the main branch publishes the "latest" image.');
      if (v.onTags) add("    tags: ['v*']", 'A tag such as v1.2.3 publishes a versioned image. v* means "starts with v".');
    } else if (v.onTags) {
      add('  push:');
      add("    tags: ['v*']", 'A tag such as v1.2.3 publishes a versioned image.');
    }
    if (v.onPR) {
      add('  pull_request:', 'When a pull request is opened or updated.');
      add(`    branches: [${branch}]`, 'Builds the image to prove the Dockerfile works. Nothing is published.');
    }
    add('');
    add('permissions:', 'What the built-in GITHUB_TOKEN may do.');
    add('  contents: read', 'Read the code.');
    if (ghcr) add('  packages: write', 'Needed to push to the GitHub Container Registry. Nothing else is granted.');
    add('');
    add('jobs:');
    add('  image:', 'One job that builds and (when allowed) pushes.');
    add('    runs-on: ubuntu-latest');
    add('    timeout-minutes: 30', 'Image builds can be slow. This stops a stuck one.');
    add('    steps:');
    add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine.');
    if (v.arm) add(`      - uses: ${GHA_ACTIONS.qemu}`, 'Lets the Linux machine pretend to be an ARM computer, so it can build for ARM.');
    add(`      - uses: ${GHA_ACTIONS.buildx}`, 'Sets up Docker Buildx, the modern builder. It handles caching and many platforms.');
    add(`      - uses: ${GHA_ACTIONS.login}`, 'Signs in to the registry, so the push is allowed.');
    add("        if: github.event_name != 'pull_request'", 'Pull requests only build. They never sign in or push, which also keeps secrets away from untrusted code.');
    add('        with:');
    if (ghcr) {
      add('          registry: ghcr.io', 'The GitHub Container Registry.');
      add('          username: ${{ github.actor }}', 'Your GitHub user name, filled in by GitHub.');
      add('          password: ${{ secrets.GITHUB_TOKEN }}', 'The built-in token. You do not create it and never see it.');
    } else {
      add('          username: ${{ secrets.DOCKERHUB_USERNAME }}', 'Your Docker Hub name, read from a secret you add in the repository settings.');
      add('          password: ${{ secrets.DOCKERHUB_TOKEN }}', 'A Docker Hub access token (not your password), read from a secret.');
    }
    add(`      - id: meta`, 'An ID so a later step can read this step’s results.');
    add(`        uses: ${GHA_ACTIONS.meta}`, 'Works out the image’s name and labels from the branch or tag.');
    add('        with:');
    add(`          images: ${ghcr ? `ghcr.io/\${{ github.repository_owner }}/${image}` : `\${{ secrets.DOCKERHUB_USERNAME }}/${image}`}`, ghcr ? 'The full image name. The action turns capital letters into lowercase for you, which the registry requires.' : 'Your Docker Hub name, then the image name.');
    add('          tags: |', 'Which labels (tags) to give the image. One rule per line.');
    if (v.onMain) add(`            type=raw,value=latest,enable=\${{ github.ref == 'refs/heads/${branch}' }}`, 'The "latest" label, only for pushes to the main branch.');
    if (v.onTags) add('            type=semver,pattern={{version}}', 'A tag v1.2.3 becomes the image label 1.2.3.');
    add('            type=sha', 'Also label every image with the commit it came from, so you can always trace it.');
    add(`      - uses: ${GHA_ACTIONS.build}`, 'Builds the image from your Dockerfile.');
    add('        with:');
    add(`          context: ${v.context.trim()}`, 'The folder Docker builds from.');
    add(`          file: ${v.dockerfile.trim()}`, 'Which Dockerfile to use.');
    if (v.arm) add('          platforms: linux/amd64,linux/arm64', 'Build for normal PCs and for ARM.');
    add("          push: ${{ github.event_name != 'pull_request' }}", 'Push the image, except on pull requests.');
    add('          tags: ${{ steps.meta.outputs.tags }}', 'The labels worked out two steps ago.');
    add('          labels: ${{ steps.meta.outputs.labels }}', 'Extra information stored inside the image, such as the source repository.');
    if (v.cache) {
      add('          cache-from: type=gha', 'Reuse build layers saved by earlier runs.');
      add('          cache-to: type=gha,mode=max', 'Save this run’s layers for next time.');
    }
    return [{ path: '.github/workflows/docker.yml', label: 'docker.yml', lines }];
  },

  zipName: () => 'github-actions-docker.zip',

  run(v) {
    const ghcr = v.registry === 'ghcr';
    return {
      where:
        GH_WHERE +
        (ghcr
          ? ' This one needs no secrets. After the first push, the image appears under your profile’s Packages on github.com (GUI). New packages start private. Open the package settings to make it public if you want.'
          : ' Before the first run, add two secrets on github.com (GUI): DOCKERHUB_USERNAME (your Docker Hub name) and DOCKERHUB_TOKEN (an access token made at hub.docker.com under Account settings, Security. Use a token, never your password).') +
        ' For a version image, create a tag with the commands below.',
      commands: [
        ...ghCommands('docker.yml', 'Add Docker publish workflow'),
        { cmd: 'git tag v1.0.0', what: 'Label the current commit as version 1.0.0.' },
        { cmd: 'git push origin v1.0.0', what: 'Send the tag to GitHub. That starts a run that publishes the image as 1.0.0.' },
      ],
      flags: [
        ...GH_GIT_FLAGS,
        ...(ghcr ? [] : GH_SECRET_FLAGS),
        { flag: 'git tag v1.0.0', meaning: 'Names this commit. A tag starting with v is what this workflow reacts to.' },
        { flag: 'git push origin <tag>', meaning: 'Tags are not sent by a plain git push. You push them by name.' },
      ],
    };
  },
};

/* =====================================================================
   4. Release
   ===================================================================== */

const ghRelease = {
  id: 'release',
  label: 'Release',
  ready: true,
  title: 'Release on a version tag',
  intro: 'Push a tag such as v1.2.0 and GitHub makes a Release page for it, with automatic notes listing what changed. It can attach a build file too.',

  groups: [
    {
      legend: 'The release',
      fields: [
        { id: 'wfName', type: 'text', label: 'Workflow name', hint: 'Letters, digits, spaces and . _ ( ) -', default: 'Release' },
        { id: 'tagPattern', type: 'text', label: 'Which tags count as releases?', hint: 'A pattern. v* means "starts with v". Letters, digits, dots, hyphens and * only.', default: 'v*' },
        { id: 'draft', type: 'check', label: 'Save as a draft so I can read it before it goes public', default: false },
        { id: 'pre', type: 'check', label: 'Mark tags with a dash (v1.0.0-rc1) as pre-releases', default: true },
      ],
    },
    {
      legend: 'A file to attach',
      optional: true,
      fields: [
        { id: 'attach', type: 'check', label: 'Build something and attach it to the release', default: false },
        { id: 'buildCmd', type: 'text', label: 'Build command', hint: 'The command that makes the file. No $ sign.', default: 'npm run build', showIf: { field: 'attach', in: [true] } },
        { id: 'assets', type: 'text', label: 'Files to attach', hint: 'A path or pattern inside the project, such as dist/*. Letters, digits and . _ / - * only.', default: 'dist/*', showIf: { field: 'attach', in: [true] } },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!GH_NAME_RE.test(v.wfName.trim())) e.wfName = 'Use 1 to 40 characters: letters, digits, spaces and . _ ( ) -. Start with a letter or digit.';
    if (!GH_TAG_RE.test(v.tagPattern.trim())) e.tagPattern = 'Use letters, digits, dots, hyphens and * only, up to 20 characters. For example v*.';
    if (v.attach) {
      if (!GH_CMD_RE.test(v.buildCmd.trim())) e.buildCmd = 'Use letters, digits, spaces and . _ / : = @ % + , ~ & | < > * " \' - only. No $ sign.';
      const a = v.assets.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._\/*-]{0,79}$/.test(a) || !noDotDot(a)) e.assets = 'Write a path or pattern such as dist/*. Letters, digits and . _ / - * only, no ..';
    }
    return e;
  },

  build(v) {
    const { lines, add } = ghYaml();
    add('# Makes a GitHub Release when you push a version tag. Save as .github/workflows/release.yml', 'Lines starting with # are comments.');
    add(`name: ${v.wfName.trim()}`);
    add('');
    add('on:');
    add('  push:');
    add(`    tags: [${dq(v.tagPattern.trim())}]`, 'Runs only when a tag matching this pattern is pushed. Ordinary pushes do nothing.');
    add('');
    add('permissions:', 'What the built-in GITHUB_TOKEN may do.');
    add('  contents: write', 'Creating a release needs write access to the repository’s contents. It is set here, for this workflow only.');
    add('');
    add('jobs:');
    add('  release:');
    add('    runs-on: ubuntu-latest');
    add('    timeout-minutes: 15');
    add('    steps:');
    add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine.');
    if (v.attach) {
      add('      - name: Build', 'Makes the file to attach.');
      ghRun(add, '        ', v.buildCmd.trim(), 'Your build command.');
    }
    add('      - name: Create the release');
    add('        env:', 'Values the command below reads as shell variables.');
    add('          GH_TOKEN: ${{ github.token }}', 'The built-in token. The gh command reads GH_TOKEN to sign in.');
    add('          TAG: ${{ github.ref_name }}', 'The tag that started the run. It goes into a variable first, never straight into the command, so a strange tag name cannot run code.');
    add('        run: |', 'A block of shell lines.');
    const parts = ['gh release create "$TAG"'];
    if (v.attach) parts.push(v.assets.trim());
    parts.push('--generate-notes');
    if (v.draft) parts.push('--draft');
    if (v.pre) {
      add('          PRE=""', 'An empty extra flag by default.');
      add('          case "$TAG" in *-*) PRE="--prerelease" ;; esac', 'If the tag contains a dash, such as v1.0.0-rc1, mark the release as a pre-release.');
      parts.push('$PRE');
    }
    add(`          ${parts.join(' ')}`, v.attach ? 'Creates the release, writes notes from the merged pull requests and commits, and attaches your files.' : 'Creates the release and writes notes from the merged pull requests and commits.');
    return [{ path: '.github/workflows/release.yml', label: 'release.yml', lines }];
  },

  zipName: () => 'github-actions-release.zip',

  run() {
    return {
      where: GH_WHERE + ' To make a release, create a tag and push it (commands below). Then open Releases on your repository page (GUI) to read it.',
      commands: [
        ...ghCommands('release.yml', 'Add release workflow'),
        { cmd: 'git tag v1.0.0', what: 'Label the current commit as version 1.0.0.' },
        { cmd: 'git push origin v1.0.0', what: 'Send the tag to GitHub. That starts the workflow.' },
      ],
      flags: [
        ...GH_GIT_FLAGS,
        { flag: 'git tag v1.0.0', meaning: 'Names this commit. Tags that match your pattern start the workflow.' },
        { flag: 'git push origin <tag>', meaning: 'Tags are not sent by a plain git push. You push them by name.' },
        { flag: 'gh release create', meaning: 'The GitHub command-line tool. Already installed on GitHub’s machines.' },
        { flag: '--generate-notes', meaning: 'Write the release notes from the pull requests and commits since the last release.' },
      ],
    };
  },
};

/* =====================================================================
   5. Deploy
   ===================================================================== */

const ghDeploy = {
  id: 'deploy',
  label: 'Deploy',
  ready: true,
  title: 'Deploy from main',
  intro: 'Publish a static site to GitHub Pages, or log in to your own server over SSH and run a command there. Both run only from the main branch, and can wait for a person to approve.',

  groups: [
    {
      legend: 'Where it goes',
      fields: [
        { id: 'wfName', type: 'text', label: 'Workflow name', hint: 'Letters, digits, spaces and . _ ( ) -', default: 'Deploy' },
        {
          id: 'target',
          type: 'select',
          label: 'Deploy to',
          options: [
            ['pages', 'GitHub Pages (a static website, free)'],
            ['ssh', 'My own server over SSH'],
          ],
          default: 'pages',
        },
        { id: 'branch', type: 'text', label: 'Main branch', default: 'main', hint: 'Only pushes to this branch deploy.' },
      ],
    },
    {
      legend: 'GitHub Pages',
      fields: [
        { id: 'buildCmd', type: 'text', label: 'Build command (optional)', hint: 'Leave empty if your site needs no build. No $ sign.', default: '', showIf: { field: 'target', in: ['pages'] } },
        { id: 'siteDir', type: 'text', label: 'Folder that holds the finished site', hint: 'A path inside the project. A dot means the top of the project.', default: '.', showIf: { field: 'target', in: ['pages'] } },
      ],
    },
    {
      legend: 'Your server',
      fields: [
        { id: 'remoteCmd', type: 'text', label: 'Command to run on the server', hint: 'One command, such as bash /srv/app/deploy.sh. Letters, digits, spaces and . _ / = @ % + , ~ - only.', default: 'bash /srv/app/deploy.sh', showIf: { field: 'target', in: ['ssh'] } },
      ],
    },
    {
      legend: 'Safety',
      optional: true,
      fields: [
        { id: 'approve', type: 'check', label: 'Wait for a person to approve (environment)', default: true, hint: 'Uses a GitHub "environment". You add the approvers on github.com (GUI).' },
        { id: 'envName', type: 'text', label: 'Environment name', hint: 'Letters, digits and hyphens.', default: 'production', showIf: { field: 'approve', in: [true] } },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!GH_NAME_RE.test(v.wfName.trim())) e.wfName = 'Use 1 to 40 characters: letters, digits, spaces and . _ ( ) -. Start with a letter or digit.';
    if (!GH_BRANCH_RE.test(v.branch.trim())) e.branch = 'Use letters, digits and . _ / - only. For example main.';
    if (v.target === 'pages') {
      if (v.buildCmd.trim() && !GH_CMD_RE.test(v.buildCmd.trim())) e.buildCmd = 'Use letters, digits, spaces and . _ / : = @ % + , ~ & | < > * " \' - only. No $ sign.';
      const d = v.siteDir.trim();
      if (d !== '.' && !pathOk(d)) e.siteDir = 'Write . or a folder such as dist. Letters, digits and . _ / - only, no .. and no leading slash.';
    } else if (!GH_REMOTE_RE.test(v.remoteCmd.trim())) e.remoteCmd = 'Use letters, digits, spaces and . _ / = @ % + , ~ - only, up to 100 characters.';
    if (v.approve && !/^[A-Za-z0-9][A-Za-z0-9-]{0,29}$/.test(v.envName.trim())) e.envName = 'Use letters, digits and hyphens, up to 30 characters.';
    return e;
  },

  build(v) {
    const branch = v.branch.trim();
    const env = v.envName.trim();
    const { lines, add } = ghYaml();
    if (v.target === 'pages') {
      add('# Publishes a static site to GitHub Pages. Save as .github/workflows/deploy.yml', 'Lines starting with # are comments.');
      add(`name: ${v.wfName.trim()}`);
      add('');
      add('on:');
      add('  push:');
      add(`    branches: [${branch}]`, 'Only pushes to the main branch deploy.');
      add('  workflow_dispatch:', 'Also lets you deploy by hand from the Actions tab.');
      add('');
      add('permissions:', 'What the built-in GITHUB_TOKEN may do.');
      add('  contents: read', 'Read the code.');
      add('  pages: write', 'Needed to publish to GitHub Pages.');
      add('  id-token: write', 'Lets the deploy step prove to GitHub that this run is really yours. No password involved.');
      add('');
      add('concurrency:');
      add('  group: pages', 'Only one deploy at a time.');
      add('  cancel-in-progress: false', 'Never cancel a deploy that is half done. The next one waits.');
      add('');
      add('jobs:');
      add('  build:', 'Prepares the site files.');
      add('    runs-on: ubuntu-latest');
      add('    steps:');
      add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine.');
      add(`      - uses: ${GHA_ACTIONS.pagesConfig}`, 'Reads the Pages settings of your repository.');
      if (v.buildCmd.trim()) {
        add('      - name: Build the site');
        ghRun(add, '        ', v.buildCmd.trim(), 'Your build command.');
      }
      add(`      - uses: ${GHA_ACTIONS.pagesUpload}`, 'Packs the folder into a file that the deploy job publishes.');
      add('        with:');
      add(`          path: ${v.siteDir.trim()}`, 'The folder that holds the finished site.');
      add('');
      add('  deploy:', 'Publishes what the build job packed.');
      add('    needs: build', 'Waits for the build job. If the build fails, this never runs.');
      add('    runs-on: ubuntu-latest');
      add('    environment:', 'Pages deploys always use an environment.');
      add('      name: github-pages', 'The name GitHub Pages expects.');
      add('      url: ${{ steps.deployment.outputs.page_url }}', 'Shows the live address on the run page.');
      add('    steps:');
      add(`      - id: deployment`, 'An ID so the url above can read this step’s result.');
      add(`        uses: ${GHA_ACTIONS.pagesDeploy}`, 'Publishes the site.');
    } else {
      add('# Logs in to your server over SSH and runs one command. Save as .github/workflows/deploy.yml', 'Lines starting with # are comments.');
      add(`name: ${v.wfName.trim()}`);
      add('');
      add('on:');
      add('  push:');
      add(`    branches: [${branch}]`, 'Only pushes to the main branch deploy.');
      add('  workflow_dispatch:', 'Also lets you deploy by hand from the Actions tab.');
      add('');
      add('permissions:');
      add('  contents: read', 'This workflow only reads the code. The server login uses your secrets, not this token.');
      add('');
      add('concurrency:');
      add('  group: deploy', 'Only one deploy at a time.');
      add('  cancel-in-progress: false', 'Never cancel a deploy that is half done.');
      add('');
      add('jobs:');
      add('  deploy:');
      add('    runs-on: ubuntu-latest');
      add('    timeout-minutes: 15');
      if (v.approve) {
        add(`    environment: ${env}`, 'A job that uses this environment waits until a required reviewer approves it, and can use secrets saved on the environment.');
      }
      add('    steps:');
      add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine. Handy if the deploy command needs files.');
      add('      - name: Deploy over SSH');
      add('        env:', 'Secrets are put in environment variables, never typed into the commands.');
      add('          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}', 'The server’s address, from a secret.');
      add('          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}', 'The user to log in as, from a secret.');
      add('          DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}', 'The PRIVATE SSH key, from a secret. Make a key used only for deploys.');
      add('          DEPLOY_KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}', 'The server’s public fingerprint, from a secret. It proves you are talking to your server and not someone else.');
      add(`          REMOTE_CMD: ${dq(v.remoteCmd.trim())}`, 'The command that runs on the server.');
      add('        run: |', 'A block of shell lines.');
      add('          mkdir -p ~/.ssh', 'Makes the folder where ssh looks for keys.');
      add('          printf "%s\\n" "$DEPLOY_KEY" > ~/.ssh/id_ed25519', 'Writes the key to a file, only on this temporary machine.');
      add('          chmod 600 ~/.ssh/id_ed25519', 'ssh refuses a key that other users could read. 600 means only the owner can.');
      add('          printf "%s\\n" "$DEPLOY_KNOWN_HOSTS" > ~/.ssh/known_hosts', 'Tells ssh which server fingerprint to trust.');
      add('          ssh "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_CMD"', 'Logs in and runs your command. $REMOTE_CMD is filled in here, on GitHub’s machine, and the finished text is sent to your server. There is no "StrictHostKeyChecking=no": that setting would switch off the protection above.');
    }
    return [{ path: '.github/workflows/deploy.yml', label: 'deploy.yml', lines }];
  },

  zipName: () => 'github-actions-deploy.zip',

  run(v) {
    const pages = v.target === 'pages';
    return {
      where:
        GH_WHERE +
        (pages
          ? ' One setting first, on github.com (GUI): Settings, Pages, then under Build and deployment choose Source: GitHub Actions. Without it the deploy step fails. Your site appears at https://YOUR-NAME.github.io/REPOSITORY/.'
          : ' Before the first run, add four secrets on github.com (GUI): DEPLOY_HOST, DEPLOY_USER, DEPLOY_KEY and DEPLOY_KNOWN_HOSTS. Make the key on your laptop (terminal) with: ssh-keygen -t ed25519 -f deploy_key -N "" . Put deploy_key.pub into ~/.ssh/authorized_keys on the server (SSH). Paste the whole deploy_key file into the DEPLOY_KEY secret, then delete both key files from your laptop. For DEPLOY_KNOWN_HOSTS, run ssh-keyscan -t ed25519 YOUR-SERVER (terminal) and paste the line it prints.') +
        (v.approve && !pages ? ' For the approval step: Settings, Environments, New environment, then add yourself under Required reviewers (GUI).' : ''),
      commands: ghCommands('deploy.yml', 'Add deploy workflow'),
      flags: [
        ...GH_GIT_FLAGS,
        ...(pages
          ? [{ flag: 'Settings > Pages > Source: GitHub Actions', meaning: 'Tells GitHub that a workflow, not a branch, publishes the site.' }]
          : [
              ...GH_SECRET_FLAGS,
              { flag: 'ssh-keygen -t ed25519 -f deploy_key -N ""', meaning: 'Makes a key pair. -t is the type, -f the file name, -N "" gives it no passphrase (a CI machine cannot type one).' },
              { flag: 'ssh-keyscan -t ed25519 HOST', meaning: 'Asks the server for its public fingerprint. Check it matches your server before you save it.' },
            ]),
        ...(v.approve ? [{ flag: 'Settings > Environments', meaning: 'Where you add required reviewers. A job that uses the environment waits for them.' }] : []),
      ],
    };
  },
};

/* =====================================================================
   6. Scheduled and manual job
   ===================================================================== */

const GH_CRONS = [
  ['0 2 * * *', 'Every night at 02:00'],
  ['0 3 * * 1', 'Every Monday at 03:00'],
  ['0 * * * *', 'Every hour'],
  ['0 4 1 * *', 'On the 1st of each month at 04:00'],
];

const ghSchedule = {
  id: 'schedule',
  label: 'Scheduled job',
  ready: true,
  title: 'Scheduled and manual job',
  intro: 'Run something on a timer, such as a nightly security audit or a check that your website is up. You can also start it by hand from the Actions tab.',

  groups: [
    {
      legend: 'The job',
      fields: [
        { id: 'wfName', type: 'text', label: 'Workflow name', hint: 'Letters, digits, spaces and . _ ( ) -', default: 'Nightly check' },
        {
          id: 'kind',
          type: 'select',
          label: 'What should it do?',
          options: [
            ['health', 'Check that a website answers'],
            ['npm', 'Audit npm packages for known vulnerabilities'],
            ['pip', 'Audit Python packages for known vulnerabilities'],
            ['custom', 'Run my own command'],
          ],
          default: 'health',
        },
        { id: 'url', type: 'text', label: 'Website address', hint: 'Such as https://example.com/health. Letters, digits, dots, hyphens and a path.', default: 'https://example.com', showIf: { field: 'kind', in: ['health'] } },
        { id: 'level', type: 'select', label: 'Fail only for problems at least this serious', options: [['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High'], ['critical', 'Critical']], default: 'high', showIf: { field: 'kind', in: ['npm'] } },
        { id: 'custom', type: 'text', label: 'Command', hint: 'One command. No $ sign.', default: 'bash scripts/check.sh', showIf: { field: 'kind', in: ['custom'] } },
      ],
    },
    {
      legend: 'When',
      fields: [
        { id: 'cron', type: 'select', label: 'Run', options: GH_CRONS, default: '0 2 * * *', hint: 'GitHub uses UTC. India is UTC+5:30, so 02:00 UTC is 07:30 here.' },
        { id: 'manual', type: 'check', label: 'Also add a Run workflow button', default: true },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!GH_NAME_RE.test(v.wfName.trim())) e.wfName = 'Use 1 to 40 characters: letters, digits, spaces and . _ ( ) -. Start with a letter or digit.';
    if (v.kind === 'health' && !GH_URL_RE.test(v.url.trim())) e.url = 'Write an address such as https://example.com or https://example.com/health. Letters, digits, dots, hyphens and a simple path only.';
    if (v.kind === 'custom' && !GH_CMD_RE.test(v.custom.trim())) e.custom = 'Use letters, digits, spaces and . _ / : = @ % + , ~ & | < > * " \' - only. No $ sign.';
    return e;
  },

  build(v) {
    const { lines, add } = ghYaml();
    add('# Runs on a timer. Save as .github/workflows/scheduled.yml', 'Lines starting with # are comments.');
    add(`name: ${v.wfName.trim()}`);
    add('');
    add('on:');
    add('  schedule:', 'Run at set times.');
    add(`    - cron: ${dq(v.cron)}`, 'Five fields: minute, hour, day of month, month, day of week. Times are UTC. GitHub may start it a few minutes late when it is busy.');
    if (v.manual) add('  workflow_dispatch:', 'A "Run workflow" button on the Actions tab, so you can test it without waiting.');
    add('');
    add('permissions:');
    add('  contents: read', 'Read-only. This job never changes your repository.');
    add('');
    add('jobs:');
    add('  check:');
    add('    runs-on: ubuntu-latest');
    add('    timeout-minutes: 10');
    add('    steps:');
    if (v.kind === 'health') {
      add('      - name: Check the website', 'No code is needed, so there is no checkout step.');
      add('        run: |');
      add(`          curl --fail --silent --show-error --max-time 20 ${dq(v.url.trim())} > /dev/null`, 'Fetches the page. --fail turns an error page (404, 500) into a failed step. --max-time 20 gives up after 20 seconds.');
    } else if (v.kind === 'npm') {
      add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine.');
      add(`      - uses: ${GHA_ACTIONS.setupNode}`);
      add('        with:');
      add('          node-version: "22"');
      add('      - name: Audit packages');
      add(`        run: npm audit --audit-level=${v.level}`, 'Checks the packages in package-lock.json against a list of known vulnerabilities. It fails only for problems at this level or worse.');
    } else if (v.kind === 'pip') {
      add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine.');
      add(`      - uses: ${GHA_ACTIONS.setupPython}`);
      add('        with:');
      add('          python-version: "3.13"');
      add('      - name: Audit packages');
      add('        run: |');
      add('          pip install pip-audit', 'Installs the audit tool.');
      add('          pip-audit -r requirements.txt', 'Checks every package in requirements.txt against a list of known vulnerabilities.');
    } else {
      add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine.');
      add('      - name: Run the command');
      ghRun(add, '        ', v.custom.trim(), 'Your command. If it fails, the run is marked failed and GitHub emails you.');
    }
    return [{ path: '.github/workflows/scheduled.yml', label: 'scheduled.yml', lines }];
  },

  zipName: () => 'github-actions-scheduled.zip',

  run() {
    return {
      where:
        GH_WHERE +
        ' Two things to know: a schedule runs only from the default branch, and GitHub switches off scheduled workflows in a public repository after 60 days with no activity. When a scheduled run fails, GitHub emails the person who last changed the schedule.',
      commands: ghCommands('scheduled.yml', 'Add scheduled workflow'),
      flags: [
        ...GH_GIT_FLAGS,
        { flag: 'cron: "0 2 * * *"', meaning: 'minute hour day-of-month month day-of-week. A * means every. So this is minute 0 of hour 2, every day.' },
        { flag: 'Run workflow (button)', meaning: 'Starts the workflow now. It appears on the workflow’s page in the Actions tab when workflow_dispatch is set.' },
      ],
    };
  },
};

/* =====================================================================
   7. Security: CodeQL + Dependabot
   ===================================================================== */

const GH_CODEQL = [
  ['javascript-typescript', 'none'],
  ['python', 'none'],
  ['java-kotlin', 'none'],
  ['go', 'autobuild'],
  ['actions', 'none'],
];

const GH_DEP = [
  ['npm', '/', 'npm packages (package.json)'],
  ['pip', '/', 'Python packages (requirements.txt)'],
  ['maven', '/', 'Java packages (pom.xml)'],
  ['gomod', '/', 'Go modules (go.mod)'],
  ['docker', '/', 'Base images in your Dockerfile'],
  ['github-actions', '/', 'The actions in your workflow files'],
];

const ghSecurity = {
  id: 'security',
  label: 'Security scan',
  ready: true,
  title: 'Security: CodeQL and Dependabot',
  intro: 'Two files that watch your project for you. CodeQL reads your code for bugs that attackers use. Dependabot opens pull requests when a package or an action you use has a newer version.',

  groups: [
    {
      legend: 'CodeQL: scan the code',
      fields: [
        { id: 'branch', type: 'text', label: 'Main branch', default: 'main', hint: 'Pushes to it, and pull requests into it, are scanned.' },
        { id: 'cqJs', type: 'check', label: 'JavaScript and TypeScript', default: true },
        { id: 'cqPy', type: 'check', label: 'Python', default: false },
        { id: 'cqJava', type: 'check', label: 'Java and Kotlin', default: false },
        { id: 'cqGo', type: 'check', label: 'Go', default: false },
        { id: 'cqActions', type: 'check', label: 'Your own workflow files (finds risky patterns in Actions)', default: true },
        { id: 'weekly', type: 'check', label: 'Also scan once a week', default: true, hint: 'New kinds of bug are added to CodeQL over time, so old code can get new findings.' },
      ],
    },
    {
      legend: 'Dependabot: keep packages fresh',
      fields: [
        { id: 'dNpm', type: 'check', label: 'npm packages', default: false },
        { id: 'dPip', type: 'check', label: 'Python packages', default: false },
        { id: 'dMaven', type: 'check', label: 'Java (Maven) packages', default: false },
        { id: 'dGo', type: 'check', label: 'Go modules', default: false },
        { id: 'dDocker', type: 'check', label: 'Docker base images', default: false },
        { id: 'dActions', type: 'check', label: 'GitHub Actions versions', default: true, hint: 'Recommended. Action versions in your workflow files go out of date.' },
        {
          id: 'interval',
          type: 'select',
          label: 'How often to look for updates',
          options: [['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']],
          default: 'weekly',
        },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!GH_BRANCH_RE.test(v.branch.trim())) e.branch = 'Use letters, digits and . _ / - only. For example main.';
    if (!v.cqJs && !v.cqPy && !v.cqJava && !v.cqGo && !v.cqActions && !v.dNpm && !v.dPip && !v.dMaven && !v.dGo && !v.dDocker && !v.dActions) e.cqJs = 'Choose at least one thing to scan or to keep updated.';
    return e;
  },

  build(v) {
    const files = [];
    const langs = GH_CODEQL.filter(([l]) => ({ 'javascript-typescript': v.cqJs, python: v.cqPy, 'java-kotlin': v.cqJava, go: v.cqGo, actions: v.cqActions }[l]));
    const deps = GH_DEP.filter(([id]) => ({ npm: v.dNpm, pip: v.dPip, maven: v.dMaven, gomod: v.dGo, docker: v.dDocker, 'github-actions': v.dActions }[id]));
    const branch = v.branch.trim();

    if (langs.length) {
      const { lines, add } = ghYaml();
      add('# Scans your code with CodeQL. Save as .github/workflows/codeql.yml', 'Lines starting with # are comments.');
      add('name: CodeQL');
      add('');
      add('on:');
      add('  push:');
      add(`    branches: [${branch}]`, 'Scan every push to the main branch.');
      add('  pull_request:');
      add(`    branches: [${branch}]`, 'Scan pull requests, so problems are caught before merging.');
      if (v.weekly) {
        add('  schedule:');
        add('    - cron: "17 3 * * 1"', 'Every Monday at 03:17 UTC. An odd minute avoids the busy start of the hour.');
      }
      add('');
      add('permissions:', 'Kept minimal. Each line is needed.');
      add('  contents: read', 'Read the code.');
      add('  actions: read', 'Lets CodeQL read this workflow’s run details.');
      add('  security-events: write', 'Lets CodeQL put its findings in the Security tab.');
      add('');
      add('jobs:');
      add('  analyze:');
      add('    runs-on: ubuntu-latest');
      add('    timeout-minutes: 30');
      add('    strategy:');
      add('      fail-fast: false', 'If one language fails, the others still finish.');
      add('      matrix:', 'One job per language.');
      add('        include:');
      for (const [l, mode] of langs) {
        add(`          - language: ${l}`, l === 'actions' ? 'Scans your workflow files for risky patterns.' : `Scan ${l} code.`);
        add(`            build-mode: ${mode}`, mode === 'none' ? 'This language needs no build, so CodeQL reads the source.' : 'Go is compiled, so CodeQL watches an automatic build.');
      }
      add('    steps:');
      add(`      - uses: ${GHA_ACTIONS.checkout}`, 'Copies your repository onto the machine.');
      add(`      - uses: ${GHA_ACTIONS.codeqlInit}`, 'Sets up CodeQL for one language.');
      add('        with:');
      add('          languages: ${{ matrix.language }}', 'This job’s language.');
      add('          build-mode: ${{ matrix.build-mode }}', 'How CodeQL gets to know the code.');
      add(`      - uses: ${GHA_ACTIONS.codeqlRun}`, 'Runs the scan and uploads the findings.');
      add('        with:');
      add('          category: "/language:${{ matrix.language }}"', 'Keeps each language’s findings separate in the Security tab.');
      files.push({ path: '.github/workflows/codeql.yml', label: 'codeql.yml', lines });
    }

    if (deps.length) {
      const { lines, add } = ghYaml();
      add('# Tells Dependabot what to keep updated. Save as .github/dependabot.yml', 'Lines starting with # are comments. This file goes in .github, not in workflows.');
      add('version: 2', 'The file format version. Always 2.');
      add('updates:', 'One entry for each thing to watch.');
      for (const [id, dir, what] of deps) {
        add(`  - package-ecosystem: ${dir === '/' ? id : id}`, `Watch ${what}.`);
        add(`    directory: "${dir}"`, 'Where the package file is. / means the top of the project.');
        add('    schedule:');
        add(`      interval: ${v.interval}`, 'How often Dependabot looks for newer versions.');
        add('    open-pull-requests-limit: 5', 'No more than 5 open update pull requests at once, so your list does not flood.');
        if (id === 'github-actions') add('    groups:', 'Combine updates into fewer pull requests.');
        if (id === 'github-actions') {
          add('      actions:');
          add('        patterns: ["*"]', 'All action updates arrive in one pull request.');
        }
      }
      files.push({ path: '.github/dependabot.yml', label: 'dependabot.yml', lines });
    }
    return files;
  },

  zipName: () => 'github-actions-security.zip',

  run(v) {
    return {
      where:
        GH_WHERE +
        ' Dependabot reads .github/dependabot.yml, and CodeQL reads .github/workflows/codeql.yml. After the first push, look under the Security tab on github.com (GUI) for findings, and the Pull requests tab for Dependabot’s updates. CodeQL is free for public repositories. Private ones need GitHub Code Security.',
      commands: [
        { cmd: 'mkdir -p .github/workflows', what: 'Make the folder GitHub looks in.' },
        { cmd: 'git add .github', what: 'Add everything inside .github to the next commit: both files.' },
        { cmd: 'git commit -m "Add CodeQL and Dependabot"', what: 'Save the files in your project’s history.' },
        { cmd: 'git push', what: 'Send the commit to GitHub.' },
      ],
      flags: [
        ...GH_GIT_FLAGS,
        { flag: 'Security tab', meaning: 'On your repository page. Lists what CodeQL found, and Dependabot alerts.' },
        { flag: 'package-ecosystem', meaning: 'Which kind of package Dependabot watches: npm, pip, maven, gomod, docker or github-actions.' },
      ],
    };
  },
};

const GITHUB_ACTIONS_TOOLS = [ghCI, ghMatrix, ghDocker, ghRelease, ghDeploy, ghSchedule, ghSecurity];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { GITHUB_ACTIONS_TOOLS, GHA_ACTIONS };

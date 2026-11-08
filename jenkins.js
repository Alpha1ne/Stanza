'use strict';

/*
  jenkins.js — the Jenkins generators.

  A Jenkinsfile is a Groovy script that tells Jenkins how to build a project.
  These tools write *declarative* pipelines, the beginner-friendly style:
  a fixed outline (pipeline > stages > stage > steps) filled in with steps.

  Same tool shape as terraform.js: groups of fields, validate(v), build(v)
  returning files with a note per line, and run(v).

  Safety: anything typed into a form lands inside a Groovy 'single quoted'
  string, so every pattern below rejects quotes, backslashes, $ and backticks.
  Secrets are never typed in. Passwords come from Jenkins credentials, and
  the shell (not Groovy) reads them, so they never appear in the log.
*/

/* ---------- Checks for anything that lands in a Groovy string ---------- */

const JK_NAME_RE = /^[A-Za-z][A-Za-z0-9 _.-]{0,38}[A-Za-z0-9]$/; // project name
const JK_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/; // agent label
const JK_CRED_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/; // Jenkins credentials ID
const JK_CMD_RE = /^[A-Za-z0-9][A-Za-z0-9 ._:\/=@+,&|>()-]{0,119}$/; // one shell command
const JK_GLOB_RE = /^[A-Za-z0-9*._\/,-]{1,100}$/; // file patterns such as dist/** or target/*.jar
const JK_CRON_RE = /^[H0-9*\/,-]+( [H0-9*\/,-]+){4}$/; // five cron fields
const JK_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const JK_HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/; // server name or IP
const JK_REGISTRY_RE = /^[a-z0-9][a-z0-9.-]{0,100}(:\d{1,5})?$/;
const JK_IMAGE_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,3}$/;
const JK_USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const JK_PATH_RE = /^\/[A-Za-z0-9._\/-]{1,100}$/; // an absolute path on the server
const JK_RELPATH_RE = /^[A-Za-z0-9._\/-]{1,60}$/; // a folder in the project

const JK_IMAGES = [
  ['node:22', 'Node.js 22 (node:22)'],
  ['python:3.12', 'Python 3.12 (python:3.12)'],
  ['maven:3.9-eclipse-temurin-21', 'Maven with Java 21'],
  ['gradle:8-jdk21', 'Gradle 8 with Java 21'],
  ['ubuntu:24.04', 'Plain Ubuntu 24.04'],
];

// What each kind of project runs. null means "skip that stage".
const JK_PRESETS = {
  node: {
    name: 'Node.js',
    install: 'npm ci',
    test: 'npm test',
    build: 'npm run build',
    junit: '',
    archive: 'dist/**',
    needs: 'Node.js and npm must be installed on the agent (or use the Docker option).',
  },
  python: {
    name: 'Python',
    install: 'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt',
    test: '.venv/bin/python -m pytest --junitxml=report.xml',
    build: null,
    junit: 'report.xml',
    archive: '',
    needs: 'Python 3 with the venv module must be installed on the agent (or use the Docker option). Your project needs a requirements.txt and pytest.',
  },
  maven: {
    name: 'Java with Maven',
    install: null,
    test: 'mvn -B -ntp test',
    build: 'mvn -B -ntp package -DskipTests',
    junit: '**/target/surefire-reports/*.xml',
    archive: 'target/*.jar',
    needs: 'Maven and a JDK must be installed on the agent (or use the Docker option).',
  },
  gradle: {
    name: 'Java with Gradle',
    install: null,
    test: './gradlew --no-daemon test',
    build: './gradlew --no-daemon build -x test',
    junit: '**/build/test-results/test/*.xml',
    archive: 'build/libs/*.jar',
    needs: 'A JDK must be installed on the agent (or use the Docker option). Your project needs the gradlew script committed.',
  },
  custom: { name: 'Your own commands', needs: 'Whatever your commands use must be installed on the agent.' },
};

/* ---------- Writing a Jenkinsfile ---------- */

function groovy() {
  const lines = [];
  const add = (t, n = null) => lines.push({ t, n });
  return { lines, add };
}

const q = (s) => `'${s}'`; // a Groovy single-quoted string (values are pre-checked)

/* ---------- Steps shown under every tool ---------- */

const JK_WHERE_GIT =
  'The Jenkinsfile lives in your project’s git repository, next to your code. Save the downloaded file in the top folder of the project, then use a terminal (your laptop, or a VM through its console or SSH) to commit it. Everything after that happens in the Jenkins web page (GUI).';

const JK_GIT_COMMANDS = [
  { cmd: 'git add Jenkinsfile', what: 'Tell git to include the new file in your next commit. The name must be exactly Jenkinsfile, with a capital J and no ending.' },
  { cmd: 'git commit -m "Add Jenkinsfile"', what: 'Save the file in your project’s history, with a short message saying why.' },
  { cmd: 'git push', what: 'Send the commit to your remote repository (GitHub, GitLab or similar) so Jenkins can read it.' },
];

const JK_GIT_FLAGS = [
  { flag: 'git add Jenkinsfile', meaning: 'Pick the file to be saved in the next commit.' },
  { flag: 'git commit -m "..."', meaning: '-m gives the commit message in quotes, so git does not open an editor.' },
  { flag: 'git push', meaning: 'Upload your commits to the remote repository.' },
];

const JK_UI_FLAGS = [
  { flag: 'New Item > Pipeline', meaning: 'In Jenkins, create a job of the Pipeline type. A job is one project that Jenkins builds.' },
  { flag: 'Definition: Pipeline script from SCM', meaning: 'Tell Jenkins to read the Jenkinsfile from your git repository, instead of typing the script into the web page.' },
  { flag: 'SCM: Git, Repository URL', meaning: 'Where your code lives, for example https://github.com/you/project.git. For a private repo, add a credential here.' },
  { flag: 'Branch Specifier: */main', meaning: 'Which branch to build. Change it if your main branch has another name.' },
  { flag: 'Script Path: Jenkinsfile', meaning: 'The file name Jenkins looks for. Leave it as Jenkinsfile.' },
  { flag: 'Build Now', meaning: 'Start a run by hand. When the job has parameters, the button is called Build with Parameters.' },
  { flag: 'Console Output', meaning: 'The live log of a run. This is where you read errors.' },
];

/* =====================================================================
   Tool 1: Pipeline (build and test)
   ===================================================================== */

const jkPipeline = {
  id: 'pipeline',
  label: 'Pipeline',
  ready: true,
  title: 'Build and test pipeline',
  intro: 'A Jenkinsfile that builds your project, runs its tests and keeps the results. It is a Groovy script that Jenkins reads from your repository.',

  groups: [
    {
      legend: 'Your project',
      fields: [
        {
          id: 'projectName',
          type: 'text',
          label: 'Project name',
          hint: 'Letters, digits, spaces, dots, hyphens and underscores. Shown in the log.',
          default: 'my-app',
        },
        {
          id: 'language',
          type: 'select',
          label: 'What kind of project is it?',
          options: [
            ['node', 'Node.js (npm)'],
            ['python', 'Python (pip and pytest)'],
            ['maven', 'Java with Maven'],
            ['gradle', 'Java with Gradle'],
            ['custom', 'Something else: I will type the commands'],
          ],
          default: 'node',
          hint: 'This picks the standard commands for that kind of project.',
        },
      ],
    },
    {
      legend: 'Your own commands',
      fields: [
        {
          id: 'installCmd',
          type: 'text',
          label: 'Install command',
          hint: 'One command, such as: make deps. Leave empty to skip this stage.',
          default: '',
          showIf: { field: 'language', in: ['custom'] },
        },
        {
          id: 'testCmd',
          type: 'text',
          label: 'Test command',
          hint: 'One command, such as: make test. Leave empty to skip.',
          default: 'make test',
          showIf: { field: 'language', in: ['custom'] },
        },
        {
          id: 'buildCmd',
          type: 'text',
          label: 'Build command',
          hint: 'One command, such as: make build. Leave empty to skip.',
          default: 'make build',
          showIf: { field: 'language', in: ['custom'] },
        },
        {
          id: 'customJunit',
          type: 'text',
          label: 'Test report files (JUnit XML)',
          hint: 'Optional. A file pattern such as reports/*.xml. Jenkins shows these as a test chart.',
          default: '',
          showIf: { field: 'language', in: ['custom'] },
        },
        {
          id: 'customArchive',
          type: 'text',
          label: 'Files to keep after the build',
          hint: 'Optional. A file pattern such as build/*.zip.',
          default: '',
          showIf: { field: 'language', in: ['custom'] },
        },
      ],
    },
    {
      legend: 'Where it runs',
      fields: [
        {
          id: 'agentType',
          type: 'select',
          label: 'Which machine runs the build?',
          options: [
            ['any', 'Any available machine'],
            ['label', 'A machine with a certain label'],
            ['docker', 'Inside a fresh Docker container'],
          ],
          default: 'any',
          hint: 'In Jenkins, a machine that runs builds is called an agent. A Docker container gives every run a clean start.',
        },
        {
          id: 'agentLabel',
          type: 'text',
          label: 'Label',
          hint: 'The label the agent was given in Jenkins, such as linux.',
          default: 'linux',
          showIf: { field: 'agentType', in: ['label'] },
        },
        {
          id: 'dockerImage',
          type: 'select',
          label: 'Docker image',
          options: JK_IMAGES,
          default: 'node:22',
          hint: 'Pick one that has your tools in it. The agent needs Docker and the Docker Pipeline plugin.',
          showIf: { field: 'agentType', in: ['docker'] },
        },
      ],
    },
    {
      legend: 'Stages to include',
      fields: [
        { id: 'doInstall', type: 'check', label: 'Install dependencies', default: true, hint: 'Skipped for Maven and Gradle, which fetch them while building.' },
        { id: 'doTest', type: 'check', label: 'Run the tests', default: true },
        { id: 'skipBox', type: 'check', label: 'Add a tick box to skip the tests', default: false, hint: 'Adds a RUN_TESTS option to the Build with Parameters page.', showIf: { field: 'doTest', in: [true] } },
        { id: 'doBuild', type: 'check', label: 'Build the project', default: true },
        { id: 'doArchive', type: 'check', label: 'Keep the built files', default: true, hint: 'Saves them on the Jenkins page of each run, so you can download them later.' },
      ],
    },
    {
      legend: 'When it runs',
      fields: [
        {
          id: 'trigger',
          type: 'select',
          label: 'Start automatically?',
          options: [
            ['none', 'No, I will click Build Now'],
            ['poll', 'Check the repository for changes'],
            ['cron', 'On a schedule'],
          ],
          default: 'none',
        },
        {
          id: 'schedule',
          type: 'text',
          label: 'Schedule (five cron fields)',
          hint: 'Minute, hour, day of month, month, day of week. H means "a spread-out minute". H/5 * * * * is about every five minutes. H 2 * * * is once a night.',
          default: 'H/5 * * * *',
          showIf: { field: 'trigger', in: ['poll', 'cron'] },
        },
      ],
    },
    {
      legend: 'Housekeeping',
      optional: true,
      fields: [
        { id: 'timeoutMin', type: 'text', label: 'Stop a run after how many minutes?', hint: 'A whole number from 1 to 720. A stuck build then cannot hold a machine forever.', default: '30' },
        { id: 'keepBuilds', type: 'text', label: 'Keep the last how many runs?', hint: 'A whole number from 1 to 500. Older ones are deleted to save disk space.', default: '10' },
        { id: 'timestamps', type: 'check', label: 'Put the time on every log line', default: true, hint: 'Needs the Timestamper plugin.' },
        { id: 'noParallel', type: 'check', label: 'Never run two builds at once', default: true },
        { id: 'cleanWs', type: 'check', label: 'Clean the workspace afterwards', default: true, hint: 'Deletes the downloaded files when the run ends. Needs the Workspace Cleanup plugin.' },
        { id: 'email', type: 'text', label: 'Email when a run fails', hint: 'Optional. Jenkins must have mail settings set up first.', default: '' },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!JK_NAME_RE.test(v.projectName.trim())) e.projectName = 'Use 2 to 40 characters: letters, digits, spaces, dots, hyphens and underscores. Start with a letter.';
    if (v.language === 'custom') {
      for (const [id, label] of [['installCmd', 'install'], ['testCmd', 'test'], ['buildCmd', 'build']]) {
        const t = v[id].trim();
        if (t && !JK_CMD_RE.test(t)) e[id] = `The ${label} command may use letters, digits, spaces and . _ : / = @ + , & | > ( ) -. Quotes, $ and backslashes are not allowed here. Put complicated commands in a script file instead.`;
      }
      if (!v.installCmd.trim() && !v.testCmd.trim() && !v.buildCmd.trim()) e.testCmd = 'Give at least one command, or the pipeline has nothing to run.';
      for (const [id, what] of [['customJunit', 'test report'], ['customArchive', 'file']]) {
        const t = v[id].trim();
        if (t && !JK_GLOB_RE.test(t)) e[id] = `A ${what} pattern may use letters, digits, * . _ / , and hyphens only.`;
      }
    }
    if (v.agentType === 'label' && !JK_LABEL_RE.test(v.agentLabel.trim())) e.agentLabel = 'Use letters, digits, dots, hyphens and underscores.';
    if (v.trigger !== 'none') {
      const s = v.schedule.trim();
      if (!JK_CRON_RE.test(s)) e.schedule = 'Write five fields separated by single spaces, using digits, *, H, / , and -. Example: H/5 * * * *';
    }
    const tm = v.timeoutMin.trim();
    if (!/^\d{1,3}$/.test(tm) || Number(tm) < 1 || Number(tm) > 720) e.timeoutMin = 'Enter a whole number from 1 to 720.';
    const kb = v.keepBuilds.trim();
    if (!/^\d{1,3}$/.test(kb) || Number(kb) < 1 || Number(kb) > 500) e.keepBuilds = 'Enter a whole number from 1 to 500.';
    if (v.email.trim() && !JK_EMAIL_RE.test(v.email.trim())) e.email = 'That does not look like an email address.';
    return e;
  },

  build(v) {
    const { lines, add } = groovy();
    const name = v.projectName.trim();
    const custom = v.language === 'custom';
    const p = JK_PRESETS[v.language];
    const cmds = custom
      ? { install: v.installCmd.trim() || null, test: v.testCmd.trim() || null, build: v.buildCmd.trim() || null, junit: v.customJunit.trim(), archive: v.customArchive.trim() }
      : p;

    const stages = [];
    if (v.doInstall && cmds.install) stages.push('install');
    if (v.doTest && cmds.test) stages.push('test');
    if (v.doBuild && cmds.build) stages.push('build');
    const archive = v.doArchive && cmds.archive ? cmds.archive : '';
    if (archive) stages.push('archive');

    add('// Jenkinsfile for ' + name, 'Two slashes start a comment, as in many languages. Jenkins ignores it. This file is Groovy, a language that runs on Java.');
    add('// Jenkins checks out your code by itself before the first stage runs.', 'You do not need a "checkout" step when the job reads this file from your repository.');
    add('');
    add('pipeline {', 'Every declarative pipeline is one big pipeline block. Jenkins reads the sections inside it from the top.');

    if (v.agentType === 'any') {
      add('    agent any', 'agent says where the build runs. "any" means the first free machine Jenkins has.');
    } else if (v.agentType === 'label') {
      add('    agent {', 'agent says where the build runs.');
      add(`        label ${q(v.agentLabel.trim())}`, 'Only machines given this label in Jenkins will take the job.');
      add('    }');
    } else {
      add('    agent {', 'agent says where the build runs.');
      add('        docker {', 'Run the build inside a Docker container. Jenkins starts it, runs your stages in it, and throws it away after. That gives every run a clean start.');
      add(`            image ${q(v.dockerImage)}`, 'The Docker image to start. It must already contain the tools your build needs.');
      add('        }');
      add('    }');
    }

    add('');
    add('    options {', 'Settings that apply to the whole pipeline.');
    add(`        timeout(time: ${v.timeoutMin.trim()}, unit: 'MINUTES')`, 'Stop the run if it takes longer than this. A hung build would otherwise hold a machine forever.');
    add(`        buildDiscarder(logRotator(numToKeepStr: ${q(v.keepBuilds.trim())}))`, 'Keep the records of only the last few runs and delete older ones, so the disk does not fill up.');
    if (v.timestamps) add('        timestamps()', 'Put the time in front of every line of the log. Needs the Timestamper plugin.');
    if (v.noParallel) add('        disableConcurrentBuilds()', 'If a run is already going, wait for it instead of starting a second one at the same time.');
    add('    }');

    if (v.trigger !== 'none') {
      add('');
      add('    triggers {', 'Ways a run can start without anyone clicking.');
      if (v.trigger === 'poll') {
        add(`        pollSCM(${q(v.schedule.trim())})`, 'Every so often, ask the repository "anything new?" and run only if there is. Simple, but a webhook from GitHub is quicker.');
      } else {
        add(`        cron(${q(v.schedule.trim())})`, 'Run at these times whether or not the code changed. The five fields are minute, hour, day of month, month, day of week. H spreads the start time so many jobs do not begin together.');
      }
      add('    }');
    }

    const hasParam = v.doTest && v.skipBox && cmds.test;
    if (hasParam) {
      add('');
      add('    parameters {', 'Questions Jenkins asks when someone clicks Build with Parameters.');
      add("        booleanParam(name: 'RUN_TESTS', defaultValue: true, description: 'Untick to skip the tests')", 'A tick box. It is ticked by default. Later, params.RUN_TESTS holds true or false.');
      add('    }');
    }

    add('');
    add('    environment {', 'Variables every step can read. In shell commands they are written $NAME.');
    add(`        APP_NAME = ${q(name)}`, 'A variable you can use in your own commands as $APP_NAME.');
    add("        CI = 'true'", 'Many tools check for CI=true and switch to quiet, non-interactive behaviour.');
    add('    }');

    add('');
    add('    stages {', 'The list of stages. Jenkins runs them one after another and stops at the first one that fails.');
    let firstStage = true;
    const stageHead = (title, note) => {
      add(`        stage(${q(title)}) {`, firstStage ? 'A stage is one named step in the pipeline. The name appears in the Jenkins page, so people can see where a run stopped.' : note);
      firstStage = false;
    };
    if (stages.includes('install')) {
      stageHead('Install', null);
      add('            steps {', 'The steps inside a stage are the actual work.');
      add(`                sh ${q(cmds.install)}`, 'sh runs a command in the Linux shell. If the command fails, the stage and the run fail.');
      add('            }');
      add('        }');
    }
    if (stages.includes('test')) {
      stageHead('Test', null);
      if (hasParam) {
        add('            when {', 'A condition. The stage runs only when it is true, and is shown as skipped otherwise.');
        add('                expression { return params.RUN_TESTS }', 'True when the RUN_TESTS box was ticked.');
        add('            }');
      }
      add('            steps {');
      add(`                sh ${q(cmds.test)}`, 'Run the tests. A failing test makes the command fail, which fails the run.');
      add('            }');
      add('        }');
    }
    if (stages.includes('build')) {
      stageHead('Build', null);
      add('            steps {');
      add(`                sh ${q(cmds.build)}`, 'Build the project.');
      add('            }');
      add('        }');
    }
    if (stages.includes('archive')) {
      stageHead('Archive', null);
      add('            steps {');
      add(`                archiveArtifacts artifacts: ${q(archive)}, fingerprint: true`, 'Save the files that match this pattern with the run, so you can download them from the Jenkins page. fingerprint lets Jenkins track where the files end up.');
      add('            }');
      add('        }');
    }
    if (!stages.length) {
      stageHead('Hello', null);
      lines[lines.length - 1].n = 'Every pipeline needs at least one stage. You turned all the stages off, so this one only prints a line.';
      add('            steps {');
      add("                echo 'Nothing to run yet'", 'echo prints a line in the log.');
      add('            }');
      add('        }');
    }
    add('    }');

    const junit = cmds.junit && v.doTest && cmds.test;
    const failMail = v.email.trim();
    add('');
    add('    post {', 'Runs after the stages, whether they passed or failed. Good for tidying up and for telling people.');
    add('        always {', 'Runs every time, in every case.');
    if (junit) {
      add(`            junit allowEmptyResults: true, testResults: ${q(cmds.junit)}`, 'Read the test report files and show the results as a chart in Jenkins. allowEmptyResults stops the run failing when no report exists, for example when the tests were skipped. It comes before cleanup, because cleanup deletes the files.');
    }
    if (v.cleanWs) {
      add('            cleanWs()', 'Delete the downloaded files from the machine. It saves disk space and stops one run leaking into the next. Needs the Workspace Cleanup plugin.');
    }
    if (!junit && !v.cleanWs) {
      add("            echo 'Run finished'", 'echo prints a line in the log.');
    }
    add('        }');
    add('        success {', 'Runs only when everything passed.');
    add(`            echo ${q(`${name} built successfully`)}`);
    add('        }');
    add('        failure {', 'Runs only when something failed.');
    add(`            echo ${q(`${name} failed. Read the Console Output`)}`);
    if (failMail) {
      add(`            mail to: ${q(failMail)}, subject: ${q(`Build failed: ${name}`)}, body: 'See the Jenkins page for the log.'`, 'Send an email. Jenkins needs mail (SMTP) settings under Manage Jenkins > System first, or this step errors.');
    }
    add('        }');
    add('    }');
    add('}');

    return [{ path: 'Jenkinsfile', label: 'Jenkinsfile', lines }];
  },

  zipName() {
    return 'jenkins-pipeline.zip';
  },

  run(v) {
    const p = JK_PRESETS[v.language];
    const plugins = ['Pipeline', 'Git'];
    if (v.agentType === 'docker') plugins.push('Docker Pipeline');
    if (v.timestamps) plugins.push('Timestamper');
    if (v.cleanWs) plugins.push('Workspace Cleanup');
    return {
      where:
        JK_WHERE_GIT +
        ` In Jenkins (GUI): New Item, name it, choose Pipeline, then under Pipeline pick "Pipeline script from SCM", set SCM to Git, paste your repository URL, and set Script Path to Jenkinsfile. Save, then click Build Now. Plugins used: ${plugins.join(', ')}. ${p.needs}`,
      commands: JK_GIT_COMMANDS,
      flags: [...JK_GIT_FLAGS, ...JK_UI_FLAGS],
    };
  },
};

/* =====================================================================
   Tool 2: Deploy pipeline (Docker image and SSH, with passwords kept safe)
   ===================================================================== */

const jkDeploy = {
  id: 'deploy',
  label: 'Deploy pipeline',
  ready: true,
  title: 'Deploy pipeline',
  intro: 'A Jenkinsfile that ships your project: it builds and pushes a Docker image, and/or copies files to a server over SSH. Passwords and keys come from Jenkins credentials, never from this file.',

  groups: [
    {
      legend: 'Your project',
      fields: [
        { id: 'projectName', type: 'text', label: 'Project name', hint: 'Letters, digits, spaces, dots, hyphens and underscores.', default: 'my-app' },
        {
          id: 'env',
          type: 'select',
          label: 'Ask which place to deploy to?',
          options: [
            ['none', 'No, always deploy'],
            ['choice', 'Yes: staging or production'],
          ],
          default: 'choice',
          hint: 'Adds a choice to the Build with Parameters page. A production deploy waits for a person to click Deploy.',
        },
      ],
    },
    {
      legend: 'Docker image',
      fields: [
        { id: 'doDocker', type: 'check', label: 'Build and push a Docker image', default: true, hint: 'The agent needs Docker. Your repository needs a Dockerfile in its top folder.' },
        { id: 'registry', type: 'text', label: 'Registry address', hint: 'Where images are stored. docker.io is Docker Hub. Other examples: ghcr.io, registry.example.com:5000.', default: 'docker.io', showIf: { field: 'doDocker', in: [true] } },
        { id: 'image', type: 'text', label: 'Image name', hint: 'Lowercase, for example myuser/my-app. Jenkins adds the run number as the tag.', default: 'myuser/my-app', showIf: { field: 'doDocker', in: [true] } },
        { id: 'registryCred', type: 'text', label: 'Credentials ID for the registry', hint: 'The ID of a "Username with password" credential you create in Jenkins. You choose the ID, for example dockerhub-creds.', default: 'dockerhub-creds', showIf: { field: 'doDocker', in: [true] } },
      ],
    },
    {
      legend: 'Copy to a server over SSH',
      fields: [
        { id: 'doSsh', type: 'check', label: 'Copy files to a server and restart it', default: false, hint: 'Needs the SSH Agent plugin.' },
        { id: 'sshHost', type: 'text', label: 'Server name or IP address', hint: 'For example 203.0.113.10 or app.example.com.', default: 'app.example.com', showIf: { field: 'doSsh', in: [true] } },
        { id: 'sshUser', type: 'text', label: 'User on the server', hint: 'Lowercase letters, digits, hyphens and underscores. Use a limited user, not root.', default: 'deploy', showIf: { field: 'doSsh', in: [true] } },
        { id: 'sshCred', type: 'text', label: 'Credentials ID for the SSH key', hint: 'The ID of an "SSH Username with private key" credential in Jenkins.', default: 'deploy-ssh-key', showIf: { field: 'doSsh', in: [true] } },
        { id: 'sshSource', type: 'text', label: 'Folder in your project to copy', hint: 'For example dist or build/output. Build it before this stage, or commit it.', default: 'dist', showIf: { field: 'doSsh', in: [true] } },
        { id: 'sshTarget', type: 'text', label: 'Folder on the server', hint: 'An absolute path such as /var/www/my-app.', default: '/var/www/my-app', showIf: { field: 'doSsh', in: [true] } },
        { id: 'sshRestart', type: 'text', label: 'Command to run on the server afterwards', hint: 'Optional. For example: sudo systemctl restart my-app. Leave empty to skip.', default: '', showIf: { field: 'doSsh', in: [true] } },
      ],
    },
    {
      legend: 'Housekeeping',
      optional: true,
      fields: [
        { id: 'timeoutMin', type: 'text', label: 'Stop a run after how many minutes?', hint: 'A whole number from 1 to 720.', default: '30' },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!JK_NAME_RE.test(v.projectName.trim())) e.projectName = 'Use 2 to 40 characters: letters, digits, spaces, dots, hyphens and underscores. Start with a letter.';
    if (!v.doDocker && !v.doSsh) e.doDocker = 'Choose at least one way to deploy: a Docker image, or copying over SSH.';
    if (v.doDocker) {
      if (!JK_REGISTRY_RE.test(v.registry.trim())) e.registry = 'Use a host name in lowercase, such as docker.io or ghcr.io, optionally with a port.';
      if (!JK_IMAGE_RE.test(v.image.trim())) e.image = 'Use lowercase letters, digits, dots, hyphens and underscores, with / between parts. Example: myuser/my-app';
      if (!JK_CRED_RE.test(v.registryCred.trim())) e.registryCred = 'Use letters, digits, dots, hyphens and underscores.';
    }
    if (v.doSsh) {
      if (!JK_HOST_RE.test(v.sshHost.trim())) e.sshHost = 'Use a server name or IP address: letters, digits, dots and hyphens.';
      if (!JK_USER_RE.test(v.sshUser.trim())) e.sshUser = 'Use lowercase letters, digits, hyphens and underscores.';
      else if (v.sshUser.trim() === 'root') e.sshUser = 'Do not deploy as root. Make a limited user on the server for this.';
      if (!JK_CRED_RE.test(v.sshCred.trim())) e.sshCred = 'Use letters, digits, dots, hyphens and underscores.';
      const src = v.sshSource.trim();
      if (!JK_RELPATH_RE.test(src) || src.startsWith('/') || src.includes('..')) e.sshSource = 'Write a folder inside your project, such as dist. No leading / and no ..';
      const tgt = v.sshTarget.trim();
      if (!JK_PATH_RE.test(tgt) || tgt.includes('..') || tgt === '/') e.sshTarget = 'Write an absolute path on the server, such as /var/www/my-app. No .. and not just /.';
      const rs = v.sshRestart.trim();
      if (rs && !JK_CMD_RE.test(rs)) e.sshRestart = 'Use letters, digits, spaces and . _ : / = @ + , & | > ( ) -. Quotes, $ and backslashes are not allowed.';
    }
    const tm = v.timeoutMin.trim();
    if (!/^\d{1,3}$/.test(tm) || Number(tm) < 1 || Number(tm) > 720) e.timeoutMin = 'Enter a whole number from 1 to 720.';
    return e;
  },

  build(v) {
    const { lines, add } = groovy();
    const name = v.projectName.trim();
    const useEnv = v.env === 'choice';
    const imageRef = `${v.registry.trim()}/${v.image.trim()}`;

    add('// Jenkinsfile that deploys ' + name, 'A comment. Jenkins ignores it. This file is Groovy, a language that runs on Java.');
    add('');
    add('pipeline {', 'Every declarative pipeline is one big pipeline block.');
    add('    agent any', 'Run on the first free machine. The stages that use Docker or SSH need those tools installed on that machine.');
    add('');
    add('    options {', 'Settings for the whole pipeline.');
    add(`        timeout(time: ${v.timeoutMin.trim()}, unit: 'MINUTES')`, 'Stop the run if it takes longer than this. Approval waits are timed separately, below.');
    add('        disableConcurrentBuilds()', 'Never run two deploys at the same time. Two deploys racing each other can leave a server half updated.');
    add('    }');

    if (useEnv) {
      add('');
      add('    parameters {', 'Questions Jenkins asks when someone clicks Build with Parameters.');
      add("        choice(name: 'DEPLOY_ENV', choices: ['staging', 'production'], description: 'Where to deploy')", 'A drop-down list. The first item is the default, so a hurried click goes to staging, not production.');
      add('    }');
    }

    if (v.doDocker) {
      add('');
      add('    environment {', 'Variables every step can read. In shell commands they are written $NAME.');
      add(`        IMAGE = ${q(imageRef)}`, 'The full image name: registry, then image. The run number is added as the tag when the image is built.');
      add('    }');
    }

    add('');
    add('    stages {', 'The list of stages, run one after another. The first failure stops the run.');

    if (v.doDocker) {
      add("        stage('Build image') {", 'A stage is one named step. The name shows in the Jenkins page.');
      add('            steps {');
      add('                sh \'docker build -t "$IMAGE:$BUILD_NUMBER" .\'', 'Build the image from the Dockerfile in this folder. -t names it. $BUILD_NUMBER is the run number Jenkins gives, so every run makes a different tag. Single quotes make the shell fill in $IMAGE, not Groovy.');
      add('            }');
      add('        }');
      add('');
      add("        stage('Push image') {");
      add('            steps {');
      add(`                withCredentials([usernamePassword(credentialsId: ${q(v.registryCred.trim())}, usernameVariable: 'REG_USER', passwordVariable: 'REG_PASS')]) {`, 'Borrow the username and password stored in Jenkins under this ID. They exist only inside these braces, as REG_USER and REG_PASS, and Jenkins hides them in the log.');
      add(`                    sh 'echo "$REG_PASS" | docker login ${v.registry.trim()} -u "$REG_USER" --password-stdin'`, 'Log in to the registry. The password is sent through a pipe (--password-stdin), so it never shows in a command line or process list.');
      add('                    sh \'docker push "$IMAGE:$BUILD_NUMBER"\'', 'Upload the image.');
      add('                }');
      add('            }');
      add('        }');
    }

    if (useEnv) {
      add('');
      add("        stage('Approve') {");
      add('            agent none', 'Wait for the answer without holding a build machine.');
      add('            when {', 'A condition. The stage runs only if it is true.');
      add("                expression { return params.DEPLOY_ENV == 'production' }", 'Ask only for production. Staging goes straight through.');
      add('            }');
      add('            steps {');
      add("                timeout(time: 1, unit: 'HOURS') {", 'If nobody answers within an hour, give up and fail the run, instead of waiting forever.');
      add("                    input message: 'Deploy to production?', ok: 'Deploy'", 'Pause and show a button in Jenkins. The run continues only when someone clicks Deploy. Abort stops it.');
      add('                }');
      add('            }');
      add('        }');
    }

    if (v.doSsh) {
      const where = `${v.sshUser.trim()}@${v.sshHost.trim()}`;
      add('');
      add("        stage('Deploy over SSH') {");
      add('            steps {');
      add(`                sshagent(credentials: [${q(v.sshCred.trim())}]) {`, 'Load the private key stored in Jenkins under this ID for the commands inside the braces. The key is never written into this file. Needs the SSH Agent plugin.');
      add(`                    sh 'scp -o StrictHostKeyChecking=accept-new -r ${v.sshSource.trim()}/. ${where}:${v.sshTarget.trim()}/'`, 'Copy the folder to the server. -r means include sub-folders. accept-new trusts a server the first time it is seen and then refuses if its key ever changes, which stops silent man-in-the-middle attacks later.');
      if (v.sshRestart.trim()) {
        add(`                    sh 'ssh -o StrictHostKeyChecking=accept-new ${where} "${v.sshRestart.trim()}"'`, 'Run one command on the server, such as restarting the app so it picks up the new files.');
      }
      add('                }');
      add('            }');
      add('        }');
    }
    add('    }');

    add('');
    add('    post {', 'Runs after the stages, pass or fail.');
    if (v.doDocker) {
      add('        always {', 'Runs every time.');
      add(`            sh 'docker logout ${v.registry.trim()} || true'`, 'Remove the saved registry login from the machine. || true means "do not fail the run if this fails".');
      add('        }');
    }
    add('        success {', 'Runs only when everything passed.');
    add(`            echo ${q(`${name} deployed`)}`);
    add('        }');
    add('        failure {', 'Runs only when something failed.');
    add("            echo 'Deploy failed. Read the Console Output'");
    add('        }');
    add('    }');
    add('}');

    return [{ path: 'Jenkinsfile', label: 'Jenkinsfile', lines }];
  },

  zipName() {
    return 'jenkins-deploy.zip';
  },

  run(v) {
    const plugins = ['Pipeline', 'Git', 'Credentials Binding'];
    if (v.doSsh) plugins.push('SSH Agent');
    const creds = [];
    if (v.doDocker) creds.push(`"${v.registryCred.trim()}" (Username with password)`);
    if (v.doSsh) creds.push(`"${v.sshCred.trim()}" (SSH Username with private key)`);
    return {
      where:
        JK_WHERE_GIT +
        ` First, in Jenkins (GUI): Manage Jenkins > Credentials > System > Global credentials > Add Credentials, and create ${creds.join(' and ')}. Use the exact IDs above. Then make a Pipeline job as in the Pipeline generator. Plugins used: ${plugins.join(', ')}. Never write a password or key into the Jenkinsfile.`,
      commands: JK_GIT_COMMANDS,
      flags: [
        ...JK_GIT_FLAGS,
        { flag: 'Manage Jenkins > Credentials', meaning: 'Where Jenkins stores passwords and keys safely. A job refers to one by its ID and never sees it typed in a file.' },
        ...JK_UI_FLAGS,
      ],
    };
  },
};

const JENKINS_TOOLS = [jkPipeline, jkDeploy];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') {
  module.exports = {
    JENKINS_TOOLS, JK_PRESETS, JK_NAME_RE, JK_LABEL_RE, JK_CRED_RE, JK_CMD_RE, JK_GLOB_RE, JK_EMAIL_RE, JK_HOST_RE,
    JK_IMAGES, JK_WHERE_GIT, JK_GIT_COMMANDS, JK_GIT_FLAGS, JK_UI_FLAGS, groovy, q,
  };
}

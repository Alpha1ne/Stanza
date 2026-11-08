'use strict';

/*
  jenkins-more.js — five more Jenkins generators.

  Multibranch pipeline, test matrix, shared library, Jenkins setup (Docker,
  plugins, Configuration as Code) and build-agent setup.

  Same rules as jenkins.js: every typed value is checked before it reaches a
  quoted string, and no password or key is ever typed into a generated file.
  Passwords live in a .env file that stays out of git.
*/

// In the browser jenkins.js has already run and these names are globals.
// In Node (tests) they are imported.
const JKX =
  typeof JK_PRESETS !== 'undefined'
    ? { JK_PRESETS, JK_NAME_RE, JK_LABEL_RE, JK_CRED_RE, JK_CMD_RE, JK_EMAIL_RE, JK_IMAGES, JK_WHERE_GIT, JK_GIT_COMMANDS, JK_GIT_FLAGS, JK_UI_FLAGS, groovy, q }
    : require('./jenkins.js');

const JK2_BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/;
const JK2_TAG_RE = /^[A-Za-z0-9._*-]{1,20}$/;
const JK2_URL_RE = /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]{0,100}(:\d{2,5})?\/?$/;
const JK2_ID_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const JK2_STEP_RE = /^[a-z][A-Za-z0-9]{2,29}$/;
const JK2_VAL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const JK2_PUBKEY_RE = /^ssh-(ed25519|rsa) [A-Za-z0-9+\/=]{40,800}( [A-Za-z0-9@._-]{1,60})?$/;
const JK2_PATH_RE = /^\/[A-Za-z0-9._\/-]{1,80}$/;
const JK2_MSG_RE = /^[A-Za-z0-9 .,:;!()\/_-]{0,100}$/;

const jk2Fields = (...ids) => ids; // readability only

function jk2Plain(lines, add) {
  return { lines, add };
}

/* =====================================================================
   Multibranch pipeline
   ===================================================================== */

const jkMultibranch = {
  id: 'multibranch',
  label: 'Multibranch pipeline',
  ready: true,
  title: 'Multibranch pipeline',
  intro: 'One Jenkinsfile that behaves differently by branch: tests on every branch and pull request, deploy only from main, and a release step for version tags. Jenkins finds the branches by itself.',

  groups: [
    {
      legend: 'Your project',
      fields: [
        { id: 'projectName', type: 'text', label: 'Project name', hint: 'Letters, digits, spaces, dots, hyphens and underscores.', default: 'my-app' },
        {
          id: 'language',
          type: 'select',
          label: 'What kind of project is it?',
          options: [
            ['node', 'Node.js (npm)'],
            ['python', 'Python (pip and pytest)'],
            ['maven', 'Java with Maven'],
            ['gradle', 'Java with Gradle'],
          ],
          default: 'node',
        },
        { id: 'mainBranch', type: 'text', label: 'Name of your main branch', hint: 'Usually main or master. Only this branch will deploy.', default: 'main' },
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
            ['docker', 'Inside a fresh Docker container'],
          ],
          default: 'any',
        },
        { id: 'dockerImage', type: 'select', label: 'Docker image', options: JKX.JK_IMAGES, default: 'node:22', hint: 'Pick one that has your tools in it.', showIf: { field: 'agentType', in: ['docker'] } },
      ],
    },
    {
      legend: 'What happens on which branch',
      fields: [
        { id: 'prNote', type: 'check', label: 'Print a note on pull requests', default: true, hint: 'Shows which pull request and which branch it is going into.' },
        { id: 'doDeploy', type: 'check', label: 'Deploy from the main branch', default: true },
        { id: 'deployCmd', type: 'text', label: 'Deploy command', hint: 'One command, such as bash deploy.sh. Leave empty to print a placeholder message.', default: 'bash deploy.sh', showIf: { field: 'doDeploy', in: [true] } },
        { id: 'approve', type: 'check', label: 'Ask a person before deploying', default: true, hint: 'The run waits for someone to click Deploy.', showIf: { field: 'doDeploy', in: [true] } },
        { id: 'doRelease', type: 'check', label: 'Keep the built files for version tags', default: true, hint: 'When you push a git tag such as v1.2.0, the build is archived as a release.' },
        { id: 'tagPattern', type: 'text', label: 'Which tags count as releases?', hint: 'A pattern. v* means "starts with v". Letters, digits, dots, hyphens and * only.', default: 'v*', showIf: { field: 'doRelease', in: [true] } },
      ],
    },
    {
      legend: 'Housekeeping',
      optional: true,
      fields: [
        { id: 'timeoutMin', type: 'text', label: 'Stop a run after how many minutes?', hint: 'A whole number from 1 to 720.', default: '30' },
        { id: 'keepBuilds', type: 'text', label: 'Keep the last how many runs per branch?', hint: 'A whole number from 1 to 500.', default: '10' },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!JKX.JK_NAME_RE.test(v.projectName.trim())) e.projectName = 'Use 2 to 40 characters: letters, digits, spaces, dots, hyphens and underscores. Start with a letter.';
    if (!JK2_BRANCH_RE.test(v.mainBranch.trim())) e.mainBranch = 'Use letters, digits, dots, hyphens, underscores and /. Example: main';
    if (v.doDeploy && v.deployCmd.trim() && !JKX.JK_CMD_RE.test(v.deployCmd.trim())) e.deployCmd = 'Use letters, digits, spaces and . _ : / = @ + , & | > ( ) -. Quotes, $ and backslashes are not allowed. Put a long command in a script file.';
    if (v.doRelease && !JK2_TAG_RE.test(v.tagPattern.trim())) e.tagPattern = 'Use letters, digits, dots, hyphens and *. Example: v*';
    const tm = v.timeoutMin.trim();
    if (!/^\d{1,3}$/.test(tm) || Number(tm) < 1 || Number(tm) > 720) e.timeoutMin = 'Enter a whole number from 1 to 720.';
    const kb = v.keepBuilds.trim();
    if (!/^\d{1,3}$/.test(kb) || Number(kb) < 1 || Number(kb) > 500) e.keepBuilds = 'Enter a whole number from 1 to 500.';
    return e;
  },

  build(v) {
    const { lines, add } = JKX.groovy();
    const q = JKX.q;
    const name = v.projectName.trim();
    const p = JKX.JK_PRESETS[v.language];
    const main = v.mainBranch.trim();
    let first = true;
    const stage = (title, note) => {
      add(`        stage(${q(title)}) {`, first ? 'A stage is one named step in the pipeline. The name appears in the Jenkins page.' : note);
      first = false;
    };

    add('// Jenkinsfile for ' + name + ' (multibranch)', 'A comment. Jenkins ignores it. A multibranch job reads this one file from every branch and pull request.');
    add('');
    add('pipeline {', 'Every declarative pipeline is one big pipeline block.');
    if (v.agentType === 'any') {
      add('    agent any', 'Run on the first free machine.');
    } else {
      add('    agent {');
      add('        docker {', 'Run the build inside a fresh container, then throw it away. Needs Docker and the Docker Pipeline plugin.');
      add(`            image ${q(v.dockerImage)}`);
      add('        }');
      add('    }');
    }
    add('');
    add('    options {', 'Settings for the whole run.');
    add(`        timeout(time: ${v.timeoutMin.trim()}, unit: 'MINUTES')`, 'Stop a stuck run.');
    add(`        buildDiscarder(logRotator(numToKeepStr: ${q(v.keepBuilds.trim())}))`, 'Keep only the last few runs of each branch.');
    add('    }');
    add('');
    add('    stages {');

    if (v.prNote) {
      stage('Pull request', null);
      add('            when {', 'A condition. The stage runs only when it is true, and is shown as skipped otherwise.');
      add('                changeRequest()', 'True only when this run is for a pull request (merge request). Multibranch jobs only.');
      add('            }');
      add('            steps {');
      add('                echo "Pull request #${env.CHANGE_ID}: ${env.CHANGE_BRANCH} into ${env.CHANGE_TARGET}"', 'Jenkins sets CHANGE_ID, CHANGE_BRANCH and CHANGE_TARGET for pull requests. Double quotes let Groovy put them in the text. These are not secret.');
      add('            }');
      add('        }');
    }

    if (p.install) {
      stage('Install', null);
      add('            steps {');
      add(`                sh ${q(p.install)}`, 'Fetch the project’s dependencies. Runs on every branch.');
      add('            }');
      add('        }');
    }
    stage('Test', null);
    add('            steps {');
    add(`                sh ${q(p.test)}`, 'Run the tests. This runs on every branch and every pull request, so a broken change is caught before it is merged.');
    add('            }');
    if (p.junit) {
      add('            post {', 'A post block can sit inside one stage. It runs when that stage ends.');
      add('                always {');
      add(`                    junit allowEmptyResults: true, testResults: ${q(p.junit)}`, 'Show the test results as a chart.');
      add('                }');
      add('            }');
    }
    add('        }');

    if (p.build) {
      stage('Build', null);
      add('            steps {');
      add(`                sh ${q(p.build)}`, 'Build the project.');
      add('            }');
      add('        }');
    }

    if (v.doRelease && p.archive) {
      stage('Release', null);
      add('            when {');
      add(`                tag ${q(v.tagPattern.trim())}`, 'True when the run is for a git tag that matches this pattern, for example v1.2.0. Pushing a tag is how you start a release.');
      add('            }');
      add('            steps {');
      add(`                archiveArtifacts artifacts: ${q(p.archive)}, fingerprint: true`, 'Keep the built files with the run so they can be downloaded.');
      add('            }');
      add('        }');
    }

    if (v.doDeploy && v.approve) {
      stage('Approve', null);
      add('            agent none', 'Wait for the answer without holding a build machine.');
      add('            when {');
      add(`                branch ${q(main)}`, 'True only on this branch. Other branches never get this far.');
      add('            }');
      add('            steps {');
      add("                timeout(time: 1, unit: 'HOURS') {", 'Give up if nobody answers within an hour.');
      add("                    input message: 'Deploy this build?', ok: 'Deploy'", 'Pause until someone clicks Deploy.');
      add('                }');
      add('            }');
      add('        }');
    }
    if (v.doDeploy) {
      stage('Deploy', null);
      add('            when {');
      add(`                branch ${q(main)}`, 'Deploy only from the main branch. Feature branches and pull requests skip this stage.');
      add('            }');
      add('            steps {');
      if (v.deployCmd.trim()) add(`                sh ${q(v.deployCmd.trim())}`, 'Your deploy command. Keep secrets out of it: use withCredentials, as in the Deploy pipeline generator.');
      else add("                echo 'Deploy step goes here'", 'A placeholder. Replace it with your deploy command.');
      add('            }');
      add('        }');
    }
    add('    }');
    add('');
    add('    post {', 'Runs after the stages, pass or fail.');
    add('        failure {');
    add('            echo "Failed on ${env.BRANCH_NAME}"', 'BRANCH_NAME is the branch (or pull request name) of this run. It exists in multibranch jobs.');
    add('        }');
    add('    }');
    add('}');
    return [{ path: 'Jenkinsfile', label: 'Jenkinsfile', lines }];
  },

  zipName() {
    return 'jenkins-multibranch.zip';
  },

  run(v) {
    return {
      where:
        JKX.JK_WHERE_GIT +
        ' In Jenkins (GUI): New Item, name it, choose Multibranch Pipeline. Under Branch Sources add GitHub (or Git) and your repository. Keep Build Configuration as "by Jenkinsfile". Save, and Jenkins scans the repository and makes a job for every branch that has a Jenkinsfile. To start runs the moment you push, add a webhook in your repository settings pointing at https://YOUR-JENKINS/github-webhook/ (this needs Jenkins reachable from the internet; for a home lab, use "Scan Multibranch Pipeline Triggers" with a periodic interval instead). Plugins used: Pipeline, Git' +
        (v.agentType === 'docker' ? ', Docker Pipeline' : '') +
        ', and GitHub Branch Source for GitHub repositories.',
      commands: JKX.JK_GIT_COMMANDS,
      flags: [
        ...JKX.JK_GIT_FLAGS,
        { flag: 'New Item > Multibranch Pipeline', meaning: 'A job type that creates one job per branch by itself.' },
        { flag: 'Branch Sources', meaning: 'Where the branches come from: your repository. Add a credential here for a private one.' },
        { flag: 'Scan Multibranch Pipeline Triggers', meaning: 'How often Jenkins looks for new branches and pull requests when no webhook is set.' },
        { flag: 'Webhook: /github-webhook/', meaning: 'A web address Jenkins listens on. GitHub calls it on each push, so runs start at once.' },
        { flag: 'Build Now (per branch)', meaning: 'Start a run for one branch by hand.' },
      ],
    };
  },
};

/* =====================================================================
   Test matrix pipeline
   ===================================================================== */

const JK2_MATRIX = {
  node: { name: 'Node.js', axis: 'NODE_VERSION', image: (a) => `node:\${${a}}`, steps: ['node --version', 'npm ci', 'npm test'], junit: '' },
  python: { name: 'Python', axis: 'PYTHON_VERSION', image: (a) => `python:\${${a}}`, steps: ['python --version', 'python -m pip install -r requirements.txt', 'python -m pytest'], junit: '' },
  java: { name: 'Java with Maven', axis: 'JAVA_VERSION', image: (a) => `maven:3.9-eclipse-temurin-\${${a}}`, steps: ['java -version', 'mvn -B -ntp test'], junit: '**/target/surefire-reports/*.xml' },
};

const jkMatrix = {
  id: 'matrix',
  label: 'Test matrix',
  ready: true,
  title: 'Test matrix pipeline',
  intro: 'Run the same tests on several versions of a language at the same time, and optionally on several kinds of machine, from a few lines of Groovy.',

  groups: [
    {
      legend: 'What to test',
      fields: [
        {
          id: 'kind',
          type: 'select',
          label: 'Language',
          options: [
            ['node', 'Node.js'],
            ['python', 'Python'],
            ['java', 'Java with Maven'],
          ],
          default: 'node',
        },
        { id: 'versions', type: 'text', label: 'Versions to test', hint: 'Separate with commas, up to 8. Examples: Node 20, 22. Python 3.11, 3.12. Java 17, 21.', default: '20, 22' },
      ],
    },
    {
      legend: 'Where it runs',
      fields: [
        { id: 'useDocker', type: 'check', label: 'Use a Docker container for each version', default: true, hint: 'The easy way: the container has exactly that version. Needs Docker and the Docker Pipeline plugin. Without it, every machine must already have each version.' },
        { id: 'platforms', type: 'text', label: 'Also try several kinds of machine (optional)', hint: 'Agent labels, separated by commas, such as linux, windows. Empty means any machine. Every label multiplies the number of runs.', default: '' },
        { id: 'failFast', type: 'check', label: 'Stop all the others when one fails', default: false, hint: 'Saves time. Leave it off if you want to see every result.' },
      ],
    },
  ],

  validate(v) {
    const e = {};
    const list = (t) => t.split(',').map((x) => x.trim()).filter(Boolean);
    const vs = list(v.versions);
    if (!vs.length || vs.length > 8) e.versions = 'Give between 1 and 8 versions, separated by commas.';
    else if (vs.some((x) => !JK2_VAL_RE.test(x))) e.versions = 'Each version may use letters, digits, dots, hyphens and underscores only.';
    else if (new Set(vs).size !== vs.length) e.versions = 'Each version should appear once.';
    const ps = list(v.platforms);
    if (ps.length > 4) e.platforms = 'Use at most 4 labels.';
    else if (ps.some((x) => !JKX.JK_LABEL_RE.test(x))) e.platforms = 'Each label may use letters, digits, dots, hyphens and underscores only.';
    else if (new Set(ps).size !== ps.length) e.platforms = 'Each label should appear once.';
    return e;
  },

  build(v) {
    const { lines, add } = JKX.groovy();
    const q = JKX.q;
    const m = JK2_MATRIX[v.kind];
    const list = (t) => t.split(',').map((x) => x.trim()).filter(Boolean);
    const vs = list(v.versions);
    const ps = list(v.platforms);

    add(`// Test ${m.name} on ${vs.join(', ')}`, 'A comment. Jenkins ignores it.');
    add('');
    add('pipeline {');
    add('    agent none', 'No machine is chosen at the top. The matrix below gives each combination its own.');
    if (v.failFast) {
      add('');
      add('    options {');
      add('        parallelsAlwaysFailFast()', 'When one of the parallel runs fails, stop the others straight away.');
      add('    }');
    }
    add('');
    add('    stages {');
    add("        stage('Test') {");
    add('            matrix {', 'A matrix runs the stages inside it once for every combination of the values below, at the same time.');
    if (v.useDocker) {
      add('                agent {', 'Each combination gets its own agent.');
      add('                    docker {', 'A fresh container for each run.');
      add(`                        image "${m.image('VERSION'.replace('VERSION', m.axis))}"`, `Double quotes let Groovy fill in the current version, so each run starts the right image, for example ${m.image(m.axis).replace('${' + m.axis + '}', vs[0])}.`);
      if (ps.length) add('                        label "${PLATFORM}"', 'Start the container on a machine with the current label.');
      add('                    }');
      add('                }');
    } else if (ps.length) {
      add('                agent {');
      add('                    label "${PLATFORM}"', 'Run on a machine with the current label.');
      add('                }');
    } else {
      add('                agent any', 'Any machine. It must already have every version you listed.');
    }
    add('                axes {', 'The things that vary. Two axes of 2 values each give 4 runs.');
    add('                    axis {');
    add(`                        name ${q(m.axis)}`, 'The variable the current value is stored in.');
    add(`                        values ${vs.map(q).join(', ')}`, 'The values to try, one run for each.');
    add('                    }');
    if (ps.length) {
      add('                    axis {');
      add("                        name 'PLATFORM'", 'A second axis. Every version is tried on every label.');
      add(`                        values ${ps.map(q).join(', ')}`);
      add('                    }');
    }
    add('                }');
    add('                stages {', 'The stages that run for each combination.');
    add("                    stage('Run') {");
    add('                        steps {');
    for (const st of m.steps) add(`                            sh ${q(st)}`, st === m.steps[0] ? 'Print the version, so the log proves which one ran.' : null);
    add('                        }');
    if (m.junit) {
      add('                        post {');
      add('                            always {');
      add(`                                junit allowEmptyResults: true, testResults: ${q(m.junit)}`, 'Show the test results from this combination.');
      add('                            }');
      add('                        }');
    }
    add('                    }');
    add('                }');
    add('            }');
    add('        }');
    add('    }');
    add('}');
    return [{ path: 'Jenkinsfile', label: 'Jenkinsfile', lines }];
  },

  zipName() {
    return 'jenkins-matrix.zip';
  },

  run(v) {
    const n = v.versions.split(',').filter((x) => x.trim()).length * Math.max(1, v.platforms.split(',').filter((x) => x.trim()).length);
    return {
      where:
        JKX.JK_WHERE_GIT +
        ` In Jenkins (GUI): make a Pipeline job as in the Pipeline generator. Each run starts ${n} combination${n === 1 ? '' : 's'} at once, so you need enough free executors for them to really run side by side.` +
        (v.useDocker ? ' Plugins used: Pipeline, Git, Docker Pipeline.' : ' Plugins used: Pipeline, Git.'),
      commands: JKX.JK_GIT_COMMANDS,
      flags: [...JKX.JK_GIT_FLAGS, ...JKX.JK_UI_FLAGS],
    };
  },
};

/* =====================================================================
   Shared library starter
   ===================================================================== */

const jkLibrary = {
  id: 'library',
  label: 'Shared library',
  ready: true,
  title: 'Shared library starter',
  intro: 'A small git repository of your own reusable pipeline steps, plus the Jenkinsfile that uses them. Fix a build recipe in one place and every project gets it.',

  groups: [
    {
      legend: 'The library',
      fields: [
        { id: 'libName', type: 'text', label: 'Library name', hint: 'The name you register in Jenkins and write in @Library. Letters, digits, dots, hyphens and underscores.', default: 'my-shared-library' },
        {
          id: 'kind',
          type: 'select',
          label: 'What should the first step do?',
          options: [
            ['standard', 'A whole standard build pipeline (install, test, build)'],
            ['notify', 'A small helper that reports the result of a build'],
          ],
          default: 'standard',
        },
        { id: 'stepName', type: 'text', label: 'Name of the step', hint: 'camelCase, such as standardBuild. This is how projects call it.', default: 'standardBuild' },
        { id: 'email', type: 'text', label: 'Email when the build fails', hint: 'Optional. Only used by the helper step. Jenkins needs mail settings first.', default: '', showIf: { field: 'kind', in: ['notify'] } },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!JKX.JK_CRED_RE.test(v.libName.trim())) e.libName = 'Use letters, digits, dots, hyphens and underscores.';
    if (!JK2_STEP_RE.test(v.stepName.trim())) e.stepName = 'Start with a lowercase letter, then letters and digits only (3 to 30 characters). Example: standardBuild';
    if (v.kind === 'notify' && v.email.trim() && !JKX.JK_EMAIL_RE.test(v.email.trim())) e.email = 'That does not look like an email address.';
    return e;
  },

  build(v) {
    const q = JKX.q;
    const step = v.stepName.trim();
    const lib = v.libName.trim();
    const files = [];

    // vars/<step>.groovy
    {
      const { lines, add } = JKX.groovy();
      if (v.kind === 'standard') {
        add(`// vars/${step}.groovy`, 'Every file in the vars folder becomes a step. The file name is the step name.');
        add('');
        add('def call(Map config = [:]) {', 'call is the method Jenkins runs when a project writes the step name. Map config = [:] means "options, and an empty set if none were given".');
        add("    def language = config.get('language', 'node')", 'Read an option, with a default. Projects can pass language: \'maven\' and so on.');
        add('    def commands = [', 'A map of the commands for each kind of project.');
        add("        node  : [install: 'npm ci', test: 'npm test', build: 'npm run build'],");
        add("        python: [install: 'python3 -m pip install -r requirements.txt', test: 'python3 -m pytest', build: 'python3 -m build'],");
        add("        maven : [install: 'mvn -B -ntp dependency:resolve', test: 'mvn -B -ntp test', build: 'mvn -B -ntp package -DskipTests'],");
        add('    ]');
        add('    def run = commands[language]', 'Pick the commands for this project’s language.');
        add('');
        add('    pipeline {', 'A library step can hold a whole pipeline. This is called a pipeline template.');
        add('        agent any');
        add('        stages {');
        add("            stage('Install') {");
        add('                steps {');
        add('                    sh run.install', 'No quotes: run.install is a Groovy value, not text. Its value is the command.');
        add('                }');
        add('            }');
        add("            stage('Test') {");
        add('                steps {');
        add('                    sh run.test');
        add('                }');
        add('            }');
        add("            stage('Build') {");
        add('                steps {');
        add('                    sh run.build');
        add('                }');
        add('            }');
        add('        }');
        add('    }');
        add('}');
      } else {
        add(`// vars/${step}.groovy`, 'Every file in the vars folder becomes a step. The file name is the step name.');
        add('');
        add('def call(String status = null) {', 'A step that takes one optional piece of text. call runs when a project writes the step name.');
        add('    def result = status ?: currentBuild.currentResult', '?: means "use the left side, or the right side if it is empty". currentResult is SUCCESS, UNSTABLE or FAILURE.');
        add('    echo "Build ${env.JOB_NAME} #${env.BUILD_NUMBER} finished: ${result}"', 'Print a line with the job name, run number and result. These are ready-made Jenkins variables.');
        if (v.email.trim()) {
          add("    if (result != 'SUCCESS') {", 'Only send mail when something went wrong.');
          add(`        mail to: ${q(v.email.trim())}, subject: "Build \${result}: \${env.JOB_NAME}", body: "See \${env.BUILD_URL}"`, 'Send an email with a link to the run. Jenkins needs mail settings first.');
          add('    }');
        }
        add('}');
      }
      files.push({ path: `vars/${step}.groovy`, label: `vars/${step}.groovy`, lines });
    }

    // Jenkinsfile that uses it
    {
      const { lines, add } = JKX.groovy();
      add('// Jenkinsfile in a project that uses the library', 'This is the file a project keeps. It is tiny, because the library holds the real recipe.');
      add('');
      add(`@Library(${q(lib)}) _`, 'Load the library registered under this name in Jenkins. The lone underscore is required: it is Groovy for "attach this to nothing".');
      add('');
      if (v.kind === 'standard') {
        add(`${step}(language: 'node')`, 'Call the step. language: \'node\' is an option, read in the library as config.language.');
      } else {
        add('pipeline {');
        add('    agent any');
        add('    stages {');
        add("        stage('Work') {");
        add('            steps {');
        add("                echo 'Doing the work'");
        add('            }');
        add('        }');
        add('    }');
        add('    post {');
        add('        always {');
        add(`            ${step}()`, 'Call the library step after every run. It reads the result itself.');
        add('        }');
        add('    }');
        add('}');
      }
      files.push({ path: 'Jenkinsfile', label: 'Jenkinsfile (in a project)', lines });
    }

    // README
    {
      const { lines, add } = JKX.groovy();
      add(`# ${lib}`, 'The heading. This file is for people. Jenkins does not read it.');
      add('');
      add('A Jenkins shared library: reusable pipeline steps.');
      add('');
      add('## Layout', 'Jenkins expects exactly these folder names.');
      add('');
      add('- `vars/` holds one `.groovy` file per step. The file name is the step name.');
      add('- `src/` (optional) holds ordinary Groovy classes.');
      add('- `resources/` (optional) holds files a step can read with `libraryResource`.');
      add('');
      add('## Use it', 'How a project uses the library.');
      add('');
      add('1. In Jenkins: Manage Jenkins > System > Global Trusted Pipeline Libraries > Add.');
      add(`2. Name: \`${lib}\`. Default version: \`main\`. Retrieval method: Modern SCM > Git. Enter this repository.`);
      add(`3. In a project's Jenkinsfile, start with \`@Library('${lib}') _\` and call \`${step}\`.`);
      files.push({ path: 'README.md', label: 'README.md', lines });
    }
    return files;
  },

  zipName(v) {
    return `${v.libName.trim()}.zip`;
  },

  run() {
    return {
      where:
        'This is a git repository of its own, separate from your projects. Unzip the files into a new folder, then use a terminal (your laptop, or a VM through its console or SSH) to put it in git. After that, register it in the Jenkins web page (GUI): Manage Jenkins > System > Global Trusted Pipeline Libraries > Add. Give it the name from the Jenkinsfile, set Default version to main, choose Retrieval method Modern SCM, pick Git, and enter the repository address.',
      commands: [
        { cmd: 'git init', what: 'Make the folder a git repository.' },
        { cmd: 'git add vars README.md', what: 'Pick the library files for the first commit. Jenkins needs the vars folder at the top of the repository.' },
        { cmd: 'git commit -m "Add shared library"', what: 'Save them in history.' },
        { cmd: 'git push', what: 'Send the commit to your remote repository, once you have added it with git remote add origin.' },
      ],
      flags: [
        { flag: 'git init', meaning: 'Start a new git repository in this folder.' },
        { flag: 'git add vars README.md', meaning: 'Choose files for the next commit.' },
        { flag: 'git commit -m "..."', meaning: '-m gives the message, so git does not open an editor.' },
        { flag: 'Global Trusted Pipeline Libraries', meaning: 'The Jenkins setting where a library is registered. Code here runs without the sandbox, so only add repositories you trust.' },
        { flag: 'Default version: main', meaning: 'Which branch or tag of the library to load, unless a project asks for another with @Library(\'name@version\').' },
      ],
    };
  },
};

/* =====================================================================
   Jenkins setup: Docker, plugins, Configuration as Code
   ===================================================================== */

const JK2_PLUGINS = [
  ['git', 'git', 'Get code from git repositories.', true],
  ['workflow-aggregator', 'workflow-aggregator', 'Pipeline: the bundle that gives you Jenkinsfiles.', true],
  ['credentials-binding', 'credentials-binding', 'Use stored passwords and keys inside a pipeline (withCredentials).', true],
  ['configuration-as-code', 'configuration-as-code', 'Set Jenkins up from the jenkins.yaml file.', true],
  ['pipeline-stage-view', 'pipeline-stage-view', 'Show each stage as a box on the job page.', true],
  ['junit', 'junit', 'Show test results as charts.', true],
];

const jkSetup = {
  id: 'setup',
  label: 'Jenkins setup',
  ready: true,
  title: 'Jenkins server setup',
  intro: 'Run Jenkins itself in Docker, with its plugins and its settings (admin user, URL, credentials) written as files. Start it with one command and rebuild it the same way any time.',

  groups: [
    {
      legend: 'The server',
      fields: [
        { id: 'port', type: 'text', label: 'Web port', hint: 'The port you open in the browser. 8080 is the Jenkins default. 1024 to 65535.', default: '8080' },
        { id: 'url', type: 'text', label: 'Jenkins address', hint: 'The address people will type, such as http://localhost:8080 or http://192.168.1.50:8080. Used in links and emails.', default: 'http://localhost:8080' },
        { id: 'adminId', type: 'text', label: 'Admin user name', hint: 'Lowercase letters, digits, hyphens and underscores. The password is not typed here. It goes in a .env file you keep private.', default: 'admin' },
        {
          id: 'executors',
          type: 'select',
          label: 'Run builds on the Jenkins server itself?',
          options: [
            ['2', 'Yes, 2 at a time (fine for learning)'],
            ['0', 'No, only on separate agents (safer for real use)'],
          ],
          default: '2',
          hint: 'With No you must add an agent before anything can build. See the Agent setup generator.',
        },
        { id: 'message', type: 'text', label: 'Welcome message', hint: 'Shown at the top of the Jenkins page. Optional.', default: 'Managed by files. Change jenkins.yaml, not the web page.' },
      ],
    },
    {
      legend: 'Plugins',
      fields: [
        { id: 'pDocker', type: 'check', label: 'Docker Pipeline (docker agents)', default: true },
        { id: 'pSsh', type: 'check', label: 'SSH Agent (ssh keys in pipelines)', default: false },
        { id: 'pGithub', type: 'check', label: 'GitHub and GitHub Branch Source', default: true },
        { id: 'pTime', type: 'check', label: 'Timestamper (time on log lines)', default: true },
        { id: 'pClean', type: 'check', label: 'Workspace Cleanup (cleanWs)', default: true },
        { id: 'pMail', type: 'check', label: 'Email Extension', default: false },
        { id: 'pSlack', type: 'check', label: 'Slack Notification', default: false },
        { id: 'pUtil', type: 'check', label: 'Pipeline Utility Steps (readJSON, readYaml)', default: false },
      ],
    },
    {
      legend: 'Docker builds from inside Jenkins',
      optional: true,
      fields: [
        { id: 'dockerBuilds', type: 'check', label: 'Let Jenkins run docker commands', default: false, hint: 'Installs the Docker command-line tool in the image and shares the host’s Docker. See the warning in the file.' },
      ],
    },
    {
      legend: 'A saved login (credential)',
      optional: true,
      fields: [
        { id: 'addCred', type: 'check', label: 'Create a registry login in Jenkins', default: false, hint: 'A "Username with password" credential, filled from your .env file.' },
        { id: 'credId', type: 'text', label: 'Credentials ID', hint: 'The ID a Jenkinsfile uses, such as dockerhub-creds.', default: 'dockerhub-creds', showIf: { field: 'addCred', in: [true] } },
      ],
    },
    {
      legend: 'Agents',
      optional: true,
      fields: [
        { id: 'inbound', type: 'check', label: 'Open the port that Docker agents connect to (50000)', default: false, hint: 'Only needed for inbound agents that do not use WebSocket.' },
      ],
    },
  ],

  validate(v) {
    const e = {};
    const pt = v.port.trim();
    if (!/^\d{4,5}$/.test(pt) || Number(pt) < 1024 || Number(pt) > 65535) e.port = 'Enter a whole number from 1024 to 65535.';
    if (!JK2_URL_RE.test(v.url.trim())) e.url = 'Write an address such as http://localhost:8080 or https://jenkins.example.com. Letters, digits, dots and hyphens only, no path.';
    if (!JK2_ID_RE.test(v.adminId.trim())) e.adminId = 'Use 3 to 32 characters: lowercase letters, digits, hyphens and underscores. Start with a letter.';
    if (!JK2_MSG_RE.test(v.message.trim())) e.message = 'Use up to 100 characters: letters, digits, spaces and . , : ; ! ( ) / _ -';
    if (v.addCred && !JKX.JK_CRED_RE.test(v.credId.trim())) e.credId = 'Use letters, digits, dots, hyphens and underscores.';
    return e;
  },

  build(v) {
    const files = [];
    const port = v.port.trim();
    const url = v.url.trim();
    const admin = v.adminId.trim();

    // ---- plugins.txt
    {
      const { lines, add } = JKX.groovy();
      add('# Plugins to install in the Jenkins image, one per line.', 'Lines starting with # are comments.');
      add('# A bare name installs the newest version when the image is built.', 'Fine for learning. For real use, pin versions as name:version so a rebuild cannot surprise you.');
      add('');
      add('# Essentials');
      for (const [id, , why] of JK2_PLUGINS) add(id, why);
      const opt = [];
      if (v.pDocker) opt.push(['docker-workflow', 'Docker Pipeline: lets a pipeline run stages in containers.']);
      if (v.pSsh) opt.push(['ssh-agent', 'SSH Agent: loads an ssh key for a few steps (sshagent).']);
      if (v.pGithub) opt.push(['github', 'GitHub: webhooks and links to GitHub.'], ['github-branch-source', 'GitHub Branch Source: multibranch jobs from GitHub, with pull requests.']);
      if (v.pTime) opt.push(['timestamper', 'Timestamper: the time on every log line.']);
      if (v.pClean) opt.push(['ws-cleanup', 'Workspace Cleanup: the cleanWs() step.']);
      if (v.pMail) opt.push(['email-ext', 'Email Extension: richer emails than the plain mail step.']);
      if (v.pSlack) opt.push(['slack', 'Slack Notification: slackSend.']);
      if (v.pUtil) opt.push(['pipeline-utility-steps', 'Pipeline Utility Steps: readJSON, readYaml, zip and more.']);
      if (opt.length) {
        add('');
        add('# Your choices');
        for (const [id, why] of opt) add(id, why);
      }
      files.push({ path: 'plugins.txt', label: 'plugins.txt', lines });
    }

    // ---- Dockerfile
    {
      const { lines, add } = JKX.groovy();
      add('FROM jenkins/jenkins:lts-jdk21', 'Start from the official Jenkins image, the long-term-support release on Java 21. LTS gets fewer, safer updates.');
      if (v.dockerBuilds) {
        add('');
        add('USER root', 'Installing software needs the root user. We switch back to jenkins afterwards.');
        add('RUN apt-get update && apt-get install -y ca-certificates curl \\', 'Install tools needed to add the Docker download source.');
        add(' && install -m 0755 -d /etc/apt/keyrings \\');
        add(' && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \\', 'Download Docker’s signing key, so apt can check the packages are genuine.');
        add(' && chmod a+r /etc/apt/keyrings/docker.asc \\');
        add(' && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \\', 'Tell apt about Docker’s package source, for this Debian version.');
        add(' && apt-get update && apt-get install -y docker-ce-cli \\', 'Install only the docker command, not the Docker engine. The engine stays on the host.');
        add(' && rm -rf /var/lib/apt/lists/*', 'Delete the downloaded package lists to keep the image small.');
      }
      add('');
      add('USER jenkins', 'Run Jenkins as the normal jenkins user, never as root.');
      add('COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt', 'Put the plugin list into the image.');
      add('RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt', 'Install every plugin in the list while the image is built, so Jenkins starts ready.');
      files.push({ path: 'Dockerfile', label: 'Dockerfile', lines });
    }

    // ---- docker-compose.yml
    {
      const { lines, add } = JKX.groovy();
      add('services:', 'Compose describes the containers to run.');
      add('  jenkins:', 'One container, called jenkins here.');
      add('    build: .', 'Build the image from the Dockerfile in this folder.');
      add('    container_name: jenkins');
      add('    restart: unless-stopped', 'Start again after a reboot or a crash, unless you stopped it on purpose.');
      add('    ports:', 'Which doors from your machine lead into the container.');
      add(`      - "${port}:8080"`, `Open http://localhost:${port} on this machine. The left number is yours to change. Jenkins always listens on 8080 inside.`);
      if (v.inbound) add('      - "50000:50000"', 'The port inbound agents use to connect to the controller.');
      add('    environment:', 'Settings given to Jenkins when it starts.');
      add('      CASC_JENKINS_CONFIG: /var/jenkins_home/casc/jenkins.yaml', 'Tells the Configuration as Code plugin where its file is.');
      add('      JAVA_OPTS: -Djenkins.install.runSetupWizard=false', 'Skip the first-time wizard. The jenkins.yaml file does the setup instead.');
      add('      JENKINS_ADMIN_ID: ${JENKINS_ADMIN_ID}', 'Compose fills this in from your .env file. The password never appears in this file.');
      add('      JENKINS_ADMIN_PASSWORD: ${JENKINS_ADMIN_PASSWORD}');
      if (v.addCred) {
        add('      REGISTRY_USER: ${REGISTRY_USER}');
        add('      REGISTRY_TOKEN: ${REGISTRY_TOKEN}');
      }
      add('    volumes:', 'Places that outlive the container.');
      add('      - jenkins_home:/var/jenkins_home', 'A named volume that holds all of Jenkins’ data: jobs, history, settings. Delete the container and the data stays.');
      add('      - ./jenkins.yaml:/var/jenkins_home/casc/jenkins.yaml:ro', 'Share the settings file into the container. :ro makes it read-only there.');
      if (v.dockerBuilds) {
        add('      - /var/run/docker.sock:/var/run/docker.sock', 'WARNING: this gives Jenkins full control of the host’s Docker, which is almost the same as root on the host. Do this only on a machine you control, and only for projects you trust.');
        add('    group_add:', 'Give the jenkins user permission to use the Docker socket.');
        add('      - "${DOCKER_GID}"', 'The number of the host’s docker group. Find it with: getent group docker | cut -d: -f3. Put it in .env.');
      }
      add('');
      add('volumes:');
      add('  jenkins_home:', 'Declare the named volume used above.');
      files.push({ path: 'docker-compose.yml', label: 'docker-compose.yml', lines });
    }

    // ---- jenkins.yaml
    {
      const { lines, add } = JKX.groovy();
      add('jenkins:', 'Settings for Jenkins itself. This is the Configuration as Code format.');
      add(`  systemMessage: "${v.message.trim()}"`, 'The banner shown at the top of every page.');
      add(`  numExecutors: ${v.executors}`, 'How many builds the Jenkins server may run itself. 0 means none: only agents build, which keeps the server safe.');
      add('  securityRealm:', 'Who may log in, and how.');
      add('    local:', 'Jenkins keeps its own list of users.');
      add('      allowsSignup: false', 'Nobody can make their own account.');
      add('      users:');
      add('        - id: "${JENKINS_ADMIN_ID}"', 'Read from the environment, which came from your .env file.');
      add('          password: "${JENKINS_ADMIN_PASSWORD}"', 'The password is never written in this file.');
      add('  authorizationStrategy:', 'What a logged-in user may do.');
      add('    loggedInUsersCanDoAnything:', 'Simple: every user is an admin. Fine for one person. For a team use the Matrix Authorization plugin.');
      add('      allowAnonymousRead: false', 'Strangers see nothing, not even job names.');
      add('unclassified:', 'Settings that do not belong to one plugin.');
      add('  location:');
      add(`    url: "${url}/"`, 'The address Jenkins puts in links and emails.');
      if (v.addCred) {
        add('credentials:', 'Stored logins.');
        add('  system:');
        add('    domainCredentials:');
        add('      - credentials:');
        add('          - usernamePassword:', 'A username with a password or token, the kind withCredentials(usernamePassword(...)) reads.');
        add('              scope: GLOBAL', 'Available to every job.');
        add(`              id: "${v.credId.trim()}"`, 'The ID a Jenkinsfile uses to ask for it.');
        add('              description: "Registry login"');
        add('              username: "${REGISTRY_USER}"', 'Both come from the environment, so no secret is in this file.');
        add('              password: "${REGISTRY_TOKEN}"');
      }
      files.push({ path: 'jenkins.yaml', label: 'jenkins.yaml', lines });
    }

    // ---- .env.example
    {
      const { lines, add } = JKX.groovy();
      add('# Copy this file to .env and fill it in. Never commit .env.', 'The real values go in .env, which .gitignore keeps out of git.');
      add(`JENKINS_ADMIN_ID=${admin}`);
      add('JENKINS_ADMIN_PASSWORD=change-me-to-a-long-password', 'Replace this with a long password of your own.');
      if (v.addCred) {
        add('REGISTRY_USER=your-registry-user');
        add('REGISTRY_TOKEN=your-registry-access-token', 'Use an access token, not your account password. Revoke it when you stop using it.');
      }
      if (v.dockerBuilds) add('DOCKER_GID=999', 'Replace with the output of: getent group docker | cut -d: -f3');
      files.push({ path: '.env.example', label: '.env.example', lines });
    }

    // ---- .gitignore
    {
      const { lines, add } = JKX.groovy();
      add('.env', 'The real secrets file. Never commit it.');
      files.push({ path: '.gitignore', label: '.gitignore', lines });
    }
    return files;
  },

  zipName() {
    return 'jenkins-setup.zip';
  },

  run(v) {
    const commands = [
      { cmd: 'cp .env.example .env', what: 'Make your private settings file from the example.' },
      { cmd: 'chmod 600 .env', what: 'Only you may read it. It holds the admin password.' },
      { cmd: 'nano .env', what: 'Open it and replace the placeholder values. Type the password here, never on a command line.' },
    ];
    if (v.dockerBuilds) commands.push({ cmd: 'getent group docker | cut -d: -f3', what: 'Print the number of the docker group. Put it in .env as DOCKER_GID.' });
    commands.push(
      { cmd: 'docker compose build', what: 'Build the Jenkins image with your plugins. The first time takes a few minutes.' },
      { cmd: 'docker compose up -d', what: 'Start Jenkins in the background.' },
      { cmd: 'docker compose logs -f jenkins', what: 'Watch it start. Wait for "Jenkins is fully up and running", then press Ctrl+C.' }
    );
    return {
      where: `On the machine that will host Jenkins, in a terminal (VM console or SSH). It needs Docker with the compose plugin. Then, in a browser (GUI), open ${v.url.trim()} and log in with the admin user and the password from your .env file.`,
      commands,
      flags: [
        { flag: 'cp .env.example .env', meaning: 'Copy a file. The new file is yours to fill in.' },
        { flag: 'chmod 600', meaning: 'Set permissions: read and write for the owner, nothing for anyone else.' },
        { flag: 'docker compose build', meaning: 'Build the image described by the Dockerfile.' },
        { flag: 'docker compose up -d', meaning: 'Create and start the containers. -d means detached: run in the background.' },
        { flag: 'docker compose logs -f jenkins', meaning: 'Show the container’s log. -f follows it as new lines arrive.' },
        { flag: 'docker compose down', meaning: 'Stop and remove the container. The jenkins_home volume keeps your data. Add -v only if you want to delete the data too.' },
      ],
    };
  },
};

/* =====================================================================
   Build agent setup
   ===================================================================== */

const jkAgent = {
  id: 'agent',
  label: 'Agent setup',
  ready: true,
  title: 'Build agent setup',
  intro: 'Add a machine that does the building, so the Jenkins server only coordinates. Pick a plain Linux machine over SSH, or a Docker container that dials in.',

  groups: [
    {
      legend: 'Kind of agent',
      fields: [
        {
          id: 'method',
          type: 'select',
          label: 'How does the agent connect?',
          options: [
            ['ssh', 'A Linux machine, reached over SSH'],
            ['inbound', 'A Docker container that connects to Jenkins'],
          ],
          default: 'ssh',
          hint: 'SSH: Jenkins logs in to the machine. Inbound: the agent logs in to Jenkins, which works through firewalls.',
        },
      ],
    },
    {
      legend: 'The Linux machine',
      fields: [
        { id: 'agentUser', type: 'text', label: 'User to create on the machine', hint: 'Lowercase letters, digits, hyphens and underscores.', default: 'jenkins', showIf: { field: 'method', in: ['ssh'] } },
        { id: 'workDir', type: 'text', label: 'Work folder', hint: 'An absolute path where builds happen. Jenkins calls it the Remote root directory.', default: '/home/jenkins/agent', showIf: { field: 'method', in: ['ssh'] } },
        {
          id: 'java',
          type: 'select',
          label: 'Java version to install',
          options: [
            ['openjdk-21-jre-headless', 'Java 21 (Ubuntu 24.04, Debian 13)'],
            ['openjdk-17-jre-headless', 'Java 17 (Ubuntu 22.04 and older, Debian 12)'],
          ],
          default: 'openjdk-21-jre-headless',
          hint: 'The agent needs a Java the Jenkins server supports.',
          showIf: { field: 'method', in: ['ssh'] },
        },
        { id: 'pubKey', type: 'text', label: 'Public key Jenkins will log in with', hint: 'The one line from the .pub file, such as ssh-ed25519 AAAA... name. Never paste a private key here.', default: '', showIf: { field: 'method', in: ['ssh'] } },
      ],
    },
    {
      legend: 'The Docker agent',
      fields: [
        { id: 'agentName', type: 'text', label: 'Agent name', hint: 'Must match the name you give the node in Jenkins. Lowercase letters, digits, hyphens and underscores.', default: 'docker-agent-1', showIf: { field: 'method', in: ['inbound'] } },
        { id: 'jenkinsUrl', type: 'text', label: 'Jenkins address', hint: 'As the agent sees it, such as http://192.168.1.50:8080. Not localhost, unless the agent runs on the same machine without Docker networking.', default: 'http://192.168.1.50:8080', showIf: { field: 'method', in: ['inbound'] } },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (v.method === 'ssh') {
      if (!JK2_ID_RE.test(v.agentUser.trim()) && !/^[a-z_][a-z0-9_-]{0,31}$/.test(v.agentUser.trim())) e.agentUser = 'Use lowercase letters, digits, hyphens and underscores.';
      else if (v.agentUser.trim() === 'root') e.agentUser = 'Do not use root for an agent.';
      const w = v.workDir.trim();
      if (!JK2_PATH_RE.test(w) || w.includes('..') || w === '/') e.workDir = 'Write an absolute path such as /home/jenkins/agent. No .. and not just /.';
      if (!JK2_PUBKEY_RE.test(v.pubKey.trim())) e.pubKey = 'Paste the single line from your .pub file, starting with ssh-ed25519 or ssh-rsa. Make one with ssh-keygen (see the steps).';
    } else {
      if (!JK2_ID_RE.test(v.agentName.trim())) e.agentName = 'Use 3 to 32 characters: lowercase letters, digits, hyphens and underscores. Start with a letter.';
      if (!JK2_URL_RE.test(v.jenkinsUrl.trim())) e.jenkinsUrl = 'Write an address such as http://192.168.1.50:8080. No path.';
    }
    return e;
  },

  build(v) {
    const { lines, add } = JKX.groovy();
    if (v.method === 'ssh') {
      const user = v.agentUser.trim();
      const work = v.workDir.trim();
      add('#!/usr/bin/env bash', 'Run this script with bash.');
      add('# Prepare this machine to be a Jenkins build agent (Ubuntu or Debian).');
      add('set -euo pipefail', 'Stop at the first error, treat unset variables as errors, and fail a pipe if any part fails.');
      add('');
      add(`AGENT_USER='${user}'`, 'The user Jenkins will log in as.');
      add(`WORK_DIR='${work}'`, 'Where builds will happen.');
      add(`PUBLIC_KEY='${v.pubKey.trim()}'`, 'The public half of the key. It is safe to put in a file.');
      add('');
      add('sudo apt-get update', 'Refresh the package list.');
      add(`sudo apt-get install -y ${v.java} git`, 'Install Java, which the agent program needs, and git, which builds nearly always use.');
      add('');
      add('# Make the user if it does not exist yet', 'The next line only runs useradd when the id command fails.');
      add('id "$AGENT_USER" >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash "$AGENT_USER"', 'Create a normal user with a home folder. It has no sudo rights, which is what you want.');
      add('HOME_DIR="$(getent passwd "$AGENT_USER" | cut -d: -f6)"', 'Look up the user’s home folder.');
      add('');
      add('sudo install -d -m 700 -o "$AGENT_USER" -g "$AGENT_USER" "$HOME_DIR/.ssh"', 'Make the .ssh folder, private to that user (700).');
      add('echo "$PUBLIC_KEY" | sudo tee "$HOME_DIR/.ssh/authorized_keys" >/dev/null', 'Allow anyone holding the matching private key to log in as this user. The private key stays in Jenkins.');
      add('sudo chown "$AGENT_USER:$AGENT_USER" "$HOME_DIR/.ssh/authorized_keys"');
      add('sudo chmod 600 "$HOME_DIR/.ssh/authorized_keys"', 'SSH refuses a key file that others can read.');
      add('');
      add('sudo install -d -m 755 -o "$AGENT_USER" -g "$AGENT_USER" "$WORK_DIR"', 'Make the work folder, owned by the agent user.');
      add('');
      add('echo "Agent machine is ready. Now add it as a node in Jenkins."');
      return [{ path: 'setup-agent.sh', label: 'setup-agent.sh', lines }];
    }

    const name = v.agentName.trim();
    const url = v.jenkinsUrl.trim();
    add('services:', 'Compose describes the containers to run.');
    add('  agent:', 'One container, called agent here.');
    add('    image: jenkins/inbound-agent:latest-jdk21', 'The official agent image. It runs the agent program and dials in to Jenkins.');
    add(`    container_name: ${name}`);
    add('    init: true', 'Run a tiny init program as process 1, which cleans up finished child processes properly.');
    add('    restart: unless-stopped', 'Come back after a reboot, unless you stopped it on purpose.');
    add('    environment:');
    add(`      JENKINS_URL: ${url}`, 'Where the Jenkins server is.');
    add(`      JENKINS_AGENT_NAME: ${name}`, 'The node name. It must match the node you create in Jenkins.');
    add('      JENKINS_SECRET: ${AGENT_SECRET}', 'The node’s secret. Compose fills it in from your .env file, so it is not in this file.');
    add('      JENKINS_WEB_SOCKET: "true"', 'Connect over the normal web port, so no extra port needs opening on the server.');
    return [
      { path: 'docker-compose.agent.yml', label: 'docker-compose.agent.yml', lines },
      (() => {
        const w = JKX.groovy();
        w.add('# Copy to .env and fill in. Never commit .env.', 'The real secret goes in .env, which stays out of git.');
        w.add('AGENT_SECRET=paste-the-secret-from-the-node-page', 'Jenkins shows this secret on the node’s page after you create the node.');
        return { path: '.env.example', label: '.env.example', lines: w.lines };
      })(),
      (() => {
        const w = JKX.groovy();
        w.add('.env', 'Keep the secret out of git.');
        return { path: '.gitignore', label: '.gitignore', lines: w.lines };
      })(),
    ];
  },

  zipName(v) {
    return v.method === 'ssh' ? 'jenkins-agent-ssh.zip' : 'jenkins-agent-docker.zip';
  },

  run(v) {
    if (v.method === 'ssh') {
      return {
        where:
          'Three places. 1) On the Jenkins server (VM console or SSH), make a key pair. Paste the public key line into the form. 2) On the new agent machine (console or SSH), run the script. 3) In the Jenkins web page (GUI), add the machine as a node. In Jenkins: Manage Jenkins > Nodes > New Node, name it, choose Permanent Agent. Set Remote root directory to your work folder, add a label such as linux, set Launch method to "Launch agents via SSH", enter the machine’s address, and add a credential of kind "SSH Username with private key" holding the PRIVATE key. Set Host Key Verification Strategy to "Known hosts file" or "Manually trusted key" and save.',
        commands: [
          { cmd: 'ssh-keygen -t ed25519 -f ~/.ssh/jenkins_agent -C jenkins-agent', what: 'On the Jenkins server: make a new key pair. When it asks for a passphrase, press Enter for none, since Jenkins cannot type one. This makes jenkins_agent (private) and jenkins_agent.pub (public).' },
          { cmd: 'cat ~/.ssh/jenkins_agent.pub', what: 'Print the public key. Copy that one line into the form above. It is safe to share.' },
          { cmd: 'bash setup-agent.sh', what: 'On the agent machine: run the downloaded script. It installs Java and git, makes the user, and allows your key.' },
        ],
        flags: [
          { flag: 'ssh-keygen -t ed25519', meaning: 'Make a key pair using the modern ed25519 type.' },
          { flag: '-f ~/.ssh/jenkins_agent', meaning: 'The file name to save to, so it does not overwrite your own key.' },
          { flag: '-C jenkins-agent', meaning: 'A comment stored in the key, to remember what it is for.' },
          { flag: 'Remote root directory', meaning: 'The work folder on the agent. Use the same one as in the form.' },
          { flag: 'Labels', meaning: 'A name jobs use to ask for this machine: agent { label \'linux\' }.' },
          { flag: 'Host Key Verification Strategy', meaning: 'How Jenkins checks it is talking to the right machine. Do not pick "Non verifying" except in a throwaway lab.' },
        ],
      };
    }
    return {
      where:
        'Two places. First, in the Jenkins web page (GUI): Manage Jenkins > Nodes > New Node, give it the same name as in the form, choose Permanent Agent, set Remote root directory to /home/jenkins/agent, add a label, and set Launch method to "Launch agent by connecting it to the controller". Save, open the node, and copy the secret shown on its page. Second, on the machine that will run the agent (VM console or SSH), which needs Docker: make the .env file with that secret and start the container.',
      commands: [
        { cmd: 'cp .env.example .env', what: 'Make your private settings file.' },
        { cmd: 'chmod 600 .env', what: 'Only you may read it. It holds the node secret.' },
        { cmd: 'nano .env', what: 'Open it and paste the secret after AGENT_SECRET=. Do not put it on a command line.' },
        { cmd: 'docker compose -f docker-compose.agent.yml up -d', what: 'Start the agent in the background. In a few seconds the node turns online in Jenkins.' },
        { cmd: 'docker compose -f docker-compose.agent.yml logs -f', what: 'Watch it connect. Press Ctrl+C to stop watching.' },
      ],
      flags: [
        { flag: 'docker compose -f FILE', meaning: '-f picks a compose file with a name other than the default.' },
        { flag: 'up -d', meaning: 'Create and start the container in the background (detached).' },
        { flag: 'logs -f', meaning: 'Show the log and keep following it.' },
        { flag: 'Launch agent by connecting it to the controller', meaning: 'The inbound style: the agent dials in, so the server needs no way to reach the agent.' },
        { flag: 'Use WebSocket', meaning: 'On the node page, tick it, since the compose file sets JENKINS_WEB_SOCKET.' },
      ],
    };
  },
};

const JENKINS_MORE_TOOLS = [jkMultibranch, jkMatrix, jkLibrary, jkSetup, jkAgent];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { JENKINS_MORE_TOOLS };

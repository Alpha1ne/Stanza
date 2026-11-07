'use strict';

/*
  jk-ref.js — the Jenkins reference pages: pipeline concepts and steps.

  Same shape as the other reference files. `cmd` is Groovy. A literal Groovy
  ${...} is written \${...} so JavaScript leaves it alone. Every example was
  checked with a real Groovy parser. Steps that come from a plugin say so.
*/

const JK_WORDS = [
  ['Jenkins', 'A server that builds, tests and deploys your code automatically, every time the code changes.'],
  ['Job', 'One project in Jenkins. A Pipeline job is one that runs a Jenkinsfile.'],
  ['Jenkinsfile', 'A text file in your repository that says how to build the project. It is written in Groovy.'],
  ['Groovy', 'A scripting language that runs on Java. A Jenkinsfile is Groovy, but you only need a few pieces of it.'],
  ['Pipeline', 'The whole recipe: the stages, in order.'],
  ['Stage', 'One named part of the recipe, such as Build or Test. The Jenkins page shows each stage as a box.'],
  ['Step', 'One action inside a stage, such as running a command.'],
  ['Agent', 'The machine that runs the build. The Jenkins server itself is called the controller.'],
  ['Plugin', 'An add-on that gives Jenkins new steps. Some steps below work only if their plugin is installed.'],
  ['Credentials', 'Passwords, tokens and keys stored safely inside Jenkins. A pipeline uses them by ID, never by typing them in.'],
  ['Workspace', 'The folder on the agent where your code is downloaded for a run.'],
];

const JK_CONCEPT_GROUPS = [
  /* ------------------------------------------------------------------ */
  {
    id: 'outline',
    tool: 'The outline',
    kind: 'groovy',
    title: 'The outline of a pipeline',
    blurb: 'A declarative Jenkinsfile always has the same shape. Learn the shape once and every Jenkinsfile reads the same.',
    commands: [
      {
        id: 'minimal',
        cmd: `pipeline {
    agent any

    stages {
        stage('Hello') {
            steps {
                echo 'Hello from Jenkins'
            }
        }
    }
}`,
        title: 'The smallest pipeline',
        what: 'The least a declarative pipeline needs: where to run, and one stage with one step.',
        use: 'A starting point. Every other example here adds to this.',
        parts: [
          ['pipeline { }', 'The outer block. Everything lives inside it.'],
          ['agent any', 'Where to run. any means the first free machine.'],
          ['stages { }', 'The list of stages. Jenkins runs them in order.'],
          ['stage(\'Hello\') { }', 'One stage. The name is what shows in the Jenkins page.'],
          ['steps { }', 'The actions inside the stage.'],
          ['echo \'...\'', 'A step that prints a line in the log.'],
        ],
        tips: [
          'Declarative means the shape is fixed. Jenkins checks it before running and tells you if a section is in the wrong place.',
          'The older style is called scripted. It starts with node { } and allows any Groovy. Beginners should use declarative.',
        ],
      },
      {
        id: 'agent',
        cmd: `pipeline {
    agent {
        docker {
            image 'node:22'
        }
    }

    stages {
        stage('Version') {
            steps {
                sh 'node --version'
            }
        }
    }
}`,
        title: 'agent: where the build runs',
        what: 'Chooses the machine, or container, that runs the stages.',
        use: 'To get a clean environment with the right tools, such as a Docker image that already has Node.',
        parts: [
          ['agent any', 'Any free machine.'],
          ['agent { label \'linux\' }', 'Only machines that were given the label linux in Jenkins.'],
          ['agent { docker { image \'node:22\' } }', 'Start a container from this image, run the stages in it, then delete it. Needs Docker and the Docker Pipeline plugin on the machine.'],
          ['agent none', 'Run nothing at the top, so each stage must say its own agent. Used to wait for approval without holding a machine.'],
        ],
        tips: ['A stage can have its own agent block too. Then that stage uses a different machine from the rest.'],
      },
      {
        id: 'options',
        cmd: `pipeline {
    agent any

    options {
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
    }

    stages {
        stage('Work') {
            steps {
                echo 'Working'
            }
        }
    }
}`,
        title: 'options: settings for the whole run',
        what: 'Rules about how a run behaves: how long it may take, how many old runs to keep, and whether two may overlap.',
        use: 'In nearly every real pipeline. A timeout alone saves you from builds that hang for days.',
        parts: [
          ['timeout(time: 30, unit: \'MINUTES\')', 'Abort the run if it goes past 30 minutes.'],
          ['buildDiscarder(logRotator(numToKeepStr: \'10\'))', 'Keep only the last 10 runs. Older ones are deleted.'],
          ['disableConcurrentBuilds()', 'If a run is going, make the next one wait.'],
          ['timestamps()', 'Not shown. Put the time on each log line. Needs the Timestamper plugin.'],
          ['skipDefaultCheckout()', 'Not shown. Stop Jenkins downloading your code before the first stage, when you want to do it yourself.'],
        ],
      },
      {
        id: 'environment',
        cmd: `pipeline {
    agent any

    environment {
        APP_NAME = 'my-app'
        GREETING = "Hello from \${APP_NAME}"
    }

    stages {
        stage('Show') {
            steps {
                sh 'echo "$GREETING"'
            }
        }
    }
}`,
        title: 'environment: variables for every step',
        what: 'Sets variables that all steps can read. In a shell command you write them as $NAME.',
        use: 'For names and settings you use in several places. Not for passwords. See credentials.',
        parts: [
          ['APP_NAME = \'my-app\'', 'A variable. Single quotes keep the text exactly as written.'],
          ['"Hello from ${APP_NAME}"', 'Double quotes let Groovy put another variable into the text.'],
          ['sh \'echo "$GREETING"\'', 'In a single-quoted sh, the shell (not Groovy) fills in $GREETING.'],
        ],
        tips: ['Jenkins also gives you ready-made variables, such as BUILD_NUMBER, JOB_NAME, WORKSPACE and BRANCH_NAME (multibranch jobs only).'],
      },
      {
        id: 'parameters',
        cmd: `pipeline {
    agent any

    parameters {
        string(name: 'VERSION', defaultValue: '1.0.0', description: 'Version to build')
        choice(name: 'TARGET', choices: ['staging', 'production'], description: 'Where to deploy')
        booleanParam(name: 'RUN_TESTS', defaultValue: true, description: 'Run the tests?')
    }

    stages {
        stage('Show') {
            steps {
                echo "Building \${params.VERSION} for \${params.TARGET}"
            }
        }
    }
}`,
        title: 'parameters: questions asked before a run',
        what: 'Adds a form that Jenkins shows when someone clicks Build with Parameters. The answers are read as params.NAME.',
        use: 'To let people choose a version, a target or an option without editing the Jenkinsfile.',
        parts: [
          ['string(...)', 'A text box.'],
          ['choice(...)', 'A drop-down list. The first choice is the default.'],
          ['booleanParam(...)', 'A tick box.'],
          ['params.VERSION', 'How you read an answer in a step.'],
        ],
        careful: 'The first time a new parameter is added, the Build Now button is still the old one. Run once, and the form appears from the next run.',
      },
      {
        id: 'triggers',
        cmd: `pipeline {
    agent any

    triggers {
        pollSCM('H/5 * * * *')
        cron('H 2 * * *')
    }

    stages {
        stage('Work') {
            steps {
                echo 'Triggered'
            }
        }
    }
}`,
        title: 'triggers: start a run automatically',
        what: 'Lets Jenkins start runs by itself, on a timetable or when the code changes.',
        use: 'So nobody has to click Build Now.',
        parts: [
          ['pollSCM(\'H/5 * * * *\')', 'About every five minutes, check the repository, and run only if something changed.'],
          ['cron(\'H 2 * * *\')', 'Run once a night at about 2 a.m., changed or not.'],
          ['H', 'Stands for "a spread-out number". Jenkins picks the minute so many jobs do not all start together.'],
          ['five fields', 'Minute, hour, day of month, month, day of week.'],
        ],
        tips: ['A webhook from GitHub or GitLab starts the run instantly and uses less effort than polling. Set that up in the job and in the repository.'],
      },
      {
        id: 'post',
        cmd: `pipeline {
    agent any

    stages {
        stage('Work') {
            steps {
                sh 'exit 1'
            }
        }
    }

    post {
        always {
            echo 'Always runs'
        }
        success {
            echo 'Only when it passed'
        }
        failure {
            echo 'Only when it failed'
        }
        cleanup {
            echo 'Runs last, after everything else'
        }
    }
}`,
        title: 'post: what to do afterwards',
        what: 'Steps that run after the stages finish, chosen by how the run ended.',
        use: 'To save test results, clean up, and tell people when something broke.',
        parts: [
          ['always', 'Every time.'],
          ['success', 'Only when all stages passed.'],
          ['failure', 'Only when a stage failed.'],
          ['unstable', 'Not shown. When tests failed but the build itself worked.'],
          ['changed', 'Not shown. When the result differs from the previous run, for example it was fixed.'],
          ['cleanup', 'Runs last of all, whatever happened. Use it to delete files.'],
        ],
        tips: ['post can also be put inside a single stage, to run something after only that stage.'],
      },
      {
        id: 'when',
        cmd: `pipeline {
    agent any

    stages {
        stage('Deploy') {
            when {
                allOf {
                    branch 'main'
                    environment name: 'DEPLOY', value: 'yes'
                }
            }
            steps {
                echo 'Deploying'
            }
        }
    }
}`,
        title: 'when: run a stage only sometimes',
        what: 'Puts a condition on a stage. If it is false the stage is skipped, and the Jenkins page shows it greyed out.',
        use: 'To deploy only from the main branch, or to run a slow test only when asked.',
        parts: [
          ['branch \'main\'', 'True when the run is for the main branch. Works in multibranch jobs only.'],
          ['environment name: \'DEPLOY\', value: \'yes\'', 'True when that environment variable has that value.'],
          ['expression { return params.RUN_TESTS }', 'Not shown. Any Groovy test that gives true or false.'],
          ['allOf { }', 'All the conditions inside must be true. anyOf needs just one, and not { } reverses one.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'flow',
    tool: 'Control flow',
    kind: 'groovy',
    title: 'Doing several things, or waiting',
    blurb: 'Run stages side by side, repeat them for several versions, ask a person, or use plain Groovy when you need it.',
    commands: [
      {
        id: 'parallel',
        cmd: `pipeline {
    agent any

    stages {
        stage('Checks') {
            parallel {
                stage('Lint') {
                    steps {
                        echo 'Linting'
                    }
                }
                stage('Unit tests') {
                    steps {
                        echo 'Testing'
                    }
                }
            }
        }
    }
}`,
        title: 'parallel: stages side by side',
        what: 'Runs the stages inside it at the same time instead of one after another.',
        use: 'To shorten a slow pipeline when parts do not depend on each other.',
        parts: [
          ['parallel { }', 'Holds two or more stages that start together.'],
          ['stage(\'Lint\')', 'Each inner stage is shown as its own branch in the Jenkins page.'],
        ],
        tips: ['The stage after the parallel block waits for all branches. If one branch fails, the others are still allowed to finish unless you add failFast true.'],
      },
      {
        id: 'matrix',
        cmd: `pipeline {
    agent none

    stages {
        stage('Test') {
            matrix {
                axes {
                    axis {
                        name 'VERSION'
                        values '20', '22'
                    }
                }
                stages {
                    stage('Run') {
                        agent any
                        steps {
                            echo "Testing on version \${VERSION}"
                        }
                    }
                }
            }
        }
    }
}`,
        title: 'matrix: try every combination',
        what: 'Repeats the same stages once for every value you list.',
        use: 'To test your code on several versions of a language or several operating systems with very little code.',
        parts: [
          ['axes { }', 'The things that vary. Two axes of two values each give four runs.'],
          ['axis { name ... values ... }', 'One axis: its name, and the values it takes.'],
          ['${VERSION}', 'Inside the matrix, each run sees the current value as a variable.'],
        ],
      },
      {
        id: 'input',
        cmd: `pipeline {
    agent any

    stages {
        stage('Approve') {
            steps {
                timeout(time: 1, unit: 'HOURS') {
                    input message: 'Deploy to production?', ok: 'Deploy'
                }
            }
        }
        stage('Deploy') {
            steps {
                echo 'Deploying'
            }
        }
    }
}`,
        title: 'input: ask a person',
        what: 'Pauses the run and shows a button. The run goes on only when someone clicks it.',
        use: 'As a safety gate before production.',
        parts: [
          ['input message: \'...\'', 'The question shown on the page.'],
          ['ok: \'Deploy\'', 'The text on the go-ahead button. Abort is the other choice.'],
          ['timeout(...)', 'Without it, an unanswered question waits forever.'],
          ['submitter: \'alice\'', 'Not shown. Only this person may click. Without it, anyone with permission can.'],
        ],
        tips: ['Wait in a stage with agent none, so the paused run does not hold a build machine.'],
      },
      {
        id: 'script',
        cmd: `pipeline {
    agent any

    stages {
        stage('Loop') {
            steps {
                script {
                    def names = ['web', 'api', 'db']
                    for (name in names) {
                        echo "Checking \${name}"
                    }
                }
            }
        }
    }
}`,
        title: 'script: use ordinary Groovy',
        what: 'A step that opens a space where any Groovy is allowed: variables, loops, if tests.',
        use: 'When the fixed declarative shape is not enough, for example to loop over a list.',
        parts: [
          ['script { }', 'Inside, you are free to write Groovy.'],
          ['def names = [...]', 'def makes a variable. Square brackets make a list.'],
          ['for (name in names) { }', 'Repeat for each item.'],
          ['"Checking ${name}"', 'Double quotes fill in the variable.'],
        ],
        tips: ['Keep script blocks short. Long logic is easier to read and test in a shared library, or in a shell script in your repository.'],
      },
      {
        id: 'groovy',
        cmd: `def name = 'web'
def ports = [80, 443]
def info = [host: 'app.example.com', user: 'deploy']

if (ports.contains(443)) {
    echo "\${name} uses https on \${info.host}"
} else {
    echo "\${name} uses plain http"
}

ports.each { port ->
    echo "Port \${port}"
}`,
        title: 'The Groovy you need',
        what: 'The few Groovy pieces you meet in pipelines: variables, lists, maps, if, and loops.',
        use: 'Inside script { } blocks and in shared libraries.',
        parts: [
          ['def x = ...', 'Make a variable.'],
          ['[80, 443]', 'A list. Square brackets, commas between items.'],
          ['[host: \'a\', user: \'b\']', 'A map. Names with values. Read one with info.host.'],
          ['if (...) { } else { }', 'Do one thing or the other.'],
          ['ports.each { port -> ... }', 'Do something for every item. port is the current one.'],
          ['\'single\' and "double"', 'Single quotes are plain text. Double quotes replace ${...} with a value.'],
        ],
        careful: 'Never put a secret inside a double-quoted string that is passed to sh. Groovy fills it in before the shell runs, so it can end up in the log. Use single quotes and let the shell read the variable.',
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'secrets',
    tool: 'Credentials and reuse',
    kind: 'groovy',
    title: 'Secrets, and sharing code between pipelines',
    blurb: 'Passwords never go in a Jenkinsfile. Jenkins keeps them and lends them to a step for a moment.',
    commands: [
      {
        id: 'credentials',
        cmd: `pipeline {
    agent any

    stages {
        stage('Login') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'my-registry', usernameVariable: 'USER', passwordVariable: 'PASS')]) {
                    sh 'echo "$PASS" | docker login -u "$USER" --password-stdin'
                }
            }
        }
    }
}`,
        title: 'withCredentials: use a password safely',
        what: 'Fetches a stored username and password for the steps inside the braces. Outside the braces they do not exist.',
        use: 'Whenever a step needs a login, a token or a key.',
        parts: [
          ['credentialsId: \'my-registry\'', 'The ID you gave the credential in Manage Jenkins > Credentials.'],
          ['usernameVariable, passwordVariable', 'The variable names the values arrive in.'],
          ['single-quoted sh', 'Lets the shell read $PASS, so Groovy never holds the secret in the log.'],
          ['--password-stdin', 'Sends the password through a pipe, not on the command line.'],
        ],
        careful: 'Jenkins hides the values in the log by replacing them with ****. That only works for the exact text, so never print, transform or encode a secret.',
        tips: ['Other kinds: string(credentialsId: ..., variable: ...) for a token, file(...) for a file, and sshUserPrivateKey(...) for a key.'],
      },
      {
        id: 'env-credentials',
        cmd: `pipeline {
    agent any

    environment {
        API_TOKEN = credentials('api-token')
    }

    stages {
        stage('Call') {
            steps {
                sh 'curl -s -H "Authorization: Bearer $API_TOKEN" https://api.example.com/status'
            }
        }
    }
}`,
        title: 'credentials(): a secret in the environment block',
        what: 'A shortcut that loads a stored secret into a variable for the whole pipeline.',
        use: 'When many stages need the same token.',
        parts: [
          ['credentials(\'api-token\')', 'Read the credential with this ID.'],
          ['API_TOKEN', 'For a plain secret text, this holds the text. For a username and password it also gives API_TOKEN_USR and API_TOKEN_PSW.'],
        ],
        careful: 'A wider reach means more places a secret could leak. withCredentials, around only the steps that need it, is safer.',
      },
      {
        id: 'library',
        cmd: `@Library('my-shared-library') _

pipeline {
    agent any

    stages {
        stage('Build') {
            steps {
                buildApp()
            }
        }
    }
}`,
        title: 'Shared library: reuse code',
        what: 'Loads a library of your own steps, kept in a separate git repository, so many pipelines can use the same code.',
        use: 'When several projects have the same build, and you want to fix it in one place.',
        parts: [
          ['@Library(\'my-shared-library\') _', 'Load the library registered under this name. The lone underscore is required. It is Groovy for "attach this to nothing".'],
          ['buildApp()', 'A step defined in the library, in a file called vars/buildApp.groovy.'],
        ],
        tips: ['An admin sets the library up once, in Manage Jenkins > System > Global Trusted Pipeline Libraries.'],
      },
    ],
  },
];

const JK_STEP_GROUPS = [
  /* ------------------------------------------------------------------ */
  {
    id: 'run',
    tool: 'Run things',
    kind: 'groovy',
    title: 'Running commands and printing',
    blurb: 'The steps you will use most. These are built into Jenkins.',
    commands: [
      {
        id: 'sh',
        cmd: `sh 'npm test'`,
        title: 'sh: run a shell command',
        what: 'Runs a command in the Linux shell on the agent. If the command fails, the step and the run fail.',
        use: 'For almost everything: build, test, copy files.',
        parts: [
          ['sh', 'The step name.'],
          ['\'npm test\'', 'The command. Single quotes mean Groovy leaves it alone and the shell does the filling in.'],
          ['returnStdout: true', 'Not shown. Give back the command’s output as text so you can use it: def v = sh(script: \'git describe\', returnStdout: true).trim()'],
          ['returnStatus: true', 'Not shown. Give back the exit code, and do not fail the run.'],
        ],
        tips: ['For several lines use three single quotes: sh \'\'\' ... \'\'\'. Each line then runs in the same shell.'],
      },
      {
        id: 'bat',
        cmd: `bat 'dir'`,
        title: 'bat: run a Windows command',
        what: 'Like sh, but for Windows agents. It uses the Windows command prompt.',
        use: 'When your agent is a Windows machine. PowerShell users can use powershell \'...\' instead.',
        parts: [
          ['bat', 'The step name.'],
          ['\'dir\'', 'The command.'],
        ],
      },
      {
        id: 'echo',
        cmd: `echo 'Starting the build'
echo "Run number \${env.BUILD_NUMBER}"`,
        title: 'echo: print a line',
        what: 'Writes a message to the log.',
        use: 'To mark progress and show values while you debug.',
        parts: [
          ['echo \'text\'', 'Print exactly this text.'],
          ['"... ${env.BUILD_NUMBER}"', 'Double quotes let you print a variable. env.NAME reads an environment variable.'],
        ],
        careful: 'Do not echo anything secret. The log can be read by everyone who can see the job.',
      },
      {
        id: 'error',
        cmd: `if (!fileExists('package.json')) {
    error 'package.json is missing'
}`,
        title: 'error: stop the run on purpose',
        what: 'Fails the run straight away with your message.',
        use: 'When you notice something wrong that no command would have caught.',
        parts: [
          ['fileExists(\'package.json\')', 'True when that file exists.'],
          ['!', 'Means "not".'],
          ['error \'...\'', 'Stop and show this message as the reason.'],
        ],
      },
      {
        id: 'retry',
        cmd: `retry(3) {
    sh 'curl --fail https://example.com/health'
}`,
        title: 'retry: try again if it fails',
        what: 'Runs the steps inside up to the given number of times, until they work once.',
        use: 'For things that fail now and then for no good reason, such as a download.',
        parts: [
          ['retry(3)', 'Try at most 3 times in total.'],
          ['{ ... }', 'The steps to repeat.'],
        ],
        tips: ['Do not hide a real bug with retry. If something fails often, fix the cause.'],
      },
      {
        id: 'timeout',
        cmd: `timeout(time: 5, unit: 'MINUTES') {
    sh './slow-script.sh'
}`,
        title: 'timeout: stop it if it takes too long',
        what: 'Gives the steps inside a time limit. If they go over, they are stopped and the run fails.',
        use: 'Around anything that could hang, such as a network call or an approval.',
        parts: [
          ['time: 5', 'How long.'],
          ['unit: \'MINUTES\'', 'The unit: SECONDS, MINUTES or HOURS.'],
        ],
      },
      {
        id: 'sleep',
        cmd: `sleep time: 10, unit: 'SECONDS'`,
        title: 'sleep: wait a while',
        what: 'Pauses the run.',
        use: 'To give a service a moment to start before you test it.',
        parts: [
          ['time: 10', 'How long.'],
          ['unit', 'SECONDS, MINUTES or HOURS. The default is seconds.'],
        ],
        tips: ['waitUntil { ... } is better when you can test whether the service is ready, because it stops waiting as soon as it is.'],
      },
      {
        id: 'withenv',
        cmd: `withEnv(['STAGE=test', 'DEBUG=1']) {
    sh 'echo "$STAGE $DEBUG"'
}`,
        title: 'withEnv: set variables for a few steps',
        what: 'Sets environment variables only for the steps inside the braces.',
        use: 'For a setting that matters in one place only.',
        parts: [
          ['[\'STAGE=test\', ...]', 'A list of NAME=value texts.'],
          ['{ ... }', 'The steps that see them.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'files',
    tool: 'Files and code',
    kind: 'groovy',
    title: 'Getting code, moving files, saving results',
    blurb: 'Steps that work with your source code, your workspace and the results.',
    commands: [
      {
        id: 'checkout',
        cmd: `checkout scm`,
        title: 'checkout scm: get your code',
        what: 'Downloads the repository the Jenkinsfile came from, at the same commit, into the workspace.',
        use: 'Only when you turned off the automatic download, or are inside a stage with its own agent. Declarative pipelines already do it at the start.',
        parts: [
          ['checkout', 'The step name.'],
          ['scm', 'A built-in name for "the source this job is set to use".'],
        ],
      },
      {
        id: 'git',
        cmd: `git url: 'https://github.com/example/other-repo.git', branch: 'main'`,
        title: 'git: get a different repository',
        what: 'Clones another repository into the workspace.',
        use: 'When the build needs a second repository, such as a deploy config.',
        parts: [
          ['url', 'The repository address.'],
          ['branch', 'The branch to download.'],
          ['credentialsId', 'Not shown. For a private repository, the ID of the stored login.'],
        ],
      },
      {
        id: 'dir',
        cmd: `dir('frontend') {
    sh 'npm ci'
}`,
        title: 'dir: work in a sub-folder',
        what: 'Runs the steps inside the braces with a different folder as the current folder.',
        use: 'For projects where the code is in a sub-folder, such as frontend or backend.',
        parts: [
          ['dir(\'frontend\')', 'The folder, written from the workspace top. It is created if it is missing.'],
          ['{ ... }', 'The steps that run there.'],
        ],
      },
      {
        id: 'readwrite',
        cmd: `writeFile file: 'version.txt', text: '1.0.0'
def version = readFile('version.txt').trim()
echo "Version is \${version}"`,
        title: 'writeFile and readFile',
        what: 'Writes text to a file in the workspace, and reads it back as text.',
        use: 'To pass a value from one step to another, or to create a small config file.',
        parts: [
          ['writeFile file: ..., text: ...', 'Make the file with this text.'],
          ['readFile(\'version.txt\')', 'Give back the file’s contents.'],
          ['.trim()', 'Remove the new line at the end.'],
        ],
      },
      {
        id: 'stash',
        cmd: `stash name: 'build', includes: 'dist/**'
// ... later, maybe on a different machine
unstash 'build'`,
        title: 'stash and unstash: hand files to a later stage',
        what: 'Saves some files under a name, and brings them back later, even on another machine.',
        use: 'When stages run on different agents, so they do not share a workspace.',
        parts: [
          ['stash name: \'build\'', 'Save the files under the name build.'],
          ['includes: \'dist/**\'', 'Which files. ** means everything below dist.'],
          ['unstash \'build\'', 'Put them back in the current workspace.'],
        ],
        tips: ['Stashes are meant for small sets of files. Use archiveArtifacts for results you want to download.'],
      },
      {
        id: 'archive',
        cmd: `archiveArtifacts artifacts: 'build/*.zip', fingerprint: true`,
        title: 'archiveArtifacts: keep the results',
        what: 'Saves the matching files with the run. You can download them from the run’s page afterwards.',
        use: 'To keep what the build made: a jar, a zip, a report.',
        parts: [
          ['artifacts', 'A file pattern. * matches any name, ** matches any folders.'],
          ['fingerprint: true', 'Record each file’s checksum so Jenkins can show which runs used it.'],
          ['allowEmptyArchive: true', 'Not shown. Do not fail if no file matches.'],
        ],
      },
      {
        id: 'junit',
        cmd: `junit allowEmptyResults: true, testResults: '**/target/surefire-reports/*.xml'`,
        title: 'junit: show test results',
        what: 'Reads JUnit-style XML test reports and shows a pass/fail chart and a list of failed tests.',
        use: 'After running tests, in a post { always { } } block.',
        parts: [
          ['testResults', 'A pattern for the XML report files. Most test tools can write this format.'],
          ['allowEmptyResults: true', 'Do not fail if there are no reports, for example when the tests were skipped.'],
        ],
        tips: ['Failed tests make the run "unstable" (yellow), not failed (red).'],
      },
      {
        id: 'cleanws',
        cmd: `cleanWs()`,
        title: 'cleanWs: empty the workspace',
        what: 'Deletes everything the run downloaded or made on the agent. Needs the Workspace Cleanup plugin.',
        use: 'At the end of a run, so disk space is not used up and one run cannot affect the next.',
        parts: [
          ['cleanWs()', 'Delete the workspace folder’s contents.'],
          ['deleteDir()', 'The built-in alternative. It deletes the current folder with no plugin.'],
        ],
        careful: 'Run junit and archiveArtifacts before it, or their files are gone.',
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'flowsteps',
    tool: 'Jobs and tell people',
    kind: 'groovy',
    title: 'Starting other jobs and sending messages',
    blurb: 'Steps that connect jobs together, and tell people what happened. Some need a plugin.',
    commands: [
      {
        id: 'build-job',
        cmd: `build job: 'deploy-app', parameters: [string(name: 'VERSION', value: '1.0.0')], wait: true`,
        title: 'build: start another job',
        what: 'Starts a different Jenkins job from this one.',
        use: 'To chain jobs, for example a build job that starts a separate deploy job.',
        parts: [
          ['job: \'deploy-app\'', 'The other job’s name.'],
          ['parameters: [...]', 'Answers for that job’s parameters.'],
          ['wait: true', 'Wait for it to finish, and fail if it fails. false means "start it and carry on".'],
        ],
      },
      {
        id: 'catcherror',
        cmd: `catchError(buildResult: 'SUCCESS', stageResult: 'FAILURE') {
    sh './optional-check.sh'
}`,
        title: 'catchError: keep going after a failure',
        what: 'Lets the run carry on if the steps inside fail, and decides how the result is marked.',
        use: 'For checks you want to report but not block on.',
        parts: [
          ['buildResult: \'SUCCESS\'', 'What the whole run counts as. SUCCESS keeps it green.'],
          ['stageResult: \'FAILURE\'', 'What the stage is marked as, so the problem is still visible.'],
        ],
        tips: ['warnError(\'message\') { ... } is a shorter way to mark the run unstable (yellow) instead of failed.'],
      },
      {
        id: 'mail',
        cmd: `mail to: 'team@example.com', subject: 'Build failed', body: 'See the Jenkins page for the log.'`,
        title: 'mail: send an email',
        what: 'Sends a plain email.',
        use: 'To tell people a run failed.',
        parts: [
          ['to', 'Who gets it.'],
          ['subject', 'The title.'],
          ['body', 'The message.'],
        ],
        careful: 'It works only after an admin sets up the mail server in Manage Jenkins > System.',
        tips: ['emailext (the Email Extension plugin) can send richer emails with the log attached.'],
      },
      {
        id: 'slack',
        cmd: `slackSend channel: '#builds', color: 'danger', message: "Build failed: \${env.JOB_NAME} #\${env.BUILD_NUMBER}"`,
        title: 'slackSend: post in Slack (plugin)',
        what: 'Sends a message to a Slack channel. This step comes from the Slack Notification plugin.',
        use: 'To tell a team channel about runs.',
        parts: [
          ['channel', 'Where to post.'],
          ['color', 'The stripe colour: good, warning or danger.'],
          ['message', 'The text. env.JOB_NAME and env.BUILD_NUMBER are ready-made Jenkins variables.'],
        ],
        careful: 'The plugin and a Slack token stored as a Jenkins credential must be set up first. Never paste the token into the file.',
      },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { JK_CONCEPT_GROUPS, JK_STEP_GROUPS, JK_WORDS };

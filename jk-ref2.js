'use strict';

/*
  jk-ref2.js — four more Jenkins reference pages: variables, plugins,
  troubleshooting and admin/CLI.

  Same shape as jk-ref.js. A group with a `kind` shows its commands as a plain
  code block; a group without one shows shell commands with a $ prompt.
  A literal Groovy ${...} is written \${...} so JavaScript leaves it alone.
*/

const JK_VAR_WORDS = [
  ['Environment variable', 'A named value Jenkins puts in front of every build, such as the run number. Shell steps read it as $NAME.'],
  ['env', 'The Groovy object that holds those variables. env.BUILD_NUMBER is the same value as $BUILD_NUMBER in a shell.'],
  ['currentBuild', 'A Groovy object about the run in progress: its result, its duration, its description.'],
  ['Multibranch only', 'Some variables exist only in a multibranch job. In a plain Pipeline job they are empty.'],
];

const JK_VAR_GROUPS = [
  {
    id: 'build',
    tool: 'This run',
    kind: 'groovy',
    title: 'About this run',
    blurb: 'Jenkins sets these for every run. Use them in file names, messages and version labels.',
    commands: [
      { id: 'buildnumber', cmd: `echo "Run number \${env.BUILD_NUMBER}"`, title: 'BUILD_NUMBER', what: 'The number of this run of this job: 1, 2, 3 and so on.', use: 'Use it to label things you make, such as a Docker image tag.', parts: [['env.BUILD_NUMBER', 'The run number, as text.'], ['"..."', 'Double quotes so Groovy fills in the value.']] },
      { id: 'buildurl', cmd: `echo "Details: \${env.BUILD_URL}"`, title: 'BUILD_URL', what: 'The web address of this run’s page in Jenkins.', use: 'Put it in an email or chat message so people can click through to the log.', parts: [['env.BUILD_URL', 'The full address, ending in a slash.']], tips: ['It uses the address in Manage Jenkins > System > Jenkins URL. If that is wrong, the links are wrong.'] },
      { id: 'buildtag', cmd: `echo "\${env.BUILD_TAG}"`, title: 'BUILD_TAG', what: 'A text label for the run: jenkins- plus the job name and run number.', use: 'A unique name to stamp on a file or a container.', parts: [['env.BUILD_TAG', 'For example jenkins-my-app-42.']] },
      { id: 'jobname', cmd: `echo "\${env.JOB_NAME} / \${env.JOB_BASE_NAME}"`, title: 'JOB_NAME and JOB_BASE_NAME', what: 'The job’s name. JOB_NAME includes any folders; JOB_BASE_NAME is the last part only.', use: 'Name a report after the job.', parts: [['JOB_NAME', 'Like team/my-app/main for a job inside folders.'], ['JOB_BASE_NAME', 'Like main.']], careful: 'In multibranch jobs the branch name is part of JOB_NAME, and a / in a branch name is turned into %2F.' },
      { id: 'workspace', cmd: `echo "\${env.WORKSPACE}"`, title: 'WORKSPACE', what: 'The folder on the agent where this run’s files are.', use: 'Build a path to a file the run made.', parts: [['env.WORKSPACE', 'An absolute path, such as /var/jenkins_home/workspace/my-app.']] },
      { id: 'node', cmd: `echo "Running on \${env.NODE_NAME}, executor \${env.EXECUTOR_NUMBER}"`, title: 'NODE_NAME and EXECUTOR_NUMBER', what: 'Which machine runs the build, and which of its slots.', use: 'Find out where a failing build ran.', parts: [['NODE_NAME', 'The agent’s name. Built-in for the controller itself.'], ['EXECUTOR_NUMBER', 'The slot number, starting at 0.']] },
      { id: 'jenkinsurl', cmd: `echo "\${env.JENKINS_URL}"`, title: 'JENKINS_URL', what: 'The address of the Jenkins server.', use: 'Build a link to another page of Jenkins.', parts: [['env.JENKINS_URL', 'Taken from the Jenkins URL setting.']] },
    ],
  },
  {
    id: 'git',
    tool: 'Git',
    kind: 'groovy',
    title: 'About the code',
    blurb: 'These appear after Jenkins checks out your repository. Most come from the Git plugin.',
    commands: [
      { id: 'gitcommit', cmd: `echo "Building commit \${env.GIT_COMMIT}"`, title: 'GIT_COMMIT', what: 'The full ID of the commit being built.', use: 'Tag an image with the exact commit, so you can always find the code that made it.', parts: [['env.GIT_COMMIT', 'A 40-character ID.']], tips: ['A short version: env.GIT_COMMIT.take(7).'] },
      { id: 'gitbranch', cmd: `echo "Branch \${env.GIT_BRANCH}"`, title: 'GIT_BRANCH', what: 'The branch, usually with the remote name in front, such as origin/main.', use: 'Show which branch a run belongs to.', parts: [['env.GIT_BRANCH', 'origin/main in a plain Pipeline job.']], careful: 'In a multibranch job use BRANCH_NAME instead. It has no origin/ in front.' },
      { id: 'giturl', cmd: `echo "\${env.GIT_URL}"`, title: 'GIT_URL', what: 'The address of the repository.', use: 'Print where the code came from.', parts: [['env.GIT_URL', 'The clone address.']] },
    ],
  },
  {
    id: 'multi',
    tool: 'Multibranch only',
    kind: 'groovy',
    title: 'Branches, pull requests and tags',
    blurb: 'Only a multibranch job sets these. In a plain Pipeline job they are empty.',
    commands: [
      { id: 'branchname', cmd: `echo "Branch: \${env.BRANCH_NAME}"`, title: 'BRANCH_NAME', what: 'The name of the branch, or of the pull request (PR-17) or tag being built.', use: 'Choose what to do by branch.', parts: [['env.BRANCH_NAME', 'main, feature-login, PR-17 or v1.2.0.']] },
      { id: 'changeid', cmd: `echo "PR \${env.CHANGE_ID} into \${env.CHANGE_TARGET}"`, title: 'CHANGE_ID and CHANGE_TARGET', what: 'The pull request number, and the branch it wants to merge into.', use: 'Print a note, or skip deploys on pull requests.', parts: [['CHANGE_ID', 'Like 17. Empty if this run is not a pull request.'], ['CHANGE_TARGET', 'Like main.']], tips: ['Also set for pull requests: CHANGE_BRANCH, CHANGE_AUTHOR and CHANGE_URL.'] },
      { id: 'tagname', cmd: `echo "Tag: \${env.TAG_NAME}"`, title: 'TAG_NAME', what: 'The name of the git tag, when the run is for a tag.', use: 'Use the tag as the release version.', parts: [['env.TAG_NAME', 'Like v1.2.0. Empty on a branch.']] },
    ],
  },
  {
    id: 'current',
    tool: 'currentBuild',
    kind: 'groovy',
    title: 'The run in progress',
    blurb: 'currentBuild is an object about the run itself. Read it, or change a few of its fields.',
    commands: [
      { id: 'result', cmd: `echo "So far: \${currentBuild.currentResult}"`, title: 'currentBuild.currentResult', what: 'How the run is going right now: SUCCESS, UNSTABLE or FAILURE.', use: 'Choose a message in a post block.', parts: [['currentResult', 'Always has a value, even mid-run.']], tips: ['currentBuild.result can still be empty until something sets it.'] },
      { id: 'desc', cmd: `script {
    currentBuild.displayName = "#\${env.BUILD_NUMBER} \${env.BRANCH_NAME}"
    currentBuild.description = 'Nightly check'
}`, title: 'displayName and description', what: 'Change the title and the note shown for this run in the list.', use: 'Make a long list of runs easier to scan.', parts: [['script { ... }', 'Lets you write plain Groovy inside a declarative pipeline.'], ['displayName', 'The title.'], ['description', 'A longer note.']] },
      { id: 'duration', cmd: `echo "Took \${currentBuild.durationString}"`, title: 'durationString', what: 'How long the run has taken, as readable text.', use: 'Show the time in a message.', parts: [['durationString', 'Like 2 min 14 sec and counting.']] },
    ],
  },
];

/* ---------------------------------------------------------------------- */

const JK_PLUGIN_WORDS = [
  ['Plugin', 'An add-on for Jenkins. Plugins give it new steps, new job types and new settings.'],
  ['Plugin ID', 'The short code name used in plugins.txt, such as git. It is not always the same as the name in the web page.'],
  ['plugins.txt', 'A file listing the plugins to install, one per line. jenkins-plugin-cli reads it.'],
  ['Pinned version', 'Writing name:version, such as git:5.7.0, so a rebuild installs exactly that version.'],
  ['Dependency', 'A plugin another plugin needs. Jenkins installs those for you.'],
];

const JK_PLUGIN_GROUPS = [
  {
    id: 'core',
    tool: 'Core',
    kind: 'plugins',
    title: 'The essentials',
    blurb: 'Nearly every Jenkins server wants these. Put the ID on its own line in plugins.txt.',
    commands: [
      { id: 'git', cmd: 'git', title: 'Git', what: 'Gets your code from git repositories.', use: 'Needed to check out a repository.', parts: [['git', 'The plugin ID.']] },
      { id: 'workflow', cmd: 'workflow-aggregator', title: 'Pipeline', what: 'A bundle of plugins that together give you Jenkinsfiles and the pipeline steps.', use: 'Needed for any Jenkinsfile.', parts: [['workflow-aggregator', 'The ID is not the name. It is the bundle.']] },
      { id: 'credbind', cmd: 'credentials-binding', title: 'Credentials Binding', what: 'Lets a pipeline use a stored secret in a few steps, with withCredentials.', use: 'Any deploy or login step.', parts: [['credentials-binding', 'Adds withCredentials.']], tips: ['Secrets are masked in the log, but a script that prints them in a changed form can still leak them.'] },
      { id: 'credentials', cmd: 'credentials', title: 'Credentials', what: 'The place where Jenkins stores secrets.', use: 'Installed with most setups. It is a dependency of many others.', parts: [['credentials', 'The store itself.']] },
      { id: 'plaincred', cmd: 'plain-credentials', title: 'Plain Credentials', what: 'Adds the "Secret text" and "Secret file" credential types.', use: 'Store an API token.', parts: [['plain-credentials', 'Secret text and secret file.']] },
      { id: 'casc', cmd: 'configuration-as-code', title: 'Configuration as Code', what: 'Sets up Jenkins from a jenkins.yaml file instead of clicking.', use: 'A server you can rebuild at any time.', parts: [['configuration-as-code', 'Reads the YAML file.']] },
      { id: 'junit', cmd: 'junit', title: 'JUnit', what: 'Reads test result files and shows them as charts.', use: 'The junit step.', parts: [['junit', 'Adds the junit step.']] },
      { id: 'stageview', cmd: 'pipeline-stage-view', title: 'Pipeline Stage View', what: 'Shows each stage of the recent runs as a box on the job page.', use: 'See at a glance which stage failed.', parts: [['pipeline-stage-view', 'The stage boxes.']] },
    ],
  },
  {
    id: 'pipeline',
    tool: 'Pipeline helpers',
    kind: 'plugins',
    title: 'Helpers for pipelines',
    blurb: 'Plugins that add useful steps to a Jenkinsfile.',
    commands: [
      { id: 'docker', cmd: 'docker-workflow', title: 'Docker Pipeline', what: 'Lets a stage run inside a container (agent { docker { ... } }).', use: 'Each build gets a clean, known set of tools.', parts: [['docker-workflow', 'Adds agent docker and the docker step.']], careful: 'The agent machine needs Docker installed.' },
      { id: 'utility', cmd: 'pipeline-utility-steps', title: 'Pipeline Utility Steps', what: 'Adds readJSON, readYaml, writeJSON, zip, unzip and more.', use: 'Read a version number out of a file.', parts: [['pipeline-utility-steps', 'Adds the file helpers.']] },
      { id: 'cleanup', cmd: 'ws-cleanup', title: 'Workspace Cleanup', what: 'Adds the cleanWs step that deletes the run’s files.', use: 'Stop disks from filling up.', parts: [['ws-cleanup', 'Adds cleanWs().']] },
      { id: 'timestamper', cmd: 'timestamper', title: 'Timestamper', what: 'Puts the time in front of every line in the log.', use: 'See which step was slow.', parts: [['timestamper', 'Adds options { timestamps() }.']] },
      { id: 'timeout', cmd: 'build-timeout', title: 'Build Timeout', what: 'Stops a run that takes too long.', use: 'A safety net for stuck runs.', parts: [['build-timeout', 'Works with timeout().']] },
      { id: 'sshagent', cmd: 'ssh-agent', title: 'SSH Agent', what: 'Loads a stored private key for a few steps (sshagent).', use: 'Deploy over SSH.', parts: [['ssh-agent', 'Adds sshagent.']] },
      { id: 'jobdsl', cmd: 'job-dsl', title: 'Job DSL', what: 'Describes jobs in code, so many jobs can be created automatically.', use: 'Combined with Configuration as Code.', parts: [['job-dsl', 'Adds the job DSL.']] },
    ],
  },
  {
    id: 'scm',
    tool: 'Source and notify',
    kind: 'plugins',
    title: 'Source control and messages',
    blurb: 'Connect Jenkins to GitHub or GitLab, and tell people the result.',
    commands: [
      { id: 'github', cmd: 'github', title: 'GitHub', what: 'Links to GitHub and receives its webhooks.', use: 'Start a run the moment someone pushes.', parts: [['github', 'The /github-webhook/ address.']] },
      { id: 'ghbranch', cmd: 'github-branch-source', title: 'GitHub Branch Source', what: 'Finds the branches and pull requests of a GitHub repository for a multibranch job.', use: 'Run tests on every pull request.', parts: [['github-branch-source', 'Adds GitHub as a branch source.']] },
      { id: 'gitlab', cmd: 'gitlab-plugin', title: 'GitLab', what: 'Links to GitLab and receives its webhooks.', use: 'The GitLab equivalent of GitHub.', parts: [['gitlab-plugin', 'GitLab triggers.']] },
      { id: 'mailer', cmd: 'mailer', title: 'Mailer', what: 'Sends a plain email (the mail step).', use: 'Tell someone a build failed.', parts: [['mailer', 'Needs mail settings in System.']] },
      { id: 'emailext', cmd: 'email-ext', title: 'Email Extension', what: 'Richer emails: templates, attachments, rules for when to send.', use: 'A summary email.', parts: [['email-ext', 'Adds emailext.']] },
      { id: 'slack', cmd: 'slack', title: 'Slack Notification', what: 'Sends a message to a Slack channel (slackSend).', use: 'Post results to a team channel.', parts: [['slack', 'Needs a token stored as a credential.']] },
    ],
  },
  {
    id: 'agents',
    tool: 'Agents and access',
    kind: 'plugins',
    title: 'Agents and who may do what',
    blurb: 'Connect build machines, and control permissions.',
    commands: [
      { id: 'sshslaves', cmd: 'ssh-slaves', title: 'SSH Build Agents', what: 'Lets Jenkins log in to a machine over SSH and run builds there.', use: 'A plain Linux machine as an agent.', parts: [['ssh-slaves', 'Adds the SSH launch method.']] },
      { id: 'kubernetes', cmd: 'kubernetes', title: 'Kubernetes', what: 'Starts a pod for each build and removes it afterwards.', use: 'Builds that scale on a cluster.', parts: [['kubernetes', 'Adds agent kubernetes.']] },
      { id: 'matrixauth', cmd: 'matrix-auth', title: 'Matrix Authorization Strategy', what: 'A table of who may do what.', use: 'More than one person with different rights.', parts: [['matrix-auth', 'Adds a permission grid.']] },
      { id: 'rolestrategy', cmd: 'role-strategy', title: 'Role-based Authorization Strategy', what: 'Groups permissions into roles and gives roles to users.', use: 'A team where people share the same rights.', parts: [['role-strategy', 'Adds roles.']] },
    ],
  },
  {
    id: 'pinning',
    tool: 'Versions',
    kind: 'plugins',
    title: 'Pin a version',
    blurb: 'A bare ID installs the newest version. A pinned ID installs exactly one.',
    commands: [
      { id: 'pin', cmd: `# newest each time the image is built
git

# exactly this version
git:5.7.0

# the newest version of a plugin that is also acceptable
workflow-aggregator:latest`, title: 'Pin with a colon', what: 'Put the version after a colon. Then rebuilding next year gives the same plugin.', use: 'Real servers, where a surprise update can break a build.', parts: [['#', 'A comment.'], ['name:version', 'Pin to one version.'], [':latest', 'Always the newest.']], tips: ['The version numbers above are examples. Check the real ones on the Plugins page of your own Jenkins (Manage Jenkins > Plugins > Installed).'] },
    ],
  },
];

/* ---------------------------------------------------------------------- */

const JK_ERR_WORDS = [
  ['Console output', 'The full log of a run. Click a run, then Console Output. The error is usually near the bottom.'],
  ['Sandbox', 'Jenkins runs a Jenkinsfile in a restricted mode and blocks some Groovy methods until an admin approves them.'],
  ['Controller', 'The Jenkins server. Agents are the machines that build.'],
  ['Stack trace', 'A long list of code names printed with an error. Read the first line, and the line that names your file.'],
];

const JK_ERR_GROUPS = [
  {
    id: 'pipe',
    tool: 'Pipeline',
    kind: 'log',
    title: 'Errors in the Jenkinsfile',
    blurb: 'Find the message in Console Output, then match it here. Each one says what it means and how to fix it.',
    commands: [
      { id: 'nodsl', cmd: 'java.lang.NoSuchMethodError: No such DSL method \'xyz\' found among steps', title: 'No such DSL method', what: 'Jenkins does not know the step xyz.', use: 'Most often a typo, or the plugin that provides the step is not installed.', parts: [['No such DSL method', 'The step name is unknown.'], ['found among steps', 'Followed by the list of steps Jenkins does know.']], tips: ['Fix: check the spelling against the Steps reference. Then install the plugin. A step like docker or sshagent needs its plugin.'] },
      { id: 'syntax', cmd: 'WorkflowScript: 12: unexpected token: } @ line 12, column 5.', title: 'Syntax error', what: 'The Groovy is not well formed. The line number points near the problem.', use: 'A missing or extra brace or quote.', parts: [['WorkflowScript: 12', 'The Jenkinsfile, line 12.'], ['unexpected token', 'Something is in the wrong place.']], tips: ['Fix: look at the line above the one named too. Count the { and } and the quotes. Use the generator to get the structure right.'] },
      { id: 'script', cmd: 'Scripts not permitted to use method java.lang.String toUpperCase', title: 'Script Security: not permitted', what: 'The sandbox blocked a Groovy method.', use: 'Appears when a Jenkinsfile uses a method that is not on the safe list.', parts: [['Scripts not permitted', 'The sandbox said no.'], ['method ...', 'Which method it was.']], careful: 'Do not approve it blindly. Approve only code you have read. Manage Jenkins > In-process Script Approval.' },
      { id: 'agenttype', cmd: 'java.lang.NoSuchMethodError: No such DSL method \'docker\' found among steps [... ]\n\nInvalid agent type "docker" specified. Must be one of [any, label, none]', title: 'Invalid agent type "docker"', what: 'The Docker Pipeline plugin is not installed.', use: 'Using agent { docker { ... } }.', parts: [['Invalid agent type', 'Jenkins does not recognise docker as an agent.'], ['Must be one of', 'It lists only the built-in agents.']], tips: ['Fix: install the Docker Pipeline plugin (ID docker-workflow), then run again.'] },
      { id: 'context', cmd: 'org.jenkinsci.plugins.workflow.steps.MissingContextVariableException: Required context class hudson.FilePath is missing', title: 'Required context class hudson.FilePath is missing', what: 'A step that needs a machine and a workspace ran where there is none.', use: 'A sh or checkout step inside a stage that has agent none.', parts: [['hudson.FilePath', 'Jenkins’ name for a folder on an agent.'], ['is missing', 'No agent has been chosen yet.']], tips: ['Fix: wrap the step in a node { ... } block, or give the stage an agent.'] },
      { id: 'creds', cmd: 'ERROR: deploy-key\nFinished: FAILURE', title: 'Credentials not found', what: 'The ID in the Jenkinsfile does not exist, or it is in a place this job cannot see.', use: 'A typo in credentialsId, or the secret was made in another folder.', parts: [['ERROR: deploy-key', 'The ID that could not be found.']], tips: ['Fix: open Manage Jenkins > Credentials and compare the ID letter by letter. IDs are case-sensitive.'] },
      { id: 'nojf', cmd: 'ERROR: Jenkinsfile not found (or: Unable to find Jenkinsfile)', title: 'Jenkinsfile not found', what: 'Jenkins could not find the file where the job looks.', use: 'A wrong name, a wrong folder, or the wrong branch.', parts: [['Script Path', 'The setting that tells the job where the file is.']], tips: ['Fix: the file must be named exactly Jenkinsfile (capital J, no extension) at the top of the repository, or the job’s Script Path must match.'] },
    ],
  },
  {
    id: 'git',
    tool: 'Git and SSH',
    kind: 'log',
    title: 'Errors getting the code or reaching a machine',
    blurb: 'These happen before your own steps run.',
    commands: [
      { id: 'publickey', cmd: 'Permission denied (publickey).', title: 'Permission denied (publickey)', what: 'The other side did not accept the key.', use: 'Git over SSH, or an SSH agent that will not connect.', parts: [['publickey', 'The login method that failed.']], tips: ['Fix: is the public key in authorized_keys (or in your repository’s deploy keys)? Does the credential in Jenkins hold the matching PRIVATE key? Do the folder and file permissions allow it (.ssh 700, authorized_keys 600)?'] },
      { id: 'hostkey', cmd: 'Host key verification failed.', title: 'Host key verification failed', what: 'Jenkins does not know this machine yet, or its identity changed.', use: 'The first time Jenkins connects over SSH.', parts: [['Host key', 'The machine’s fingerprint.']], careful: 'Do not turn verification off on a real network. Add the key: ssh-keyscan -H host >> known_hosts on the Jenkins machine, or choose "Manually trusted key" on the node.' },
      { id: 'auth', cmd: 'stderr: remote: Invalid username or password. fatal: Authentication failed', title: 'Authentication failed', what: 'The username and token for a repository are wrong.', use: 'A private repository over HTTPS.', parts: [['Invalid username or password', 'GitHub no longer takes a password here.']], tips: ['Fix: use a personal access token, stored as a "Username with password" credential. Check it has not expired.'] },
      { id: 'agentoffline', cmd: 'Waiting for next available executor on \'linux\'\n\n(or) \'agent-1\' is offline', title: 'Agent offline, or waiting for an executor', what: 'No free machine has the label the job asked for.', use: 'The run sits in the queue and never starts.', parts: [['Waiting for next available executor', 'Nobody can take the job.'], ['\'linux\'', 'The label it asked for.']], tips: ['Fix: open Manage Jenkins > Nodes. Is the node online? Does it have that label? Is it busy? On the controller, check numExecutors is not 0 if you want it to build.'] },
      { id: 'javaver', cmd: 'java.lang.UnsupportedClassVersionError: ... has been compiled by a more recent version of the Java Runtime', title: 'Java version too old', what: 'The agent runs an older Java than the Jenkins server needs.', use: 'A newly added agent.', parts: [['UnsupportedClassVersionError', 'The code needs a newer Java.']], tips: ['Fix: install the Java version your Jenkins version requires on the agent (the Agent setup generator picks it for you).'] },
    ],
  },
  {
    id: 'docker',
    tool: 'Docker',
    kind: 'log',
    title: 'Errors running Docker',
    blurb: 'When a pipeline or the setup uses Docker.',
    commands: [
      { id: 'sock', cmd: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock', title: 'Docker socket: permission denied', what: 'The user running the build is not allowed to use Docker.', use: 'A Jenkins container, or an agent user, that runs docker.', parts: [['docker.sock', 'The file Docker listens on.'], ['permission denied', 'The user is not in the docker group.']], tips: ['Fix: add the user to the docker group (sudo usermod -aG docker USER, then log in again). For Jenkins in Docker, set group_add with the host’s docker group number.'] },
      { id: 'nodocker', cmd: 'docker: command not found', title: 'docker: command not found', what: 'The docker program is not installed where the step runs.', use: 'A Jenkins container without the Docker CLI.', parts: [['command not found', 'The shell cannot find the program.']], tips: ['Fix: install docker-ce-cli in the image (see the Jenkins setup generator), or choose an agent that has Docker.'] },
      { id: 'pull', cmd: 'Error response from daemon: pull access denied for myimage, repository does not exist or may require \'docker login\'', title: 'Pull access denied', what: 'The image name is wrong, or it is private and you are not logged in.', use: 'agent { docker { image ... } } or docker pull.', parts: [['pull access denied', 'The registry refused.']], tips: ['Fix: check the name and tag. For a private image, log in with a stored credential.'] },
    ],
  },
  {
    id: 'server',
    tool: 'The server',
    kind: 'log',
    title: 'Errors on the Jenkins server',
    blurb: 'Problems with Jenkins itself.',
    commands: [
      { id: 'offline', cmd: 'This Jenkins instance appears to be offline.', title: 'Appears to be offline', what: 'Jenkins cannot reach the internet to download plugins.', use: 'During setup, behind a proxy or with no network.', parts: [['offline', 'No route out.']], tips: ['Fix: check the machine’s network and DNS, or set the proxy in Manage Jenkins > Plugins > Advanced settings.'] },
      { id: 'crumb', cmd: 'HTTP ERROR 403 No valid crumb was included in the request', title: 'No valid crumb', what: 'A request to Jenkins did not carry its anti-forgery token.', use: 'A script or a reverse proxy calling Jenkins.', parts: [['crumb', 'The CSRF token Jenkins checks.']], tips: ['Fix: fetch the crumb first, or use an API token with the Jenkins CLI. A proxy that changes the address can also cause it.'] },
      { id: 'reverse', cmd: 'It appears that your reverse proxy set up is broken.', title: 'Reverse proxy is broken', what: 'The address Jenkins thinks it has does not match the address you use.', use: 'Jenkins behind nginx or a load balancer.', parts: [['reverse proxy', 'A server in front of Jenkins.']], tips: ['Fix: set the Jenkins URL correctly, and make the proxy pass the Host and X-Forwarded headers.'] },
      { id: 'disk', cmd: 'java.io.IOException: No space left on device', title: 'No space left on device', what: 'The disk is full.', use: 'After many builds with no clean-up.', parts: [['No space left', 'Nothing can be written.']], tips: ['Fix: delete old builds (buildDiscarder), clean workspaces (cleanWs), prune Docker (docker system prune).'] },
    ],
  },
];

/* ---------------------------------------------------------------------- */

const JK_ADMIN_WORDS = [
  ['Jenkins CLI', 'A small program, jenkins-cli.jar, that sends commands to the Jenkins server from a terminal.'],
  ['API token', 'A long random password for one user, made on the user’s page. Better than a real password for scripts.'],
  ['Token file', 'A file that holds user:token. The CLI reads it, so the token never appears on the command line.'],
  ['Safe restart', 'Wait for running builds to finish, then restart.'],
  ['Volume', 'A Docker-managed folder that outlives the container. Jenkins keeps all its data in one.'],
];

const JK_ADMIN_GROUPS = [
  {
    id: 'cli',
    tool: 'CLI setup',
    title: 'Start using the CLI',
    blurb: 'Run these in a terminal on your own machine or on the server. Never type the token as part of a command.',
    commands: [
      { id: 'download', cmd: 'curl -fsSL -o jenkins-cli.jar http://localhost:8080/jnlpJars/jenkins-cli.jar', title: 'Download the CLI', what: 'Fetch the command-line program from your own Jenkins.', use: 'Do this once.', parts: [['-f', 'Fail on an error page instead of saving it.'], ['-s', 'Silent: no progress bar.'], ['-S', 'But still show errors.'], ['-L', 'Follow redirects.'], ['-o jenkins-cli.jar', 'The file to save as.']], tips: ['Needs Java installed on the machine you run it from. Change localhost:8080 to your address.'] },
      { id: 'tokenfile', cmd: 'nano ~/.jenkins-token', title: 'Make the token file', what: 'Create a file that holds your login and token as user:token.', use: 'Make the token first: in Jenkins click your name, Security, Add new token. Type one line in the file, such as admin:11aa..., save, then lock it.', parts: [['nano', 'A simple text editor.'], ['~/.jenkins-token', 'A file in your home folder. The name is only a habit.']], careful: 'Never type the token inside a command. It would be saved in your shell history and visible to others on the machine.' },
      { id: 'lock', cmd: 'chmod 600 ~/.jenkins-token', title: 'Lock the token file', what: 'Make the file readable by you only.', use: 'Right after creating it.', parts: [['chmod', 'Change permissions.'], ['600', 'Owner can read and write, nobody else can do anything.']] },
      { id: 'whoami', cmd: 'java -jar jenkins-cli.jar -s http://localhost:8080 -auth @$HOME/.jenkins-token who-am-i', title: 'Check that it works', what: 'Ask Jenkins who you are.', use: 'The first command to try. If it prints your name, the setup is right.', parts: [['java -jar jenkins-cli.jar', 'Run the program.'], ['-s URL', 'The server’s address.'], ['-auth @FILE', 'Read user:token from the file. The @ means "this is a file name, not the login itself".'], ['who-am-i', 'The command to run.']] },
    ],
  },
  {
    id: 'jobs',
    tool: 'Jobs',
    title: 'Jobs and builds',
    blurb: 'Every command below starts with the same first part. A shell variable keeps it short.',
    commands: [
      { id: 'alias', cmd: 'JCLI="java -jar jenkins-cli.jar -s http://localhost:8080 -auth @$HOME/.jenkins-token"', title: 'Shorten the start', what: 'Save the long first part in a variable called JCLI.', use: 'Then write $JCLI list-jobs instead. Valid only in this terminal window.', parts: [['JCLI=', 'Make a variable.'], ['"..."', 'The text to remember.']] },
      { id: 'listjobs', cmd: '$JCLI list-jobs', title: 'List the jobs', what: 'Print the name of every job.', use: 'See what exists.', parts: [['$JCLI', 'Expands to the long first part.'], ['list-jobs', 'The command.']] },
      { id: 'build', cmd: '$JCLI build my-app -s -v', title: 'Start a build and wait', what: 'Run the job and show the result.', use: 'Start a run from a script.', parts: [['build my-app', 'Start the job called my-app.'], ['-s', 'Wait until it finishes.'], ['-v', 'Show the log while waiting.']] },
      { id: 'console', cmd: '$JCLI console my-app', title: 'Read the last log', what: 'Print the console output of the latest run.', use: 'Check what happened without opening the page.', parts: [['console my-app', 'The log of the last run of my-app.']] },
      { id: 'disable', cmd: '$JCLI disable-job my-app', title: 'Turn a job off', what: 'Stop a job from running until you enable it.', use: 'Pause a job during maintenance.', parts: [['disable-job', 'Off. enable-job turns it on.']] },
    ],
  },
  {
    id: 'plugins',
    tool: 'Plugins',
    title: 'Plugins and restarts',
    blurb: 'Check, add and apply changes.',
    commands: [
      { id: 'listplugins', cmd: '$JCLI list-plugins', title: 'List plugins', what: 'Show every installed plugin and its version.', use: 'Check what a server has.', parts: [['list-plugins', 'Name, version and update status.']] },
      { id: 'install', cmd: '$JCLI install-plugin git -restart', title: 'Install a plugin', what: 'Add a plugin by its ID.', use: 'Quick change on a running server.', parts: [['install-plugin git', 'The plugin ID.'], ['-restart', 'Restart afterwards so it takes effect.']], careful: 'A server built from a plugins.txt file loses a plugin added this way when the image is rebuilt. Add it to the file too.' },
      { id: 'reload', cmd: '$JCLI reload-configuration', title: 'Reload the config from disk', what: 'Re-read the settings on disk.', use: 'After editing files by hand.', parts: [['reload-configuration', 'Discards the in-memory settings and reads them again.']] },
      { id: 'casc', cmd: '$JCLI reload-jcasc-configuration', title: 'Reload jenkins.yaml', what: 'Apply a changed jenkins.yaml without a restart.', use: 'After editing the Configuration as Code file.', parts: [['reload-jcasc-configuration', 'Needs the configuration-as-code plugin.']] },
      { id: 'saferestart', cmd: '$JCLI safe-restart', title: 'Restart safely', what: 'Wait for running builds to end, then restart.', use: 'Apply an update.', parts: [['safe-restart', 'Polite. restart interrupts builds right away.']] },
    ],
  },
  {
    id: 'docker',
    tool: 'Docker',
    title: 'Run and look after Jenkins in Docker',
    blurb: 'For a server built with the Jenkins setup generator. Run these on the server, in the folder with docker-compose.yml.',
    commands: [
      { id: 'up', cmd: 'docker compose up -d', title: 'Start it', what: 'Create and start Jenkins in the background.', use: 'First start, and after a reboot if restart is not set.', parts: [['up', 'Create and start.'], ['-d', 'Detached: run in the background.']] },
      { id: 'logs', cmd: 'docker compose logs -f --tail 100 jenkins', title: 'Watch the log', what: 'Show the last 100 lines and follow new ones.', use: 'See why it will not start.', parts: [['logs', 'Show the log.'], ['-f', 'Follow.'], ['--tail 100', 'Begin with the last 100 lines.'], ['jenkins', 'The service name in the compose file.']] },
      { id: 'rebuild', cmd: 'docker compose build --pull && docker compose up -d', title: 'Update Jenkins', what: 'Rebuild the image on the newest base, then replace the container.', use: 'Take a new Jenkins release. Your data stays in the volume.', parts: [['build', 'Build the image.'], ['--pull', 'Fetch the newest base image first.'], ['&&', 'Run the next command only if the first succeeded.']], careful: 'Back up first (next entry).' },
      { id: 'backup', cmd: 'docker run --rm -v jenkins_home:/data -v "$PWD":/backup alpine tar czf /backup/jenkins-backup.tar.gz -C /data .', title: 'Back up the data volume', what: 'Pack everything in the jenkins_home volume into one file in this folder.', use: 'Before any update.', parts: [['docker run --rm', 'Run a throwaway container and delete it after.'], ['-v jenkins_home:/data', 'Show the volume inside as /data.'], ['-v "$PWD":/backup', 'Show this folder as /backup.'], ['alpine', 'A tiny image that has tar.'], ['tar czf FILE', 'c create, z compress, f the file name.'], ['-C /data .', 'Pack the contents of /data.']], tips: ['The volume may be named with a project prefix. Check with docker volume ls.'] },
      { id: 'down', cmd: 'docker compose down', title: 'Stop it', what: 'Stop and remove the container. The data volume is kept.', use: 'Maintenance.', parts: [['down', 'Stop and remove.']], careful: 'Adding -v deletes the data volume too. Do not add it unless you mean to erase Jenkins.' },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = {
  JK_VAR_GROUPS, JK_VAR_WORDS, JK_PLUGIN_GROUPS, JK_PLUGIN_WORDS,
  JK_ERR_GROUPS, JK_ERR_WORDS, JK_ADMIN_GROUPS, JK_ADMIN_WORDS,
};

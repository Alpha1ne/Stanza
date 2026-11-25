'use strict';

/*
  argocd-ref.js — five Argo CD reference pages: concepts, commands, fields,
  statuses and errors.

  Same shape as gha-ref.js. A group with a `kind` shows its examples as a
  plain code block. A group without one shows single-line commands.
*/

/* ===================================================================== *
 *  Concepts
 * ===================================================================== */

const AC_CONCEPT_WORDS = [
  ['GitOps', 'Git is the single source of truth. You change Git, and a tool makes the cluster match it.'],
  ['Argo CD', 'A tool that runs inside Kubernetes, watches Git, and keeps the cluster matching it.'],
  ['Application', 'One thing Argo CD looks after: a Git folder, plus the cluster and namespace to put it in.'],
  ['Sync', 'Making the cluster match Git. Applying the changes.'],
  ['Drift', 'The cluster no longer matches Git, for example because someone edited a resource by hand.'],
  ['Prune', 'Deleting a resource from the cluster because it was removed from Git.'],
  ['Self-heal', 'Argo CD undoing a change made by hand, so the cluster goes back to what Git says.'],
  ['Manifest', 'A YAML file that describes a Kubernetes object.'],
];

const AC_CONCEPT_GROUPS = [
  {
    id: 'idea',
    tool: 'The idea',
    kind: 'yaml',
    title: 'The idea: Git is the truth',
    blurb: 'With Argo CD you stop running kubectl apply by hand. You change files in Git, and Argo CD notices and makes the cluster match.',
    commands: [
      {
        id: 'loop',
        cmd: `Git repository  ──(Argo CD reads)──▶  desired state
Kubernetes      ──(Argo CD reads)──▶  live state
Argo CD compares the two:
  same      → Synced
  different → OutOfSync  → sync → cluster changes to match Git`,
        title: 'The loop Argo CD runs',
        what: 'Argo CD keeps comparing two things: what Git says should exist, and what really exists in the cluster.',
        use: 'This one picture explains most of Argo CD. Every status and setting is about this comparison.',
        parts: [['desired state', 'The YAML in Git.'], ['live state', 'What is actually running in the cluster right now.'], ['Synced', 'They match.'], ['OutOfSync', 'They differ.'], ['sync', 'The step that changes the cluster to match Git.']],
        tips: ['Argo CD checks Git about every 3 minutes. A webhook from your Git host can make it instant.', 'Argo CD runs inside the cluster. It pulls from Git, so your pipeline does not need cluster passwords.'],
      },
      {
        id: 'vscicd',
        cmd: `CI (Jenkins, GitHub Actions):  build, test, publish the image
CD (Argo CD):                  deploy what Git says`,
        title: 'CI builds, Argo CD deploys',
        what: 'The two jobs are separate. A pipeline builds and tests, then updates a file in Git. Argo CD does the deploying.',
        use: 'To see where Argo CD fits next to Jenkins or GitHub Actions in Stanza.',
        parts: [['CI', 'Continuous integration: build and test every change.'], ['CD', 'Continuous delivery: get the tested change running.']],
        tips: ['The usual link: the pipeline commits a new image tag to the config repository, and Argo CD sees the commit.'],
      },
      {
        id: 'pull',
        cmd: `Push model:  pipeline ──kubectl apply──▶ cluster   (the pipeline needs cluster access)
Pull model:  cluster ◀──reads── Git                (Argo CD needs only read access to Git)`,
        title: 'Pull instead of push',
        what: 'Old-style pipelines push changes into the cluster. Argo CD pulls them from Git.',
        use: 'It is safer: the cluster’s keys never leave the cluster, and Git holds a full history of every change.',
        parts: [['Push model', 'The pipeline logs in to the cluster and applies changes.'], ['Pull model', 'A tool inside the cluster reads Git and applies changes.']],
      },
    ],
  },
  {
    id: 'objects',
    tool: 'The objects',
    kind: 'yaml',
    title: 'The objects Argo CD adds to Kubernetes',
    blurb: 'Argo CD adds its own kinds of object. You write them as YAML and apply them like any other.',
    commands: [
      {
        id: 'application',
        cmd: `apiVersion: argoproj.io/v1alpha1
kind: Application`,
        title: 'Application',
        what: 'One deployment unit: where in Git, and where in the cluster.',
        use: 'Make one for every app you want Argo CD to look after.',
        parts: [['argoproj.io/v1alpha1', 'Argo’s group and the version of its object types.'], ['Application', 'The kind.']],
        tips: ['It lives in Argo CD’s own namespace, usually argocd, not in the app’s namespace.'],
      },
      {
        id: 'appproject',
        cmd: `apiVersion: argoproj.io/v1alpha1
kind: AppProject`,
        title: 'AppProject',
        what: 'A fence: which repositories, clusters and namespaces a group of applications may use, and who may do what.',
        use: 'To keep one team’s apps from touching another team’s namespaces.',
        parts: [['AppProject', 'The kind.']],
        tips: ['Every Application belongs to a project. If you name none, it joins "default", which allows everything.'],
      },
      {
        id: 'appset',
        cmd: `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet`,
        title: 'ApplicationSet',
        what: 'A factory. One template plus a generator makes many Applications.',
        use: 'The same app in dev, staging and prod, or one app for every folder or cluster.',
        parts: [['ApplicationSet', 'The kind.']],
        tips: ['Deleting an ApplicationSet deletes the Applications it made.'],
      },
      {
        id: 'repo',
        cmd: `metadata:
  labels:
    argocd.argoproj.io/secret-type: repository`,
        title: 'Repository (a labelled Secret)',
        what: 'Argo CD stores repository logins in ordinary Kubernetes Secrets that carry a special label.',
        use: 'To give Argo CD access to a private repository.',
        parts: [['secret-type: repository', 'The label that makes Argo CD read the Secret as a repository login.']],
        careful: 'A Secret is only encoded, not encrypted. Limit who can read Secrets in the argocd namespace.',
      },
    ],
  },
  {
    id: 'patterns',
    tool: 'Patterns',
    kind: 'yaml',
    title: 'Patterns you will meet',
    blurb: 'Ways people organise Argo CD once they have more than one app.',
    commands: [
      {
        id: 'appofapps',
        cmd: `# One Application whose folder holds other Application files.
spec:
  source:
    repoURL: https://github.com/example/platform.git
    path: apps`,
        title: 'App of apps',
        what: 'One Application points at a folder full of Application YAML files. Syncing it creates all the others.',
        use: 'Bootstrap a whole cluster from a single command. Add an app by adding a file.',
        parts: [['path: apps', 'A folder that contains Application manifests, not ordinary workloads.']],
        tips: ['An ApplicationSet with a Git generator does the same thing more flexibly.'],
      },
      {
        id: 'envs',
        cmd: `overlays/
  dev/
  staging/
  prod/`,
        title: 'One folder per environment',
        what: 'The same app in several environments, kept as separate folders (often Kustomize overlays) in one repository.',
        use: 'Promote a change by editing one folder, then the next.',
        parts: [['overlays/dev', 'Settings for dev.'], ['overlays/prod', 'Settings for prod.']],
        tips: ['Prefer folders over branches. Branches drift apart and are hard to compare.'],
      },
      {
        id: 'waves',
        cmd: `metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "1"`,
        title: 'Sync waves',
        what: 'A number that sets the order resources are applied in. Lower waves go first, and Argo CD waits until each wave is healthy.',
        use: 'Create the database before the app that needs it.',
        parts: [['sync-wave', 'The annotation name.'], ['"1"', 'The wave. It is written as text. The default is 0. Negative numbers are allowed.']],
        tips: ['Use quotes around the number, or the file is invalid.'],
      },
      {
        id: 'hooks',
        cmd: `metadata:
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded`,
        title: 'Hooks',
        what: 'A Job that runs at a set moment of a sync, such as before it (PreSync) or after it (PostSync).',
        use: 'Run a database migration before the new version starts.',
        parts: [['hook: PreSync', 'Run before the normal resources are applied. Others: Sync, PostSync, SyncFail.'], ['hook-delete-policy', 'When to delete the finished hook. HookSucceeded deletes it after it works.']],
      },
    ],
  },
];

/* ===================================================================== *
 *  Commands
 * ===================================================================== */

const AC_COMMAND_WORDS = [
  ['argocd', 'The Argo CD command-line tool. It talks to the Argo CD server.'],
  ['Server', 'The Argo CD API server inside the cluster. The command logs in to it.'],
  ['Context', 'A saved login. The argocd command remembers it between runs.'],
  ['--insecure', 'Skip checking the server’s certificate. Fine for a local test, never for a real system.'],
];

const AC_COMMAND_GROUPS = [
  {
    id: 'login',
    tool: 'Log in',
    title: 'Log in and look around',
    blurb: 'Commands for connecting the argocd tool to a server. Anything that asks for a password uses a hidden prompt: never type a password as a flag.',
    commands: [
      {
        id: 'login',
        cmd: 'argocd login localhost:8080 --username admin --insecure',
        title: 'Log in',
        what: 'Connects the command to an Argo CD server and saves the login. It asks for the password with a hidden prompt.',
        use: 'The first command you run. For a local test, port-forward the server first.',
        parts: [['argocd login', 'Log in.'], ['localhost:8080', 'The server’s address and port.'], ['--username admin', 'Who to log in as.'], ['--insecure', 'Accept the server’s self-made certificate. Local tests only.']],
        careful: 'Do not use --password on the command line. It would show in your shell history and in the process list.',
      },
      {
        id: 'initpw',
        cmd: 'argocd admin initial-password -n argocd',
        title: 'Read the first password',
        what: 'Prints the one-time password Argo CD made for the admin user at install time.',
        use: 'Once, right after installing.',
        parts: [['admin initial-password', 'Read the first password from the cluster.'], ['-n argocd', 'The namespace Argo CD is installed in.']],
        tips: ['Change the password, then delete the argocd-initial-admin-secret Secret.'],
      },
      {
        id: 'updatepw',
        cmd: 'argocd account update-password',
        title: 'Change your password',
        what: 'Sets a new password for the logged-in account. It asks for the old and the new one with hidden prompts.',
        use: 'Right after the first login.',
        parts: [['account update-password', 'Change the password of the account you are logged in as.']],
      },
      {
        id: 'version',
        cmd: 'argocd version',
        title: 'Check the version',
        what: 'Prints the version of the command and of the server it is connected to.',
        use: 'To check the install worked, or when asking for help.',
        parts: [['version', 'Print versions.']],
      },
      {
        id: 'context',
        cmd: 'argocd context',
        title: 'List saved logins',
        what: 'Shows every server you have logged in to, and which one is current.',
        use: 'When you work with more than one Argo CD.',
        parts: [['context', 'List the saved logins.']],
      },
    ],
  },
  {
    id: 'apps',
    tool: 'Applications',
    title: 'Look after applications',
    blurb: 'The commands you use every day.',
    commands: [
      {
        id: 'list',
        cmd: 'argocd app list',
        title: 'List applications',
        what: 'Shows every application with its sync status and health.',
        use: 'A quick look at what is running and what is out of sync.',
        parts: [['app list', 'List the applications.']],
        tips: ['Add -o wide for more columns, or -p NAME to show one project only.'],
      },
      {
        id: 'get',
        cmd: 'argocd app get guestbook',
        title: 'Show one application',
        what: 'Shows the application’s settings, sync status, health, and every resource it manages.',
        use: 'To find out why an application is not healthy.',
        parts: [['app get', 'Show one application.'], ['guestbook', 'The application’s name.']],
        tips: ['Add --refresh to make Argo CD check Git again right now.'],
      },
      {
        id: 'create',
        cmd: 'argocd app create guestbook --repo https://github.com/argoproj/argocd-example-apps.git --path guestbook --dest-server https://kubernetes.default.svc --dest-namespace default',
        title: 'Create an application',
        what: 'Makes an Application from flags, without writing a YAML file.',
        use: 'Quick experiments. For real use, keep an Application YAML in Git.',
        parts: [['app create guestbook', 'Make an application with this name.'], ['--repo', 'The Git repository.'], ['--path', 'The folder in the repository.'], ['--dest-server', 'The cluster’s address. This one means "the cluster Argo CD runs in".'], ['--dest-namespace', 'The namespace to deploy into.']],
        tips: ['An Application created by hand is not in Git. If someone deletes it, nothing brings it back.'],
      },
      {
        id: 'diff',
        cmd: 'argocd app diff guestbook',
        title: 'See the differences',
        what: 'Shows what is different between Git and the cluster, line by line, like git diff.',
        use: 'Before syncing, to see what would change.',
        parts: [['app diff', 'Compare Git with the cluster.']],
      },
      {
        id: 'sync',
        cmd: 'argocd app sync guestbook',
        title: 'Sync now',
        what: 'Applies what is in Git to the cluster.',
        use: 'When automatic sync is off, or to sync without waiting for the next check.',
        parts: [['app sync', 'Make the cluster match Git.']],
        tips: ['--dry-run shows what would happen. --prune also deletes extra resources. --force replaces resources and can cause downtime.'],
      },
      {
        id: 'wait',
        cmd: 'argocd app wait guestbook --health --timeout 300',
        title: 'Wait until it is healthy',
        what: 'Pauses until the application is healthy, or until the time runs out.',
        use: 'In a script: do not go on until the deploy has worked.',
        parts: [['app wait', 'Pause until a condition is true.'], ['--health', 'The condition: healthy.'], ['--timeout 300', 'Give up after 300 seconds.']],
      },
      {
        id: 'history',
        cmd: 'argocd app history guestbook',
        title: 'See past syncs',
        what: 'Lists earlier syncs with their ID, time and the Git commit each one used.',
        use: 'To find the last version that worked.',
        parts: [['app history', 'List past syncs.']],
      },
      {
        id: 'rollback',
        cmd: 'argocd app rollback guestbook 3',
        title: 'Go back to an earlier sync',
        what: 'Puts the cluster back to how it was at sync number 3.',
        use: 'An emergency exit after a bad deploy.',
        parts: [['app rollback', 'Go back.'], ['3', 'The ID from app history.']],
        careful: 'Rollback does not work while automatic sync is on, and Git still holds the bad version. The real fix is to revert the commit in Git.',
      },
      {
        id: 'logs',
        cmd: 'argocd app logs guestbook --follow',
        title: 'Read the logs',
        what: 'Shows the logs of the application’s pods.',
        use: 'To see why a pod crashes, without finding its name.',
        parts: [['app logs', 'Show pod logs.'], ['--follow', 'Keep printing new lines. Press Ctrl+C to stop.']],
      },
      {
        id: 'delete',
        cmd: 'argocd app delete guestbook',
        title: 'Delete an application',
        what: 'Removes the Application. With the finalizer in place it also deletes everything the app deployed.',
        use: 'When an app is retired.',
        parts: [['app delete', 'Delete the application.']],
        careful: 'This can delete a running app. Check with app get first.',
      },
    ],
  },
  {
    id: 'admin',
    tool: 'Repos, clusters and projects',
    title: 'Repositories, clusters and projects',
    blurb: 'Setting up what applications use.',
    commands: [
      {
        id: 'repolist',
        cmd: 'argocd repo list',
        title: 'List repositories',
        what: 'Shows the repositories Argo CD knows and whether it can connect to each.',
        use: 'After adding a private repository, look for Successful.',
        parts: [['repo list', 'List repositories.']],
      },
      {
        id: 'repoadd',
        cmd: 'argocd repo add git@github.com:example/shop-config.git --ssh-private-key-path ~/.ssh/argocd_deploy',
        title: 'Add a repository with an SSH key',
        what: 'Tells Argo CD how to read a private repository, using a key file.',
        use: 'When the repository is private. The Stanza Private repository generator does the same safely.',
        parts: [['repo add', 'Add a repository.'], ['git@github.com:example/shop-config.git', 'Its SSH address.'], ['--ssh-private-key-path', 'The private key file. The key itself never appears on the command line.']],
        careful: 'For a token, do not use --password. Use the Stanza Private repository generator, which asks with a hidden prompt.',
      },
      {
        id: 'clusteradd',
        cmd: 'argocd cluster add my-context',
        title: 'Add another cluster',
        what: 'Registers another Kubernetes cluster, so Argo CD can deploy to it.',
        use: 'To run one Argo CD that manages several clusters.',
        parts: [['cluster add', 'Register a cluster.'], ['my-context', 'The name of the context in your kubeconfig.']],
        tips: ['It creates a service account with broad rights on that cluster. Guard Argo CD accordingly.'],
      },
      {
        id: 'clusterlist',
        cmd: 'argocd cluster list',
        title: 'List clusters',
        what: 'Shows every cluster Argo CD can deploy to, and whether it can connect.',
        use: 'To get a cluster’s name or address for an Application.',
        parts: [['cluster list', 'List clusters.']],
      },
      {
        id: 'projlist',
        cmd: 'argocd proj list',
        title: 'List projects',
        what: 'Shows every project.',
        use: 'To see what fences exist.',
        parts: [['proj list', 'List projects.']],
      },
      {
        id: 'projtoken',
        cmd: 'argocd proj role create-token shop deployer',
        title: 'Make a token for a project role',
        what: 'Creates a token that carries the permissions of one role, for a pipeline or a script.',
        use: 'Let a pipeline run argocd app sync, and nothing else.',
        parts: [['proj role create-token', 'Make a token.'], ['shop', 'The project.'], ['deployer', 'The role.']],
        careful: 'The token is printed once. Put it in a secret store, never in a file or in Git.',
      },
    ],
  },
];

/* ===================================================================== *
 *  Fields
 * ===================================================================== */

const AC_FIELD_WORDS = [
  ['Field', 'One setting in a YAML file, such as targetRevision.'],
  ['spec', 'The section that says what you want. Everything important in an Application is under spec.'],
  ['annotation', 'A label that carries a value. Argo CD reads some annotations on your resources, such as sync-wave.'],
  ['finalizer', 'A hold on deletion. Kubernetes waits for the controller to clear it.'],
];

const AC_FIELD_GROUPS = [
  {
    id: 'source',
    tool: 'Source',
    kind: 'yaml',
    title: 'Where the config comes from',
    blurb: 'The source section of an Application.',
    commands: [
      {
        id: 'git',
        cmd: `source:
  repoURL: https://github.com/example/shop-config.git
  targetRevision: main
  path: overlays/prod`,
        title: 'A Git source',
        what: 'The repository, the branch, and the folder to read.',
        use: 'Almost every Application.',
        parts: [['repoURL', 'The Git repository.'], ['targetRevision', 'A branch, a tag or a commit. HEAD means the default branch.'], ['path', 'The folder in the repository.']],
        tips: ['A tag or commit never changes under you. A branch moves with every push.'],
      },
      {
        id: 'helm',
        cmd: `source:
  repoURL: https://github.com/example/charts.git
  path: shop
  helm:
    releaseName: shop
    valueFiles:
      - values-prod.yaml`,
        title: 'A Helm chart',
        what: 'Treat the folder as a Helm chart and pick which values files override its defaults.',
        use: 'When the config is a Helm chart.',
        parts: [['helm', 'Helm settings.'], ['releaseName', 'The name Helm uses for the install.'], ['valueFiles', 'Files, relative to the chart folder, that override the defaults.']],
        tips: ['Argo CD runs helm template itself. It does not run helm install, so Helm hooks work differently.'],
      },
      {
        id: 'kustomize',
        cmd: `source:
  repoURL: https://github.com/example/shop-config.git
  path: overlays/prod
  kustomize:
    namePrefix: prod-`,
        title: 'Kustomize',
        what: 'Treat the folder as Kustomize and add settings on top of its kustomization.yaml.',
        use: 'One base with an overlay for each environment.',
        parts: [['kustomize', 'Kustomize settings.'], ['namePrefix', 'Put this at the start of every resource name.']],
      },
      {
        id: 'sources',
        cmd: `sources:
  - repoURL: https://charts.example.com
    chart: shop
    targetRevision: 1.4.0
    helm:
      valueFiles:
        - $values/prod/values.yaml
  - repoURL: https://github.com/example/values.git
    targetRevision: main
    ref: values`,
        title: 'Several sources',
        what: 'Use more than one source. A common use is a chart from one place and its values file from your own Git.',
        use: 'Keep third-party charts untouched, and your own values in Git.',
        parts: [['sources', 'A list. Use it instead of source, never both.'], ['chart', 'A chart from a Helm repository, instead of a Git path.'], ['ref: values', 'Gives this source a name, so the other source can read its files.'], ['$values/...', 'A file from the source named values.']],
      },
    ],
  },
  {
    id: 'dest',
    tool: 'Destination and policy',
    kind: 'yaml',
    title: 'Where it goes and how it is synced',
    blurb: 'The destination and syncPolicy sections.',
    commands: [
      {
        id: 'destination',
        cmd: `destination:
  server: https://kubernetes.default.svc
  namespace: shop`,
        title: 'destination',
        what: 'The cluster, and the namespace on it.',
        use: 'Every Application.',
        parts: [['server', 'The cluster’s API address. This address always means the cluster Argo CD runs in.'], ['name', 'Another way to name the cluster: by the name Argo CD stores. Use server or name, not both.'], ['namespace', 'The namespace to deploy into.']],
      },
      {
        id: 'automated',
        cmd: `syncPolicy:
  automated:
    prune: true
    selfHeal: true`,
        title: 'automated',
        what: 'Turns on automatic sync. Without this block, syncing is manual.',
        use: 'When you trust Git as the truth and want changes to flow by themselves.',
        parts: [['automated', 'Sync by itself when Git changes.'], ['prune', 'Delete resources that were removed from Git.'], ['selfHeal', 'Undo changes made by hand in the cluster.']],
        careful: 'prune: true deletes real resources, including data volumes if they are in Git. Start with prune off and turn it on when you are sure.',
      },
      {
        id: 'syncoptions',
        cmd: `syncPolicy:
  syncOptions:
    - CreateNamespace=true
    - ServerSideApply=true
    - PruneLast=true`,
        title: 'syncOptions',
        what: 'Extra switches for how a sync works.',
        use: 'Create namespaces, handle huge resources, and delete old things only after the new ones are healthy.',
        parts: [['CreateNamespace=true', 'Create the namespace if it is missing.'], ['ServerSideApply=true', 'Let the cluster merge changes. Handles very large resources.'], ['PruneLast=true', 'Delete removed resources only at the end of the sync.'], ['ApplyOutOfSyncOnly=true', 'Apply only the resources that differ. Quicker for big apps.'], ['Replace=true', 'Delete and re-create instead of patching. Risky: it can cause downtime.']],
      },
      {
        id: 'retry',
        cmd: `syncPolicy:
  retry:
    limit: 5
    backoff:
      duration: 5s
      factor: 2
      maxDuration: 3m`,
        title: 'retry',
        what: 'What to do when a sync fails: try again, with growing pauses.',
        use: 'Handles brief problems, such as a namespace that is still being created.',
        parts: [['limit', 'How many more times to try. A negative number means forever.'], ['duration', 'The wait before the first retry.'], ['factor', 'The wait is multiplied by this each time.'], ['maxDuration', 'The longest wait.']],
      },
      {
        id: 'ignore',
        cmd: `ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
      - /spec/replicas`,
        title: 'ignoreDifferences',
        what: 'Fields Argo CD should not treat as drift.',
        use: 'An autoscaler changes replicas all the time. Without this Argo CD fights it and shows OutOfSync.',
        parts: [['group', 'The resource’s API group. Deployments are in apps. Core kinds such as Service use an empty "".'], ['kind', 'The resource type.'], ['jsonPointers', 'Paths to the fields to ignore.']],
        tips: ['Add RespectIgnoreDifferences=true to syncOptions so a sync does not overwrite them either.'],
      },
      {
        id: 'finalizer',
        cmd: `metadata:
  finalizers:
    - resources-finalizer.argocd.argoproj.io`,
        title: 'finalizers',
        what: 'Makes deleting the Application also delete everything it deployed.',
        use: 'When removing an app should really remove it.',
        parts: [['resources-finalizer.argocd.argoproj.io', 'The exact name. A typo is silently ignored.']],
        careful: 'Without it, deleting an Application leaves its resources running with nothing managing them.',
      },
    ],
  },
  {
    id: 'annot',
    tool: 'Annotations',
    kind: 'yaml',
    title: 'Annotations on your own resources',
    blurb: 'Argo CD reads some annotations that you add to the resources in Git.',
    commands: [
      {
        id: 'compare',
        cmd: `metadata:
  annotations:
    argocd.argoproj.io/compare-options: IgnoreExtraneous`,
        title: 'compare-options',
        what: 'Tells Argo CD to ignore this resource when working out whether the app is in sync.',
        use: 'A resource that the cluster or a tool changes by itself.',
        parts: [['IgnoreExtraneous', 'Do not count this resource as out of sync.']],
      },
      {
        id: 'syncopt',
        cmd: `metadata:
  annotations:
    argocd.argoproj.io/sync-options: Prune=false`,
        title: 'sync-options on one resource',
        what: 'A sync option that applies to one resource only.',
        use: 'Protect a volume from being deleted, even when prune is on.',
        parts: [['Prune=false', 'Never delete this resource, even if it is removed from Git.'], ['Delete=false', 'Do not delete it when the Application is deleted.']],
      },
      {
        id: 'managed',
        cmd: `metadata:
  annotations:
    argocd.argoproj.io/tracking-id: shop:apps/Deployment:shop/web`,
        title: 'tracking-id (added by Argo CD)',
        what: 'Argo CD writes this on every resource it manages, to remember which Application owns it.',
        use: 'Read it to find out who owns a resource.',
        parts: [['tracking-id', 'Application name, then the resource’s group, kind, namespace and name.']],
        careful: 'Do not copy or edit it by hand. Two Applications claiming the same resource cause a SharedResourceWarning.',
      },
    ],
  },
];

/* ===================================================================== *
 *  Statuses
 * ===================================================================== */

const AC_STATUS_WORDS = [
  ['Sync status', 'Does the cluster match Git? Synced or OutOfSync.'],
  ['Health status', 'Is the app actually working? Healthy, Progressing, Degraded and so on.'],
  ['Operation', 'A sync that is running or has finished, with its own result.'],
  ['Hook', 'A job that runs at a set moment of a sync.'],
];

const AC_STATUS_GROUPS = [
  {
    id: 'sync',
    tool: 'Sync status',
    kind: 'log',
    title: 'Sync status: Git against the cluster',
    blurb: 'The answer to "does the cluster match Git?"',
    commands: [
      {
        id: 'synced',
        cmd: 'Sync Status: Synced to HEAD (4a1f9c2)',
        title: 'Synced',
        what: 'The cluster matches Git at the commit shown.',
        use: 'This is the goal. It says nothing about whether the app works. Check Health too.',
        parts: [['Synced', 'No differences.'], ['HEAD (4a1f9c2)', 'The branch, and the commit that was compared.']],
      },
      {
        id: 'outofsync',
        cmd: 'Sync Status: OutOfSync from HEAD (4a1f9c2)',
        title: 'OutOfSync',
        what: 'Git and the cluster differ.',
        use: 'Expected right after a push when sync is manual. A problem if it stays after an automatic sync.',
        parts: [['OutOfSync', 'There is at least one difference.']],
        tips: ['Run argocd app diff NAME to see the difference.', 'If it never turns Synced, a controller may be changing a field. Add it to ignoreDifferences.'],
      },
      {
        id: 'unknown',
        cmd: 'Sync Status: Unknown',
        title: 'Unknown',
        what: 'Argo CD could not compare, so it does not know.',
        use: 'Usually the repository or the manifests could not be read. The Conditions section says why.',
        parts: [['Unknown', 'No comparison was possible.']],
        tips: ['Run argocd app get NAME and read Conditions at the bottom, for example ComparisonError.'],
      },
    ],
  },
  {
    id: 'health',
    tool: 'Health status',
    kind: 'log',
    title: 'Health status: is it working?',
    blurb: 'Argo CD checks the real state of each resource. The application takes the worst one.',
    commands: [
      {
        id: 'healthy',
        cmd: 'Health Status: Healthy',
        title: 'Healthy',
        what: 'Every resource is working: Deployments have all their pods ready, and Services have endpoints.',
        use: 'The other half of the goal.',
        parts: [['Healthy', 'Everything is as it should be.']],
      },
      {
        id: 'progressing',
        cmd: 'Health Status: Progressing',
        title: 'Progressing',
        what: 'Something is still starting or updating, but has not failed yet.',
        use: 'Normal for a minute or two after a sync.',
        parts: [['Progressing', 'Not ready yet.']],
        tips: ['If it stays Progressing for a long time, a pod is probably stuck. Run kubectl get pods -n NAMESPACE.'],
      },
      {
        id: 'degraded',
        cmd: 'Health Status: Degraded',
        title: 'Degraded',
        what: 'A resource failed, for example pods that crash, or a Deployment that cannot finish.',
        use: 'Look at the pods: kubectl describe pod, and argocd app logs.',
        parts: [['Degraded', 'Something is broken.']],
      },
      {
        id: 'suspended',
        cmd: 'Health Status: Suspended',
        title: 'Suspended',
        what: 'Something is paused on purpose, such as a suspended CronJob or a paused rollout.',
        use: 'Usually fine.',
        parts: [['Suspended', 'Paused.']],
      },
      {
        id: 'missing',
        cmd: 'Health Status: Missing',
        title: 'Missing',
        what: 'Git describes a resource that does not exist in the cluster.',
        use: 'Normal before the first sync.',
        parts: [['Missing', 'Not in the cluster yet.']],
      },
    ],
  },
  {
    id: 'ops',
    tool: 'Operations',
    kind: 'log',
    title: 'The result of a sync',
    blurb: 'Each sync is an operation with its own outcome.',
    commands: [
      {
        id: 'succeeded',
        cmd: 'Operation: Sync\nPhase: Succeeded\nMessage: successfully synced (all tasks run)',
        title: 'Succeeded',
        what: 'The sync ran and every resource was applied.',
        use: 'Then check Health.',
        parts: [['Phase: Succeeded', 'The sync worked.']],
      },
      {
        id: 'running',
        cmd: 'Operation: Sync\nPhase: Running',
        title: 'Running',
        what: 'A sync is in progress.',
        use: 'Wait. Hooks and waves can make it take a while.',
        parts: [['Phase: Running', 'Still going.']],
        tips: ['Another sync cannot start until this one ends. You may see "another operation is already in progress".'],
      },
      {
        id: 'failed',
        cmd: 'Operation: Sync\nPhase: Failed\nMessage: one or more objects failed to apply',
        title: 'Failed',
        what: 'At least one resource could not be applied.',
        use: 'The line under Message says which one and why. Retry, if set, will run again.',
        parts: [['Phase: Failed', 'The sync did not finish.'], ['one or more objects failed to apply', 'Look further down for the specific resource and its error.']],
        tips: ['Run argocd app get NAME to see per-resource messages.'],
      },
    ],
  },
];

/* ===================================================================== *
 *  Errors
 * ===================================================================== */

const AC_ERROR_WORDS = [
  ['Condition', 'A problem Argo CD records on the Application. Shown at the bottom of argocd app get.'],
  ['ComparisonError', 'Argo CD could not work out what Git says, so it cannot compare.'],
  ['Refresh', 'Make Argo CD read Git again right now.'],
  ['Hard refresh', 'A refresh that also throws away Argo CD’s cached copy of the manifests.'],
];

const AC_ERROR_GROUPS = [
  {
    id: 'repo',
    tool: 'Repository',
    kind: 'log',
    title: 'Argo CD cannot read the repository',
    blurb: 'These show in the Conditions of an application. Fix them first: nothing else works until Git can be read.',
    commands: [
      {
        id: 'auth',
        cmd: 'rpc error: code = Unknown desc = authentication required',
        title: 'Authentication required',
        what: 'The repository is private and Argo CD has no login for it.',
        use: 'A new app that points at a private repository.',
        parts: [['authentication required', 'Git asked for a login and none was given.']],
        tips: ['Add the repository with the Private repository generator, then run argocd repo list.', 'Check the token has not expired, and that it can read this exact repository.'],
      },
      {
        id: 'notfound',
        cmd: 'repository not found',
        title: 'Repository not found',
        what: 'The address is wrong, or the login is allowed to see nothing there.',
        use: 'A typo in the address, or a token for the wrong account.',
        parts: [['repository not found', 'Git says it does not exist, or you may not see it.']],
        tips: ['GitHub reports a private repository you cannot read as "not found", not "forbidden".'],
      },
      {
        id: 'x509',
        cmd: 'x509: certificate signed by unknown authority',
        title: 'Certificate signed by unknown authority',
        what: 'The Git server uses a certificate that Argo CD does not trust, often one from your company.',
        use: 'A self-hosted Git server.',
        parts: [['x509', 'The certificate standard.'], ['unknown authority', 'The signer is not in Argo CD’s list.']],
        careful: 'Do not turn the check off for a real system. Add the company certificate to Argo CD’s argocd-tls-certs-cm instead.',
      },
      {
        id: 'resolve',
        cmd: "rpc error: code = Unknown desc = Unable to resolve 'mian' to a commit SHA",
        title: 'Unable to resolve to a commit',
        what: 'The branch, tag or commit in targetRevision does not exist.',
        use: 'A typo, or a branch that was deleted.',
        parts: [["'mian'", 'The value Argo CD tried. Here a typo of main.'], ['commit SHA', 'The ID of a commit.']],
      },
      {
        id: 'path',
        cmd: 'app path does not exist',
        title: 'App path does not exist',
        what: 'The folder named in path is not in the repository at that revision.',
        use: 'A wrong folder name, or a folder that exists only on another branch.',
        parts: [['app path', 'The path setting.'], ['does not exist', 'Nothing is there.']],
        tips: ['A leading slash, a wrong capital letter or a missing sub-folder are common.'],
      },
    ],
  },
  {
    id: 'sync',
    tool: 'Syncing',
    kind: 'log',
    title: 'A sync fails or never finishes',
    blurb: 'The repository can be read, but applying it goes wrong.',
    commands: [
      {
        id: 'crd',
        cmd: 'The Kubernetes API could not find argoproj.io/Rollout for requested resource shop/web.\nMake sure the "Rollout" CRD is installed on the destination cluster.',
        title: 'CRD is not installed',
        what: 'Your files use a kind that the cluster does not know yet.',
        use: 'A custom resource, such as a Rollout or a Certificate, applied before the tool that defines it.',
        parts: [['Rollout', 'The kind that is missing.'], ['CRD', 'A custom resource definition: what teaches Kubernetes a new kind.']],
        tips: ['Install the controller first, in an earlier sync wave.', 'Add SkipDryRunOnMissingResource=true to syncOptions if the CRD is created in the same sync.'],
      },
      {
        id: 'ns',
        cmd: 'namespaces "shop" not found',
        title: 'Namespace not found',
        what: 'The namespace does not exist, and the app was not told to create it.',
        use: 'The first sync of a new app.',
        parts: [['namespaces "shop" not found', 'No namespace with that name.']],
        tips: ['Add CreateNamespace=true to syncOptions, or put a Namespace in your files.'],
      },
      {
        id: 'denied',
        cmd: 'application destination {https://kubernetes.default.svc kube-system} is not permitted in project \'shop\'',
        title: 'Destination not permitted in project',
        what: 'The application tries to use a cluster or namespace that its project does not allow.',
        use: 'A project’s destinations list is missing this namespace.',
        parts: [['destination', 'The cluster and the namespace the app asked for.'], ["project 'shop'", 'The fence that said no.']],
        tips: ['Check destinations in the project, or deploy to an allowed namespace. Patterns such as shop-* are allowed.'],
      },
      {
        id: 'repodenied',
        cmd: "application repo https://github.com/example/other.git is not permitted in project 'shop'",
        title: 'Repository not permitted in project',
        what: 'The project’s sourceRepos list does not include this repository.',
        use: 'Moving an app to a new repository without updating the project.',
        parts: [['is not permitted in project', 'The project refused the repository.']],
      },
      {
        id: 'cluster',
        cmd: 'resource :Namespace is not permitted in project shop',
        title: 'Cluster resource not permitted',
        what: 'The files create something cluster-wide, such as a Namespace, and the project does not allow it.',
        use: 'An app with CreateNamespace=true in a project that allows no cluster-wide kinds.',
        parts: [[':Namespace', 'The group (empty) and the kind.']],
        tips: ['Add Namespace to clusterResourceWhitelist in the project.'],
      },
      {
        id: 'inprogress',
        cmd: 'another operation is already in progress',
        title: 'Another operation is already in progress',
        what: 'A sync is still running, or a previous one got stuck.',
        use: 'Clicking Sync twice, or a hook that never ends.',
        parts: [['operation', 'A sync or rollback.']],
        tips: ['Wait, or end it with argocd app terminate-op NAME.'],
      },
      {
        id: 'immutable',
        cmd: 'Deployment.apps "web" is invalid: spec.selector: Invalid value: field is immutable',
        title: 'Field is immutable',
        what: 'You changed something Kubernetes does not allow to change after creation, such as a Deployment’s selector.',
        use: 'Renaming labels on an existing Deployment.',
        parts: [['immutable', 'Cannot be changed after the resource exists.']],
        tips: ['Delete the resource, then sync, or use the Replace=true sync option for this resource. Expect downtime.'],
      },
    ],
  },
  {
    id: 'stuck',
    tool: 'Stuck and unexpected',
    kind: 'log',
    title: 'Stuck, looping or surprising',
    blurb: 'Nothing fails loudly, but the result is not what you wanted.',
    commands: [
      {
        id: 'loop',
        cmd: 'Sync Status: OutOfSync (it comes back after every sync)',
        title: 'OutOfSync again straight after syncing',
        what: 'Something in the cluster changes a field right after Argo CD sets it, so the two never match.',
        use: 'An autoscaler changing replicas, or an operator adding fields.',
        parts: [['comes back', 'Another controller is editing the same field.']],
        tips: ['Run argocd app diff NAME to see which field.', 'Add that field to ignoreDifferences.'],
      },
      {
        id: 'shared',
        cmd: 'SharedResourceWarning: Deployment/web is part of applications shop-dev and shop-prod',
        title: 'SharedResourceWarning',
        what: 'Two applications claim the same resource, so they fight over it.',
        use: 'Two Applications pointing at overlapping folders and the same namespace.',
        parts: [['SharedResourceWarning', 'Argo CD noticed the overlap.']],
        tips: ['Give each app its own namespace or its own folder.'],
      },
      {
        id: 'deleting',
        cmd: 'The application stays in Deleting state forever',
        title: 'Stuck deleting',
        what: 'The Application has the finalizer, and some resource it manages cannot be deleted.',
        use: 'A namespace or volume that is itself stuck terminating.',
        parts: [['Deleting', 'Kubernetes is waiting for the finalizer.']],
        careful: 'Removing the finalizer by hand leaves resources behind. First find the resource that will not go: argocd app get NAME.',
      },
      {
        id: 'prune',
        cmd: 'Something I did not expect was deleted after a sync',
        title: 'A resource was pruned',
        what: 'With prune on, anything removed from Git, or moved to a folder the app does not read, is deleted.',
        use: 'Moving files around in the repository.',
        parts: [['prune', 'Delete resources that are no longer in Git.']],
        tips: ['Run argocd app sync NAME --dry-run first.', 'Protect important resources with the annotation argocd.argoproj.io/sync-options: Prune=false.'],
      },
      {
        id: 'cache',
        cmd: 'I pushed to Git but Argo CD still shows the old version',
        title: 'Argo CD is slow to notice',
        what: 'Argo CD checks Git about every 3 minutes, and it caches what it read.',
        use: 'Right after a push.',
        parts: [['3 minutes', 'The default check interval.']],
        tips: ['Run argocd app get NAME --refresh, or --hard-refresh.', 'A webhook from your Git host makes it instant.'],
      },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = {
  AC_CONCEPT_GROUPS, AC_CONCEPT_WORDS, AC_COMMAND_GROUPS, AC_COMMAND_WORDS,
  AC_FIELD_GROUPS, AC_FIELD_WORDS, AC_STATUS_GROUPS, AC_STATUS_WORDS,
  AC_ERROR_GROUPS, AC_ERROR_WORDS,
};

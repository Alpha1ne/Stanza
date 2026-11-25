'use strict';

/*
  argocd.js — Argo CD generators.

  Five generators: Application, ApplicationSet, Project, Private repository
  and Install.

  Rules every generator follows:
    - Every typed value is checked before it reaches the file.
    - No password, token or key is ever typed into Stanza or written in a file.
      The repository generator reads the secret from a masked prompt and
      sends it through a pipe, so it never shows up in a process list.
    - Repository addresses must be https:// or SSH, never plain http://.
*/

const AC_DNS_RE = /^[a-z0-9]([-a-z0-9]{0,38}[a-z0-9])?$/;
const AC_REPO_RE = /^(https:\/\/[A-Za-z0-9][A-Za-z0-9.-]{0,60}(:\d{2,5})?\/[A-Za-z0-9._~\/-]{1,100}|git@[A-Za-z0-9][A-Za-z0-9.-]{0,60}:[A-Za-z0-9._\/-]{1,100}|ssh:\/\/git@[A-Za-z0-9][A-Za-z0-9.-]{0,60}(:\d{2,5})?\/[A-Za-z0-9._\/-]{1,100})$/;
const AC_REV_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,59}$/;
const AC_PATH_RE = /^([A-Za-z0-9][A-Za-z0-9._\/-]{0,79}|\.)$/;
const AC_GLOB_RE = /^[A-Za-z0-9][A-Za-z0-9._\/*-]{0,59}$/;
const AC_CLUSTER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,50}$/;
const AC_DESC_RE = /^[A-Za-z0-9 ._,()-]{0,80}$/;
const AC_VERSION_RE = /^(stable|v\d{1,2}\.\d{1,2}\.\d{1,2})$/;

const acNoDots = (p) => !p.split('/').includes('..');
const acPathOk = (p) => AC_PATH_RE.test(p) && acNoDots(p);
const acQ = (s) => `"${s}"`;
const IN_CLUSTER = 'https://kubernetes.default.svc';

function acYaml() {
  const lines = [];
  const add = (t, n = null) => lines.push({ t, n });
  return { lines, add };
}

/* ---------- shared pieces ---------- */

const AC_WHERE_KUBECTL =
  'Run these in a terminal (your laptop, or a VM through its console or SSH) that can already talk to your Kubernetes cluster. Check with kubectl get nodes first. After the apply, watch the result in the Argo CD web page (GUI), or with the argocd command.';

const AC_KUBECTL_FLAGS = [
  { flag: 'kubectl apply -f <file>', meaning: 'Create or update whatever the file describes.' },
  { flag: '-n argocd', meaning: '-n picks the namespace. Argo CD’s own objects live in the namespace it was installed into, usually argocd.' },
  { flag: 'argocd app get <name>', meaning: 'Show one application: its sync status, health, and the resources it manages.' },
  { flag: 'argocd app sync <name>', meaning: 'Apply what is in Git to the cluster now. Needed when automatic sync is off.' },
];

/* =====================================================================
   1. Application
   ===================================================================== */

const acApplication = {
  id: 'application',
  label: 'Application',
  ready: true,
  title: 'Application',
  intro: 'An Application tells Argo CD: "keep this folder of a Git repository running in this namespace of the cluster". Argo CD then watches Git and keeps the cluster matching it.',

  groups: [
    {
      legend: 'The app',
      fields: [
        { id: 'appName', type: 'text', label: 'Application name', hint: 'Lowercase letters, digits and hyphens. Up to 40 characters.', default: 'guestbook' },
        { id: 'project', type: 'text', label: 'Argo CD project', hint: 'Projects limit what an app may do. "default" allows everything. Make your own with the Project generator.', default: 'default' },
        { id: 'argoNs', type: 'text', label: 'Namespace Argo CD runs in', hint: 'Almost always argocd. The Application object itself is created here.', default: 'argocd' },
      ],
    },
    {
      legend: 'Where the config lives (Git)',
      fields: [
        { id: 'repo', type: 'text', label: 'Repository address', hint: 'https://... or git@host:owner/repo.git. Never put a password or token in the address.', default: 'https://github.com/argoproj/argocd-example-apps.git' },
        { id: 'revision', type: 'text', label: 'Branch, tag or commit', hint: 'HEAD means the repository’s default branch. A tag such as v1.2.0 pins one version.', default: 'HEAD' },
        {
          id: 'kind',
          type: 'select',
          label: 'What is in the folder?',
          options: [
            ['dir', 'Plain Kubernetes YAML files'],
            ['helm', 'A Helm chart'],
            ['kustomize', 'Kustomize (a kustomization.yaml)'],
          ],
          default: 'dir',
        },
        { id: 'path', type: 'text', label: 'Folder in the repository', hint: 'A dot means the top of the repository. No leading slash.', default: 'guestbook' },
        { id: 'recurse', type: 'check', label: 'Also read sub-folders', default: false, showIf: { field: 'kind', in: ['dir'] } },
        { id: 'valuesFile', type: 'text', label: 'Helm values file', hint: 'Relative to the chart folder. Leave empty to use the chart’s own values.yaml.', default: '', showIf: { field: 'kind', in: ['helm'] } },
        { id: 'releaseName', type: 'text', label: 'Helm release name', hint: 'Leave empty to use the application name.', default: '', showIf: { field: 'kind', in: ['helm'] } },
      ],
    },
    {
      legend: 'Where it deploys',
      fields: [
        {
          id: 'dest',
          type: 'select',
          label: 'Cluster',
          options: [
            ['in', 'The cluster Argo CD runs in'],
            ['name', 'Another cluster, by the name Argo CD knows it by'],
          ],
          default: 'in',
        },
        { id: 'clusterName', type: 'text', label: 'Cluster name', hint: 'The name shown by argocd cluster list.', default: 'prod-cluster', showIf: { field: 'dest', in: ['name'] } },
        { id: 'namespace', type: 'text', label: 'Namespace for the app', hint: 'Where the app’s resources are created.', default: 'guestbook' },
      ],
    },
    {
      legend: 'Keeping it in sync',
      fields: [
        {
          id: 'sync',
          type: 'select',
          label: 'Sync',
          options: [
            ['auto', 'Automatic: apply every change from Git by itself'],
            ['manual', 'Manual: show differences, apply only when I press Sync'],
          ],
          default: 'auto',
        },
        { id: 'prune', type: 'check', label: 'Delete things that were removed from Git (prune)', default: true, showIf: { field: 'sync', in: ['auto'] } },
        { id: 'selfHeal', type: 'check', label: 'Undo changes made by hand in the cluster (self-heal)', default: true, showIf: { field: 'sync', in: ['auto'] } },
        { id: 'createNs', type: 'check', label: 'Create the namespace if it does not exist', default: true },
      ],
    },
    {
      legend: 'More options',
      optional: true,
      fields: [
        { id: 'serverSide', type: 'check', label: 'Use server-side apply', default: false, hint: 'Needed for very large resources, such as big CRDs.' },
        { id: 'retry', type: 'check', label: 'Retry a failed sync with growing pauses', default: true },
        { id: 'cascade', type: 'check', label: 'Deleting this Application also deletes what it deployed', default: true },
        { id: 'ignoreReplicas', type: 'check', label: 'Ignore the replica count of Deployments', default: false, hint: 'Use this when an autoscaler changes replicas. Without it Argo CD fights the autoscaler.' },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!AC_DNS_RE.test(v.appName.trim())) e.appName = 'Use lowercase letters, digits and hyphens, starting and ending with a letter or digit. Up to 40 characters.';
    if (!AC_DNS_RE.test(v.project.trim())) e.project = 'Use lowercase letters, digits and hyphens only.';
    if (!AC_DNS_RE.test(v.argoNs.trim())) e.argoNs = 'Use lowercase letters, digits and hyphens only. Usually argocd.';
    if (!AC_REPO_RE.test(v.repo.trim())) e.repo = 'Write an https:// address or an SSH address such as git@github.com:owner/repo.git. Plain http:// is not accepted, and no password may be in the address.';
    if (!AC_REV_RE.test(v.revision.trim())) e.revision = 'Use letters, digits and . _ / - only, such as HEAD, main or v1.2.0.';
    if (!acPathOk(v.path.trim())) e.path = 'Write a folder such as guestbook, or a dot. Letters, digits and . _ / - only, no .. and no leading slash.';
    if (v.kind === 'helm') {
      if (v.valuesFile.trim() && !acPathOk(v.valuesFile.trim())) e.valuesFile = 'Write a path such as values-prod.yaml. Letters, digits and . _ / - only.';
      if (v.releaseName.trim() && !AC_DNS_RE.test(v.releaseName.trim())) e.releaseName = 'Use lowercase letters, digits and hyphens only.';
    }
    if (v.dest === 'name' && !AC_CLUSTER_RE.test(v.clusterName.trim())) e.clusterName = 'Use letters, digits and . _ - only.';
    if (!AC_DNS_RE.test(v.namespace.trim())) e.namespace = 'Use lowercase letters, digits and hyphens only.';
    return e;
  },

  build(v) {
    const { lines, add } = acYaml();
    const auto = v.sync === 'auto';
    add('# Tells Argo CD to keep a Git folder running in the cluster. Save as application.yaml', 'Lines starting with # are comments. Argo CD ignores them.');
    add('apiVersion: argoproj.io/v1alpha1', 'Which version of Argo CD’s own object types this file uses.');
    add('kind: Application', 'The type of object. Argo CD adds this type to Kubernetes when it is installed.');
    add('metadata:', 'Names and labels for this object.');
    add(`  name: ${v.appName.trim()}`, 'The application’s name, as shown in Argo CD.');
    add(`  namespace: ${v.argoNs.trim()}`, 'Argo CD only looks for Applications in its own namespace.');
    if (v.cascade) {
      add('  finalizers:', 'A finalizer is a hold on deletion: Kubernetes waits for it to be cleared first.');
      add('    - resources-finalizer.argocd.argoproj.io', 'Deleting this Application then also deletes everything it deployed. Without it, the app’s resources keep running with nobody managing them.');
    }
    add('spec:', 'What you want.');
    add(`  project: ${v.project.trim()}`, 'The project this app belongs to. A project limits which repositories and clusters an app may use.');
    add('  source:', 'Where the desired state is stored.');
    add(`    repoURL: ${v.repo.trim()}`, 'The Git repository.');
    add(`    targetRevision: ${v.revision.trim()}`, 'Which branch, tag or commit to follow. HEAD is the repository’s default branch.');
    add(`    path: ${v.path.trim()}`, 'The folder in the repository that holds the config.');
    if (v.kind === 'dir' && v.recurse) {
      add('    directory:', 'Settings for plain YAML folders.');
      add('      recurse: true', 'Also read YAML files in sub-folders.');
    }
    if (v.kind === 'helm') {
      const rel = v.releaseName.trim();
      const vf = v.valuesFile.trim();
      if (rel || vf) {
        add('    helm:', 'Settings for a Helm chart.');
        if (rel) add(`      releaseName: ${rel}`, 'The name Helm uses for this install.');
        if (vf) {
          add('      valueFiles:', 'Files that override the chart’s default values.');
          add(`        - ${vf}`, 'A values file inside the chart folder.');
        }
      } else {
        add('    helm: {}', 'Treat the folder as a Helm chart with its default settings.');
      }
    }
    if (v.kind === 'kustomize') add('    kustomize: {}', 'Treat the folder as Kustomize, using its kustomization.yaml.');
    add('  destination:', 'Where to deploy.');
    if (v.dest === 'in') add(`    server: ${IN_CLUSTER}`, 'This address always means "the cluster Argo CD itself runs in".');
    else add(`    name: ${v.clusterName.trim()}`, 'A cluster you added with argocd cluster add. Use its name instead of its address.');
    add(`    namespace: ${v.namespace.trim()}`, 'The namespace the app’s resources go into.');
    add('  syncPolicy:', 'How and when Argo CD applies changes.');
    if (auto) {
      add('    automated:', 'Apply changes from Git without anyone pressing Sync. Argo CD checks Git about every 3 minutes.');
      add(`      prune: ${v.prune ? 'true' : 'false'}`, v.prune ? 'If a file is removed from Git, delete the matching resource from the cluster.' : 'Resources removed from Git stay in the cluster. Argo CD only marks them as extra.');
      add(`      selfHeal: ${v.selfHeal ? 'true' : 'false'}`, v.selfHeal ? 'If someone changes a resource by hand (kubectl edit), Argo CD puts it back as Git says.' : 'A change made by hand is shown as out of sync, but is not undone.');
    } else {
      add('    # automated is left out, so syncing is manual.', 'Argo CD shows OutOfSync when Git and the cluster differ. You apply the change with the Sync button or argocd app sync.');
    }
    const opts = [];
    if (v.createNs) opts.push(['CreateNamespace=true', 'Create the namespace if it is not there yet.']);
    if (v.serverSide) opts.push(['ServerSideApply=true', 'Let the cluster merge the changes (server-side apply) instead of the client. It copes with huge resources.']);
    if (v.ignoreReplicas) opts.push(['RespectIgnoreDifferences=true', 'Also skip the ignored fields when syncing, not only when comparing.']);
    if (opts.length) {
      add('    syncOptions:', 'Extra switches for the sync.');
      for (const [o, n] of opts) add(`      - ${o}`, n);
    }
    if (v.retry) {
      add('    retry:', 'What to do when a sync fails.');
      add('      limit: 5', 'Try up to 5 more times, then give up and show the error.');
      add('      backoff:', 'The pause between tries.');
      add('        duration: 5s', 'Wait 5 seconds before the first retry.');
      add('        factor: 2', 'Double the wait each time: 5s, 10s, 20s, 40s.');
      add('        maxDuration: 3m', 'Never wait longer than 3 minutes.');
    }
    if (v.ignoreReplicas) {
      add('  ignoreDifferences:', 'Fields Argo CD should not treat as drift.');
      add('    - group: apps', 'Deployments belong to the "apps" group.');
      add('      kind: Deployment', 'Only for Deployments.');
      add('      jsonPointers:', 'The fields to ignore, written as paths.');
      add('        - /spec/replicas', 'The number of copies. An autoscaler changes it, and Argo CD should not undo that.');
    }
    return [{ path: 'application.yaml', label: 'application.yaml', lines }];
  },

  zipName: () => 'argocd-application.zip',

  run(v) {
    const n = v.appName.trim();
    return {
      where: AC_WHERE_KUBECTL + ' Argo CD must already be installed. If it is not, use the Install generator first. If the repository is private, add it with the Private repository generator first.',
      commands: [
        { cmd: 'kubectl apply -f application.yaml', what: 'Create the Application. Argo CD notices it and starts watching Git.' },
        { cmd: `argocd app get ${n}`, what: 'Read its status. Look for Sync Status and Health Status.' },
        ...(v.sync === 'manual' ? [{ cmd: `argocd app sync ${n}`, what: 'Apply what is in Git to the cluster. Manual mode waits for you to do this.' }] : []),
      ],
      flags: [...AC_KUBECTL_FLAGS, { flag: 'Sync Status', meaning: 'Synced means the cluster matches Git. OutOfSync means it does not.' }, { flag: 'Health Status', meaning: 'Healthy means the app is running properly. Progressing means it is still starting. Degraded means something is wrong.' }],
    };
  },
};

/* =====================================================================
   2. ApplicationSet
   ===================================================================== */

const acAppSet = {
  id: 'appset',
  label: 'ApplicationSet',
  ready: true,
  title: 'ApplicationSet',
  intro: 'One file that makes many Applications. List some environments, point at a folder of apps, or name your clusters, and Argo CD creates one Application for each.',

  groups: [
    {
      legend: 'The set',
      fields: [
        { id: 'name', type: 'text', label: 'ApplicationSet name', hint: 'Lowercase letters, digits and hyphens. It starts each generated app’s name.', default: 'shop' },
        { id: 'project', type: 'text', label: 'Argo CD project', default: 'default' },
        { id: 'argoNs', type: 'text', label: 'Namespace Argo CD runs in', default: 'argocd' },
        {
          id: 'gen',
          type: 'select',
          label: 'How should it decide what to create?',
          options: [
            ['list', 'From a list I type (for example dev, staging, prod)'],
            ['git', 'One for every folder in a Git repository'],
            ['clusters', 'One for every cluster Argo CD knows'],
          ],
          default: 'list',
        },
      ],
    },
    {
      legend: 'The list',
      fields: [
        { id: 'envs', type: 'text', label: 'Names', hint: 'Separate with commas. Lowercase letters, digits and hyphens. Up to 6.', default: 'dev, staging, prod', showIf: { field: 'gen', in: ['list'] } },
        { id: 'basePath', type: 'text', label: 'Folder that holds one sub-folder per name', hint: 'With dev, staging and prod and overlays here, Argo CD reads overlays/dev, overlays/staging and overlays/prod.', default: 'overlays', showIf: { field: 'gen', in: ['list'] } },
        { id: 'nsPer', type: 'check', label: 'Give each its own namespace', default: true, showIf: { field: 'gen', in: ['list'] } },
      ],
    },
    {
      legend: 'The Git folders',
      fields: [
        { id: 'glob', type: 'text', label: 'Folders to match', hint: 'apps/* means every folder directly inside apps.', default: 'apps/*', showIf: { field: 'gen', in: ['git'] } },
      ],
    },
    {
      legend: 'The clusters',
      fields: [
        { id: 'clusterPath', type: 'text', label: 'Folder to deploy on each cluster', default: 'deploy', showIf: { field: 'gen', in: ['clusters'] } },
        { id: 'clusterNs', type: 'text', label: 'Namespace on each cluster', default: 'shop', showIf: { field: 'gen', in: ['clusters'] } },
      ],
    },
    {
      legend: 'Where the config lives (Git)',
      fields: [
        { id: 'repo', type: 'text', label: 'Repository address', hint: 'https://... or git@host:owner/repo.git. No password or token in the address.', default: 'https://github.com/example/shop-config.git' },
        { id: 'revision', type: 'text', label: 'Branch, tag or commit', default: 'HEAD' },
      ],
    },
    {
      legend: 'Keeping it in sync',
      fields: [
        { id: 'auto', type: 'check', label: 'Apply changes automatically', default: true },
        { id: 'prune', type: 'check', label: 'Delete things that were removed from Git (prune)', default: false, showIf: { field: 'auto', in: [true] } },
        { id: 'selfHeal', type: 'check', label: 'Undo changes made by hand (self-heal)', default: true, showIf: { field: 'auto', in: [true] } },
        { id: 'createNs', type: 'check', label: 'Create each namespace if it does not exist', default: true },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!AC_DNS_RE.test(v.name.trim())) e.name = 'Use lowercase letters, digits and hyphens, starting and ending with a letter or digit.';
    if (v.name.trim().length > 30) e.name = 'Use 30 characters or fewer, because each generated name adds a suffix.';
    if (!AC_DNS_RE.test(v.project.trim())) e.project = 'Use lowercase letters, digits and hyphens only.';
    if (!AC_DNS_RE.test(v.argoNs.trim())) e.argoNs = 'Use lowercase letters, digits and hyphens only. Usually argocd.';
    if (!AC_REPO_RE.test(v.repo.trim())) e.repo = 'Write an https:// address or an SSH address such as git@github.com:owner/repo.git. No plain http://, no password in the address.';
    if (!AC_REV_RE.test(v.revision.trim())) e.revision = 'Use letters, digits and . _ / - only, such as HEAD, main or v1.2.0.';
    if (v.gen === 'list') {
      const list = v.envs.split(',').map((s) => s.trim()).filter(Boolean);
      if (!list.length) e.envs = 'Write at least one name.';
      else if (list.length > 6) e.envs = 'Use 6 names or fewer.';
      else if (list.some((s) => !AC_DNS_RE.test(s) || s.length > 15)) e.envs = 'Each name may use lowercase letters, digits and hyphens only, up to 15 characters.';
      else if (new Set(list).size !== list.length) e.envs = 'Each name should appear once.';
      if (!acPathOk(v.basePath.trim()) || v.basePath.trim() === '.') e.basePath = 'Write a folder such as overlays. Letters, digits and . _ / - only, no .. and no leading slash.';
    }
    if (v.gen === 'git') {
      if (!AC_GLOB_RE.test(v.glob.trim()) || !acNoDots(v.glob.trim())) e.glob = 'Write a pattern such as apps/*. Letters, digits and . _ / - * only, no ..';
    }
    if (v.gen === 'clusters') {
      if (!acPathOk(v.clusterPath.trim())) e.clusterPath = 'Write a folder such as deploy. Letters, digits and . _ / - only, no ..';
      if (!AC_DNS_RE.test(v.clusterNs.trim())) e.clusterNs = 'Use lowercase letters, digits and hyphens only.';
    }
    return e;
  },

  build(v) {
    const { lines, add } = acYaml();
    const name = v.name.trim();
    add('# Makes many Applications from one template. Save as applicationset.yaml', 'Lines starting with # are comments.');
    add('apiVersion: argoproj.io/v1alpha1');
    add('kind: ApplicationSet', 'A factory for Applications. Argo CD’s ApplicationSet controller reads it.');
    add('metadata:');
    add(`  name: ${name}`, 'The ApplicationSet’s own name.');
    add(`  namespace: ${v.argoNs.trim()}`, 'Argo CD’s namespace.');
    add('spec:');
    add('  goTemplate: true', 'Use Go-style placeholders such as {{ .env }}. They are more powerful and report mistakes.');
    add('  goTemplateOptions: ["missingkey=error"]', 'If the template uses a name that does not exist, stop with an error instead of silently writing "<no value>".');
    add('  generators:', 'The generator decides how many Applications there are and what each one’s values are.');
    if (v.gen === 'list') {
      const list = v.envs.split(',').map((s) => s.trim()).filter(Boolean);
      add('    - list:', 'A list that you type.');
      add('        elements:', 'One entry per Application.');
      for (const x of list) add(`          - env: ${x}`, `Makes one Application where {{ .env }} is "${x}".`);
    } else if (v.gen === 'git') {
      add('    - git:', 'Looks inside a Git repository.');
      add(`        repoURL: ${v.repo.trim()}`, 'The repository to look in.');
      add(`        revision: ${v.revision.trim()}`, 'Which branch or tag to look at.');
      add('        directories:', 'Make one Application for every folder that matches.');
      add(`          - path: ${v.glob.trim()}`, 'A folder pattern. A new folder here creates a new Application by itself.');
    } else {
      add('    - clusters: {}', 'One Application for every cluster registered in Argo CD. Empty braces mean "all of them".');
    }
    add('  template:', 'The pattern every generated Application is built from.');
    add('    metadata:');
    let appName;
    let path;
    let ns;
    let server = IN_CLUSTER;
    if (v.gen === 'list') {
      appName = `${name}-{{ .env }}`;
      path = `${v.basePath.trim()}/{{ .env }}`;
      ns = v.nsPer ? `${name}-{{ .env }}` : name;
    } else if (v.gen === 'git') {
      appName = '{{ .path.basename }}';
      path = '{{ .path.path }}';
      ns = '{{ .path.basename }}';
    } else {
      appName = `${name}-{{ .name }}`;
      path = v.clusterPath.trim();
      ns = v.clusterNs.trim();
      server = '{{ .server }}';
    }
    add(`      name: ${acQ(appName)}`, v.gen === 'list' ? 'Each Application’s name. {{ .env }} is replaced by the list entry, so every name is different.' : v.gen === 'git' ? '{{ .path.basename }} is the folder’s own name, such as "cart".' : '{{ .name }} is the cluster’s name. Every Application needs a different name.');
    add('    spec:');
    add(`      project: ${v.project.trim()}`, 'The Argo CD project for every generated app.');
    add('      source:');
    add(`        repoURL: ${v.repo.trim()}`, 'The Git repository.');
    add(`        targetRevision: ${v.revision.trim()}`, 'Which branch, tag or commit to follow.');
    add(`        path: ${acQ(path)}`, v.gen === 'git' ? '{{ .path.path }} is the full folder path that matched.' : 'The folder for this Application.');
    add('      destination:');
    add(`        server: ${acQ(server)}`, v.gen === 'clusters' ? '{{ .server }} is the cluster’s address, from the generator.' : 'This address means "the cluster Argo CD runs in".');
    add(`        namespace: ${acQ(ns)}`, 'The namespace for this app.');
    add('      syncPolicy:');
    if (v.auto) {
      add('        automated:', 'Apply changes without anyone pressing Sync.');
      add(`          prune: ${v.prune ? 'true' : 'false'}`, v.prune ? 'Delete resources that are removed from Git.' : 'Resources removed from Git are kept. Safer while you are learning.');
      add(`          selfHeal: ${v.selfHeal ? 'true' : 'false'}`, v.selfHeal ? 'Undo changes made by hand.' : 'Changes made by hand are shown but not undone.');
    } else {
      add('        # automated is left out, so each app syncs manually.', 'Use the Sync button or argocd app sync for each one.');
    }
    if (v.createNs) {
      add('        syncOptions:');
      add('          - CreateNamespace=true', 'Create each namespace if it is missing.');
    }
    return [{ path: 'applicationset.yaml', label: 'applicationset.yaml', lines }];
  },

  zipName: () => 'argocd-applicationset.zip',

  run(v) {
    return {
      where: AC_WHERE_KUBECTL + ' The generated Applications appear in the Argo CD web page and in argocd app list. If you delete the ApplicationSet, the Applications it made are deleted too, so be careful.',
      commands: [
        { cmd: 'kubectl apply -f applicationset.yaml', what: 'Create the ApplicationSet. Argo CD makes one Application for each item right away.' },
        { cmd: `kubectl get applicationset ${v.name.trim()} -n ${v.argoNs.trim()}`, what: 'Check that Kubernetes accepted it.' },
        { cmd: 'argocd app list', what: 'List every application. The generated ones are in the list.' },
      ],
      flags: [
        ...AC_KUBECTL_FLAGS,
        { flag: 'goTemplate: true', meaning: 'Placeholders are written {{ .name }}, with a dot. Without it you write {{name}}.' },
        { flag: 'missingkey=error', meaning: 'A placeholder with no value stops the ApplicationSet with an error, so you notice typos.' },
      ],
    };
  },
};

/* =====================================================================
   3. Project
   ===================================================================== */

const acProject = {
  id: 'project',
  label: 'Project',
  ready: true,
  title: 'Project',
  intro: 'A project is a fence around a team’s applications: which repositories they may read, which namespaces and clusters they may deploy to, and who may do what.',

  groups: [
    {
      legend: 'The project',
      fields: [
        { id: 'name', type: 'text', label: 'Project name', hint: 'Lowercase letters, digits and hyphens.', default: 'shop' },
        { id: 'desc', type: 'text', label: 'Description', hint: 'Letters, digits, spaces and . , _ ( ) - only.', default: 'The shop team' },
        { id: 'argoNs', type: 'text', label: 'Namespace Argo CD runs in', default: 'argocd' },
      ],
    },
    {
      legend: 'What it may read and deploy',
      fields: [
        { id: 'repo1', type: 'text', label: 'Allowed repository', hint: 'The only Git repository this project may read. https:// or SSH.', default: 'https://github.com/example/shop-config.git' },
        { id: 'repo2', type: 'text', label: 'A second allowed repository (optional)', default: '' },
        { id: 'namespaces', type: 'text', label: 'Allowed namespaces', hint: 'Separate with commas. A * at the end is allowed, such as shop-*.', default: 'shop-dev, shop-prod' },
        {
          id: 'cluster',
          type: 'select',
          label: 'Cluster',
          options: [
            ['in', 'Only the cluster Argo CD runs in'],
            ['name', 'A named cluster'],
          ],
          default: 'in',
        },
        { id: 'clusterName', type: 'text', label: 'Cluster name', default: 'prod-cluster', showIf: { field: 'cluster', in: ['name'] } },
        {
          id: 'clusterRes',
          type: 'select',
          label: 'Cluster-wide resources (Namespaces, roles and so on)',
          options: [
            ['none', 'None. Only things inside a namespace (safest)'],
            ['ns', 'Namespaces only (needed for CreateNamespace)'],
            ['all', 'Everything (not recommended)'],
          ],
          default: 'ns',
        },
      ],
    },
    {
      legend: 'Who may do what',
      optional: true,
      fields: [
        { id: 'roleView', type: 'check', label: 'A read-only role', default: true, hint: 'Can see the project’s applications, nothing more.' },
        { id: 'roleDeploy', type: 'check', label: 'A deployer role that may press Sync', default: true, hint: 'Can sync the project’s applications, but not change or delete them.' },
        { id: 'orphans', type: 'check', label: 'Warn about resources in the namespaces that no app manages', default: true },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!AC_DNS_RE.test(v.name.trim())) e.name = 'Use lowercase letters, digits and hyphens, starting and ending with a letter or digit.';
    if (!AC_DESC_RE.test(v.desc.trim())) e.desc = 'Use letters, digits, spaces and . , _ ( ) - only, up to 80 characters.';
    if (!AC_DNS_RE.test(v.argoNs.trim())) e.argoNs = 'Use lowercase letters, digits and hyphens only. Usually argocd.';
    if (!AC_REPO_RE.test(v.repo1.trim())) e.repo1 = 'Write an https:// address or an SSH address such as git@github.com:owner/repo.git. No plain http://.';
    if (v.repo2.trim() && !AC_REPO_RE.test(v.repo2.trim())) e.repo2 = 'Write an https:// address or an SSH address, or leave it empty.';
    const ns = v.namespaces.split(',').map((s) => s.trim()).filter(Boolean);
    if (!ns.length) e.namespaces = 'Write at least one namespace.';
    else if (ns.length > 8) e.namespaces = 'Use 8 namespaces or fewer.';
    else if (ns.some((s) => !/^[a-z0-9]([-a-z0-9]{0,38}[a-z0-9])?\*?$/.test(s) && !/^[a-z0-9]([-a-z0-9]{0,38}[a-z0-9]-)?\*$/.test(s))) e.namespaces = 'Each one may use lowercase letters, digits and hyphens, with a * allowed at the end, such as shop-*. A lone * is not accepted: it means every namespace.';
    else if (ns.includes('*')) e.namespaces = 'A lone * means every namespace, which removes the fence. Name them, or use a pattern such as shop-*.';
    if (v.cluster === 'name' && !AC_CLUSTER_RE.test(v.clusterName.trim())) e.clusterName = 'Use letters, digits and . _ - only.';
    return e;
  },

  build(v) {
    const { lines, add } = acYaml();
    const name = v.name.trim();
    const repos = [v.repo1.trim(), v.repo2.trim()].filter(Boolean);
    const nss = v.namespaces.split(',').map((s) => s.trim()).filter(Boolean);
    add('# A fence around a team’s applications. Save as project.yaml', 'Lines starting with # are comments.');
    add('apiVersion: argoproj.io/v1alpha1');
    add('kind: AppProject', 'The type of object for a project.');
    add('metadata:');
    add(`  name: ${name}`, 'The project’s name. Applications join it with spec.project.');
    add(`  namespace: ${v.argoNs.trim()}`, 'Argo CD’s namespace.');
    add('spec:');
    add(`  description: ${acQ(v.desc.trim())}`, 'A note for people reading the project list.');
    add('  sourceRepos:', 'The only Git repositories applications in this project may read.');
    for (const r of repos) add(`    - ${r}`, 'An application that points at any other repository is refused.');
    add('  destinations:', 'The only places applications in this project may deploy to.');
    for (const n of nss) {
      if (v.cluster === 'in') add(`    - server: ${IN_CLUSTER}`, 'The cluster Argo CD runs in.');
      else add(`    - name: ${v.clusterName.trim()}`, 'A named cluster.');
      add(`      namespace: ${n}`, n.includes('*') ? 'Any namespace that starts the same way.' : 'The only namespace allowed on that cluster.');
    }
    if (v.clusterRes === 'none') {
      add('  clusterResourceWhitelist: []', 'An empty list: no cluster-wide resources (Namespaces, ClusterRoles) may be created. Safest.');
    } else if (v.clusterRes === 'ns') {
      add('  clusterResourceWhitelist:', 'Cluster-wide resources that may be created.');
      add('    - group: ""', 'The core group, which holds Namespaces.');
      add('      kind: Namespace', 'Only Namespaces. Needed when an app uses CreateNamespace=true.');
    } else {
      add('  clusterResourceWhitelist:');
      add('    - group: "*"', 'Any group.');
      add('      kind: "*"', 'Any kind. This lets the project create cluster roles and more. Use it only for trusted teams.');
    }
    if (v.orphans) {
      add('  orphanedResources:', 'Resources that exist in the namespaces but belong to no application.');
      add('    warn: true', 'Show a warning for them. Nothing is deleted.');
    }
    if (v.roleView || v.roleDeploy) {
      add('  roles:', 'Named sets of permissions that you can give to people or tokens.');
      if (v.roleView) {
        add('    - name: viewer', 'A role called viewer.');
        add('      description: Can look, cannot change', 'A note about the role.');
        add('      policies:', 'Permission lines. The format is: p, who, what, action, which, allow or deny.');
        add(`        - p, proj:${name}:viewer, applications, get, ${name}/*, allow`, 'Members of this role may read every application in this project.');
      }
      if (v.roleDeploy) {
        add('    - name: deployer', 'A role called deployer.');
        add('      description: Can press Sync', 'A note about the role.');
        add('      policies:');
        add(`        - p, proj:${name}:deployer, applications, get, ${name}/*, allow`, 'May read the applications.');
        add(`        - p, proj:${name}:deployer, applications, sync, ${name}/*, allow`, 'May press Sync on them. Nothing more: no edit and no delete.');
      }
    }
    return [{ path: 'project.yaml', label: 'project.yaml', lines }];
  },

  zipName: () => 'argocd-project.zip',

  run(v) {
    const n = v.name.trim();
    return {
      where: AC_WHERE_KUBECTL + ' Create the project before the applications that use it. An Application whose spec.project names a project that does not exist is refused.',
      commands: [
        { cmd: 'kubectl apply -f project.yaml', what: 'Create the project.' },
        { cmd: `argocd proj get ${n}`, what: 'Read it back. Check the allowed repositories and destinations.' },
        ...(v.roleDeploy ? [{ cmd: `argocd proj role create-token ${n} deployer`, what: 'Make a token for the deployer role, for example for a pipeline. Treat the printed token like a password: store it in a secret store and never in a file.' }] : []),
      ],
      flags: [
        ...AC_KUBECTL_FLAGS,
        { flag: 'argocd proj get', meaning: 'Show one project’s settings.' },
        { flag: 'sourceRepos', meaning: 'The repositories applications may read.' },
        { flag: 'destinations', meaning: 'The clusters and namespaces applications may deploy to.' },
        { flag: 'p, who, what, action, which, effect', meaning: 'One permission line: who, on what kind of thing, which action, on which objects, then allow or deny.' },
      ],
    };
  },
};

/* =====================================================================
   4. Private repository
   ===================================================================== */

const acRepo = {
  id: 'repo',
  label: 'Private repository',
  ready: true,
  title: 'Private repository',
  intro: 'Let Argo CD read a private Git repository. This makes a script that asks for your token or key safely. The secret is never typed into Stanza and is never written in a file.',

  groups: [
    {
      legend: 'The repository',
      fields: [
        { id: 'name', type: 'text', label: 'A short name for it', hint: 'Lowercase letters, digits and hyphens. It names the Kubernetes Secret.', default: 'shop-config' },
        { id: 'repo', type: 'text', label: 'Repository address', hint: 'https://... for a token, or git@host:owner/repo.git for an SSH key.', default: 'https://github.com/example/shop-config.git' },
        { id: 'argoNs', type: 'text', label: 'Namespace Argo CD runs in', default: 'argocd' },
      ],
    },
    {
      legend: 'How Argo CD signs in',
      fields: [
        {
          id: 'auth',
          type: 'select',
          label: 'Method',
          options: [
            ['token', 'An access token (HTTPS)'],
            ['ssh', 'An SSH deploy key'],
          ],
          default: 'token',
          hint: 'Use a read-only token or a read-only deploy key made just for Argo CD.',
        },
        { id: 'user', type: 'text', label: 'User name for the token', hint: 'For GitHub tokens any name works, such as argocd. Letters, digits and . _ - only.', default: 'argocd', showIf: { field: 'auth', in: ['token'] } },
        { id: 'keyPath', type: 'text', label: 'Path to the private key file', hint: 'On the machine where you run the script. Such as ~/.ssh/argocd_deploy', default: '~/.ssh/argocd_deploy', showIf: { field: 'auth', in: ['ssh'] } },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!AC_DNS_RE.test(v.name.trim())) e.name = 'Use lowercase letters, digits and hyphens, starting and ending with a letter or digit.';
    if (!AC_DNS_RE.test(v.argoNs.trim())) e.argoNs = 'Use lowercase letters, digits and hyphens only. Usually argocd.';
    const r = v.repo.trim();
    if (!AC_REPO_RE.test(r)) e.repo = 'Write an https:// address or an SSH address such as git@github.com:owner/repo.git. No plain http://, and no password in the address.';
    else if (v.auth === 'token' && !r.startsWith('https://')) e.repo = 'A token works with an https:// address. For git@ addresses, choose the SSH deploy key method.';
    else if (v.auth === 'ssh' && r.startsWith('https://')) e.repo = 'An SSH key works with an SSH address such as git@github.com:owner/repo.git. For https:// addresses, choose the token method.';
    if (v.auth === 'token' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/.test(v.user.trim())) e.user = 'Use letters, digits and . _ - only.';
    if (v.auth === 'ssh' && (!/^(~\/)?[A-Za-z0-9._\/-]{1,100}$/.test(v.keyPath.trim()) || !acNoDots(v.keyPath.trim()))) e.keyPath = 'Write a path such as ~/.ssh/argocd_deploy. Letters, digits and . _ / - only.';
    return e;
  },

  build(v) {
    const { lines, add } = acYaml();
    const name = v.name.trim();
    const ns = v.argoNs.trim();
    const repo = v.repo.trim();
    const secret = `repo-${name}`;
    add('#!/usr/bin/env bash', 'Run this file with bash.');
    add('# Adds a private Git repository to Argo CD. Save as add-repo.sh', 'Lines starting with # are comments.');
    add('set -euo pipefail', 'Stop at the first error, treat unset variables as errors, and fail if any part of a pipe fails. A half-finished script is worse than a stopped one.');
    add('');
    if (v.auth === 'token') {
      add('printf "Access token for the repository (typing is hidden): "', 'Prints the question. printf does not add a new line.');
      add('read -rs REPO_TOKEN', 'Reads what you type without showing it. -s hides it, and -r keeps backslashes as they are.');
      add('echo', 'Moves to a new line, because the hidden typing printed nothing.');
      add('');
      add(`printf %s "$REPO_TOKEN" | kubectl create secret generic ${secret} -n ${ns} \\`, 'Makes a Kubernetes Secret. The token goes in through a pipe, so it never appears in the process list where other users could see it.');
      add('  --from-literal=type=git \\', 'Tells Argo CD this is a Git repository.');
      add(`  --from-literal=url=${repo} \\`, 'The repository address.');
      add(`  --from-literal=username=${v.user.trim()} \\`, 'The user name that goes with the token.');
      add('  --from-file=password=/dev/stdin', 'Reads the password from the pipe. /dev/stdin is "what was piped in".');
      add('unset REPO_TOKEN', 'Forgets the token in this script’s memory.');
    } else {
      add(`KEY=${v.keyPath.trim().startsWith('~/') ? '"$HOME/' + v.keyPath.trim().slice(2) + '"' : '"' + v.keyPath.trim() + '"'}`, 'The private key file. It stays on your machine and is only sent to your cluster.');
      add('test -r "$KEY" || { echo "Cannot read $KEY"; exit 1; }', 'Stops with a clear message if the key file is missing.');
      add('');
      add(`kubectl create secret generic ${secret} -n ${ns} \\`, 'Makes a Kubernetes Secret that holds the key.');
      add('  --from-literal=type=git \\', 'Tells Argo CD this is a Git repository.');
      add(`  --from-literal=url=${repo} \\`, 'The repository address.');
      add('  --from-file=sshPrivateKey="$KEY"', 'Stores the key file’s contents. The key never appears in the command line.');
    }
    add('');
    add(`kubectl label secret ${secret} -n ${ns} argocd.argoproj.io/secret-type=repository`, 'This label is how Argo CD finds the Secret. Without it Argo CD ignores it.');
    add(`echo "Added ${repo} to Argo CD."`, 'A friendly message.');
    return [{ path: 'add-repo.sh', label: 'add-repo.sh', lines }];
  },

  zipName: () => 'argocd-repo.zip',

  run(v) {
    const ssh = v.auth === 'ssh';
    return {
      where:
        'Run this in a terminal (your laptop, or a VM through its console or SSH) that can talk to your cluster. ' +
        (ssh
          ? 'First make a key made only for Argo CD: ssh-keygen -t ed25519 -f ~/.ssh/argocd_deploy -N "" (terminal). Add the .pub file as a read-only deploy key in the repository’s Settings, Deploy keys (GUI). Do not reuse your personal key.'
          : 'First make a fine-grained, read-only access token on github.com under Settings, Developer settings (GUI), limited to this one repository. The script asks for it with a hidden prompt.') +
        ' When you are done, revoke the token or key if you ever stop using it.',
      commands: [
        { cmd: 'bash add-repo.sh', what: ssh ? 'Run the script. It stores the key in your cluster.' : 'Run the script. Paste the token when asked. Nothing shows as you type.' },
        { cmd: 'argocd repo list', what: 'Check that Argo CD can reach the repository. Look for the word Successful.' },
      ],
      flags: [
        { flag: 'bash add-repo.sh', meaning: 'Run the script file.' },
        { flag: 'read -rs', meaning: '-s hides what you type. -r keeps backslashes as they are.' },
        { flag: 'kubectl create secret generic', meaning: 'Make a Kubernetes Secret, a small store for sensitive values.' },
        { flag: '--from-file=password=/dev/stdin', meaning: 'Read the secret from the pipe, so it never shows in the command line.' },
        { flag: 'argocd.argoproj.io/secret-type=repository', meaning: 'The label that tells Argo CD "this Secret describes a repository".' },
        { flag: 'argocd repo list', meaning: 'Show the repositories Argo CD knows and whether it can connect.' },
      ],
    };
  },
};

/* =====================================================================
   5. Install
   ===================================================================== */

const acInstall = {
  id: 'install',
  label: 'Install',
  ready: true,
  title: 'Install Argo CD',
  intro: 'A script that installs Argo CD into a Kubernetes cluster, waits until it is ready, and shows you how to open it and log in.',

  groups: [
    {
      legend: 'The install',
      fields: [
        { id: 'version', type: 'text', label: 'Version', hint: 'stable follows the newest release. For a real system, pin one, such as v3.2.0.', default: 'stable' },
        { id: 'ns', type: 'text', label: 'Namespace', hint: 'Where Argo CD is installed.', default: 'argocd' },
        {
          id: 'access',
          type: 'select',
          label: 'How will you open the web page?',
          options: [
            ['forward', 'Port-forward from my machine (simplest, nothing exposed)'],
            ['nodeport', 'A NodePort on the cluster’s machines'],
            ['lb', 'A LoadBalancer (needs a cloud or MetalLB)'],
          ],
          default: 'forward',
        },
        { id: 'cli', type: 'check', label: 'Also install the argocd command (Linux)', default: true },
      ],
    },
  ],

  validate(v) {
    const e = {};
    if (!AC_VERSION_RE.test(v.version.trim())) e.version = 'Write stable, or a version such as v3.2.0.';
    if (!AC_DNS_RE.test(v.ns.trim())) e.ns = 'Use lowercase letters, digits and hyphens only.';
    return e;
  },

  build(v) {
    const { lines, add } = acYaml();
    const ns = v.ns.trim();
    const ver = v.version.trim();
    add('#!/usr/bin/env bash', 'Run this file with bash.');
    add('# Installs Argo CD. Save as install-argocd.sh', 'Lines starting with # are comments.');
    add('set -euo pipefail', 'Stop at the first error, treat unset variables as errors, and fail if any part of a pipe fails.');
    add('');
    add('kubectl cluster-info > /dev/null', 'Stops early, with an error, if kubectl cannot reach a cluster. The output is thrown away.');
    add(`kubectl create namespace ${ns} --dry-run=client -o yaml | kubectl apply -f -`, 'Creates the namespace, and does nothing if it already exists. Running the script twice is safe.');
    add(`kubectl apply -n ${ns} --server-side --force-conflicts -f https://raw.githubusercontent.com/argoproj/argo-cd/${ver}/manifests/install.yaml`, 'Installs Argo CD from the project’s own file. --server-side is needed because some of its definitions are too big for the normal method. --force-conflicts lets it take over fields on a re-run or an upgrade.');
    add('');
    add(`kubectl wait --for=condition=available deployment/argocd-server -n ${ns} --timeout=300s`, 'Waits up to 5 minutes until the web server is running, so the next steps do not start too early.');
    if (v.access === 'nodeport') {
      add(`kubectl patch svc argocd-server -n ${ns} -p '{"spec": {"type": "NodePort"}}'`, 'Opens a port on every machine of the cluster. Reach it at https://MACHINE-IP:PORT. Anyone who can reach that machine can reach the login page.');
    } else if (v.access === 'lb') {
      add(`kubectl patch svc argocd-server -n ${ns} -p '{"spec": {"type": "LoadBalancer"}}'`, 'Asks the cloud for a public address. The login page becomes reachable from the internet, so protect it, for example with a firewall.');
    }
    if (v.cli) {
      add('');
      add('curl -sSL -o argocd-linux-amd64 https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64', 'Downloads the argocd command for Linux. -s hides progress, -S still shows errors, -L follows redirects.');
      add('sudo install -m 555 argocd-linux-amd64 /usr/local/bin/argocd', 'Copies it into a folder on your PATH, and makes it read and run only. sudo asks for your password.');
      add('rm argocd-linux-amd64', 'Deletes the downloaded file.');
    }
    add('');
    add('echo "Argo CD is installed."', 'A friendly message.');
    if (v.access === 'forward') {
      add(`echo "Open a second terminal and run: kubectl port-forward svc/argocd-server -n ${ns} 8080:443"`, 'Port-forward makes the cluster’s web server reachable at your own machine. It keeps running until you press Ctrl+C.');
      add('echo "Then open https://localhost:8080"', 'The browser warns about the certificate, because Argo CD makes its own. For a local test that is expected.');
    } else {
      add(`echo "Find the address with: kubectl get svc argocd-server -n ${ns}"`, 'Shows the port or address that was created.');
    }
    add(`echo "The first password: argocd admin initial-password -n ${ns}"`, 'Prints the one-time password for the admin user. The user name is admin.');
    return [{ path: 'install-argocd.sh', label: 'install-argocd.sh', lines }];
  },

  zipName: () => 'argocd-install.zip',

  run(v) {
    const ns = v.ns.trim();
    return {
      where:
        'Run this in a terminal (your laptop, or a VM through its console or SSH) that already talks to a Kubernetes cluster. Check with kubectl get nodes first. No cluster yet? A local one such as kind or minikube is fine for learning. The web page opens in a browser (GUI). Change the first password, then delete the one-time secret.',
      commands: [
        { cmd: 'bash install-argocd.sh', what: 'Run the script. It takes a minute or two.' },
        ...(v.access === 'forward' ? [{ cmd: `kubectl port-forward svc/argocd-server -n ${ns} 8080:443`, what: 'Run in a second terminal. Leave it open while you use the web page.' }] : []),
        { cmd: `argocd admin initial-password -n ${ns}`, what: 'Print the one-time admin password. Copy it, then paste it at the login page or the prompt below.' },
        { cmd: `argocd login localhost:8080 --username admin --insecure`, what: 'Log the command in. It asks for the password with a hidden prompt. --insecure accepts the self-made certificate, fine for a local test only.' },
        { cmd: 'argocd account update-password', what: 'Change the password. It asks for the old and new password with hidden prompts.' },
        { cmd: `kubectl delete secret argocd-initial-admin-secret -n ${ns}`, what: 'Delete the one-time password once you have changed it.' },
      ],
      flags: [
        { flag: 'kubectl apply --server-side', meaning: 'The cluster merges the change itself. Needed for very large definitions.' },
        { flag: '--force-conflicts', meaning: 'Take over fields that another tool set before. Safe on a new install.' },
        { flag: 'kubectl wait --for=condition=available', meaning: 'Pause until the Deployment is ready, up to --timeout.' },
        { flag: 'kubectl port-forward svc/NAME 8080:443', meaning: 'Send your machine’s port 8080 to port 443 of the service in the cluster.' },
        { flag: 'argocd login --insecure', meaning: 'Skip checking the certificate. Fine locally, never for a real system.' },
      ],
    };
  },
};

const ARGOCD_TOOLS = [acApplication, acAppSet, acProject, acRepo, acInstall];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { ARGOCD_TOOLS };

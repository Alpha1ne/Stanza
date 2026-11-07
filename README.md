# Stanza

Stanza is a no-backend web app that writes DevOps configuration files for you. Pick a tool, answer a few plain questions, and get a finished file. Beside every line, Stanza shows a short note in plain English explaining what that line does and why it is there.

## What is included

**Ansible**
- Generators: inventory, ad-hoc commands, playbooks and roles.
- Reference pages: commands, modules and playbook concepts, each with a "?" breakdown of every example.

**Terraform**
- Generators: provider setup, security groups, EC2 instances and S3 buckets.
- Reference pages: commands, the HCL language and common AWS resources.

**Jenkins**
- Generators: a build-and-test pipeline and a deploy pipeline (Docker image and SSH, with passwords kept in Jenkins credentials). The output is a Groovy `Jenkinsfile`.
- Reference pages: pipeline concepts and steps.

**Planned**
- Docker: Dockerfile and Docker Compose.

## Running it

No install and no server.

1. Download or clone this repository.
2. Open `index.html` in a browser.

Nothing is uploaded. Everything runs in the browser with plain HTML, CSS and JavaScript. You can download each generated file, or all of them as a zip.

## Project layout

| File | What it does |
|---|---|
| `index.html` | The page structure. |
| `style.css` | Layout, colours (Frost and Midnight themes) and responsive rules. |
| `app.js` | Routing, the form, the file tabs, the notes and the reference pages. |
| `tools.js` | The Ansible generators and the list of tools shown in the menu. |
| `terraform.js` | The Terraform generators. |
| `jenkins.js` | The Jenkins generators (Jenkinsfile). |
| `commands.js`, `modules.js`, `concepts.js` | Ansible reference data. |
| `tf-commands.js`, `tf-concepts.js`, `tf-resources.js` | Terraform reference data. |
| `jk-ref.js` | Jenkins reference data. |
| `zip.js` | Builds the downloadable zip without any library. |
| `brand/`, `fonts/` | Logos, icons and bundled fonts, so the page works offline. |
| `tests/` | Browser tests (Playwright) and an accessibility check (axe-core). |

## Notes

- The reference examples were checked against real tools: `ansible-core` 2.22, OpenTofu 1.9.1 (a stand-in for Terraform) and a Groovy parser for the Jenkinsfiles. AWS resource arguments were checked against the AWS provider documentation. Nothing was applied to a real AWS account.
- Ansible, Terraform and Docker are trademarks of their owners (Red Hat, HashiCorp and Docker, Inc.). Stanza is an independent project and is not affiliated with them.

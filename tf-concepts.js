'use strict';

/*
  tf-concepts.js — the Terraform language (HCL) reference.

  Same shape as concepts.js, `cmd` is HCL. Inside the template strings a
  literal Terraform ${...} is written \${...} so JavaScript leaves it alone.

  Examples that can run on their own use only the built-in terraform_data
  resource (no cloud account, no provider download) and were run with
  OpenTofu. noRun: true marks a piece that needs a real provider, another
  file, or is a settings file. Those were checked for format and syntax only.
*/

const TF_CONCEPT_GROUPS = [
  /* ------------------------------------------------------------------ */
  {
    id: 'shape',
    tool: 'The language',
    kind: 'hcl',
    title: 'The shape of Terraform code',
    blurb: 'Terraform files are written in HCL. It is made of blocks, and blocks hold arguments. Once you see that, every file looks the same.',
    commands: [
      {
        id: 'blocks',
        cmd: `resource "terraform_data" "greeting" {
  input = "hello"
}`,
        title: 'A block, line by line',
        what: 'One resource block. It asks Terraform to manage one thing, called greeting, of the kind terraform_data.',
        use: 'Almost everything you write is a block like this one: a keyword, some labels in quotes, then settings in braces.',
        parts: [
          ['resource', 'The block type. Other types are variable, output, data, provider, module and locals.'],
          ['"terraform_data"', 'The first label: what kind of thing. For AWS you would see "aws_instance" or "aws_s3_bucket". The part before the first underscore names the provider.'],
          ['"greeting"', 'The second label: your own name for it. It only has to be unique among resources of that kind.'],
          ['{ }', 'The body. Everything between the braces belongs to this block.'],
          ['input = "hello"', 'An argument: a name, an equals sign, and a value.'],
        ],
        tips: [
          'The address of this resource is terraform_data.greeting: type, dot, name. You will type that in commands and references.',
          'A line starting with # or // is a comment. Terraform ignores it. Use comments to explain why.',
          'Order does not matter. Terraform works out the order from the references.',
        ],
      },
      {
        id: 'references',
        cmd: `resource "terraform_data" "first" {
  input = "hello"
}

resource "terraform_data" "second" {
  input = "\${terraform_data.first.output} world"
}

output "result" {
  value = terraform_data.second.output
}`,
        title: 'One thing using another',
        what: 'The second resource reads a value from the first. Terraform sees the link and always builds the first one first.',
        use: 'To pass values between resources, for example a subnet ID into a server.',
        parts: [
          ['terraform_data.first.output', 'type.name.attribute. The value the first resource exposes after it is built.'],
          ['"\${ ... } world"', 'Inside quotes, ${ } drops a value into the text. Alone, with no text around it, you can write the reference with no quotes at all.'],
          ['output "result"', 'Prints the value after apply.'],
        ],
        tips: [
          'This link is called an implicit dependency. You rarely need depends_on, because references already make the order.',
          'Some values, such as a server’s ID, are unknown until it exists. Plan shows them as (known after apply).',
        ],
      },
      {
        id: 'settings',
        cmd: `terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}`,
        title: 'The terraform settings block',
        what: 'Says which Terraform version the code needs and which providers to download, with the versions allowed.',
        use: 'At the top of every real project, usually in a file called versions.tf or main.tf.',
        parts: [
          ['required_version = ">= 1.6"', 'Refuse to run on an older Terraform. A clear error is better than a confusing one half way.'],
          ['required_providers', 'The list of plugins this code needs.'],
          ['source = "hashicorp/aws"', 'Where to download it from: owner/name on the registry.'],
          ['version = "~> 6.0"', 'Allow 6.x updates, but not 7.0. The ~> sign means "this, or newer in the last part only".'],
        ],
        tips: ['Version rules: = exact, >= minimum, ~> 6.0 means at least 6.0 and under 7.0, ~> 6.2.1 means at least 6.2.1 and under 6.3.'],
        noRun: true,
      },
      {
        id: 'provider',
        cmd: `provider "aws" {
  region = "ap-south-1"

  default_tags {
    tags = {
      Project   = "stanza-demo"
      ManagedBy = "terraform"
    }
  }
}`,
        title: 'The provider block',
        what: 'Sets up the AWS plugin: which region to use, and tags to stamp on everything it creates.',
        use: 'Once per provider. Credentials are not written here. They come from the AWS CLI sign-in or environment variables.',
        parts: [
          ['provider "aws"', 'Configure the plugin named aws.'],
          ['region = "ap-south-1"', 'Where resources go. ap-south-1 is Mumbai.'],
          ['default_tags', 'Tags added to every taggable resource this provider creates.'],
          ['tags = { ... }', 'A map of name = value pairs.'],
        ],
        careful: 'Never write an access key or secret key in this block. It ends up in git and in the state.',
        noRun: true,
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'values',
    tool: 'Variables and outputs',
    kind: 'hcl',
    title: 'Inputs, outputs and local values',
    blurb: 'How settings come in, how answers go out, and how to name a calculation once.',
    commands: [
      {
        id: 'variable',
        cmd: `variable "greeting" {
  type        = string
  description = "What to say"
  default     = "hello"
}

resource "terraform_data" "say" {
  input = var.greeting
}

output "said" {
  value = terraform_data.say.output
}`,
        title: 'An input variable',
        what: 'Declares a setting you can change without editing the code, then uses it as var.greeting.',
        use: 'Anything that differs between environments: a region, a size, a name.',
        parts: [
          ['variable "greeting"', 'Declare an input called greeting.'],
          ['type = string', 'What kind of value. Others: number, bool, list(string), map(string), object({...}).'],
          ['description', 'A note for the person using it. Shown when Terraform asks for the value.'],
          ['default = "hello"', 'Used when nobody gives a value. Leave it out to make the value required.'],
          ['var.greeting', 'How you read it elsewhere. Always var. then the name.'],
        ],
        tips: [
          'Ways to set it, strongest last: the default, a TF_VAR_greeting environment variable, terraform.tfvars, then -var on the command line.',
          'A variable with no default makes Terraform stop and ask, which breaks automation. Give defaults unless the value must be chosen.',
        ],
      },
      {
        id: 'validation',
        cmd: `variable "environment" {
  type    = string
  default = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Use dev, staging or prod."
  }
}

output "env" {
  value = var.environment
}`,
        title: 'Reject bad input early',
        what: 'A validation block checks the value before anything is built. If the condition is false, Terraform stops and shows your message.',
        use: 'To catch a typo such as "prodd" at plan time instead of after half of a deployment.',
        parts: [
          ['validation { }', 'A rule for this variable. You can have several.'],
          ['condition', 'An expression that must be true. It can use the variable itself.'],
          ['contains([...], var.environment)', 'A function that is true when the value is in the list.'],
          ['error_message', 'What the person sees when the condition is false. Say how to fix it.'],
        ],
        tips: ['Try it: terraform plan -var="environment=test" fails with your message.'],
      },
      {
        id: 'sensitive',
        cmd: `variable "db_password" {
  type      = string
  sensitive = true
  default   = "change-me"
}

resource "terraform_data" "database" {
  input = var.db_password
}

output "password" {
  value     = var.db_password
  sensitive = true
}`,
        title: 'Hide secret values from the screen',
        what: 'sensitive = true makes Terraform print <sensitive> instead of the value in plans and outputs.',
        use: 'For passwords and tokens that pass through your code.',
        parts: [
          ['sensitive = true (variable)', 'Hide this variable in plan and apply output.'],
          ['sensitive = true (output)', 'Required on any output that carries a sensitive value, even one calculated from it, or Terraform refuses.'],
          ['input = var.db_password', 'You can still pass the value to other resources. Only the printing is hidden.'],
        ],
        careful: 'This hides the screen only. The value is still written in plain text in the state file, so protect the state, and never use a real password as a default.',
        tips: ['Pass the real value with the TF_VAR_db_password environment variable so it never sits in a file.'],
      },
      {
        id: 'locals',
        cmd: `variable "project" {
  type    = string
  default = "stanza"
}

locals {
  prefix = "\${var.project}-dev"
  tags = {
    Project = var.project
    Owner   = "athul"
  }
}

resource "terraform_data" "named" {
  input = local.prefix
}

output "tags" {
  value = local.tags
}`,
        title: 'Name a value once with locals',
        what: 'A locals block gives names to values or calculations you use in several places. You read them as local.name.',
        use: 'To stop repeating the same naming rule or tag list everywhere.',
        parts: [
          ['locals { }', 'Holds one or more named values. The word is plural when you declare, singular when you use.'],
          ['prefix = "${var.project}-dev"', 'A calculated value. It can use variables and other resources.'],
          ['local.prefix', 'How you read it. Always local. then the name.'],
        ],
        tips: ['A variable is an input from outside. A local is a private shortcut inside. Users cannot set locals.'],
      },
      {
        id: 'output',
        cmd: `resource "terraform_data" "box" {
  input = "ready"
}

output "box_status" {
  description = "What the box says"
  value       = terraform_data.box.output
}`,
        title: 'Output values',
        what: 'An output prints a value at the end of apply and stores it so you can read it later with terraform output.',
        use: 'To show what you need next: an IP address, a URL, an ID. Modules also use outputs to hand values back.',
        parts: [
          ['output "box_status"', 'Declare an output with this name.'],
          ['description', 'A note about what the value is.'],
          ['value', 'The value to show. Any expression.'],
        ],
        tips: ['Run terraform output box_status any time after apply to see it again.'],
      },
      {
        id: 'tfvars',
        cmd: `# terraform.tfvars
project     = "stanza"
environment = "prod"
ports       = [80, 443]
tags = {
  Owner = "athul"
}`,
        title: 'A tfvars file',
        what: 'A plain list of variable values. Terraform reads terraform.tfvars and any *.auto.tfvars file by itself.',
        use: 'To keep settings for one environment in one small file next to the code.',
        parts: [
          ['project = "stanza"', 'Set the variable called project. No var. prefix here and no declaration.'],
          ['ports = [80, 443]', 'A list. Square brackets, commas between items.'],
          ['tags = { ... }', 'A map. Curly braces, name = value inside.'],
          ['-var-file=prod.tfvars', 'For a file with another name, point at it on the command line.'],
        ],
        careful: 'Do not commit a tfvars file that holds secrets. Add it to .gitignore.',
        noRun: true,
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'logic',
    tool: 'Loops and logic',
    kind: 'hcl',
    title: 'Repeating things and making choices',
    blurb: 'Build several of something from one block, choose between values, and reshape lists.',
    commands: [
      {
        id: 'count',
        cmd: `resource "terraform_data" "server" {
  count = 3

  input = "server-\${count.index}"
}

output "names" {
  value = terraform_data.server[*].input
}`,
        title: 'count: make N copies',
        what: 'Builds three copies of the block. Inside, count.index is 0, 1, then 2.',
        use: 'When the copies are identical, or you only need a number of them. Set count = 0 to switch something off.',
        parts: [
          ['count = 3', 'How many copies to make.'],
          ['count.index', 'The copy’s number, counting from 0.'],
          ['terraform_data.server[*].input', 'The [*] gathers the input of every copy into a list.'],
          ['terraform_data.server[0]', 'To reach one copy, use its number in square brackets.'],
        ],
        careful: 'Copies are tracked by number. Removing the first of a list shifts the others, and Terraform may rebuild them. Use for_each when each copy has its own identity.',
      },
      {
        id: 'for-each',
        cmd: `resource "terraform_data" "env" {
  for_each = toset(["dev", "staging", "prod"])

  input = "env-\${each.key}"
}

output "envs" {
  value = [for k, v in terraform_data.env : v.output]
}`,
        title: 'for_each: one copy per item',
        what: 'Builds one copy for each item in a set or map. Each copy is named after its item, not a number.',
        use: 'When copies differ, such as one bucket per name. Adding or removing an item touches only that item.',
        parts: [
          ['for_each = toset([...])', 'The items to loop over. A set of strings or a map.'],
          ['each.key', 'The current item (for a map, its key).'],
          ['each.value', 'For a map, the value that goes with the key. For a set it equals each.key.'],
          ['terraform_data.env["prod"]', 'Reach one copy by its key.'],
        ],
        tips: ['With a map: for_each = { web = "t3.micro", db = "t3.small" } then each.key is web and each.value is t3.micro.'],
      },
      {
        id: 'conditional',
        cmd: `variable "environment" {
  type    = string
  default = "dev"
}

locals {
  size = var.environment == "prod" ? "large" : "small"
}

resource "terraform_data" "monitoring" {
  count = var.environment == "prod" ? 1 : 0

  input = "on"
}

output "size" {
  value = local.size
}`,
        title: 'Choose a value, or switch something on or off',
        what: 'The pattern test ? a : b gives a when the test is true, otherwise b. With count it builds a thing only when you want it.',
        use: 'Bigger servers in prod, optional extras, or features behind a true/false switch.',
        parts: [
          ['var.environment == "prod"', 'The test. Comparison signs: == != < > <= >=. Join tests with && (and), || (or) and ! (not).'],
          ['? "large" : "small"', 'The value if true, then the value if false.'],
          ['count = ... ? 1 : 0', 'The standard trick: one copy or none.'],
        ],
        tips: ['Both answers must be the same kind of value, for example both text.'],
      },
      {
        id: 'for-expr',
        cmd: `locals {
  names = ["web", "api", "db"]

  upper   = [for n in local.names : upper(n)]
  lengths = { for n in local.names : n => length(n) }
  short   = [for n in local.names : n if length(n) < 4]
}

output "upper" {
  value = local.upper
}

output "lengths" {
  value = local.lengths
}

output "short" {
  value = local.short
}`,
        title: 'for expressions: reshape a list or map',
        what: 'Builds a new list or map by going through an old one, changing or filtering each item.',
        use: 'To turn one list into the shape another block wants.',
        parts: [
          ['[for n in local.names : upper(n)]', 'Square brackets make a list. Take each n, apply a function, collect the results.'],
          ['{ for n in local.names : n => length(n) }', 'Curly braces make a map. The => sets the key on the left and the value on the right.'],
          ['if length(n) < 4', 'Keep only items where this is true.'],
        ],
        tips: ['Try expressions without building anything: run terraform console and type them in.'],
      },
      {
        id: 'functions',
        cmd: `locals {
  words = ["alpha", "beta", "gamma"]
}

output "joined" {
  value = join("-", local.words)
}

output "merged" {
  value = merge({ a = 1 }, { b = 2 })
}

output "lookup" {
  value = lookup({ dev = "t3.micro", prod = "t3.large" }, "prod", "t3.micro")
}

output "formatted" {
  value = format("%s-%02d", "web", 7)
}`,
        title: 'Built-in functions',
        what: 'Terraform has a library of functions. You call one as name(arguments) anywhere a value goes.',
        use: 'To join text, combine maps, look up a value with a fallback, build names, read files and more.',
        parts: [
          ['join("-", list)', 'Glue a list into one piece of text with a separator.'],
          ['merge(map1, map2)', 'Combine maps. Later ones win on a clash.'],
          ['lookup(map, key, default)', 'Read a key from a map, or use the default if it is missing.'],
          ['format("%s-%02d", ...)', 'Fill a template. %s is text, %02d is a number padded to two digits.'],
        ],
        tips: [
          'More you will meet: length, element, concat, split, replace, lower, upper, toset, tolist, file, templatefile, cidrsubnet, jsonencode.',
          'Functions are built in. You cannot write your own.',
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'safety',
    tool: 'Order and safety',
    kind: 'hcl',
    title: 'Order, safety rails and moving things around',
    blurb: 'Control the order of building, protect important things, and change code without rebuilding.',
    commands: [
      {
        id: 'depends-on',
        cmd: `resource "terraform_data" "database" {
  input = "db"
}

resource "terraform_data" "app" {
  input = "app"

  depends_on = [terraform_data.database]
}`,
        title: 'depends_on: force an order',
        what: 'Tells Terraform to build the database before the app, even though the app does not read any value from it.',
        use: 'Only when there is a hidden link that Terraform cannot see from references.',
        parts: [['depends_on = [ ... ]', 'A list of resource addresses that must be finished first.']],
        tips: ['If one block reads a value from another, you do not need depends_on. The reference already sets the order.'],
      },
      {
        id: 'lifecycle',
        cmd: `resource "terraform_data" "important" {
  input = "keep me"

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [input]
  }
}`,
        title: 'lifecycle: protect a resource',
        what: 'A lifecycle block changes how Terraform treats one resource. Here it refuses to delete it and ignores edits to input.',
        use: 'For things you cannot afford to lose, such as a database, or settings that something else changes.',
        parts: [
          ['prevent_destroy = true', 'Any plan that would delete or replace this fails with an error.'],
          ['ignore_changes = [input]', 'Do not react when these arguments differ. Useful when another tool edits them.'],
          ['create_before_destroy', 'Not shown. Build the replacement first, then delete the old one. Avoids downtime.'],
          ['replace_triggered_by', 'Not shown. Rebuild this resource when another one changes.'],
        ],
        tips: ['terraform destroy still runs, but fails on this resource. If you delete the whole resource block from the code, the protection goes with it and the plan will destroy the real thing.'],
      },
      {
        id: 'precondition',
        cmd: `variable "disk_gb" {
  type    = number
  default = 20
}

resource "terraform_data" "disk" {
  input = var.disk_gb

  lifecycle {
    precondition {
      condition     = var.disk_gb >= 8
      error_message = "The disk must be at least 8 GB."
    }
  }
}`,
        title: 'precondition: check before building',
        what: 'A rule inside lifecycle. If its condition is false, Terraform stops before creating or changing the resource.',
        use: 'To check things a variable validation cannot, such as a value that comes from another resource.',
        parts: [
          ['precondition { }', 'Checked before the resource is built.'],
          ['condition', 'Must be true to continue.'],
          ['error_message', 'Shown if it is false.'],
          ['postcondition', 'Not shown. The same, but checked after the resource is built, using its real values.'],
        ],
      },
      {
        id: 'check',
        cmd: `variable "limit" {
  type    = number
  default = 10
}

check "limit_is_sane" {
  assert {
    condition     = var.limit <= 100
    error_message = "The limit is unusually high."
  }
}`,
        title: 'check: warn without stopping',
        what: 'A check block tests something and prints a warning if it fails. Unlike a precondition, it never stops the run.',
        use: 'For health or sanity tests, such as "is the website answering?"',
        parts: [
          ['check "limit_is_sane"', 'A named check. The name appears in the warning.'],
          ['assert { }', 'The actual test: a condition and a message.'],
        ],
        tips: ['A failed check is only a warning, so a pipeline will not fail on it. Use a precondition when you need to stop.'],
      },
      {
        id: 'moved',
        cmd: `moved {
  from = terraform_data.old_name
  to   = terraform_data.new_name
}

resource "terraform_data" "new_name" {
  input = "same thing, new name"
}`,
        title: 'moved: rename without rebuilding',
        what: 'Tells Terraform that a resource has a new name in the code, so it renames the state entry instead of deleting and recreating.',
        use: 'Whenever you rename a resource block or move it into a module.',
        parts: [
          ['moved { }', 'A note about a rename. It shows up in the plan so a reviewer can see it.'],
          ['from', 'The old address.'],
          ['to', 'The new address. It must match a resource that exists in the code.'],
        ],
        tips: ['This is the code version of terraform state mv. It is safer because the plan shows it first.'],
      },
      {
        id: 'import-block',
        cmd: `import {
  to = aws_s3_bucket.logs
  id = "my-existing-logs-bucket"
}

resource "aws_s3_bucket" "logs" {
  bucket = "my-existing-logs-bucket"
}`,
        title: 'import: adopt something that exists',
        what: 'Tells Terraform that a resource block should take over an existing real thing, found by its ID.',
        use: 'For something created by hand that you want Terraform to manage from now on.',
        parts: [
          ['import { }', 'A one-off instruction. It shows up in the plan.'],
          ['to', 'The resource block that will own it.'],
          ['id', 'The real thing’s ID. Each resource’s docs page says what the ID is.'],
        ],
        tips: ['Run terraform plan and check it says "1 to import". Afterwards you can delete the import block.'],
        noRun: true,
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'reuse',
    tool: 'Data, modules, more',
    kind: 'hcl',
    title: 'Reading existing things and reusing code',
    blurb: 'Look things up instead of building them, share code between projects, and handle more than one account.',
    commands: [
      {
        id: 'data',
        cmd: `data "aws_caller_identity" "me" {}

output "account_id" {
  value = data.aws_caller_identity.me.account_id
}`,
        title: 'A data source: look something up',
        what: 'A data block reads information about something that already exists. It builds nothing.',
        use: 'To find an AMI ID, the current account number, or a VPC that someone else created.',
        parts: [
          ['data "aws_caller_identity"', 'Look up the account you are signed in as.'],
          ['"me"', 'Your name for the result.'],
          ['{}', 'This one needs no settings. Others take a filter.'],
          ['data.aws_caller_identity.me.account_id', 'Read it. The address starts with data.'],
        ],
        noRun: true,
      },
      {
        id: 'dynamic',
        cmd: `variable "ports" {
  type    = list(number)
  default = [80, 443]
}

resource "aws_security_group" "web" {
  name = "web"

  dynamic "ingress" {
    for_each = var.ports

    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["10.0.0.0/8"]
    }
  }
}`,
        title: 'dynamic: repeat a block inside a block',
        what: 'Writes the nested ingress block once for each port in the list.',
        use: 'When a resource has a repeating inner block and the number of copies comes from a variable.',
        parts: [
          ['dynamic "ingress"', 'The name of the inner block to repeat.'],
          ['for_each = var.ports', 'What to loop over.'],
          ['content { }', 'The body of each copy.'],
          ['ingress.value', 'The current item. The name is the block name, not each.'],
        ],
        tips: ['Use it sparingly. Plain repeated blocks are easier to read when the list is short and never changes.'],
        noRun: true,
      },
      {
        id: 'module',
        cmd: `module "network" {
  source = "./modules/network"

  cidr_block = "10.0.0.0/16"
  name       = "demo"
}

output "vpc_id" {
  value = module.network.vpc_id
}`,
        title: 'A module call',
        what: 'Uses a folder of Terraform code as a reusable unit. The arguments are the folder’s input variables.',
        use: 'To build the same group of resources in several places without copying code.',
        parts: [
          ['module "network"', 'Your name for this use of the module.'],
          ['source = "./modules/network"', 'Where the code is. A local folder, a Git address or a registry name.'],
          ['cidr_block, name', 'Values for the variables declared inside the module.'],
          ['module.network.vpc_id', 'Read an output the module defines.'],
        ],
        tips: ['A module is just a folder with .tf files. Your main folder is itself the "root module".', 'Run terraform init again after adding or changing a module source.'],
        noRun: true,
      },
      {
        id: 'alias',
        cmd: `provider "aws" {
  region = "ap-south-1"
}

provider "aws" {
  alias  = "virginia"
  region = "us-east-1"
}

resource "aws_s3_bucket" "replica" {
  provider = aws.virginia
  bucket   = "my-replica-bucket-example"
}`,
        title: 'Two regions or accounts at once',
        what: 'A second provider block with an alias, then a resource that chooses it.',
        use: 'For anything global that lives in one fixed region, or when a setup spans two regions or accounts.',
        parts: [
          ['alias = "virginia"', 'A name for this second copy of the provider.'],
          ['provider = aws.virginia', 'On a resource: use that copy instead of the default one.'],
        ],
        noRun: true,
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'state',
    tool: 'State and backends',
    kind: 'hcl',
    title: 'Keeping state safe',
    blurb: 'On your own laptop the state is a local file. For anything shared, move it somewhere safe.',
    commands: [
      {
        id: 'backend',
        cmd: `terraform {
  backend "s3" {
    bucket       = "my-team-tfstate"
    key          = "prod/network/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}`,
        title: 'Store the state in an S3 bucket',
        what: 'Keeps the state in a bucket instead of a file on your laptop, encrypted, with a lock so two people cannot apply at once.',
        use: 'As soon as more than one person, or a pipeline, uses the same project.',
        parts: [
          ['backend "s3"', 'Use an S3 bucket as the backend.'],
          ['bucket', 'The bucket. Create it first, by hand or in a separate project. Turn on versioning so old states can be recovered.'],
          ['key', 'The file name inside the bucket. Use a different key for each project.'],
          ['encrypt = true', 'Encrypt the state at rest.'],
          ['use_lockfile = true', 'Lock using a small file in the same bucket. Older guides use a DynamoDB table (dynamodb_table) for locks. That setting is being phased out.'],
        ],
        careful: 'A backend block cannot use variables. Write the values in or pass them with init -backend-config.',
        tips: ['After editing this, run terraform init -migrate-state to copy your current state across.'],
        noRun: true,
      },
      {
        id: 'remote-state',
        cmd: `data "terraform_remote_state" "network" {
  backend = "s3"

  config = {
    bucket = "my-team-tfstate"
    key    = "prod/network/terraform.tfstate"
    region = "ap-south-1"
  }
}

output "vpc_id" {
  value = data.terraform_remote_state.network.outputs.vpc_id
}`,
        title: 'Read another project’s outputs',
        what: 'Reads the outputs saved in another project’s state, so two projects can share values.',
        use: 'When a network project and an application project are kept apart, and the app needs the VPC ID.',
        parts: [
          ['terraform_remote_state', 'A built-in data source that reads a state file.'],
          ['backend = "s3"', 'Where the other state lives.'],
          ['config = { ... }', 'The same bucket, key and region as the other project’s backend.'],
          ['.outputs.vpc_id', 'Only outputs are readable, so the other project must declare one.'],
        ],
        careful: 'Whoever can run this can read the whole state of the other project, secrets included. Give out access sparingly.',
        noRun: true,
      },
      {
        id: 'lockfile',
        cmd: `provider "registry.terraform.io/hashicorp/aws" {
  version     = "6.0.0"
  constraints = "~> 6.0"
  hashes = [
    "h1:0000000000000000000000000000000000000000000=",
  ]
}`,
        title: 'The .terraform.lock.hcl file',
        what: 'Written by terraform init. It records the exact provider version chosen and checksums of the download. This is a sample of its shape.',
        use: 'You never write it. You commit it, so everyone and every pipeline gets exactly the same providers.',
        parts: [
          ['version = "6.0.0"', 'The exact version chosen the first time. It stays until you run init -upgrade.'],
          ['constraints = "~> 6.0"', 'The rule from your required_providers block when it was chosen.'],
          ['hashes = [ ... ]', 'Checksums. Terraform refuses a provider whose download does not match.'],
        ],
        tips: ['The numbers above are made up for illustration. Never edit a real lock file by hand.'],
        noRun: true,
      },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { TF_CONCEPT_GROUPS };

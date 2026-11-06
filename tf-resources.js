'use strict';

/*
  tf-resources.js — common AWS resources, explained argument by argument.

  Same shape as concepts.js, `cmd` is HCL. A literal Terraform ${...} is
  written \${...}. Every example was checked for canonical formatting and
  syntax, and every argument name was checked against the AWS provider
  documentation. Nothing here was applied to a real account.
*/

const TF_RESOURCE_GROUPS = [
  /* ------------------------------------------------------------------ */
  {
    id: 'network',
    tool: 'Network',
    kind: 'hcl',
    title: 'Network: the private road system',
    blurb: 'A VPC is your own private network in AWS. Subnets are rooms inside it. The gateway and route table are the door to the internet. A server needs all of these to be reachable.',
    commands: [
      {
        id: 'vpc',
        cmd: `resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "main"
  }
}`,
        title: 'aws_vpc: your own network',
        what: 'Creates a private network with room for about 65,000 addresses.',
        use: 'The first thing in any AWS setup. Everything else lives inside it.',
        parts: [
          ['cidr_block = "10.0.0.0/16"', 'The range of private addresses. /16 means "the first two numbers are fixed", leaving room for 65,536. Pick a private range and do not overlap other networks you will connect to.'],
          ['enable_dns_support', 'Let machines inside look up names. Leave it true.'],
          ['enable_dns_hostnames', 'Give servers with public addresses a name too. Needed for some services.'],
          ['tags', 'Labels. The Name tag is what the AWS console shows.'],
        ],
        tips: ['Every AWS account already has a default VPC in each region. Create your own to keep practice and real work apart.', 'A VPC itself is free. What you put inside it costs money.'],
      },
      {
        id: 'subnet',
        cmd: `resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "ap-south-1a"
  map_public_ip_on_launch = true

  tags = {
    Name = "public-a"
  }
}`,
        title: 'aws_subnet: a slice of the network',
        what: 'Creates a smaller range of addresses inside the VPC, in one data centre (availability zone).',
        use: 'Servers are placed in subnets. Public ones face the internet, private ones do not.',
        parts: [
          ['vpc_id = aws_vpc.main.id', 'Which network this belongs to. This reference also makes Terraform build the VPC first.'],
          ['cidr_block = "10.0.1.0/24"', 'A slice of the VPC range. /24 gives 256 addresses (AWS keeps 5). It must sit inside the VPC range and not overlap another subnet.'],
          ['availability_zone', 'Which data centre. Use a second subnet in another zone for resilience.'],
          ['map_public_ip_on_launch', 'Give new servers here a public address automatically.'],
        ],
        tips: ['A subnet is only "public" if its route table sends internet traffic to an internet gateway. The setting above does not do that.'],
      },
      {
        id: 'igw',
        cmd: `resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "main"
  }
}`,
        title: 'aws_internet_gateway: the front door',
        what: 'Attaches an internet door to the VPC.',
        use: 'Needed for anything in the VPC to reach the internet or be reached from it.',
        parts: [
          ['vpc_id', 'The network to attach to. A VPC can have only one.'],
          ['tags', 'Labels.'],
        ],
        tips: ['The gateway itself is free. It does nothing until a route table sends traffic to it.'],
      },
      {
        id: 'route-table',
        cmd: `resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "public"
  }
}`,
        title: 'aws_route_table: the signposts',
        what: 'A list of rules that say where network traffic goes. This one sends all outside traffic to the internet gateway.',
        use: 'To make a subnet public, or to send traffic somewhere special.',
        parts: [
          ['vpc_id', 'The network it belongs to.'],
          ['route { }', 'One rule. Add more blocks for more rules.'],
          ['cidr_block = "0.0.0.0/0"', 'Which destinations the rule covers. 0.0.0.0/0 means "everything else".'],
          ['gateway_id', 'Where to send it: here, the internet gateway.'],
        ],
        tips: ['Traffic inside the VPC always works. AWS adds that rule for you, so you never write it.'],
      },
      {
        id: 'route-assoc',
        cmd: `resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}`,
        title: 'aws_route_table_association: connect the two',
        what: 'Tells a subnet to use a particular route table.',
        use: 'The last step in making a subnet public.',
        parts: [
          ['subnet_id', 'The subnet to connect.'],
          ['route_table_id', 'The route table it should follow.'],
        ],
        tips: ['Without this, the subnet uses the VPC’s main route table, which has no internet route.'],
      },
      {
        id: 'eip',
        cmd: `resource "aws_eip" "web" {
  domain   = "vpc"
  instance = aws_instance.web.id

  depends_on = [aws_internet_gateway.main]
}`,
        title: 'aws_eip: a fixed public address',
        what: 'Reserves a public IP address that stays yours and attaches it to a server.',
        use: 'When the address must not change when the server restarts, for example one you put in DNS.',
        parts: [
          ['domain = "vpc"', 'The kind of network the address is for. Always "vpc" for new work.'],
          ['instance', 'The server to attach to.'],
          ['depends_on', 'Build the internet gateway first, so the address can be reached.'],
        ],
        careful: 'AWS charges for every public IPv4 address, whether or not it is attached. Destroy it when you finish practising.',
      },
      {
        id: 'azs',
        cmd: `data "aws_availability_zones" "available" {
  state = "available"
}

output "zones" {
  value = data.aws_availability_zones.available.names
}`,
        title: 'aws_availability_zones: list the data centres',
        what: 'Looks up which availability zones are open in the region, so you do not hard-code names like ap-south-1a.',
        use: 'To spread subnets across zones: data.aws_availability_zones.available.names[0], then [1].',
        parts: [
          ['data', 'A lookup. It builds nothing.'],
          ['state = "available"', 'Only list zones that are usable right now.'],
          ['.names', 'The list of zone names.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'access',
    tool: 'Access',
    kind: 'hcl',
    title: 'Access: keys and permissions',
    blurb: 'A key pair lets you SSH in. An IAM role lets a server call other AWS services without any password stored on it.',
    commands: [
      {
        id: 'key-pair',
        cmd: `resource "aws_key_pair" "me" {
  key_name   = "my-laptop"
  public_key = file("~/.ssh/id_ed25519.pub")
}`,
        title: 'aws_key_pair: your SSH key',
        what: 'Uploads the public half of your SSH key to AWS so servers can be started that you can log into.',
        use: 'Before creating a server you plan to SSH into. Reference it from the server as key_name.',
        parts: [
          ['key_name', 'The name AWS will list it under.'],
          ['public_key', 'The contents of your public key. file() reads it from your computer.'],
          ['~/.ssh/id_ed25519.pub', 'The .pub file is the public half and is safe to share. Never point this at the private file with no .pub.'],
        ],
        careful: 'Only ever upload the .pub file. The private key stays on your computer.',
      },
      {
        id: 'policy-doc',
        cmd: `data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}`,
        title: 'aws_iam_policy_document: write a policy in HCL',
        what: 'Builds an IAM policy as a JSON string from simple blocks. You never hand-write JSON. This one says "EC2 servers may take on this role".',
        use: 'Whenever a role needs a trust policy or a permissions policy.',
        parts: [
          ['data', 'It only prepares text. Nothing is created in AWS.'],
          ['statement { }', 'One rule. A policy can have several.'],
          ['actions', 'What may be done. sts:AssumeRole means "take on this role".'],
          ['principals { }', 'Who the rule is about.'],
          ['type = "Service"', 'The who is an AWS service, not a person.'],
          ['identifiers', 'Which service. ec2.amazonaws.com means EC2 servers.'],
          ['.json', 'The result: data.aws_iam_policy_document.ec2_assume.json is the text you pass on.'],
        ],
        tips: ['In a permissions policy you would also set effect (Allow is the default), resources and actions such as s3:GetObject.'],
      },
      {
        id: 'iam-role',
        cmd: `resource "aws_iam_role" "web" {
  name               = "web-server"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}`,
        title: 'aws_iam_role: an identity for a server',
        what: 'Creates a role that EC2 servers may take on. It can do nothing yet. You attach permissions to it next.',
        use: 'Instead of putting AWS keys on a server. The server gets short-lived credentials automatically.',
        parts: [
          ['name', 'The role’s name.'],
          ['assume_role_policy', 'The trust policy: who may use the role. Here it comes from the policy document above.'],
        ],
        tips: ['A role has two separate parts: who can use it (trust) and what it can do (permissions). Mixing them up is the most common IAM confusion.'],
      },
      {
        id: 'role-attach',
        cmd: `resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.web.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}`,
        title: 'aws_iam_role_policy_attachment: give the role permissions',
        what: 'Attaches an existing AWS-managed policy to the role. This one lets the server be managed through Systems Manager.',
        use: 'To grant a role the ready-made permissions it needs.',
        parts: [
          ['role', 'The role’s name. Note: the name, not the ARN.'],
          ['policy_arn', 'The identifier of the policy. AWS-made ones start with arn:aws:iam::aws:policy/.'],
        ],
        careful: 'Give only the permissions needed. Avoid AdministratorAccess on a server.',
      },
      {
        id: 'instance-profile',
        cmd: `resource "aws_iam_instance_profile" "web" {
  name = "web-server"
  role = aws_iam_role.web.name
}`,
        title: 'aws_iam_instance_profile: the plug for a server',
        what: 'The wrapper that lets an EC2 server use a role. The console creates one for you. Terraform does not.',
        use: 'Set iam_instance_profile = aws_iam_instance_profile.web.name on your aws_instance.',
        parts: [
          ['name', 'The profile’s name. It can match the role’s name.'],
          ['role', 'The role to wrap.'],
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'storage',
    tool: 'Storage and data',
    kind: 'hcl',
    title: 'Disks and databases',
    blurb: 'Where data lives. The database example costs money while it exists, so read its warning.',
    commands: [
      {
        id: 'ebs',
        cmd: `resource "aws_ebs_volume" "data" {
  availability_zone = "ap-south-1a"
  size              = 20
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "data"
  }
}`,
        title: 'aws_ebs_volume: an extra disk',
        what: 'Creates a separate disk that can be attached to a server and survives if the server is deleted.',
        use: 'For data you want to keep apart from the server’s main disk.',
        parts: [
          ['availability_zone', 'Must match the zone of the server it will attach to.'],
          ['size = 20', 'Size in gigabytes.'],
          ['type = "gp3"', 'The disk type. gp3 is the current general purpose SSD.'],
          ['encrypted = true', 'Encrypt the data on the disk.'],
        ],
        tips: ['Creating the disk does not attach it. Attach with aws_volume_attachment, then format and mount it inside the server.'],
        careful: 'The disk costs money per gigabyte per month even when it is not attached.',
      },
      {
        id: 'dynamodb',
        cmd: `resource "aws_dynamodb_table" "orders" {
  name         = "orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "order_id"

  attribute {
    name = "order_id"
    type = "S"
  }
}`,
        title: 'aws_dynamodb_table: a simple database table',
        what: 'Creates a DynamoDB table. It stores items by a key, with no servers for you to run.',
        use: 'For fast lookups by key. Also commonly used for session data and counters.',
        parts: [
          ['name', 'The table’s name.'],
          ['billing_mode = "PAY_PER_REQUEST"', 'Pay only for what you read and write. The other choice, PROVISIONED, charges for reserved capacity.'],
          ['hash_key = "order_id"', 'The main key. Every item must have one and it must be unique unless you add a range_key.'],
          ['attribute { }', 'Declare the type of each key attribute. Only keys go here, not every field.'],
          ['type = "S"', 'S is text (string), N is number, B is binary.'],
        ],
        tips: ['DynamoDB is not a SQL database. You cannot search by just any field without extra indexes.'],
      },
      {
        id: 'rds',
        cmd: `resource "aws_db_instance" "app" {
  identifier                  = "app-db"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  db_name                     = "app"
  username                    = "appadmin"
  manage_master_user_password = true
  publicly_accessible         = false
  skip_final_snapshot         = true
}`,
        title: 'aws_db_instance: a managed SQL database',
        what: 'Creates a PostgreSQL server that AWS runs, backs up and patches for you.',
        use: 'When an application needs a normal SQL database.',
        parts: [
          ['identifier', 'The database server’s name in AWS.'],
          ['engine / engine_version', 'The software. postgres 16 here. Others include mysql and mariadb.'],
          ['instance_class', 'The size of the machine. db.t4g.micro is the smallest common one.'],
          ['allocated_storage = 20', 'Disk in gigabytes.'],
          ['db_name', 'The first database created inside the server.'],
          ['username', 'The admin user’s name.'],
          ['manage_master_user_password = true', 'AWS makes a strong password and keeps it in Secrets Manager. You never write a password in your code or state.'],
          ['publicly_accessible = false', 'Do not give it an internet address. Keep it private.'],
          ['skip_final_snapshot = true', 'Delete without saving a last backup. Fine for practice, wrong for real data.'],
        ],
        careful: 'This is one of the expensive resources. It charges by the hour while it exists. Run terraform destroy when you finish practising, and set skip_final_snapshot to false for anything real.',
        tips: ['It takes several minutes to create and to destroy. That is normal.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'messaging',
    tool: 'Messaging and logs',
    kind: 'hcl',
    title: 'Logs and messages',
    blurb: 'Places for programs to write logs and pass messages to each other.',
    commands: [
      {
        id: 'log-group',
        cmd: `resource "aws_cloudwatch_log_group" "app" {
  name              = "/app/web"
  retention_in_days = 14
}`,
        title: 'aws_cloudwatch_log_group: a folder for logs',
        what: 'Creates a place in CloudWatch where an application can send its logs.',
        use: 'Before anything that writes logs, so you set how long they are kept.',
        parts: [
          ['name', 'The log group’s name. A slash path is a convention, not folders.'],
          ['retention_in_days = 14', 'Delete logs older than this. Without it logs are kept forever and keep costing money.'],
        ],
        tips: ['Allowed values are fixed numbers such as 1, 3, 5, 7, 14, 30, 60, 90 and 365.'],
      },
      {
        id: 'sns',
        cmd: `resource "aws_sns_topic" "alerts" {
  name = "alerts"
}`,
        title: 'aws_sns_topic: a broadcast channel',
        what: 'Creates a topic. Anything published to it is sent to everyone subscribed, by email, text or other services.',
        use: 'For alerts and notifications. An alarm publishes to the topic and people subscribe.',
        parts: [['name', 'The topic’s name.']],
        tips: ['A topic does nothing alone. Add an aws_sns_topic_subscription so someone receives the messages.'],
      },
      {
        id: 'sqs',
        cmd: `resource "aws_sqs_queue" "jobs" {
  name                       = "jobs"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600
}`,
        title: 'aws_sqs_queue: a waiting line for jobs',
        what: 'Creates a queue. One program puts messages in, another takes them out and does the work.',
        use: 'To pass work between parts of a system without them waiting on each other.',
        parts: [
          ['name', 'The queue’s name.'],
          ['visibility_timeout_seconds = 60', 'After a worker takes a message it is hidden for this long. If the worker does not delete it in time, another can take it. Set this longer than a job takes.'],
          ['message_retention_seconds = 345600', 'How long unprocessed messages are kept: 345,600 seconds is 4 days. The maximum is 14 days.'],
        ],
      },
    ],
  },
];

// Lets Node load this file for testing. Browsers ignore it.
if (typeof module !== 'undefined') module.exports = { TF_RESOURCE_GROUPS };

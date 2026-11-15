const {SUITES}=require('/home/claude/stanza/tools.js');const {Tester}=require('/home/claude/stanza/tester.js');
let n=0,bad=0;
const def=t=>{const v={};for(const g of t.groups)for(const f of g.fields)v[f.id]=f.default;return v};
const key='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKlWEwgSh9vUk2F8Wa7hdRlPA x@y';
function variants(t){const v=def(t);if(t.id==='agent')v.pubKey=key;const out=[v];
 // flip every checkbox and cycle every select option, one at a time
 for(const g of t.groups)for(const f of g.fields){if(f.type==='check')out.push({...v,[f.id]:!v[f.id]});if(f.type==='select')for(const o of f.options)out.push({...v,[f.id]:Array.isArray(o)?o[0]:(o.value??o)});}
 if(t.id==='agent')out.push({...v,method:'inbound'});
 return out}
for(const s of SUITES)for(const t of s.tools||[]){if(!t.build)continue;
 for(const v of variants(t)){if(Object.keys(t.validate(v)).length)continue;n++;
  let r;try{r=Tester.test(t.build(v))}catch(e){bad++;console.log('THROW',s.id,t.id,e.message);continue}
  const errs=r.checks.filter(c=>c.level==='error');
  if(errs.length){bad++;console.log('ERR',s.id,t.id,JSON.stringify(v).slice(0,120),errs.map(e=>e.file+': '+e.name+' - '+e.detail).join(' | '))}
  if(!r.checks.length){bad++;console.log('NO CHECKS',s.id,t.id)}}}
console.log('variants tested',n,'problems',bad);
// negative tests: the tester must catch real mistakes
const mk=(path,text)=>({path,lines:text.split('\n').map(t=>({t}))});
const must=(name,files,pred)=>{const r=Tester.test(files);const ok=pred(r);if(!ok){bad++;console.log('MISSED',name,JSON.stringify(r.checks.filter(c=>c.level!=='pass').map(c=>c.name)))}else console.log('caught',name)};
must('yaml tab',[mk('site.yml','- name: x\n  hosts: all\n\ttasks: []')],r=>r.checks.some(c=>c.level==='error'));
must('play without hosts',[mk('site.yml','- name: x\n  tasks:\n    - ansible.builtin.ping:\n')],r=>r.checks.some(c=>c.level==='error'));
must('missing handler',[mk('site.yml','- hosts: all\n  tasks:\n    - name: a\n      ansible.builtin.copy:\n        src: a\n        dest: b\n      notify: restart nginx\n')],r=>r.checks.some(c=>c.name==='Handler exists'&&c.level==='error'));
must('inventory bad child',[mk('inventory.ini','[web]\nh1\n\n[prod:children]\nnope\n')],r=>r.checks.some(c=>c.name==='Group exists'&&c.level==='error'));
must('tf unbalanced',[mk('main.tf','resource "aws_instance" "a" {\n  ami = "x"\n')],r=>r.checks.some(c=>c.level==='error'));
must('tf missing arg',[mk('main.tf','resource "aws_instance" "a" {\n  ami = "x"\n}\n')],r=>r.checks.some(c=>c.name==='Required arguments'&&c.level==='error'));
must('tf aws key',[mk('main.tf','provider "aws" {\n  access_key = "AKIAABCDEFGHIJKLMNOP"\n}\n')],r=>r.checks.some(c=>c.name==='No keys in the code'&&c.level==='error'));
must('tf ssh open',[mk('sg.tf','resource "aws_security_group" "a" {\n  ingress {\n    from_port = 22\n    to_port = 22\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}\n')],r=>r.checks.some(c=>c.level==='warn'&&/SSH/.test(c.name)));
must('jenkins unbalanced',[mk('Jenkinsfile',"pipeline {\n  agent any\n  stages {\n    stage('a') {\n      steps {\n        sh 'x'\n      }\n    }\n")],r=>r.checks.some(c=>c.level==='error'));
must('jenkins no steps',[mk('Jenkinsfile',"pipeline {\n  agent any\n  stages {\n    stage('a') {\n    }\n  }\n}\n")],r=>r.checks.some(c=>c.name==='Stage has steps'&&c.level==='error'));
must('jenkins secret',[mk('Jenkinsfile',"pipeline {\n  agent any\n  stages {\n    stage('a') {\n      steps {\n        sh \"deploy --token ${API_TOKEN}\"\n      }\n    }\n  }\n}\n")],r=>r.checks.some(c=>c.level==='warn'&&/Secrets/.test(c.name)));
must('jenkins hardcoded pw',[mk('Jenkinsfile',"pipeline {\n  agent any\n  stages {\n    stage('a') {\n      steps {\n        sh 'x'\n      }\n    }\n  }\n  environment { password = 'hunter2hunter2' }\n}\n")],r=>r.checks.some(c=>c.level==='error'));
must('compose literal secret',[mk('docker-compose.yml','services:\n  a:\n    image: x\n    environment:\n      DB_PASSWORD: hunter2\n')],r=>r.checks.some(c=>c.name==='No secrets in compose'&&c.level==='error'));
must('compose missing volume',[mk('docker-compose.yml','services:\n  a:\n    image: x\n    volumes:\n      - data:/d\n')],r=>r.checks.some(c=>c.name==='Volume is declared'&&c.level==='error'));
must('gitignore lacks .env',[mk('.env.example','A=1'),mk('.gitignore','node_modules')],r=>r.checks.some(c=>c.name==='.env is ignored'&&c.level==='error'));
must('shell chmod 777',[mk('x.sh','#!/usr/bin/env bash\nchmod 777 /tmp/x\n')],r=>r.checks.some(c=>c.level==='error'));
process.exit(bad?1:0);

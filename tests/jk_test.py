import sys
from playwright.sync_api import sync_playwright
BASE=(sys.argv[1] if len(sys.argv)>1 else 'file:///home/claude/stanza/index.html')
fails=[]
def check(n,c):
    print(('PASS ' if c else 'FAIL ')+n)
    if not c: fails.append(n)
def code(pg): return pg.evaluate("[...document.querySelectorAll('#sheet .row .code')].map(e=>e.textContent).join('\\n')")
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(BASE+'#/jenkins'); pg.wait_for_timeout(400)
    check('jenkins lands on Pipeline', 'Build and test pipeline' in pg.locator('h2').first.inner_text())
    check('nav: 2 generators + 2 references', [x.strip() for x in pg.locator('.tree .leaf').all_inner_texts()][-4:]==['Pipeline','Deploy pipeline','Concepts','Steps'])
    check('tab is Jenkinsfile in top bar', pg.locator('.topbar #files .file').all_inner_texts()==['Jenkinsfile'])
    check('language label Groovy', 'Groovy' in pg.locator('#st-lang').inner_text())
    t=code(pg); check('default file starts with pipeline', 'pipeline {' in t and 'stage(\'Test\')' in t)
    check('custom group hidden for node', pg.locator('fieldset[data-first-field="installCmd"]').is_hidden())
    pg.select_option('#f-language','custom'); pg.wait_for_timeout(200)
    check('custom group appears', pg.locator('fieldset[data-first-field="installCmd"]').is_visible())
    pg.fill('#f-testCmd', "x'; rm -rf /"); pg.wait_for_timeout(250)
    check('unsafe command is refused', pg.locator('#f-testCmd-err').is_visible() and pg.locator('#download').is_disabled())
    pg.fill('#f-testCmd','make test'); pg.wait_for_timeout(250)
    check('fixed command accepted', pg.locator('#download').is_enabled() and "sh 'make test'" in code(pg))
    pg.select_option('#f-agentType','docker'); pg.wait_for_timeout(200)
    check('docker agent block', "image 'node:22'" in code(pg))
    pg.select_option('#f-trigger','cron'); pg.fill('#f-schedule','H 2 * * *'); pg.wait_for_timeout(250)
    check('cron trigger', "cron('H 2 * * *')" in code(pg))
    pg.fill('#f-schedule','every day'); pg.wait_for_timeout(250)
    check('bad schedule refused', pg.locator('#f-schedule-err').is_visible())
    pg.fill('#f-schedule','H 2 * * *')
    for i in ('doInstall','doTest','doBuild','doArchive'):
        if pg.locator(f'#f-{i}').is_checked(): pg.locator(f'#f-{i}').uncheck()
    pg.wait_for_timeout(250)
    check('all stages off still gives one stage', "stage('Hello')" in code(pg))
    # notes
    pg.goto(BASE+'#/jenkins/pipeline'); pg.wait_for_timeout(300)
    check('margin notes present', pg.locator('#sheet .row.annotated').count()>8)
    # deploy
    pg.goto(BASE+'#/jenkins/deploy'); pg.wait_for_timeout(400)
    t=code(pg)
    check('deploy: docker + approval, no ssh by default', "withCredentials" in t and "input message" in t and 'sshagent' not in t)
    check('deploy: secret read by shell, not groovy', '--password-stdin' in t and '$REG_PASS' in t and '"$REG_PASS"' in t)
    pg.locator('#f-doSsh').check(); pg.wait_for_timeout(250)
    check('ssh stage appears', "sshagent(credentials: ['deploy-ssh-key'])" in code(pg))
    pg.fill('#f-sshUser','root'); pg.wait_for_timeout(250)
    check('root deploy refused', pg.locator('#f-sshUser-err').is_visible())
    pg.fill('#f-sshUser','deploy')
    pg.fill('#f-sshTarget','/var/www/../etc'); pg.wait_for_timeout(250)
    check('path with .. refused', pg.locator('#f-sshTarget-err').is_visible())
    pg.fill('#f-sshTarget','/var/www/app')
    pg.locator('#f-doDocker').uncheck(); pg.locator('#f-doSsh').uncheck(); pg.wait_for_timeout(250)
    check('nothing chosen -> error + disabled', pg.locator('#f-doDocker-err').is_visible() and pg.locator('#download').is_disabled())
    pg.locator('#f-doSsh').check(); pg.wait_for_timeout(250)
    with pg.expect_download() as d: pg.click('#download')
    check('download named Jenkinsfile', d.value.suggested_filename=='Jenkinsfile')
    # run steps
    pg.goto(BASE+'#/jenkins/pipeline'); pg.wait_for_timeout(300)
    check('run steps list git commands', 'git add Jenkinsfile' in pg.locator('main').inner_text())
    # references
    pg.goto(BASE+'#/jenkins/steps'); pg.wait_for_timeout(300)
    pg.fill('#q-jenkins-steps','junit'); pg.wait_for_timeout(250)
    check('search finds junit step', pg.locator('#ref-jenkins-steps .cmd:visible').count()>=1)
    # palette
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(200); pg.keyboard.type('jenkins'); pg.wait_for_timeout(200)
    n=pg.locator('#pal-list [role=option]').count() if pg.locator('#pal-list').count() else 0
    check('palette finds jenkins items', n>=4 or pg.locator('dialog [role=option]').count()>=4)
    check('no console errors', not errs)
    # phone
    m=b.new_page(viewport={'width':320,'height':700})
    for r in ('pipeline','deploy','concepts','steps'):
        m.goto(BASE+f'#/jenkins/{r}'); m.wait_for_timeout(300)
        check(f'phone 320 jenkins/{r}: no sideways scroll', m.evaluate('document.documentElement.scrollWidth')<=320)
    b.close()
print('FAILED:', fails or 'none')

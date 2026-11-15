import sys
from playwright.sync_api import sync_playwright
B='http://127.0.0.1:8766/index.html'
axe=open('axe/node_modules/axe-core/axe.min.js').read()
routes=['ansible/inventory','ansible/adhoc','ansible/playbook','ansible/role','terraform/provider','terraform/sg','terraform/ec2','terraform/s3','jenkins/pipeline','jenkins/multibranch','jenkins/matrix','jenkins/deploy','jenkins/library','jenkins/setup','jenkins/agent']
fails=[]
def check(n,ok,extra=''):
    if not ok: fails.append(n+' '+str(extra)); print('FAIL',n,extra)
with sync_playwright() as p:
    b=p.chromium.launch()
    for scheme in('light','dark'):
        ctx=b.new_context(viewport={'width':1440,'height':900},color_scheme=scheme,reduced_motion='reduce');pg=ctx.new_page();errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
        for r in routes:
            pg.goto(B+'#/'+r);pg.reload();pg.wait_for_timeout(450)
            if r=='jenkins/agent': pg.fill('#f-pubKey','ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKlWEwgSh9vUk2F8Wa7hdRlPA x@y')
            pg.wait_for_timeout(200)
            check(r+' test enabled',pg.locator('#test').is_enabled())
            pg.click('#test');pg.wait_for_timeout(150)
            check(r+' panel visible',pg.locator('#testpanel').is_visible())
            check(r+' pressed',pg.get_attribute('#test','aria-pressed')=='true')
            check(r+' has checks',pg.locator('.tcheck').count()>0)
            check(r+' verdict',pg.locator('.tverdict').count()==1)
            check(r+' no errors flagged',pg.locator('.tcheck.t-error').count()==0, pg.locator('.tcheck.t-error').all_inner_texts())
            if r!='jenkins/library' and r!='ansible/inventory' or r=='ansible/inventory':
                pass
            pg.evaluate(axe);v=pg.evaluate("axe.run('#testpanel').then(r=>r.violations.map(v=>v.id+':'+v.nodes.length))")
            check(r+' axe '+scheme,not v,v)
            pg.click('#testpanel button:has-text("Close")');check(r+' closes',not pg.locator('#testpanel').is_visible())
        # live update: open test, change an answer, results refresh
        pg.goto(B+'#/jenkins/multibranch');pg.reload();pg.wait_for_timeout(500);pg.click('#test')
        before=pg.locator('.tgroup').first.inner_text()
        pg.locator('#w-doRelease .switch, #w-doRelease label').first.click();pg.wait_for_timeout(300)
        check('live refresh keeps panel',pg.locator('#testpanel').is_visible())
        # jump to line from a warning
        pg.goto(B+'#/terraform/sg');pg.reload();pg.wait_for_timeout(500);pg.click('#test');pg.wait_for_timeout(200)
        print('sg warnings:',pg.locator('.tcheck.t-warn').count(),'jump buttons',pg.locator('.tline').count())
        if pg.locator('.tline').count():
            pg.locator('.tline').first.click();pg.wait_for_timeout(300);check('jump flashes a row',pg.locator('#sheet .row.flash').count()>=1)
        # tool switch hides panel
        pg.goto(B+'#/ansible/playbook');pg.wait_for_timeout(400);check('panel hidden after switching tool',not pg.locator('#testpanel').is_visible())
        # play animation (motion on)
        check('no console errors '+scheme,not errs,errs[:3]); ctx.close()
    # phone overflow with panel open
    for w in(320,375):
        pg=b.new_context(viewport={'width':w,'height':800}).new_page()
        for r in('jenkins/setup','terraform/ec2','ansible/role'):
            pg.goto(B+'#/'+r);pg.reload();pg.wait_for_timeout(450);pg.click('#test');pg.wait_for_timeout(300)
            s=pg.evaluate('[document.documentElement.scrollWidth,innerWidth]');check(f'phone {w} {r} overflow',s[0]<=s[1],s)
    # animation (motion allowed) finishes with all lines
    pg=b.new_context(viewport={'width':1440,'height':900}).new_page();pg.goto(B+'#/ansible/playbook');pg.reload();pg.wait_for_timeout(500);pg.click('#test');pg.wait_for_timeout(300)
    n1=pg.locator('.dry-out .dl').count();pg.wait_for_timeout(4000);n2=pg.locator('.dry-out .dl').count()
    check('animation progresses',n2>=n1 and n2>5,(n1,n2))
    pg.click('.dry button:has-text("Show all")');total=pg.locator('.dry-out .dl').count();check('show all',total>=n2,total)
print('FAILED:',fails or 'none')

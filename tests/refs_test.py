import sys
from playwright.sync_api import sync_playwright
BASE=sys.argv[1] if len(sys.argv)>1 else 'file:///home/claude/stanza/index.html'
EXPECT={('ansible','commands'):('Commands',64,'vault','ping user'),('ansible','modules'):('Modules',35,'apt','copy dest'),('ansible','concepts'):('Concepts',21,'loop','when'),('terraform','commands'):('Commands',41,'workspace','state mv'),('terraform','concepts'):('Concepts',28,'for_each','dynamic block'),('terraform','resources'):('Resources',18,'subnet','route table'),('jenkins','concepts'):('Concepts',16,'parallel','agent docker'),('jenkins','steps'):('Steps',20,'junit','retry')}
res=[]
def check(n,ok): res.append((n,bool(ok))); print(('PASS ' if ok else 'FAIL ')+n)
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    ctx=b.new_context(viewport={'width':1440,'height':900}); ctx.grant_permissions(['clipboard-read','clipboard-write']); pg=ctx.new_page()
    pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.goto(BASE+'#/ansible')
    leaves=pg.locator('.tree .leaf').all_inner_texts()
    check('nav order: 4 generators then 3 references', [x.strip() for x in leaves]==['Inventory','Ad-hoc command','Playbook','Role','Commands','Modules','Concepts'])
    for (sid,rid),(label,count,term,multi) in EXPECT.items():
        pre=f'[{sid}/{rid}] '
        pg.goto(BASE+f'#/{sid}/{rid}'); pg.wait_for_timeout(250)
        page=pg.locator(f'#ref-{sid}-{rid}')
        check(pre+'page visible, generator hidden', page.is_visible() and pg.locator('.bench').is_hidden() and pg.locator('#planned').is_hidden())
        check(pre+'only this page is shown', pg.locator('.refpage:visible').count()==1)
        check(pre+'nav leaf is current', pg.locator('.leaf[aria-current="page"]').inner_text().strip()==label)
        check(pre+'document title', pg.title()==f'{sid.capitalize()} {label} | Stanza')
        cards=page.locator('.cmd'); n=cards.count(); check(pre+f'{n} cards (expected {count})', n==count)
        check(pre+'every card has a ? button + closed panel', page.locator('.qbtn').count()==n and page.locator('.cmd-panel:visible').count()==0)
        q=page.locator('.qbtn').first; q.click()
        check(pre+'? opens (aria-expanded + visible)', q.get_attribute('aria-expanded')=='true' and page.locator('.cmd-panel:visible').count()==1)
        check(pre+'panel table headers', page.locator('.cmd-panel:visible th').all_inner_texts()[1]=='What it means')
        check(pre+'panel has 3+ headings (does/when/piece)', page.locator('.cmd-panel:visible h4').count()>=3)
        q.focus(); pg.keyboard.press('Enter'); check(pre+'Enter closes (keyboard)', page.locator('.cmd-panel:visible').count()==0)
        pg.keyboard.press('Space'); check(pre+'Space opens (keyboard)', page.locator('.cmd-panel:visible').count()==1)
        tog=page.locator('button.btn.quiet'); tog.click()
        check(pre+'Open all', page.locator('.cmd-panel:visible').count()==n and tog.inner_text()=='Close all explanations')
        tog.click(); check(pre+'Close all', page.locator('.cmd-panel:visible').count()==0)
        s=page.locator('input[type=search]'); s.fill(term); pg.wait_for_timeout(100)
        v=page.locator('.cmd:visible').count(); check(pre+f'search "{term}" narrows ({v})', 0<v<n and 'match' in page.locator('.cmd-count').inner_text())
        s.fill('zzzzqq'); check(pre+'no-match message', page.locator('.cmd-none').is_visible() and page.locator('.cmd:visible').count()==0)
        s.fill(multi); check(pre+f'multi-word search "{multi}"', page.locator('.cmd:visible').count()>=1)
        s.fill(''); check(pre+'clearing search restores all', page.locator('.cmd:visible').count()==n)
        first=page.locator('.copy-cmd').first; want=first.get_attribute('data-cmd'); first.click(); pg.wait_for_timeout(200)
        check(pre+'copy puts example on clipboard', pg.evaluate('navigator.clipboard.readText()')==want and len(want)>5)
        page.locator('.chip').nth(1).click(); pg.wait_for_timeout(150)
        check(pre+'group chip scrolls to its group', pg.evaluate("window.scrollY")>200)
        if not (rid=='commands'):
            check(pre+'yaml cards: no $ prompt, code is scrollable-focusable', page.locator('.cmdline.yaml pre[tabindex="0"]').count()==n and page.locator('.cmdline .prompt').count()==0)
        else:
            check(pre+'command cards show $ prompt + glossary', page.locator('.cmdline .prompt').count()==n and page.locator('details.words').count()==1)
    # copy button on every card in each page: label is unique + descriptive
    for sid,rid in EXPECT:
        pg.goto(BASE+f'#/{sid}/{rid}'); pg.wait_for_timeout(200)
        labs=pg.locator(f'#ref-{sid}-{rid} .copy-cmd').evaluate_all('els=>els.map(e=>e.getAttribute("aria-label"))')
        check(f'[{sid}/{rid}] copy labels unique', len(set(labs))==len(labs))
    pg.goto(BASE+'#/terraform'); pg.wait_for_timeout(250)
    tl=[x.strip() for x in pg.locator('.tree .leaf').all_inner_texts()]
    check('terraform nav: 4 generators then 3 references', tl[-7:]==['Provider setup','Security group','EC2 instance','S3 bucket','Commands','Concepts','Resources'] or tl[-3:]==['Commands','Concepts','Resources'])
    pg.goto(BASE+'#/terraform/resources'); pg.reload(); pg.wait_for_timeout(300)
    check('refresh stays on Terraform Resources', pg.locator('#ref-terraform-resources').is_visible())
    pg.goto(BASE+'#/terraform/commands'); pg.wait_for_timeout(200)
    check('terraform glossary heading', 'New to Terraform' in pg.locator('details.words summary:visible').inner_text())
    pg.goto(BASE+'#/ansible/commands'); pg.wait_for_timeout(200)
    check('ansible glossary heading unchanged', 'New to Ansible' in pg.locator('details.words summary:visible').inner_text())
    pg.goto(BASE+'#/terraform/sg'); pg.wait_for_timeout(250)
    check('terraform generator still works after refs', pg.locator('.bench').is_visible() and pg.locator('#reference').is_hidden())
    # palette finds all three
    for term,label in (('modules','Modules'),('concepts','Concepts'),('commands','Commands')):
        pg.goto(BASE+'#/ansible/inventory'); pg.keyboard.press('Control+k'); pg.fill('#pal-q',term); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
        check(f'palette opens {label}', pg.locator('.leaf[aria-current="page"]').inner_text().strip()==label)
    pg.goto(BASE+'#/ansible/modules'); pg.reload(); pg.wait_for_timeout(300)
    check('refresh stays on Modules', pg.locator('#ref-ansible-modules').is_visible())
    pg.goto(BASE+'#/ansible/role'); pg.wait_for_timeout(250)
    check('back to a generator hides references', pg.locator('#reference').is_hidden() and pg.locator('.bench').is_visible())
    pg.goto(BASE+'#/docker'); pg.wait_for_timeout(250)
    check('Docker planned page intact', pg.locator('#planned').is_visible() and pg.locator('#reference').is_hidden())
    pg.go_back(); pg.wait_for_timeout(200)
    check('browser back works', pg.locator('.bench').is_visible())
    check('no console errors', not errs); print(errs)
    b.close()
print('FAILED:',[n for n,ok in res if not ok] or 'none', f'({len(res)} checks)')

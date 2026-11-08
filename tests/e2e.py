import sys, zipfile
from playwright.sync_api import sync_playwright

root, out = sys.argv[1], sys.argv[2]
URL = f'file://{root}/index.html'
fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra and not ok else ''))
    if not ok: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark', accept_downloads=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('requestfailed', lambda r: errs.append('requestfailed ' + r.url))
    pg.goto(URL + '#/ansible/inventory'); pg.wait_for_timeout(400)

    # ---- fonts are bundled and actually used
    fonts = pg.evaluate("Promise.all([document.fonts.load('600 16px Oxanium'), document.fonts.load('400 16px \"IBM Plex Sans\"'), document.fonts.load('400 16px \"JetBrains Mono\"')]).then(r => r.map(x => x.length))")
    check('bundled fonts load (Oxanium, Plex, JetBrains Mono)', all(n > 0 for n in fonts), str(fonts))

    # ---- routes
    for slug, h2, minrows in [('inventory', 'Inventory and project setup', 10), ('adhoc', 'Ad-hoc command', 2), ('playbook', 'Ansible playbook', 8), ('role', 'Ansible role', 4)]:
        pg.goto(URL + f'#/ansible/{slug}'); pg.wait_for_timeout(250)
        got = pg.locator('#form-title').inner_text(); rows = pg.locator('#sheet .row').count()
        cur = pg.locator('a.leaf[aria-current=page]').inner_text().strip()
        check(f'route ansible/{slug}', got == h2 and rows >= minrows and pg.locator('#copy').is_enabled(), f'{got!r} rows={rows}')
    for slug in ('docker',):
        pg.goto(URL + f'#/{slug}'); pg.wait_for_timeout(200)
        check(f'route {slug} shows planned page', pg.locator('#planned').is_visible() and pg.locator('.bench').is_hidden() and pg.locator('.plan li').count() >= 2)

    # ---- editor: crumb, tab strip, overflow handling (role with a template = 7 files)
    pg.goto(URL + '#/ansible/role'); pg.wait_for_timeout(250)
    pg.click('summary:has-text("Config file from a template")'); pg.fill('#f-confDest', '/etc/nginx/conf.d/site.conf'); pg.wait_for_timeout(150)
    n = pg.locator('button.file').count()
    check('role with template has 7 tabs', n == 7, str(n))
    check('crumb shows file name', pg.locator('#crumb .here').inner_text() == 'site.yml')
    nav = pg.locator('#files')
    overflow = pg.evaluate("(n => n.scrollWidth > n.clientWidth)(document.querySelector('#files'))")
    if overflow:
        check('right fade shown when tabs overflow', pg.locator('#tabrow').get_attribute('data-fade-r') == 'true')
    pg.locator('button.file').last.click(); pg.wait_for_timeout(200)
    vis = pg.evaluate("""(() => { const n=document.querySelector('#files'), a=n.querySelector('[aria-current=true]'); const nr=n.getBoundingClientRect(), ar=a.getBoundingClientRect(); return ar.left>=nr.left-1 && ar.right<=nr.right+1; })()""")
    check('last tab scrolls fully into view when opened', vis)
    check('crumb shows full path of last tab', 'README.md' in pg.locator('#crumb').inner_text() and 'roles' in pg.locator('#crumb').inner_text(), pg.locator('#crumb').inner_text())
    pg.screenshot(path=f'{out}/new_role_tabs.png')

    # ---- flash on edit + changed-tab dots
    pg.goto(URL + '#/ansible/role'); pg.reload(); pg.wait_for_timeout(400)   # clean page: default answers, site.yml open
    pg.fill('#f-description', 'Install and tune nginx'); pg.wait_for_timeout(120)
    dots = pg.locator('button.file[data-changed=true]').all_inner_texts()
    check('editing description marks other files changed (dots)', sorted(d.strip() for d in dots) == ['README.md', 'meta/main.yml'], str(dots))
    pg.click('button.file[data-changed=true] >> nth=0'); pg.wait_for_timeout(120)
    check('opening a changed tab clears its dot', pg.locator('button.file[data-changed=true]').count() == 1)
    pg.goto(URL + '#/ansible/playbook'); pg.wait_for_timeout(300)
    pg.fill('#f-packages', 'nginx, curl'); pg.wait_for_timeout(100)
    fl = pg.locator('.row.flash').count()
    check('typing flashes only the changed lines', 0 < fl < pg.locator('#sheet .row').count(), f'{fl} of {pg.locator("#sheet .row").count()}')
    pg.screenshot(path=f'{out}/new_flash.png')
    pg.wait_for_timeout(1400)

    # ---- notes toggle
    pg.click('#notes'); check('notes toggle hides notes', pg.locator('#sheet.no-notes').count() == 1 and pg.locator('.note').first.is_hidden())
    pg.click('#notes')

    # ---- palette
    pg.goto(URL + '#/ansible/inventory'); pg.wait_for_timeout(250)
    check('kbd hint shown', pg.locator('#kbd').get_attribute('data-key') in ('Ctrl K', 'Cmd K') and pg.evaluate("getComputedStyle(document.querySelector('#kbd'),'::before').content") in ('"Ctrl K"', '"Cmd K"'))
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(150)
    check('Ctrl+K opens the palette', pg.evaluate("document.querySelector('#palette').open"))
    check('input is focused', pg.evaluate("document.activeElement.id") == 'pal-q')
    check('lists all generators', pg.locator('#pal-list .opt').count() == 28, str(pg.locator('#pal-list .opt').count()))
    pg.screenshot(path=f'{out}/new_palette.png')
    pg.keyboard.type('role'); pg.wait_for_timeout(80)
    labs = pg.locator('#pal-list .lab').all_inner_texts()
    check('filter narrows to Role', labs == ['Role'], str(labs))
    pg.keyboard.press('Enter'); pg.wait_for_timeout(250)
    check('Enter opens Role and closes palette', pg.url.endswith('#/ansible/role') and not pg.evaluate("document.querySelector('#palette').open"))
    pg.keyboard.press('Control+k'); pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(60)
    check('arrow keys move selection', pg.evaluate("document.querySelector('#pal-q').getAttribute('aria-activedescendant')") == 'pal-2')
    pg.keyboard.press('ArrowUp'); pg.keyboard.press('ArrowUp'); pg.keyboard.press('ArrowUp')
    check('selection wraps around', pg.evaluate("document.querySelector('#pal-q').getAttribute('aria-activedescendant')") == 'pal-27')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    check('Esc closes the palette', not pg.evaluate("document.querySelector('#palette').open"))
    pg.keyboard.press('/'); pg.wait_for_timeout(100)
    check('/ opens the palette', pg.evaluate("document.querySelector('#palette').open"))
    pg.keyboard.type('zzz'); pg.wait_for_timeout(60)
    check('no-match message', 'Nothing matches' in pg.locator('#pal-list').inner_text())
    pg.keyboard.press('Escape')
    pg.click('#f-roleName'); pg.keyboard.type('/'); pg.wait_for_timeout(80)
    check('/ typed in a field does not open the palette', not pg.evaluate("document.querySelector('#palette').open"))
    pg.fill('#f-roleName', 'webserver')
    pg.click('#jump'); pg.wait_for_timeout(100)
    check('Jump button opens it', pg.evaluate("document.querySelector('#palette').open"))
    pg.mouse.click(5, 5); pg.wait_for_timeout(100)
    check('clicking the backdrop closes it', not pg.evaluate("document.querySelector('#palette').open"))

    # ---- theme toggle persists
    before = pg.evaluate("document.documentElement.dataset.theme")
    pg.click('#theme'); after = pg.evaluate("document.documentElement.dataset.theme")
    check('theme toggles', before != after)
    check('theme choice is saved immediately', pg.evaluate("localStorage.getItem('stanza-theme')") == after)
    # Headless Chromium sometimes drops file:// storage on reload (about 1 in 12 here, 0 in 80 over http),
    # so give the reload check three tries. The save itself is asserted above, deterministically.
    kept = False
    for _ in range(3):
        pg.reload(); pg.wait_for_timeout(300)
        if pg.evaluate("document.documentElement.dataset.theme") == after:
            kept = True; break
        pg.evaluate("localStorage.setItem('stanza-theme', %r)" % after)
    check('theme choice survives reload', kept)
    pg.screenshot(path=f'{out}/new_light.png')
    pg.click('#theme')

    # ---- downloads
    pg.goto(URL + '#/ansible/role'); pg.wait_for_timeout(250)
    with pg.expect_download() as d: pg.click('#download-all')
    z = zipfile.ZipFile(d.value.path()); check('role .zip downloads and is valid', z.testzip() is None and len(z.namelist()) == 5, str(z.namelist()))
    with pg.expect_download() as d2: pg.click('#download')
    check('single file downloads', d2.value.suggested_filename == 'site.yml', d2.value.suggested_filename)
    pg.click('.copy-cmd >> nth=0') if pg.locator('.copy-cmd').count() else None
    check('terminal has copy buttons', pg.locator('.copy-cmd').count() >= 3)

    # ---- invalid input path still works
    pg.goto(URL + '#/ansible/role'); pg.wait_for_timeout(250)
    pg.fill('#f-roleName', 'Bad-Name'); pg.wait_for_timeout(100)
    check('error state: message shown, copy disabled, status says so', pg.locator('#f-roleName-err').is_visible() and pg.locator('#copy').is_disabled() and 'attention' in pg.locator('#st-state').inner_text() or 'need' in pg.locator('#st-state').inner_text())
    pg.fill('#f-roleName', 'webserver'); pg.wait_for_timeout(100)
    check('error clears and file returns', pg.locator('#copy').is_enabled() and pg.locator('#sheet .row').count() > 3)

    # ---- reduced motion
    rm = b.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce').new_page()
    rm.goto(URL + '#/ansible/playbook'); rm.wait_for_timeout(250); rm.fill('#f-packages', 'nginx, git'); rm.wait_for_timeout(80)
    an = rm.evaluate("(() => { const r=document.querySelector('.row.flash'); return r ? getComputedStyle(r).animationName : 'noflash'; })()")
    check('reduced motion turns the flash animation off', an in ('none', 'noflash'), an)

    # ---- phone
    m = b.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark', device_scale_factor=2).new_page()
    m.goto(URL + '#/ansible/playbook'); m.wait_for_timeout(350)
    check('phone: no sideways page scroll', not m.evaluate('document.documentElement.scrollWidth > window.innerWidth'))
    check('phone: jump button is icon only', m.locator('#jump .jump-label').is_hidden() and m.locator('#kbd').is_hidden())
    m.screenshot(path=f'{out}/new_mobile.png')
    m.click('#jump'); m.wait_for_timeout(120)
    box = m.locator('#palette').bounding_box()
    check('phone: palette fits the screen', box and box['x'] >= 0 and box['x'] + box['width'] <= 390, str(box))
    m.screenshot(path=f'{out}/new_mobile_palette.png'); m.keyboard.press('Escape')
    m.goto(URL + '#/ansible/role'); m.wait_for_timeout(300)
    check('phone: role page no sideways scroll', not m.evaluate('document.documentElement.scrollWidth > window.innerWidth'))
    m.evaluate("window.scrollTo(0, 700)"); m.wait_for_timeout(100); m.screenshot(path=f'{out}/new_mobile_editor.png')

    # ---- desktop hero shot (dark) with the editor and a hover
    d = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark', device_scale_factor=1).new_page()
    d.goto(URL + '#/ansible/playbook'); d.wait_for_timeout(1200)
    d.locator('.row.annotated').nth(3).hover(); d.wait_for_timeout(200)
    d.screenshot(path=f'{out}/new_dark.png')

    check('no console errors, no failed requests', not errs, str(errs))
    b.close()

print('\nFAILED:', fails if fails else 'none')

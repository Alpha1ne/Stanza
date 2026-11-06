import sys, json
from playwright.sync_api import sync_playwright
axe = sys.argv[1]
URL = 'file:///home/claude/stanza/index.html'
with sync_playwright() as p:
    b = p.chromium.launch()
    total = 0
    for scheme in ('dark', 'light'):
        pg = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme=scheme).new_page()
        for route in ('#/ansible/inventory', '#/ansible/adhoc', '#/ansible/playbook', '#/ansible/role', '#/ansible/commands', '#/ansible/modules', '#/ansible/concepts', '#/terraform', '#/terraform/sg', '#/terraform/ec2', '#/terraform/s3', '#/terraform/commands', '#/terraform/concepts', '#/terraform/resources'):
            pg.goto(URL + route); pg.reload(); pg.wait_for_timeout(1300)   # let the reveal animation finish
            pg.add_script_tag(path=axe)
            r = pg.evaluate("axe.run(document, {runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']})")
            v = r['violations']; total += len(v)
            print(f'{scheme:5} {route:20} violations: {len(v)}')
            for x in v:
                print('   -', x['id'], x['impact'], '|', x['help'], '|', len(x['nodes']), 'nodes')
                for n in x['nodes'][:2]: print('       ', n['target'], (n.get('any') or [{}])[0].get('message', '')[:140])
    # palette open
    pg = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark').new_page()
    pg.goto(URL + '#/ansible/role'); pg.keyboard.press('Control+k'); pg.wait_for_timeout(300); pg.add_script_tag(path=axe)
    r = pg.evaluate("axe.run(document.querySelector('#palette'), {runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']})")
    print('palette open violations:', len(r['violations']))
    for x in r['violations']: print('   -', x['id'], x['impact'], x['help'])
    print('TOTAL page violations:', total)
    b.close()

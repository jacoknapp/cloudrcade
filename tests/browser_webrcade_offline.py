"""Real pinned emulator offline regression, using a disposable Chromium profile.
Requires Playwright, existing Chrome and an SSH tunnel to the staged/live server.
WEBRCADE_TEST_PORT=18445 by default; no personal accounts or cloud saves accessed.
"""
import asyncio, base64, json, os, tempfile
from urllib.parse import quote
from playwright.async_api import async_playwright

ORIGIN = 'https://arcade.example.test'
PORT = os.getenv('WEBRCADE_TEST_PORT', '18445')
CHROME = os.getenv('CHROME', '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')
CORES = {'nes':'retro-fceumm', 'gbc':'retro-sameboy', 'retro-melonds':'retro-melonds',
         'snes':'retro-snes9x', 'gb':'retro-sameboy', 'gba':'retro-mgba',
         'n64':'n64', 'genesis':'retro-genesis', 'psx':'psx'}
FIND = """() => { const root=document.getElementById('root')?._reactRootContainer?._internalRoot?.current;
function f(n){if(!n)return null;if(n.stateNode?.browseScreenRef)return n.stateNode;return f(n.child)||f(n.sibling)}
const l=f(root); return l?.state.feed?.getUniqueCategories().reduce((n,c)=>n+c.items.length,0); }"""

class NetworkGate:
    """Cut real transport too: Playwright offline alone can leave worker fetches online."""
    def __init__(self):
        self.online = True
        self.connections = set()

    async def connect(self, reader, writer):
        self.connections.add(writer)
        upstream = None
        try:
            if not self.online:
                return
            remote, upstream = await asyncio.open_connection('127.0.0.1', int(PORT))
            self.connections.add(upstream)
            async def copy(source, target):
                while data := await source.read(65536):
                    target.write(data)
                    await target.drain()
                target.close()
            await asyncio.gather(copy(reader, upstream), copy(remote, writer))
        except (ConnectionError, OSError):
            pass
        finally:
            writer.close()
            self.connections.discard(writer)
            if upstream:
                upstream.close()
                self.connections.discard(upstream)

    def disconnect(self):
        self.online = False
        for writer in list(self.connections):
            writer.close()

async def launch(page, url):
    await page.goto(url, wait_until='domcontentloaded')
    # Some cores display the native experimental-support warning on first use.
    for tick in range(180):
        if tick and tick % 40 == 0:
            body = await page.locator('body').inner_text()
            if 'Whoops' in body:
                raise AssertionError(body)
            print('Waiting for emulator:', body[:350], flush=True)
        if await page.evaluate('!!window.app?.emulator?.started && !app.isShowOverlay()'):
            await page.evaluate('app.emulator.pause(true)')
            return
        yes = page.get_by_text('Yes', exact=True)
        if await yes.count() and await yes.first.is_visible():
            await yes.first.click()
        await page.wait_for_timeout(500)
    raise AssertionError((url.split('?')[0], (await page.locator('body').inner_text())[:2000]))

async def main():
    gate = NetworkGate()
    proxy = await asyncio.start_server(gate.connect, '127.0.0.1', 0)
    port = proxy.sockets[0].getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='arcade-offline-browser-') as profile:
        async with async_playwright() as p:
            async def context(offline=False):
                return await p.chromium.launch_persistent_context(profile, executable_path=CHROME,
                    headless=True, ignore_https_errors=True, offline=offline, has_touch=True,
                    viewport={'width':844,'height':390}, args=['--no-sandbox','--ignore-certificate-errors',
                    '--host-resolver-rules=MAP arcade.example.test:443 127.0.0.1:'+str(port),
                    '--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader'])
            ctx = await context()
            page = ctx.pages[0]
            errors=[]
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(ORIGIN+'/')
            await page.wait_for_function('()=>('+FIND+')()>=3497', timeout=30000)
            count = await page.evaluate(FIND)
            assert count >= 3497, count
            await page.evaluate('navigator.serviceWorker.ready')
            await page.wait_for_function('!!navigator.serviceWorker.controller', timeout=30000)
            print('PASS first-visit service worker install, full library, client control', flush=True)
            feed = await page.evaluate("async()=>(await fetch('/content/feeds/combined.json')).json()")
            urls = []
            selected=os.getenv('ONLY','nes,gbc,retro-melonds').split(',')
            for kind in selected:
                item = next(i for c in feed['categories'] for i in c['items'] if i['type']==kind)
                props={**feed['props'], **item['props'], 'type':kind, 'title':item['title']}
                encoded=quote(base64.b64encode(quote(json.dumps(props),safe="~()*!.'-").encode()).decode())
                url=ORIGIN+'/play/app/'+CORES[kind]+'/?ctx=standalone&props='+encoded
                urls.append((kind,url))
                await launch(page,url)
                if kind=='nes':
                    await page.evaluate("app.emulator.saveManager.save('/offline-regression',[{name:'sav',content:new Uint8Array([17,29])}])")
                await page.wait_for_function("async()=>{const c=await caches.open('wrcad-arcade-offline-v1');return !!await c.match("+json.dumps(item['props'].get('rom',item['props'].get('discs',[None])[0]))+")}",timeout=60000)
                print('PASS online boot and full ROM cached:', kind, flush=True)
            await page.wait_for_timeout(1000)
            keys=await page.evaluate("async()=>(await (await caches.open('wrcad-arcade-offline-v1')).keys()).map(r=>r.url)")
            assert not any('/api.php' in key or '/cloud-saves/?' in key for key in keys)
            assert not errors, errors
            await ctx.close()
            gate.disconnect()
            ctx=await context(offline=True)
            page=ctx.pages[0]
            await page.goto(ORIGIN+'/')
            await page.wait_for_function('()=>('+FIND+')()>=3497',timeout=30000)
            assert await page.evaluate(FIND)>=count
            assert page.url.startswith(ORIGIN+'/play/'),page.url
            print('PASS full browser restart offline: root URL redirects, library and feed restored',flush=True)
            for kind,url in urls:
                await launch(page,url)
                if kind=='nes':
                    saved=await page.evaluate("async()=>Array.from((await app.emulator.saveManager.load('/offline-regression')).find(f=>f.name==='sav').content)")
                    assert saved==[17,29],saved
                if kind=='retro-melonds':
                    assert await page.evaluate('crossOriginIsolated'), 'DS isolation headers lost'
                print('PASS cold offline emulator boot:',kind,flush=True)
            missing=await page.evaluate("async()=>{const r=await fetch('/content/nes/roms/offline-missing-test.nes');return [r.status,await r.text()]}")
            assert missing[0]==503 and 'not fully cached' in missing[1],missing
            print('PASS missing game explains reconnect requirement; local save survived restart',flush=True)
            if 'nes' in selected:
                await page.goto(ORIGIN+'/play/')
                await page.wait_for_function('()=>('+FIND+')()>=3497',timeout=30000)
                await page.evaluate("""() => {
                  function f(n){if(!n)return null;if(n.stateNode?.browseScreenRef)return n.stateNode;return f(n.child)||f(n.sibling)}
                  const l=f(document.getElementById('root')._reactRootContainer._internalRoot.current);
                  const item=l.state.feed.getUniqueCategories().flatMap(c=>c.items).find(i=>i.type==='nes');
                  l.browseScreenRef.current.props.onAppSelected(item);
                }""")
                iframe=await page.wait_for_selector('#webrcade-app-iframe')
                frame=await iframe.content_frame()
                await frame.wait_for_function('window.app?.emulator?.started && !app.isShowOverlay()',timeout=60000)
                print('PASS offline library Play action boots cached game in normal iframe',flush=True)
            gate.online = True
            await ctx.set_offline(False)
            await page.goto(ORIGIN+'/play/')
            await page.wait_for_function('()=>('+FIND+')()>=3497',timeout=30000)
            response=await page.evaluate("async()=>{const r=await fetch('/touch-controls/offline.js?v=1');return r.ok && (await r.text()).includes('register')}")
            assert response
            print('PASS reconnect restores normal library/asset fetching',flush=True)
            await ctx.close()
    gate.disconnect()
    proxy.close()
    await proxy.wait_closed()

if __name__ == '__main__':
    asyncio.run(main())

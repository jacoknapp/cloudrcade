#!/usr/bin/env python3
"""Patch the pinned library for N64 defaults and the Recently Played adapter."""
import hashlib,json,os,subprocess,re
from pathlib import Path
IMAGE='webrcade/webrcade@sha256:77789de80c2963d58631b57306335638eec8f6425c66b7d6868576f0ea5f7a49'
ASSET='/var/www/html/play/static/js/main.7ac86965.chunk.js'
# Verify the exact installed 0.2.3 bundle before applying the migration.
EXPECTED_SHA='fc22663804c2fe3445a63487eceb428001ae858c14f5ad879f39d44ff2ddc13d'
old=b'Promise.resolve(e.loadBool(e.EXP_APPS_PROP,e.expApps))'
new=b'Promise.resolve(e.loadBool("wrcad.n64.enabled.v1",false)).then(function(done){if(done)return e.loadBool(e.EXP_APPS_PROP,e.expApps);return e.saveBool(e.EXP_APPS_PROP,true).then(function(){return e.saveBool("wrcad.n64.enabled.v1",true)}).then(function(){return true})})'
def release_notes_path():
 # Docker stages the same canonical source file beside this patcher.
 staged=Path(__file__).with_name('release-notes.json')
 return staged if staged.is_file() else Path(__file__).parent.parent.parent/'src/react/screens/releasenotes/notes.json'

def player_revision():
 # Notes-only releases must also invalidate the patched library bundle URL.
 return hashlib.sha256(Path(__file__).read_bytes()+release_notes_path().read_bytes()).hexdigest()[:16]

def patch_bundle(raw):
 assert hashlib.sha256(raw).hexdigest()==EXPECTED_SHA,'Unexpected upstream player bundle'
 assert raw.count(old)==1
 # These classes are scope-hoisted, not webpack exports. Register them before
 # React mounts the library; the hash above guards every pinned symbol here.
 marker=b'var re=oe;Object(l.X)(["images/default-thumb.png"])'
 assert raw.count(marker)==1,'Unexpected library bootstrap'
 hook=(b'window.WrcadRecent&&window.WrcadRecent.install({react:i.a,Browse:V,Library:oe});'
       b'window.WrcadMobile&&window.WrcadMobile.install({react:i.a,Browse:V,GamepadEnum:l.r});')
 cloud_tab=b'ni.contextType=Wn;'
 assert raw.count(cloud_tab)==1,'Unexpected cloud settings tab'
 cloud_hook=b'window.WrcadCloud&&window.WrcadCloud.installUI({react:i.a,CloudStorageTab:ni,storage:Mn});'
 # Bare /play/ links and the native Default feed must use this server's library,
 # just like the root redirect. Otherwise fresh browsers fetch the public demos.
 default_feed=b'https://play.webrcade.com/default-feed.json'
 assert raw.count(default_feed)==1,'Unexpected default feed loader'
 # Register the locally built Nintendo 3DS app (retro-azahar) and its `3ds` alias.
 # It is served beside the pinned apps; see retro-azahar/README.md.
 ds_type=b'{key:tt.RETRO_MELONDS,alias:tt.NDS,'
 ds_alias=b'st(rt,tt.NDS,tt.RETRO_MELONDS),'
 assert raw.count(ds_type)==1 and raw.count(ds_alias)==1,'Unexpected app type table'
 # `Je` is the pinned bundle's ROM validator (the one Nintendo DS uses).
 assert raw.count(b'validate:Je,extensions:["dsi","nds"]')==1,'Unexpected ROM validator'
 n3ds_type=(b'{key:"retro-azahar",alias:"3ds",name:"Nintendo 3DS",coreName:"Retro Azahar",slowExit:!0,'
  b'location:"app/retro-azahar/",background:"app/retro-azahar/images/3ds-background.png",'
  b'thumbnail:"app/retro-azahar/images/3ds-thumb.png",'
  b'description:"A Libretro core for the Nintendo 3DS based on Azahar.",validate:Je,'
  b'extensions:["cia","3ds","cci","cxi"],multiThreaded:!0,defaults:{rom:""}},')
 psp_type=(b'{key:"retro-ppsspp",alias:"psp",name:"PlayStation Portable",coreName:"PPSSPP",slowExit:!0,'
  b'location:"app/retro-ppsspp/",background:"app/retro-ppsspp/images/psp.svg",'
  b'thumbnail:"app/retro-ppsspp/images/psp.svg",description:"PSP browser core. Requires WebGL2 and HTTPS.",'
  b'validate:Je,extensions:["iso","cso","pbp","elf"],multiThreaded:!0,defaults:{rom:""}},')
 # A settings page like the pinned ones (same base class, row, label and switch
 # components), defined right after the Advanced page it follows.
 after_advanced=b'ei.contextType=Wn;'
 last_tab=b'label:yn.getText(bn.ADVANCED_SETTINGS),content:i.a.createElement(ei,{isActive:4===l,setFocusGridComps:d,values:c,setValues:g})}]})'
 assert raw.count(after_advanced)==1 and raw.count(last_tab)==1,'Unexpected settings pages'
 # Its switch shows a speed readout over 3DS games; the app reads it at launch.
 perf=b'(function(){try{return localStorage.getItem("wrcad.3ds.perf.v1")==="1"}catch(e){return!1}})()'
 # A second switch runs lit 3DS draws on the CPU again, to compare speed on a device.
 litcpu=b'(function(){try{return localStorage.getItem("wrcad.3ds.litcpu.v1")==="1"}catch(e){return!1}})()'
 page=(b'var WrcadExperimental=function(e){function t(){var t;return(t=e.call(this)||this).perfRef=i.a.createRef(),'
  b't.litRef=i.a.createRef(),t.gridComps=[[t.perfRef],[t.litRef]],t}C(t,e);var n=t.prototype;return n.componentDidUpdate=function(e,t){'
  b'var n=this.gridComps,a=this.props.setFocusGridComps,i=this.props.isActive;i&&i!==e.isActive&&a(n)},'
  b'n.render=function(){var t=this.context.focusGrid,n=this,r=this.perfRef,l=this.litRef;return['
  b'i.a.createElement(ka,null,i.a.createElement(Ta,null,"3DS performance readout"),i.a.createElement(La,null,'
  b'i.a.createElement(Va,{ref:r,onPad:function(e){return t.moveFocus(e.type,r)},onChange:function(e){'
  b'try{e.target.checked?localStorage.setItem("wrcad.3ds.perf.v1","1"):localStorage.removeItem("wrcad.3ds.perf.v1")}catch(x){}'
  b'n.forceUpdate()},checked:'+perf+b'}))),'
  b'i.a.createElement(ka,null,i.a.createElement(Ta,null,"3DS lighting on CPU (slower)"),i.a.createElement(La,null,'
  b'i.a.createElement(Va,{ref:l,onPad:function(e){return t.moveFocus(e.type,l)},onChange:function(e){'
  b'try{e.target.checked?localStorage.setItem("wrcad.3ds.litcpu.v1","1"):localStorage.removeItem("wrcad.3ds.litcpu.v1")}catch(x){}'
  b'n.forceUpdate()},checked:'+litcpu+b'})))]},t}(_a);'
  b'WrcadExperimental.contextType=Wn;')
 icon=(b'data:image/svg+xml;base64,'+__import__('base64').b64encode(
  b'<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#FFFFFF">'
  b'<path d="M0 0h24v24H0z" fill="none"/><path d="M19.8 18.4L14 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81H9.04'
  b'c-.42 0-.65.48-.39.81L10 6.5v4.17L4.2 18.4c-.49.66-.02 1.6.8 1.6h14c.82 0 1.29-.94.8-1.6z"/></svg>'))
 tab=(b',...((window.WrcadCloudConfig&&window.WrcadCloudConfig.enable3DS)?[{image:"'+icon+b'",label:"Experimental Settings",content:i.a.createElement(WrcadExperimental,'
  b'{isActive:5===l,setFocusGridComps:d})}] : [])')
 patched = raw.replace(old,new).replace(marker,hook+marker).replace(cloud_tab,cloud_tab+cloud_hook).replace(
  b'"'+default_feed+b'"',b'(new URL(window.WrcadCloudConfig&&window.WrcadCloudConfig.feedUrl||"/content/feeds/combined.json",location.href).href)' ).replace(
  ds_type,psp_type+b'...((window.WrcadCloudConfig&&window.WrcadCloudConfig.enable3DS)?['+n3ds_type.rstrip(b',')+b'] : []),'+ds_type).replace(ds_alias,ds_alias+b'(window.WrcadCloudConfig&&window.WrcadCloudConfig.enable3DS)&&st(rt,"3ds","retro-azahar"),st(rt,"psp","retro-ppsspp"),').replace(
  after_advanced,after_advanced+page).replace(
  last_tab,last_tab[:-len(b']})')]+tab+b']})')

 # CloudRcade modification: replace the upstream logo with the env app name.
 logo=b'children:[Object(O.jsx)("div",{className:t+"-left-text",children:"web"}),Object(O.jsx)("img",{className:t+"-image",alt:"web\\u042fcade",src:n}),Object(O.jsx)("div",{className:t+"-right-text",children:"cade"})]'
 assert patched.count(logo)==1,'Unexpected upstream logo'
 patched=patched.replace(logo,b'children:[Object(O.jsx)("div",{className:t+"-left-text",children:(window.WrcadCloudConfig&&window.WrcadCloudConfig.appName)||"cloud\\u042fcade"})]')

 # Supply our notes before the native dialog's first render, with no old-content flash.
 notes_marker=b'return e=l.y,Object(O.jsxs)(l.K.Provider,'
 heading=b'children:"WEB\\u042fCADE UPDATED"'
 dialog=b'className:"release-screen-dialog",children:'
 assert patched.count(notes_marker)==patched.count(heading)==patched.count(dialog)==1,'Unexpected release notes dialog'
 notes=json.dumps(json.loads(release_notes_path().read_text()),ensure_ascii=True,separators=(',',':')).encode()
 name=b'((window.WrcadCloudConfig&&window.WrcadCloudConfig.appName)||"cloud\\u042fcade")'
 patched=patched.replace(notes_marker,b'return e='+notes+b',Object(O.jsxs)(l.K.Provider,').replace(
  heading,b'children:'+name+b'+" updated"').replace(
  dialog,b'className:"release-screen-dialog",role:"dialog","aria-modal":!0,"aria-label":'+name+b'+" updates",children:')
 for group in (b'release-buttons-left-group',b'release-buttons-centered'):
  patched=patched.replace(b'class:"'+group+b'"',b'className:"'+group+b'"')
 # The optional startup notes must not stack over an alert/settings dialog or a game.
 startup_notes=b'setTimeout((()=>{this.ctx.showReleaseNotes(!0)}),0)'
 assert patched.count(startup_notes)==1,'Unexpected startup notes timer'
 patched=patched.replace(startup_notes,b'setTimeout((()=>{this.state.mode===this.ScreenEnum.BROWSE&&!this.ctx.isDialogOpen()&&this.ctx.showReleaseNotes(!0)}),0)')

 return re.sub(rb'([\"\'])wrcad(\.[A-Za-z0-9_.-]+)\1', lambda m: b'((window.WrcadCloudConfig&&window.WrcadCloudConfig.storagePrefix)||\"webrcade\")+'+b'\"'+m[2]+b'\"', patched)

if __name__=='__main__':
 source=os.environ.get('WEBRCADE_SOURCE_ROOT')
 raw=(Path(source)/'play/static/js'/Path(ASSET).name).read_bytes() if source else subprocess.check_output(['docker','run','--rm','--entrypoint','/bin/cat',IMAGE,ASSET])
 target=Path(os.environ.get('WEBRCADE_PLAYER_OUTPUT',str(Path(__file__).parent/'player-bundle.js')))
 p=target.with_suffix('.js.new');p.write_bytes(patch_bundle(raw));p.chmod(0o644)
 p.replace(target)
 print('Installed N64 settings migration, Recently Played library hook and Nintendo 3DS type')

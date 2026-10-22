import {LAYOUTS,attachDeviceMotion} from './input.mjs';

export function createWiiControls(target,{isActive,onChange=()=>{}}){
 const key=(target.WrcadCloudConfig?.storagePrefix||'webrcade')+'.wii.controller.v1';
 let layout='nunchuk';try{const saved=target.localStorage.getItem(key);if(Object.hasOwn(LAYOUTS,saved))layout=saved;}catch{}
 const phone=attachDeviceMotion(target,{isActive});
 const panel=document.createElement('div');panel.className='wii-controller-options';
 panel.innerHTML='<label>Wii controller <select aria-label="Wii controller layout"></select></label><button type="button" class="wii-phone-motion">Enable phone motion</button><button type="button" class="wii-recenter" hidden>Recenter phone</button><small role="status" class="wii-motion-status">Touch/mouse motion</small>';
 const select=panel.querySelector('select'),enable=panel.querySelector('.wii-phone-motion'),recenter=panel.querySelector('.wii-recenter'),status=panel.querySelector('.wii-motion-status');
 for(const [value,label]of Object.entries(LAYOUTS)){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
 select.value=layout;
 function draw(){
  const host=document.getElementById('wrcad-touch');
  if(host){host.dataset.wiiLayout=layout;host.querySelector('.kt-pad')?.setAttribute('aria-label',LAYOUTS[layout]+' touch controller');}
  const remote=layout!=='nunchuk';
  if(host){
   host.querySelector('.kt-stick:not(.kt-extra-dpad)').hidden=remote;
   for(const cid of [8,9])host.querySelector(`[data-cid="${cid}"]`).hidden=remote;
  }
 }
 function mount(){
  const drawer=document.getElementById('kt-drawer');
  if(drawer){drawer.insertBefore(panel,drawer.querySelector('.kt-edit'));draw();observer.disconnect();}
  else {
   if(!panel.isConnected)document.getElementById('launcher')?.append(panel);
   if(target.matchMedia&&!target.matchMedia('(pointer:coarse)').matches)observer.disconnect();
  }
 }
 const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});mount();draw();
 select.onchange=()=>{
  layout=select.value;try{target.localStorage.setItem(key,layout);}catch{}
  phone.clear();onChange();draw();target.dispatchEvent(new Event('resize'));
 };
 const stop=()=>{phone.disable();status.textContent='Touch/mouse motion';enable.textContent='Enable phone motion';recenter.hidden=true;};
 target.addEventListener('pagehide',stop);
 enable.onclick=async()=>{
  if(phone.enabled){stop();return;}
  const permission=phone.enable();enable.disabled=true;
  const result=await permission;enable.disabled=false;status.textContent='Phone motion: '+result;
  enable.textContent=phone.enabled?'Disable phone motion':'Enable phone motion';recenter.hidden=!phone.enabled;
 };
 recenter.onclick=()=>{phone.clear();status.textContent='Hold the phone comfortably; motion recenters when play resumes.';};
 return {get layout(){return layout;},phone,stop};
}

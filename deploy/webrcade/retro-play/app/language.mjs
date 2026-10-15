// Match Play!'s PS2 OSD_LANGUAGE enum; a disc can offer fewer languages.
const languages={ja:0,en:1,fr:2,es:3,de:4,it:5,nl:6,pt:7,ru:8,ko:9};
export const LANGUAGE_NAMES=['Japanese','English','French','Spanish','German','Italian','Dutch','Portuguese','Russian','Korean','Traditional Chinese','Simplified Chinese'];
export function systemLanguage(preferences=globalThis.navigator?.languages||[globalThis.navigator?.language]){
 for(const value of preferences){
  if(typeof value!=='string')continue;
  const parts=value.toLowerCase().replaceAll('_','-').split('-'),base=parts[0];
  if(base==='zh')return parts.includes('hans')?11:parts.includes('hant')||parts.includes('tw')||parts.includes('hk')||parts.includes('mo')?10:11;
  if(Object.hasOwn(languages,base))return languages[base];
 }
 return 1;
}

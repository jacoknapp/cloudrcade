const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{
 const {systemLanguage,LANGUAGE_NAMES}=await import(pathToFileURL(path.resolve(__dirname,'../deploy/webrcade/retro-play/app/language.mjs')));
 for(const [tags,expected] of [[['en-US'],1],[['ja-JP'],0],[['fr-CA'],2],[['es-MX'],3],[['de-DE'],4],[['it-IT'],5],[['nl-BE'],6],[['pt-BR'],7],[['ru-RU'],8],[['ko-KR'],9],[['zh-Hant-CN'],10],[['zh-Hans-TW'],11],[['zh-TW'],10],[['zh-HK'],10],[['zh-MO'],10],[['zh-CN'],11],[['zh-SG'],11],[['xx-ZZ','fr-FR','en-US'],2],[[],1],[[undefined,null,'zz'],1]])assert.equal(systemLanguage(tags),expected,JSON.stringify(tags));
 assert.equal(LANGUAGE_NAMES.length,12);assert.equal(LANGUAGE_NAMES[systemLanguage(['en-US'])],'English');
 console.log('PASS PS2 ordered preferred locales, supported-language fallback and Chinese script/region mapping');
})().catch(error=>{console.error(error);process.exitCode=1;});

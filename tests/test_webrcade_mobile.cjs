/* Native-action parity and library teardown, without ROMs or a browser. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const query={matches:true,addEventListener(name,fn){this.change=fn;}};
const document={documentElement:{toggleAttribute(){}},querySelector(){return null;}};
const window={matchMedia:()=>query};
vm.runInNewContext(fs.readFileSync('deploy/webrcade/touch/assets/category-art.js','utf8'),{window});
vm.runInNewContext(fs.readFileSync('deploy/webrcade/touch/assets/mobile.js','utf8'),{window,document,MutationObserver:class{observe(){}}});
const react={Component:class{},createElement:(type,props,...children)=>({type,ref:props?.ref,props:{...props,children}}),
 cloneElement:(el,props,...children)=>({...el,props:{...el.props,...props,...(children.length?{children}: {})}}),
 isValidElement:el=>!!el?.type,Children:{toArray:children=>[children].flat().filter(Boolean)}};
const h=react.createElement;
class Details{render(){}}
class Slider{static contextType={};}
let launches=[],settings=0,selected=[],thumbnail='/thumb.png';
const games=Array.from({length:120},(_,i)=>({title:'Game '+i,type:'nes',props:{uid:'save-'+i,rom:'/content/'+i+'.nes'}}));
const category={title:'NES',items:games};
const feed={getCategories:()=>[category],getTitle:()=> 'Synthetic arcade'};
class Browse {
 constructor(){
  for(const key of ['sliderRef','webrcadeDivRef','searchRef','settingsRef'])this[key]={current:null};
  this.state={menuMode:'categories',currentItem:category,category,feed};
  this.props={feeds:[{title:'Add Feed'}],onSettings:()=>settings++,onAppSelected:item=>launches.push(item)};
 }
 clearSearch(){this.setState({searchTerm:''});}
 getSearchItems(term){return games.filter(item=>item.title.includes(term));}
 componentDidMount(){} componentDidUpdate(){} componentWillUnmount(){} forceUpdate(){this.output=this.render();}
 setState(next,callback){const previous={...this.state};Object.assign(this.state,typeof next==='function'?next(this.state,this.props):next);this.output=this.render();callback?.();}
 render(){
  const primary=()=>this.state.menuMode==='categories'?this.setState({menuMode:'apps',currentItem:games[0]}):this.props.onAppSelected(this.state.currentItem);
  return h('provider',{},h('div',{ref:this.webrcadeDivRef},h('div',{className:'webrcade-outer'},
   h('message',{}),h('div',{className:'header-nav'},h('button',{ref:this.settingsRef,onClick:this.props.onSettings})),
   h(Details,{backgroundSrc:'/art.png',title:this.state.currentItem.title,buttons:h('fragment',{},h('button',{onClick:primary}))}),
   h(Slider,{ref:this.sliderRef,items:this.state.menuMode==='categories'?[category]:[...games,{...games[0],duplicate:true}],
    getTitle:item=>item.title,getThumbnailSrc:()=>thumbnail,getDefaultThumbnailSrc:()=>'/fallback.png'}))));
 }
}
function all(el,predicate){return (!el||typeof el!=='object')?[]:[...(predicate(el)?[el]:[]),...(el.props?.children||[]).flat(Infinity).flatMap(child=>all(child,predicate))];}
window.WrcadMobile.install({react,Browse,GamepadEnum:{A:'a'}});
const browse=new Browse();browse.componentDidMount();browse.output=browse.render();
function grid(){const el=all(browse.output,el=>el.ref===browse.sliderRef)[0];const instance=new el.type();instance.props=el.props;return instance;}
let cards=all(grid().render(),el=>el.props?.className==='cr-mobile-card');
assert.equal(cards.length,1);
assert.equal(all(cards[0],el=>el.type==='img')[0].props.src,'/thumb.png','custom category art stays intact');
thumbnail='/fallback.png';browse.output=browse.render();
assert(all(grid().render(),el=>el.type==='img')[0].props.src.startsWith('data:image/svg+xml,'),'default folders use local retro system art');
category.items=[games[0],{title:'Other system',type:'3ds'}];browse.output=browse.render();
assert.equal(all(grid().render(),el=>el.type==='img')[0].props.src,'/fallback.png','mixed-system folders keep generic artwork');
category.items=games;
thumbnail='/thumb.png';cards[0].props.onClick();
assert.equal(browse.state.menuMode,'apps','system card invokes native Select');
cards=all(grid().render(),el=>el.props?.className==='cr-mobile-card');
assert.equal(cards.length,48,'large feed and slider duplicates do not inflate mounted cards');
cards[5].props.onClick();
const sheet=all(browse.output,el=>el.props?.role==='dialog')[0];assert(sheet);
const details=all(sheet,el=>el.type===Details)[0];
details.props.buttons.props.children[0].props.onClick();
assert.strictEqual(launches[0],games[5],'mobile Play passes original ROM/core/save identity to native launcher');
browse.state.crMobilePage=1;assert.equal(all(grid().render(),el=>el.props?.className==='cr-mobile-card')[0].props['aria-label'],'Game 48');
browse._searchCache={items:games};browse._searchCountCache={items:games};
browse.props.hide=true;browse.output=browse.render();
assert.equal(all(browse.output,el=>el.type===Details).length,0);assert.equal(all(grid().render(),el=>el.type==='img').length,0);
assert.equal(browse._searchCache,null);assert.equal(browse._searchCountCache,null);
browse.props.hide=false;browse.output=browse.render();assert.equal(all(grid().render(),el=>el.props?.className==='cr-mobile-card').length,48);
query.matches=false;query.change();assert.equal(all(browse.output,el=>el.type===Slider).length,1,'desktop restores native carousel');
assert.equal(all(browse.output,el=>el.props?.role==='dialog').length,0);
browse.componentWillUnmount();
console.log('PASS mobile native Select/Play/save identity, duplicate filtering/48-card pages, UI/search teardown and restore, desktop carousel');

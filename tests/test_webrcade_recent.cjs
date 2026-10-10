const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../deploy/webrcade/touch/assets/recently-played.js'), 'utf8');
const key = 'wrcad.recently-played.v1';
function fixture({raw = null, denyRead = false, denyWrite = false, rename = {}, cloud, data = new Map()} = {}) {
  const events = {};
  const timers = [];
  const localStorage = {getItem: name => {if (denyRead) throw Error('denied');return name === key ? raw : data.get(name) || null;},
    setItem: (name, value) => {if (denyWrite) throw Error('denied');if (name === key) raw = value;else data.set(name, value);}};
  const window = {WrcadCloudConfig:{storagePrefix:'wrcad'},WrcadCloud: cloud, addEventListener: (name, fn) => events[name] = fn};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../deploy/webrcade/touch/assets/category-art.js'), 'utf8'), {window});
  vm.runInNewContext(source, {window, localStorage, document: {addEventListener() {}},
    setTimeout: (fn, delay) => {timers.push({fn, delay});return timers.length;},
    clearTimeout: id => {if (timers[id - 1]) timers[id - 1].cleared = true;}});
  class Browse {
    static ModeEnum = {CATEGORIES: 'categories'};
    static getDerivedStateFromProps(props, state) {return props.feed !== state?.feed ? {feed: props.feed, menuMode: 'apps'} : null;}
    clearSearch() {}
    render() {}
    setState(next) {Object.assign(this.state, next);}
  }
  class Library {
    ScreenEnum = {APP: 'app', BROWSE: 'browse'};
    renderBrowse() {}
    renderApp() {}
    componentDidUpdate() {}
    componentWillUnmount() {}
  }
  window.WrcadRecent.install({Browse, Library});
  const items = Array.from({length: 25}, (_, i) => ({title: rename[i] || `Game ${i}`, type: 'nes', props: {rom: `https://games.example/${i}.nes`}}));
  const categories = [{title: 'NES', items}];
  const original = JSON.stringify(categories);
  const feed = {categories, uniqueCategoryCount: 1, getCategories() {return this.categories;},
    getUniqueCategories: () => categories, getUniqueCategoryCount() {return this.uniqueCategoryCount;},
    _expandItems: values => values.map((value, i) => ({...value, id: `id-${i}`}))};
  const browse = new Browse();browse.state = Browse.getDerivedStateFromProps({feed}, {});
  const library = new Library();library.browseScreenRef = {current: browse};library.state = {feed, mode: 'browse'};
  library.componentDidUpdate({}, {mode: 'loading'});
  const launch = item => {library.state = {feed, mode: 'app', app: item};library.componentDidUpdate({}, {mode: 'browse'});};
  const exit = () => {library.state.mode = 'browse';library.componentDidUpdate({}, {mode: 'app'});};
  const recent = () => feed.getCategories().find(c => c.wrcadRecent)?.items || [];
  return {items, feed, browse, launch, exit, recent, original, data, sync: window.WrcadRecent.sync,
    startup: () => timers.find(timer => timer.delay === 0 && !timer.cleared)?.fn(),
    raw: () => raw, storage: value => {raw = value;events.storage({key});}};
}
{
  const f = fixture();
  assert.equal(f.browse.state.menuMode, 'categories');
  assert.equal(f.browse.state.currentItem.title, 'NES');
  assert.equal(f.recent().length, 0);
  assert.equal(f.feed.getUniqueCategoryCount(), 1);
  assert(!f.feed.getCategories().some(c => c.wrcadRecent));
  f.browse.state = {...f.browse.state, menuMode: 'apps', category: f.feed.getUniqueCategories()[0], currentItem: f.items[0]};
  f.launch(f.items[0]);f.launch(f.items[1]);f.launch(f.items[0]);f.exit();
  assert.deepEqual(Array.from(f.recent(), i => i.title), ['Game 0', 'Game 1']);
  assert.equal(f.feed.getUniqueCategoryCount(), 2);
  assert.equal(f.browse.state.category.title, 'NES');
  assert.equal(f.browse.state.menuMode, 'apps');
  assert.equal(JSON.stringify(f.feed.getUniqueCategories()), f.original, 'search source and original metadata stay intact');
  for (const item of f.items) f.launch(item);
  assert.equal(f.recent().length, 20);assert.equal(JSON.parse(f.raw()).length, 20);
  assert.equal(f.recent()[0].title, 'Game 24');assert.equal(f.recent()[19].title, 'Game 5');
  const restored = fixture({raw: f.raw()});
  assert.equal(restored.browse.state.menuMode, 'categories');
  assert.equal(restored.browse.state.currentItem.title, 'Recently Played');
  assert.equal(restored.recent()[0].title, 'Game 24');
  const renamed = fixture({raw: f.raw(), rename: {24: 'Renamed game'}});
  renamed.launch(renamed.items[24]);assert.equal(renamed.recent()[0].title, 'Renamed game');
  assert.equal(renamed.recent().length, 20, 'title changes do not duplicate stable ROM identities');
}
for (const raw of ['broken JSON', '{}', JSON.stringify([null, {}, 'removed-game', 'removed-game'])]) {
  const f = fixture({raw});assert.equal(f.recent().length, 0);f.launch(f.items[2]);assert.equal(f.recent()[0].title, 'Game 2');
}
for (const option of [{denyRead: true}, {denyWrite: true}]) {
  const f = fixture(option);f.launch(f.items[0]);f.launch(f.items[1]);f.exit();
  assert.deepEqual(Array.from(f.recent(), i => i.title), ['Game 1', 'Game 0']);
}
{
  const a = fixture(), b = fixture();a.launch(a.items[1]);b.storage(a.raw());
  assert.equal(b.browse.state.menuMode, 'categories');assert.equal(b.browse.state.currentItem.title, 'Recently Played');
  assert.equal(b.recent()[0].title, 'Game 1');
  b.browse.state = {...b.browse.state, menuMode: 'apps', category: b.feed.getCategories()[0]};
  b.storage(null);assert.equal(b.browse.state.menuMode, 'categories');assert.equal(b.recent().length, 0);
  assert.equal(b.browse.state.currentItem.title, 'NES');
  assert.equal(b.feed.getUniqueCategoryCount(), 1);
  assert(!b.feed.getCategories().some(c => c.wrcadRecent));
}
{
  const a = fixture(), b = fixture();
  const originalChoice = b.browse.state.currentItem;
  // Explicit navigation, including away and back, must not be overridden.
  b.browse.setState({currentItem: {title:'Other system'}});
  b.browse.setState({currentItem: originalChoice});
  a.launch(a.items[1]);b.storage(a.raw());
  assert.equal(b.browse.state.currentItem.title, 'NES');
}
console.log('PASS recent ordering/dedup/20 limit, default closed folder, return to original folder, stable identities, search source, stale/corrupt/denied storage, cross-tab updates');
module.exports = {fixture};

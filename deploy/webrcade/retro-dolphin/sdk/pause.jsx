import React from 'react';
import ReactDOM from 'react-dom';
import {CustomPauseScreen, PauseScreenButton} from '@gamecube/common-pause';
import {SaveStatesEditor} from '@gamecube/common-states';
import {SaveWhiteImage} from '@gamecube/common-images';
import {Resources, TEXT_IDS} from '@gamecube/common-resources';
import {GamepadNotifier,GamepadEnum} from '@gamecube/common-input';

// The same native pause screen, focus grid, gamepad navigation and slot editor
// used by the other cores. The core adapter supplies its own async operations.
class GameCubePause extends React.Component {
  state = {states:false, performance:false, error:'',sync:'',syncing:false,details:''};
  componentDidMount(){this.unsubscribe=this.props.emulator.subscribeSaves?.(this.refreshSync);this.refreshSync();this.syncTimer=setInterval(this.refreshSync,500);}
  componentWillUnmount(){this.unsubscribe?.();clearInterval(this.syncTimer);}
  handleDetailsKey=event=>{if(this.state.performance&&event.key==='Escape'){event.preventDefault();this.props.onResume();}};
  refreshSync=()=>{const sync=this.props.emulator.getSaveStatus?.()||'',syncing=!!this.props.emulator.isSaveBusy?.(),details=this.props.emulator.getPerformance?.()||'';if(sync!==this.state.sync||syncing!==this.state.syncing||details!==this.state.details)this.setState({sync,syncing,details});};
  saveRef = React.createRef();
  perfRef = React.createRef();
  operation = async (method, ...args) => {
    this.setState({error:''});
    try { return await this.props.emulator[method](...args); }
    catch (error) { this.setState({error:error.message});return false; }
  };
  render(){
    const {appProps,emulator,onResume}=this.props;
    const wrapped={
      getStateSlots:async()=>{try{return await emulator.getStateSlots();}catch(error){this.setState({error:error.message});return new Array(9);}},
      saveStateForSlot:slot=>this.operation('saveStateForSlot',slot),
      loadStateForSlot:slot=>this.operation('loadStateForSlot',slot),
      deleteStateForSlot:slot=>this.operation('deleteStateForSlot',slot),
    };
    return <>
      {this.state.performance ? <section id="gamecube-performance-details" aria-label="GameCube performance details" onKeyDown={this.handleDetailsKey}>
        <h2>GameCube performance</h2><pre>{emulator.getPerformance?.() || 'Waiting for measurements.'}</pre>
        <button autoFocus onClick={()=>this.setState({performance:false})}>Back to menu</button>
      </section> : this.state.states ? <SaveStatesEditor emulator={wrapped} emptyImageSrc="./gamecube.svg" onClose={onResume} showStatusCallback={()=>{}}/> :
        <CustomPauseScreen appProps={appProps} isStandalone={false} isEditor={false}
          closeCallback={onResume} exitCallback={()=>this.operation('exit')}
          additionalButtonRefs={[this.saveRef,this.perfRef]} additionalButtons={[
            <PauseScreenButton key="states" buttonRef={this.saveRef} imgSrc={SaveWhiteImage}
              label={Resources.getText(TEXT_IDS.SAVE_STATES)}
              onHandlePad={(grid,e)=>grid.moveFocus(e.type,this.saveRef)}
              onClick={()=>this.setState({states:true,error:''})}/>,
            <PauseScreenButton key="performance" buttonRef={this.perfRef} imgSrc="./gamecube.svg" label="Performance"
              onHandlePad={(grid,e)=>grid.moveFocus(e.type,this.perfRef)}
              onClick={()=>this.setState({performance:true,error:''})}/>
          ]}/>
      }
      {this.state.sync && <p id="gamecube-menu-sync" role="status" aria-busy={this.state.syncing}>{this.state.syncing&&<span className="gc-save-spinner" aria-hidden="true"/>}{this.state.sync}</p>}
      {this.state.error && <p id="gamecube-menu-error" role="alert">{this.state.error}</p>}
    </>;
  }
}

export function createPauseMenu({root,appProps,emulator,onResume,onPause}){
 let open=false;const gamepad=new GamepadNotifier();
 gamepad.addGlobalCallback(event=>{if(event.type===GamepadEnum.ESC)onPause();});gamepad.start();
 return {
  get open(){return open;},
  show(){if(open)return;open=true;gamepad.stop();root.hidden=false;ReactDOM.render(<GameCubePause appProps={appProps} emulator={emulator} onResume={onResume}/>,root);},
  dispose(){gamepad.stop();if(open)ReactDOM.unmountComponentAtNode(root);open=false;root.hidden=true;},
  hide(){if(!open)return;open=false;ReactDOM.unmountComponentAtNode(root);root.hidden=true;gamepad.start();},
 };
}

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
  state = {states:false, error:''};
  saveRef = React.createRef();
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
      {this.state.states ? <SaveStatesEditor emulator={wrapped} emptyImageSrc="./gamecube.svg" onClose={onResume} showStatusCallback={()=>{}}/> :
        <CustomPauseScreen appProps={appProps} isStandalone={false} isEditor={false}
          closeCallback={onResume} exitCallback={()=>this.operation('exit')}
          additionalButtonRefs={[this.saveRef]} additionalButtons={[
            <PauseScreenButton key="states" buttonRef={this.saveRef} imgSrc={SaveWhiteImage}
              label={Resources.getText(TEXT_IDS.SAVE_STATES)}
              onHandlePad={(grid,e)=>grid.moveFocus(e.type,this.saveRef)}
              onClick={()=>this.setState({states:true,error:''})}/>
          ]}/>
      }
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

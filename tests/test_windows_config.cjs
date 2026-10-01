const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {test} = require('node:test');
const {getDriverPath} = require('../dist/src/backends/chatgpt-desktop.js');
const {createChatGPTDesktopBackend} = require('../dist/src/backends/chatgpt-desktop.js');
const {validateConfig} = require('../dist/src/util/configLoader.js');
const config = () => ({chatgpt:{platform:'win',responseTimeout:600000,projects:{default:'Escalation'}},logging:{level:'error'}});
test('package driver lookup ignores caller cwd and same-named shadow drivers',()=>{
  const original = process.cwd();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'escalation-driver-test-'));
  try {
    fs.mkdirSync(path.join(temporary,'src/drivers/win'),{recursive:true});
    fs.writeFileSync(path.join(temporary,'src/drivers/win/driver_robust.py'),'SHADOW DRIVER\n');
    process.chdir(temporary);
    assert.equal(getDriverPath('win'),fs.realpathSync(path.join(__dirname,'../src/drivers/win/driver_robust.py')));
  } finally {
    process.chdir(original);
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});
test('Windows optional identity fields are validated without running a driver',()=>{
  const valid=config();
  valid.chatgpt.executablePath='C:\\Apps\\ChatGPT.exe';
  valid.chatgpt.pythonExecutable='C:\\Python\\python.exe';
  valid.chatgpt.allowUnifiedApp=true;
  valid.chatgpt.restartTarget=false;
  assert.equal(validateConfig(valid).valid,true);
  for(const [key,value] of [['executablePath','ChatGPT.exe'],['pythonExecutable','python'],['allowUnifiedApp','true'],['restartTarget','false']]) {
    const invalid=config();invalid.chatgpt[key]=value;
    assert.equal(validateConfig(invalid).valid,false);
  }
});
test('backend passes explicit identity and isolated Python options to every driver check',async()=>{
  const childProcess=require('node:child_process');
  const {EventEmitter}=require('node:events');
  const originalSpawn=childProcess.spawn;
  let captured;
  childProcess.spawn=(command,args,options)=>{
    captured={command,args,options};
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    child.stdin={write(){},end(){setImmediate(()=>{
      child.stdout.emit('data',Buffer.from(JSON.stringify({success:true,data:{found:true}})));
      child.emit('close',0);
    });}};
    return child;
  };
  try {
    const settings=config();
    Object.assign(settings.chatgpt,{executablePath:'C:\\Apps\\ChatGPT.exe',pythonExecutable:'C:\\Isolated\\python.exe',allowUnifiedApp:true,restartTarget:false});
    const result=await createChatGPTDesktopBackend(settings).checkAvailability();
    assert.equal(result.available,true);
    assert.equal(captured.command,settings.chatgpt.pythonExecutable);
    assert.equal(captured.options.shell,false);
    assert.equal(captured.options.env.CHATGPT_EXECUTABLE_PATH,settings.chatgpt.executablePath);
    assert.equal(captured.options.env.CHATGPT_ALLOW_UNIFIED_APP,'1');
    assert.equal(captured.options.env.CHATGPT_RESTART_TARGET,'0');
  } finally {childProcess.spawn=originalSpawn;}
});

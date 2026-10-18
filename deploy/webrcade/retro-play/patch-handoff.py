#!/usr/bin/env python3
"""Checked optional raw diagnostics; preserve original mailbox/future operations."""
from pathlib import Path
import sys
root=Path(sys.argv[1]);here=Path(__file__).resolve().parent
(root/'Source/CloudHandoffTrace.h').write_bytes((here/'native/CloudHandoffTrace.h').read_bytes())
def guarded(text):return '#ifdef CLOUD_HANDOFF_DIAGNOSTIC\n'+text+'#endif\n'
def edit(name,old,new,count=1):
    path=root/name;text=path.read_text()
    if text.count(old)!=count:raise ValueError('Pinned PS2 handoff source changed: '+name)
    path.write_text(text.replace(old,new))
edit('CMakeLists.txt','project(Play)\n','project(Play)\n\n# Same definition for every CPU header consumer; runtime timing defaults off.\nif(EMSCRIPTEN)\n add_compile_definitions(CLOUD_HANDOFF_DIAGNOSTIC=1)\nendif()\n')
edit('Source/MailBox.h','#include <future>\n','#include <future>\n'+guarded('#include "CloudHandoffTrace.h"\n'))
edit('Source/MailBox.h','\t\tFunctionType function;\n',guarded('\t\tuint32_t diagnosticEpoch=0, diagnosticMessage=0, diagnosticParent=0;\n')+'\t\tFunctionType function;\n')
edit('Source/MailBox.h','\tFunctionCallQueue m_calls;\n',guarded('\tuint32_t diagnosticMailbox=0; // allocated only under the existing queue lock\n')+'\tFunctionCallQueue m_calls;\n')
metadata='\tconst auto diagnosticEpoch=CloudHandoff::Epoch();\n\tconst auto diagnosticId=(diagnosticEpoch&1)?CloudHandoff::Id():0;\n\tconst auto diagnosticParent=(diagnosticEpoch&1)?CloudHandoff::CurrentMessage():0;\n'
edit('Source/MailBox.cpp','\tstd::future<void> future;\n','\tstd::future<void> future;\n'+guarded(metadata))
edit('Source/MailBox.cpp','void CMailBox::SendCall(FunctionType&& function)\n{\n','void CMailBox::SendCall(FunctionType&& function)\n{\n'+guarded(metadata))
for assignment in ['\t\tmessage.function = function;\n','\t\tmessage.function = std::move(function);\n']:
    edit('Source/MailBox.cpp',assignment,assignment+guarded('\t\tmessage.diagnosticEpoch=diagnosticEpoch; message.diagnosticMessage=diagnosticId; message.diagnosticParent=diagnosticParent;\n'))
edit('Source/MailBox.cpp','\t\tm_calls.push_back(std::move(message));\n','\t\tm_calls.push_back(std::move(message));\n'+guarded('\t\tif(diagnosticEpoch&1) {\n\t\t if(!diagnosticMailbox)diagnosticMailbox=CloudHandoff::Id();\n\t\t CloudHandoff::Record(diagnosticEpoch,CloudHandoff::Enqueue,diagnosticMailbox,diagnosticId,diagnosticParent);\n\t\t}\n'),count=2)
edit('Source/MailBox.cpp','\t\tfuture.wait();\n',guarded('\t\tif(diagnosticEpoch&1)CloudHandoff::Record(diagnosticEpoch,CloudHandoff::WaitBegin,diagnosticMailbox,diagnosticId,diagnosticParent);\n')+'\t\tfuture.wait();\n'+guarded('\t\tif(diagnosticEpoch&1)CloudHandoff::Record(diagnosticEpoch,CloudHandoff::WaitEnd,diagnosticMailbox,diagnosticId,diagnosticParent);\n'))
edit('Source/MailBox.cpp','\tmessage.function();\n',guarded('\tif(CloudHandoff::Enabled(message.diagnosticEpoch)) {\n\t CloudHandoff::Execute(message.diagnosticEpoch,diagnosticMailbox,message.diagnosticMessage,message.diagnosticParent,[&] {message.function();});\n\t} else\n')+'\tmessage.function();\n')

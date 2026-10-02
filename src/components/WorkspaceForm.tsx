import { useState } from 'react';
import { presentErrorText } from '../error-presentation';
export function WorkspaceForm({ initialName,rename,onSave,onClose }: {initialName?:string;rename:boolean;onSave:(name:string)=>Promise<void>;onClose:()=>void}) {
 const [name,setName]=useState(initialName??'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 return <div className="dialog-backdrop"><form className="graph-dialog" role="dialog" aria-modal="true" aria-label={rename?'重命名工作区':'新建工作区'} onSubmit={async event=>{event.preventDefault();if(busy||!name.trim())return;setBusy(true);setError('');try{await onSave(name.trim());onClose();}catch(error){setError(presentErrorText(error,{message:'工作区保存失败。',recovery:'请重试。'}));}finally{setBusy(false);}}}><h2>{rename?'重命名工作区':'新建工作区'}</h2><label>工作区名称<input autoFocus maxLength={200} value={name} onChange={event=>setName(event.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button disabled={busy||!name.trim()}>{busy?'保存中…':'保存工作区'}</button></div></form></div>;
}

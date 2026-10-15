// Named provider slots are the disk authority. Flat fields remain an in-memory API for workers.
const ids = ['deepseek','mimo','custom']
const fields = { BASE_URL:'baseUrl', API_KEY:'apiKey', MODEL:'model', TEMPERATURE:'temperature', REASONING:'reasoning' }
export const legacyModelKeys = Object.keys(fields)
const defaults = () => ({
  deepseek:{baseUrl:'https://api.deepseek.com/v1',apiKey:'',model:'deepseek-flash',temperature:0.3,reasoning:'none'},
  mimo:{baseUrl:'https://api.xiaomimimo.com/v1',apiKey:'',model:'mimo-v2.6-flash',temperature:0.3,reasoning:'none'},
  custom:{baseUrl:'https://api.openai.com/v1',apiKey:'',model:'',temperature:0.3,reasoning:'none'},
})
function infer(base='',model='') {
  try { const host=new URL(base).hostname; if(host==='xiaomimimo.com'||host.endsWith('.xiaomimimo.com'))return 'mimo';if(host==='deepseek.com'||host.endsWith('.deepseek.com'))return 'deepseek' }catch{}
  return model.startsWith('mimo-')?'mimo':'custom'
}
function readFields(map,prefix='') {
  const result={}
  for(const [env,field] of Object.entries(fields)) {
    if(map[prefix+env]===undefined)continue
    result[field]=field==='temperature'?Number(map[prefix+env]):map[prefix+env]
  }
  return result
}
export function envToModelConfig(map) {
  const named = 'ACTIVE_PROVIDER' in map || ids.some(id=>Object.keys(fields).some(key=>id.toUpperCase()+'_'+key in map))
  const legacy = legacyModelKeys.some(key=>key in map)
  if(!named&&!legacy)return {}
  const providerConfigs=defaults()
  let activeProvider
  if(named) {
    for(const id of ids)Object.assign(providerConfigs[id],readFields(map,id.toUpperCase()+'_'))
    activeProvider=ids.includes(map.ACTIVE_PROVIDER)?map.ACTIVE_PROVIDER:'deepseek'
  }else {
    activeProvider=infer(map.BASE_URL||'https://api.deepseek.com/v1',map.MODEL||'')
    Object.assign(providerConfigs[activeProvider],readFields(map))
  }
  return {activeProvider,providerConfigs,...providerConfigs[activeProvider]}
}
export function modelConfigToEnv(incoming,existing={}) {
  const current=envToModelConfig(existing),providerConfigs=defaults()
  const activeProvider=ids.includes(incoming.activeProvider)?incoming.activeProvider:current.activeProvider??infer(incoming.baseUrl||'https://api.deepseek.com/v1',incoming.model||'')
  for(const id of ids) {
    Object.assign(providerConfigs[id],current.providerConfigs?.[id])
    const supplied=incoming.providerConfigs?.[id]
    if(supplied)for(const field of Object.values(fields))if(supplied[field]!==undefined)providerConfigs[id][field]=supplied[field]
  }
  for(const field of Object.values(fields))if(incoming[field]!==undefined)providerConfigs[activeProvider][field]=incoming[field]
  const result={ACTIVE_PROVIDER:activeProvider}
  for(const id of ids)for(const [env,field] of Object.entries(fields)) {
    let value=providerConfigs[id][field]
    if(field==='temperature')value=Math.min(2,Math.max(0,Number(value)||0))
    else if(field==='reasoning')value=['none','omit','low','high','max'].includes(value)?value:'none'
    else value=typeof value==='string'?value.trim():''
    result[id.toUpperCase()+'_'+env]=value
  }
  return result
}

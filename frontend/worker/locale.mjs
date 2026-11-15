import english from '../../data/i18n/en.json' with {type:'json'}
export const normalizeLanguage=value=>value==='en'?'en':'es'
const escape=s=>s.replace(/[.*+?^{}$()|[\]\\]/g,'\\$&')
const patterns=Object.entries(english).filter(([key,value])=>key!==value&&key.trim().length>2).sort((a,b)=>b[0].length-a[0].length).map(([key,value])=>[new RegExp((/[\p{L}\p{N}_]/u.test(key[0])?'(?<![\\p{L}\\p{N}_])':'')+escape(key)+(/[\p{L}\p{N}_]/u.test(key.at(-1))?'(?![\\p{L}\\p{N}_])':''),'gu'),value])
const cache=new Map()
export function translateText(value,language='es'){
 if(typeof value!=='string')return value==null?'':String(value)
 if(language!=='en')return value
 if(Object.hasOwn(english,value))return english[value]
 if(cache.has(value))return cache.get(value)
 let result=value
 for(const [pattern,replacement] of patterns)result=result.replace(pattern,()=>replacement)
 result=result.replace(/(?<=\d)°O\b/g,'°W')
 if(cache.size>4000)cache.clear();cache.set(value,result)
 return result
}
export function formatNumber(value,digits=1,language='es'){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(language==='en'?'en-US':'es',{maximumFractionDigits:digits}):'—'}

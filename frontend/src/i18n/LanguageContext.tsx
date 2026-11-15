import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react'
import {translateText,formatNumber,type Language} from '../../worker/locale.mjs'
function initialLanguage():Language{
 try{const stored=localStorage.getItem('lunar-oracle-language');if(stored==='es'||stored==='en')return stored;const match=document.cookie.match(/(?:^|;\\s*)app_lang=(es|en)(?:;|$)/);if(match)return match[1] as Language;return navigator.language?.toLowerCase().startsWith('en')?'en':'es'}catch{return 'es'}
}
type Localization={language:Language;setLanguage:(value:Language)=>void;tr:(value:string|null|undefined)=>string;number:(value:number|null|undefined,digits?:number)=>string;fetch:typeof globalThis.fetch}
const LanguageContext=createContext<Localization|null>(null)
export function LanguageProvider({children}:{children:ReactNode}){
 const [language,setLanguage]=useState<Language>(initialLanguage)
 useEffect(()=>{document.documentElement.lang=language;document.title=language==='en'?'Lunar Oracle · Lunar Mission Planner':'Lunar Oracle · Planificador de misiones';try{localStorage.setItem('lunar-oracle-language',language);document.cookie='app_lang='+language+';path=/;max-age=31536000;SameSite=Lax'}catch{}},[language])
 const tr=useCallback((value:string|null|undefined)=>translateText(value,language),[language])
 const number=useCallback((value:number|null|undefined,digits=1)=>formatNumber(value,digits,language),[language])
 const fetch:typeof globalThis.fetch=useCallback((input:RequestInfo|URL,init?:RequestInit)=>{const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));const url=new URL(input instanceof Request?input.url:String(input),location.href);if(url.origin===location.origin&&url.pathname.startsWith('/api/'))headers.set('X-Lunar-Language',language);return globalThis.fetch(input,{...init,headers})},[language])
 const value=useMemo(()=>({language,setLanguage,tr,number,fetch}),[language,tr,number,fetch])
 return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
export function useI18n(){const value=useContext(LanguageContext);if(!value)throw new Error('LanguageProvider is required');return value}

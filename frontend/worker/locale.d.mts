export type Language='es'|'en'
export function normalizeLanguage(value:unknown):Language
export function translateText(value:string|null|undefined,language?:Language):string
export function formatNumber(value:number|null|undefined,digits?:number,language?:Language):string

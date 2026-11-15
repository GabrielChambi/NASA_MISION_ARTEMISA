import {normalizeEnglishInput} from './english-input.mjs'
/** Conservative repairs of explicit text; never invent a missing year or correct a calendar date. */
const MONTHS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const ALIASES={ene:'enero',feb:'febrero',mar:'marzo',abr:'abril',may:'mayo',jun:'junio',jul:'julio',ago:'agosto',sep:'septiembre',sept:'septiembre',setiembre:'septiembre',oct:'octubre',nov:'noviembre',dic:'diciembre',january:'enero',february:'febrero',march:'marzo',april:'abril',june:'junio',july:'julio',august:'agosto',september:'septiembre',october:'octubre',november:'noviembre',december:'diciembre'}
const WORDS={cero:0,uno:1,primero:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,veintiuno:21,veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29,treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,cien:100,ciento:100,doscientos:200,trescientos:300,cuatrocientos:400,quinientos:500,seiscientos:600,setecientos:700,ochocientos:800,novecientos:900,mil:1000}
function closeOne(a,b){if(Math.abs(a.length-b.length)>1)return false;if(a.length===b.length)return [...a].filter((c,i)=>c!==b[i]).length<=1;if(a.length>b.length)[a,b]=[b,a];let i=0,j=0,miss=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++}else{j++;miss++}}return miss+b.length-j<=1}
export function normalizeMissionText(value){
 let text=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/−/g,'-').replace(/\u00a0/g,' ')
 text=normalizeEnglishInput(text)
 text=text.replace(/\b(viaje|viajar|el|de|del|al|las|hora|durante|estar|necesito|quiero|reserva|bateria|solar|carga|consumo|desde|salida|lanzamiento|retraso)(?=\d)/g,'$1 ')
 text=text.replace(/(?<=\d)(?=(?:de|del)(?:\s|[a-z]))/g,' ').replace(/\b(?:el|del|al)(?=\d{1,2}(?:de|\s))/g,m=>m+' ')
 for(const month of MONTHS){
  text=text.replace(new RegExp('\\b'+month+'(del?|el)?(?=\\d{4}\\b)','g'),(_,connector)=>month+' '+(connector?connector+' ':''))
  text=text.replace(new RegExp('\\b'+month+'(del?|el)\\b','g'),(_,connector)=>month+' '+connector)
 }
 text=text.replace(/\b(de|del)(?=\d{4}\b)/g,'$1 ').replace(new RegExp('\\b(de|del)(?=('+MONTHS.join('|')+')\\b)','g'),'$1 ')
 text=text.replace(/\b(?:un|una)\b(?=\s+(?:hora|dia|wh|kwh|metro))/g,'1')
 const words=Object.keys(WORDS).sort((a,b)=>b.length-a.length).join('|')
 text=text.replace(new RegExp('\\b(?:'+words+')(?:\\s+(?:y\\s+)?(?:'+words+'))*\\b','g'),m=>{let total=0,current=0;for(const word of m.split(/\s+/)){if(word==='y')continue;if(word==='mil'){total+=Math.max(1,current)*1000;current=0}else current+=WORDS[word]}return String(total+current)})
 for(const [alias,month] of Object.entries(ALIASES))text=text.replace(new RegExp('\\b'+alias+'\\b\\.?','g'),month)
 text=text.replace(/(\b\d{1,2}\s+(?:de\s+)?)([a-z]{4,12})(\s+(?:(?:de|del)\s+)?\d{4}\b)/g,(_,before,word,after)=>{const choices=MONTHS.filter(m=>closeOne(word,m));return before+(choices.length===1?choices[0]:word)+after})
 text=text.replace(new RegExp('\\b('+MONTHS.join('|')+')\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*((?:19|20)\\d{2}|2100)\\b','g'),'$2 de $1 de $3')
 text=text.replace(/\b(\d{1,2})\s*(?:de\s+la\s+|por\s+la\s+)(manana|tarde|noche)\b/g,(_,hour,part)=>hour+(part==='manana'?' am':' pm'))
 return text.replace(/\s+/g,' ').trim()
}

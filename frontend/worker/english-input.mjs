import lexicon from '../../data/i18n/english-input.json' with {type:'json'}
export function normalizeEnglishInput(value){
 let text=value
 text=text.replace(/(?<=\d)(?:st|nd|rd|th)\b/g,'')
 const words=Object.keys(lexicon.numbers).sort((a,b)=>b.length-a.length).join('|')
 text=text.replace(new RegExp('\\b('+words+')-(?='+words+'\\b)','g'),'$1 ')
 text=text.replace(new RegExp('\\b(?:'+words+')(?:\\s+(?:and\\s+)?(?:'+words+'))*\\b','g'),m=>{let total=0,current=0;for(const w of m.split(/\s+/)){if(w==='and')continue;const n=lexicon.numbers[w];if(n===100)current=Math.max(1,current)*100;else if(n===1000){total+=Math.max(1,current)*1000;current=0}else current+=n}return String(total+current)})
 for(const [pattern,replacement] of lexicon.rules)text=text.replace(new RegExp(pattern,'g'),replacement)
 return text
}

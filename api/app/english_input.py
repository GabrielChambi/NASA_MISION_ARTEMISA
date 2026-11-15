import json,re
from pathlib import Path
LEXICON=json.loads((Path(__file__).resolve().parents[2]/'data/i18n/english-input.json').read_text(encoding='utf-8'))
def normalize_english_input(text):
 text=re.sub(r'(?<=\d)(?:st|nd|rd|th)\b','',text)
 words='|'.join(sorted(LEXICON['numbers'],key=len,reverse=True))
 text=re.sub(r'\b('+words+r')-(?=(?:'+words+r')\b)',r'\1 ',text)
 def number(match):
  total=current=0
  for word in match[0].split():
   if word=='and':continue
   n=LEXICON['numbers'][word]
   if n==100:current=max(1,current)*100
   elif n==1000:total+=max(1,current)*1000;current=0
   else:current+=n
  return str(total+current)
 text=re.sub(r'\b(?:'+words+r')(?:\s+(?:and\s+)?(?:'+words+r'))*\b',number,text)
 for pattern,replacement in LEXICON['rules']:text=re.sub(pattern,replacement,text)
 return text

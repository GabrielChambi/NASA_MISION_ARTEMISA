"""Conservative text normalization: repair spacing, common month spellings and explicit number words.

No calendar correction, missing-year guessing or inference of mission measurements.
"""
import re,unicodedata
MONTHS=('enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre')
ALIASES={'ene':'enero','feb':'febrero','mar':'marzo','abr':'abril','may':'mayo','jun':'junio','jul':'julio','ago':'agosto','sep':'septiembre','sept':'septiembre','setiembre':'septiembre','oct':'octubre','nov':'noviembre','dic':'diciembre',
 'january':'enero','february':'febrero','march':'marzo','april':'abril','june':'junio','july':'julio','august':'agosto','september':'septiembre','october':'octubre','november':'noviembre','december':'diciembre'}
WORDS={'cero':0,'uno':1,'primero':1,'dos':2,'tres':3,'cuatro':4,'cinco':5,'seis':6,'siete':7,'ocho':8,'nueve':9,'diez':10,'once':11,'doce':12,'trece':13,'catorce':14,'quince':15,'dieciseis':16,'diecisiete':17,'dieciocho':18,'diecinueve':19,'veinte':20,'veintiuno':21,'veintidos':22,'veintitres':23,'veinticuatro':24,'veinticinco':25,'veintiseis':26,'veintisiete':27,'veintiocho':28,'veintinueve':29,'treinta':30,'cuarenta':40,'cincuenta':50,'sesenta':60,'setenta':70,'ochenta':80,'noventa':90,'cien':100,'ciento':100,'doscientos':200,'trescientos':300,'cuatrocientos':400,'quinientos':500,'seiscientos':600,'setecientos':700,'ochocientos':800,'novecientos':900,'mil':1000}

def close_one(a,b):
 if abs(len(a)-len(b))>1:return False
 if len(a)==len(b):return sum(x!=y for x,y in zip(a,b))<=1
 if len(a)>len(b):a,b=b,a
 i=j=miss=0
 while i<len(a) and j<len(b):
  if a[i]==b[j]:i+=1;j+=1
  else:j+=1;miss+=1
 return miss+len(b)-j<=1

def number_words(match):
 words=match.group(0).split();total=current=0
 for w in words:
  if w=='y':continue
  if w=='mil':total+=max(1,current)*1000;current=0
  else:current+=WORDS[w]
 return str(total+current)

def normalize_mission_text(value):
 text=''.join(c for c in unicodedata.normalize('NFD',value) if unicodedata.category(c)!='Mn').lower().replace('−','-').replace('\u00a0',' ')
 text=re.sub(r'\b(viaje|viajar|el|de|del|al|las|hora|durante|estar|necesito|quiero|reserva|bateria|solar|carga|consumo|desde|salida|lanzamiento|retraso)(?=\d)',r'\1 ',text)
 # Only date connectors; ISO timestamps, offsets, decimals and unit suffixes remain intact.
 text=re.sub(r'(?<=\d)(?=(?:de|del)(?:\s|[a-z]))',' ',text)
 text=re.sub(r'\b(?:el|del|al)(?=\d{1,2}(?:de|\s))',lambda m:m[0]+' ',text)
 for month in MONTHS:
  text=re.sub(r'\b'+month+r'(del?|el)?(?=\d{4}\b)',lambda m:month+' '+((m[1]+' ') if m[1] else ''),text)
  text=re.sub(r'\b'+month+r'(del?|el)\b',lambda m:month+' '+m[1],text)
 text=re.sub(r'\b(de|del)(?=\d{4}\b)',r'\1 ',text)
 text=re.sub(r'\b(de|del)(?=('+ '|'.join(MONTHS)+r')\b)',r'\1 ',text)
 text=re.sub(r'\b(?:un|una)\b(?=\s+(?:hora|dia|wh|kwh|metro))','1',text)
 tokens='|'.join(sorted(WORDS,key=len,reverse=True))
 text=re.sub(r'\b(?:'+tokens+r')(?:\s+(?:y\s+)?(?:'+tokens+r'))*\b',number_words,text)
 for alias,month in ALIASES.items():text=re.sub(r'\b'+alias+r'\b\.?',month,text)
 # Correct a single month edit only inside an explicit day/month/year construction.
 def fix(m):
  candidate=m[2];matches=[v for v in MONTHS if close_one(candidate,v)]
  return m[1]+(matches[0] if len(matches)==1 else candidate)+m[3]
 text=re.sub(r'(\b\d{1,2}\s+(?:de\s+)?)([a-z]{4,12})(\s+(?:(?:de|del)\s+)?\d{4}\b)',fix,text)
 # English month-first notation becomes the same explicit day/month/year representation.
 text=re.sub(r'\b('+'|'.join(MONTHS)+r')\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*((?:19|20)\d{2}|2100)\b',r'\2 de \1 de \3',text)
 text=re.sub(r'\b(\d{1,2})\s*(?:de\s+la\s+|por\s+la\s+)(manana|tarde|noche)\b',lambda m:m[1]+(' am' if m[2]=='manana' else ' pm'),text)
 return re.sub(r'\s+',' ',text).strip()

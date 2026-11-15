import json,re
from pathlib import Path
from functools import lru_cache
ENGLISH=json.loads((Path(__file__).resolve().parents[2]/'data/i18n/en.json').read_text(encoding='utf-8'))
PATTERNS=[(re.compile((r'(?<!\w)' if k[0].isalnum() or k[0]=='_' else '')+re.escape(k)+(r'(?!\w)' if k[-1].isalnum() or k[-1]=='_' else '')),v) for k,v in sorted(ENGLISH.items(),key=lambda x:len(x[0]),reverse=True) if k!=v and len(k.strip())>2]
def normalize_language(value):return 'en' if value=='en' else 'es'
def language_instruction(language):return ' The response text must be in English. Preserve all evidence restrictions, numbers and JSON field names.' if language=='en' else ''
@lru_cache(maxsize=4000)
def translate_text(value,language='es'):
 if language!='en' or not isinstance(value,str):return value
 if value in ENGLISH:return ENGLISH[value]
 for pattern,replacement in PATTERNS:value=pattern.sub(lambda _:replacement,value)
 value=re.sub(r'(?<=\d)°O\b','°W',value)
 return value
TEXT_KEYS={'message','question','display_summary','assumptions','explanation','summary','risk_alert','site_recommendation','hardware_recommendation','limitations','reasons','label'}
def localize_payload(value,language='es',display=False):
 if language!='en':return value
 if isinstance(value,str):return translate_text(value,language) if display else value
 if isinstance(value,list):return [localize_payload(v,language,display) for v in value]
 if isinstance(value,dict):return {k:localize_payload(v,language,display or k in TEXT_KEYS) for k,v in value.items()}
 return value

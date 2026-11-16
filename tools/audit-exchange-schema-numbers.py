# Static numeric-domain audit of the pinned four schema resources only.
import json,pathlib
root=pathlib.Path(__file__).resolve().parent.parent/'scripts/lib/exchange-schemas'
records=[]
for name in ['feed','catalog','current','selection']:
    source=json.loads((root/(name+'.schema.json')).read_text())
    def walk(value,pointer):
        if isinstance(value,dict):
            types=value.get('type',[])
            types=[types] if isinstance(types,str) else types
            if 'number' in types: raise RuntimeError('fractional numeric schema domain')
            if 'integer' in types:
                if value.get('minimum',-1)<0 or value.get('maximum',9007199254740992)>9007199254740991:
                    raise RuntimeError('negative or unsafe integer domain')
                records.append({'schema':name,'pointer':pointer,'minimum':value['minimum'],'maximum':value['maximum'],'nullable':'null' in types})
            for key,item in value.items(): walk(item,pointer+'/'+key)
        elif isinstance(value,list):
            for index,item in enumerate(value): walk(item,pointer+'/'+str(index))
    walk(source,'')
assert len(records)==13
print(json.dumps({'contract':'draft0.3.1','numericDeclarations':len(records),'negativeOrFractionalNumericField':False,'fields':records},indent=2))

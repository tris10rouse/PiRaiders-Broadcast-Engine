# Independent JSON Schema Draft2020-12 applicator oracle only.
# Formats are annotations here: this environment lacks optional date-time checker.
import json,sys
from importlib.metadata import version
if version("jsonschema") != "4.26.0":
    raise RuntimeError("SCHEMA_ORACLE_VERSION")
from jsonschema import Draft202012Validator
request=json.load(sys.stdin)
original=Draft202012Validator(request['original'])
rewritten=Draft202012Validator(request['rewritten'])
print(json.dumps({'original':[original.is_valid(value) for value in request['cases']], 'rewritten':[rewritten.is_valid(value) for value in request['cases']]}))

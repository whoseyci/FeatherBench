#!/usr/bin/env python3
"""Optional bank rotation. Requires FeatherBench 2.2+ installed on the maintainer machine."""
import argparse, json, pathlib, shutil, tempfile
from featherbench.core import create_suite, load_jsonl

p=argparse.ArgumentParser();p.add_argument('--seed',required=True);p.add_argument('--profile',default='marathon',choices=['smoke','quick','standard','full','marathon']);args=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
    run=pathlib.Path(td)/'run';create_suite(run,args.seed,args.profile)
    qs={x['id']:x for x in load_jsonl(run/'public/questions.jsonl')};ks={x['id']:x for x in load_jsonl(run/'private/answer_key.jsonl')}
    items=[{'id':qid,'category':q['category'],'difficulty':q['difficulty'],'prompt':q['prompt'],'assets':q.get('assets',[]),'key':ks[qid]['key']} for qid,q in qs.items()]
    manifest=json.loads((run/'public/manifest.json').read_text())
    (root/'src/bank.json').write_text(json.dumps({'manifest':manifest,'items':items},ensure_ascii=False,separators=(',',':')))
    shutil.rmtree(root/'public/assets',ignore_errors=True);shutil.copytree(run/'public/assets',root/'public/assets')
    print(f'Wrote {len(items)} items; commitment={manifest["seed_commitment"]}')

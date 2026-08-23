import base64, html, json, os, re, sys, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

HATENA_ID=os.environ['HATENA_ID']
HATENA_API_KEY=os.environ['HATENA_API_KEY']
BLOG_ID=os.environ.get('HATENA_BLOG_ID','rapomarublog.hatenablog.com')
COL=f'https://blog.hatena.ne.jp/{HATENA_ID}/{BLOG_ID}/atom/entry'
ATOM='http://www.w3.org/2005/Atom'
APP='http://www.w3.org/2007/app'
AFF='a_id=5768596'
BOOK='pl_id=637'
BANNER='pl_id=639'


def request(url,method='GET',data=None,ctype=None):
    token=base64.b64encode(f'{HATENA_ID}:{HATENA_API_KEY}'.encode()).decode()
    headers={'Authorization':'Basic '+token,'User-Agent':'RAPOMAN-Cloud/1.0'}
    if ctype: headers['Content-Type']=ctype
    return urllib.request.urlopen(urllib.request.Request(url,data=data,method=method,headers=headers),timeout=30)


def make_xml(job,body,draft):
    cats=''.join(f'<category term="{html.escape(c,quote=True)}" />' for c in job.get('categories',[]))
    custom=''
    if job.get('custom_url'):
        custom='<hatenablog:custom-url xmlns:hatenablog="http://www.hatena.ne.jp/info/xmlns#hatenablog">'+html.escape(job['custom_url'])+'</hatenablog:custom-url>'
    now=datetime.now(timezone.utc).isoformat()
    return f'''<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="{ATOM}" xmlns:app="{APP}"><title>{html.escape(job['title'])}</title>
<author><name>{html.escape(HATENA_ID)}</name></author><content type="text/html">{html.escape(body)}</content>
<updated>{now}</updated>{cats}<app:control><app:draft>{'yes' if draft else 'no'}</app:draft></app:control>{custom}</entry>'''.encode()


def parse_entry(raw):
    root=ET.fromstring(raw)
    links={x.get('rel'):x.get('href','') for x in root.findall(f'{{{ATOM}}}link')}
    return {'title':root.findtext(f'{{{ATOM}}}title') or '', 'content':root.findtext(f'{{{ATOM}}}content') or '', 'draft':root.findtext(f'{{{APP}}}control/{{{APP}}}draft') or '', 'alternate':links.get('alternate','')}


def get_entry(loc):
    with request(loc) as r: return parse_entry(r.read())


def put_entry(loc,xml):
    with request(loc,'PUT',xml,'application/atom+xml;type=entry; charset=utf-8') as r: return parse_entry(r.read())


def post_entry(xml):
    with request(COL,'POST',xml,'application/atom+xml;type=entry; charset=utf-8') as r:
        loc=r.headers.get('Location','')
        if r.status!=201 or not loc: raise RuntimeError(f'DRAFT_POST_FAILED_{r.status}')
        return loc,parse_entry(r.read())


def preflight(job,body):
    text=re.sub(r'<[^>]+>','',body).strip()
    official=job.get('official_domain','')
    isbn=str(job.get('isbn',''))
    checks={
      'body_text':len(text)>=500,
      'affiliate_id':AFF in body,
      'first_volume_link':BOOK in body,
      'bottom_banner':BANNER in body,
      'pr_label':'PR' in body,
      'cover_image':'<img' in body and '1巻' in body,
      'official_link':bool(official) and official in body,
      'isbn':not isbn or isbn in body,
      'no_forbidden_heading':not re.search(r'<h[1-6][^>]*>\s*(まとめ|総評|こんな人におすすめ|魅力3選|読むべき理由)',body),
    }
    bad=[k for k,v in checks.items() if not v]
    if bad: raise RuntimeError('PREFLIGHT_FAIL:'+','.join(bad))
    return checks


def public_audit(job,url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'RAPOMAN-Cloud-Audit/1.0'}),timeout=30) as r:
        page=r.read().decode('utf-8','replace')
    official=job.get('official_domain',''); isbn=str(job.get('isbn',''))
    checks={
      'public_fetch':bool(page), 'affiliate_id':AFF in page, 'first_volume_link':BOOK in page,
      'bottom_banner':BANNER in page, 'pr_label':'PR' in page,
      'cover_click':bool(re.search(r'<a[^>]+a_id=5768596[^>]*>\s*<img',page,re.S)),
      'official_link':bool(official) and official in page,
      'isbn':not isbn or isbn in page,
      'no_forbidden_heading':not re.search(r'<h[1-6][^>]*>\s*(まとめ|総評|こんな人におすすめ|魅力3選|読むべき理由)',page),
    }
    return checks


def main():
    queue=Path(sys.argv[1]); job=json.loads(queue.read_text(encoding='utf-8'))
    body=job['body_html']; result={'queue':str(queue),'title':job['title'],'status':'failed'}
    preflight(job,body)
    loc=None
    try:
        if job.get('mode','new')=='update':
            loc=f"{COL}/{job['entry_id']}"
            before=get_entry(loc)
            published=put_entry(loc,make_xml(job,body,False))
            url=job.get('public_url') or published['alternate'] or before['alternate']
        else:
            loc,_=post_entry(make_xml(job,body,True))
            check=get_entry(loc)
            if not (check['title']==job['title'] and check['content']==body and check['draft']=='yes'):
                raise RuntimeError('DRAFT_VERIFY_FAILED')
            published=put_entry(loc,make_xml(job,body,False)); url=published['alternate']
        checks=public_audit(job,url)
        if not all(checks.values()):
            put_entry(loc,make_xml(job,body,True))
            raise RuntimeError('PUBLIC_AUDIT_FAIL:'+','.join(k for k,v in checks.items() if not v))
        result.update(status='published',public_url=url,audit=checks)
    except Exception as e:
        result['error']=str(e)
        if loc and job.get('mode','new')!='update':
            try: put_entry(loc,make_xml(job,body,True)); result['rolled_back_to_draft']=True
            except Exception: result['rolled_back_to_draft']=False
        raise
    finally:
        out=Path('results')/(queue.stem+'.json'); out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__': main()

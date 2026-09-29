# Read-only: the official results of the last 96 fifteen-minute BTC windows on Polymarket (gamma events by slug)
# and Kalshi (KXBTC15M markets), compared. Run 29 September 2026 ~02:35 UTC; output: results-2026-09-29.json.
# Public GETs only; no credential.
import json,subprocess,time,datetime,zoneinfo
def get(u):
    try: return json.loads(subprocess.check_output(['curl','-sS','-m','20',u]))
    except Exception: return None
ET=zoneinfo.ZoneInfo('America/New_York')
now=int(time.time()); last_closed_start=now-now%900-900*2
rows=[]
for i in range(96):
    s=last_closed_start-900*i; e=s+900
    ev=get(f"https://gamma-api.polymarket.com/events?slug=btc-updown-15m-{s}")
    if not ev: continue
    m=ev[0]['markets'][0]
    if not m.get('closed') or m.get('umaResolutionStatus')!='resolved': continue
    op=json.loads(m['outcomePrices']); poly='yes' if op[0]=='1' else ('no' if op[1]=='1' else None)
    ce=datetime.datetime.fromtimestamp(e,ET)
    t=f"KXBTC15M-{ce.strftime('%y%b%d%H%M').upper()}-{ce.strftime('%M')}"
    k=get(f"https://api.elections.kalshi.com/trade-api/v2/markets/{t}")
    km=(k or {}).get('market') or {}
    kal=km.get('result') if km.get('result') in ('yes','no') else None
    rows.append((s,t,poly,kal,km.get('floor_strike'),km.get('expiration_value')))
both=[r for r in rows if r[2] and r[3]]
dis=[r for r in both if r[2]!=r[3]]
print(f"windows with both official results: {len(both)}; disagreed: {len(dis)}")
for r in dis[:10]: print('disagree', datetime.datetime.utcfromtimestamp(r[0]).isoformat()+'Z', r[1], 'poly', r[2], 'kalshi', r[3], 'kalshi ref', r[4], '->', r[5])
json.dump([dict(zip(['start','kalshi_ticker','polymarket','kalshi','kalshi_floor','kalshi_exp'],r)) for r in rows], open('results.json','w'))

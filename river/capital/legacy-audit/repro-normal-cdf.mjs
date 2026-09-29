// kalshi-genius src/core/turbo_probability.ts:194-211, copied verbatim, against exact Φ.
// Observed 29 September 2026: errors +0.0280 (0.25), +0.0369 (0.5), +0.0290 (1), +0.0146 (1.5), +0.0055 (2).
function legacy(x){ if(x>8)return 1; if(x<-8)return 0; const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911; const sign=x<0?-1:1, absX=Math.abs(x); const t=1/(1+p*absX); const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-absX*absX/2); return 0.5*(1+sign*y);}
const exact={0.25:0.598706,0.5:0.691462,1:0.841345,1.5:0.933193,2:0.977250};
for (const [x,v] of Object.entries(exact)) console.log(x, 'exact', v, 'legacy', legacy(+x).toFixed(6), 'error', (legacy(+x)-v).toFixed(4));

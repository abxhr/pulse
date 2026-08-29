"""Phase 4: local n-of-1 experiments and predictive personal analytics."""
from __future__ import annotations
from collections import defaultdict
from datetime import date, timedelta
import math, statistics
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..models import Activity, BodyWeight, DailyHealth, Experiment, ExperimentDay, HealthAnnotation, Meal, Sleep, Workout

METRICS={"readiness":"Readiness","hrv":"HRV","resting_hr":"Resting HR","sleep_score":"Sleep score","sleep_hours":"Sleep hours","steps":"Steps","weight":"Weight","run_km":"Run km","strength_volume":"Strength volume","calories":"Calories","protein":"Protein"}
LOWER_BETTER={"resting_hr","weight"}

def daily_metrics(db:Session,days:int=180)->dict:
 start=date.today()-timedelta(days=days);out=defaultdict(dict)
 for h in db.execute(select(DailyHealth).where(DailyHealth.date>=start)).scalars():out[h.date].update(readiness=h.training_readiness,hrv=h.hrv_last_night,resting_hr=h.resting_hr,steps=h.steps)
 for s in db.execute(select(Sleep).where(Sleep.date>=start)).scalars():out[s.date].update(sleep_score=s.sleep_score,sleep_hours=round((s.total_seconds or 0)/3600,2) if s.total_seconds else None)
 for w in db.execute(select(BodyWeight).where(BodyWeight.date>=start)).scalars():out[w.date]["weight"]=w.weight_kg
 for a in db.execute(select(Activity).where(Activity.date>=start)).scalars():
  if "run" in (a.activity_type or "").lower():out[a.date]["run_km"]=out[a.date].get("run_km",0)+(a.distance_m or 0)/1000
 for w in db.execute(select(Workout).where(Workout.date>=start)).scalars():out[w.date]["strength_volume"]=out[w.date].get("strength_volume",0)+(w.volume_kg or 0)
 for m in db.execute(select(Meal).where(Meal.date>=start)).scalars():out[m.date]["calories"]=out[m.date].get("calories",0)+(m.calories or 0);out[m.date]["protein"]=out[m.date].get("protein",0)+(m.protein_g or 0)
 return out

def create_experiment(db:Session,p:dict)->dict:
 metric=p.get("outcome_metric","readiness")
 if metric not in METRICS:raise ValueError("unsupported outcome metric")
 row=Experiment(name=str(p.get("name") or "")[:128],hypothesis=str(p.get("hypothesis") or "")[:1000] or None,protocol=str(p.get("protocol") or "")[:1000] or None,outcome_metric=metric,start_date=date.fromisoformat(p.get("start_date") or date.today().isoformat()),end_date=date.fromisoformat(p["end_date"]) if p.get("end_date") else None)
 if not row.name:raise ValueError("name is required")
 db.add(row);db.commit();db.refresh(row);return serialize(db,row)

def log_day(db:Session,experiment_id:int,p:dict)->dict:
 if not db.get(Experiment,experiment_id):raise ValueError("experiment not found")
 d=date.fromisoformat(p.get("date") or date.today().isoformat());row=db.execute(select(ExperimentDay).where(ExperimentDay.experiment_id==experiment_id,ExperimentDay.date==d)).scalars().first()
 if not row:row=ExperimentDay(experiment_id=experiment_id,date=d)
 row.adhered=bool(p.get("adhered",True));row.note=str(p.get("note") or "")[:500] or None;db.add(row);db.commit();return {"date":d.isoformat(),"adhered":row.adhered,"note":row.note}

def update_experiment(db:Session,eid:int,p:dict)->dict:
 row=db.get(Experiment,eid)
 if not row:raise ValueError("experiment not found")
 if p.get("status") in {"active","completed","paused"}:row.status=p["status"]
 if p.get("end_date"):row.end_date=date.fromisoformat(p["end_date"])
 db.commit();return serialize(db,row)

def _effect(vals_a,vals_b,metric):
 if len(vals_a)<3 or len(vals_b)<3:return None
 a,b=statistics.mean(vals_a),statistics.mean(vals_b);pooled=math.sqrt((statistics.pvariance(vals_a)+statistics.pvariance(vals_b))/2) if len(vals_a)>1 and len(vals_b)>1 else 0;raw=b-a;benefit=-raw if metric in LOWER_BETTER else raw
 return {"baseline_avg":round(a,2),"intervention_avg":round(b,2),"change":round(raw,2),"improvement":round(benefit,2),"effect_size":round(benefit/pooled,2) if pooled else None,"confidence":"high" if len(vals_b)>=14 else "medium" if len(vals_b)>=7 else "early"}

def serialize(db:Session,e:Experiment)->dict:
 metrics=daily_metrics(db);logs=db.execute(select(ExperimentDay).where(ExperimentDay.experiment_id==e.id)).scalars().all();adhered={x.date for x in logs if x.adhered};baseline_start=e.start_date-timedelta(days=21)
 before=[v[e.outcome_metric] for d,v in metrics.items() if baseline_start<=d<e.start_date and v.get(e.outcome_metric) is not None]
 end=e.end_date or date.today();during=[v[e.outcome_metric] for d,v in metrics.items() if e.start_date<=d<=end and d in adhered and v.get(e.outcome_metric) is not None]
 days=max(1,(min(end,date.today())-e.start_date).days+1);return {"id":e.id,"name":e.name,"hypothesis":e.hypothesis,"protocol":e.protocol,"outcome_metric":e.outcome_metric,"outcome_label":METRICS[e.outcome_metric],"start_date":e.start_date.isoformat(),"end_date":e.end_date.isoformat() if e.end_date else None,"status":e.status,"adhered_days":len(adhered),"adherence_pct":round(len(adhered)/days*100),"analysis":_effect(before,during,e.outcome_metric)}

def experiments(db:Session)->list[dict]:return [serialize(db,x) for x in db.execute(select(Experiment).order_by(Experiment.status,Experiment.start_date.desc())).scalars().all()]
def delete_experiment(db:Session,eid:int)->bool:
 row=db.get(Experiment,eid)
 if not row:return False
 for x in db.execute(select(ExperimentDay).where(ExperimentDay.experiment_id==eid)).scalars().all():db.delete(x)
 db.delete(row);db.commit();return True

def add_annotation(db:Session,p:dict)->dict:
 d=date.fromisoformat(p.get("date") or date.today().isoformat());cat=p.get("category","other");row=HealthAnnotation(date=d,category=cat,label=str(p.get("label") or "")[:128],notes=str(p.get("notes") or "")[:1000] or None)
 if not row.label:raise ValueError("label is required")
 db.add(row);db.commit();db.refresh(row);return {"id":row.id,"date":d.isoformat(),"category":cat,"label":row.label,"notes":row.notes}

def annotations(db:Session,days=180)->list[dict]:
 rows=db.execute(select(HealthAnnotation).where(HealthAnnotation.date>=date.today()-timedelta(days=days)).order_by(HealthAnnotation.date.desc())).scalars().all();return [{"id":x.id,"date":x.date.isoformat(),"category":x.category,"label":x.label,"notes":x.notes} for x in rows]
def delete_annotation(db:Session,aid:int)->bool:
 row=db.get(HealthAnnotation,aid)
 if not row:return False
 db.delete(row);db.commit();return True

def readiness_forecast(db:Session)->dict|None:
 data=daily_metrics(db,180);days=sorted(data);samples=[]
 for i,d in enumerate(days[:-1]):
  nxt=days[i+1]
  if (nxt-d).days!=1:continue
  x=data[d];y=data[nxt].get("readiness")
  if y is not None and all(x.get(k) is not None for k in ("hrv","resting_hr","sleep_score")):samples.append((x,y))
 if len(samples)<12:return None
 def norm(k,v):vals=[x[k] for x,_ in samples];sd=statistics.pstdev(vals) or 1;return (v-statistics.mean(vals))/sd
 latest=data[days[-1]];required=("hrv","resting_hr","sleep_score")
 if any(latest.get(k) is None for k in required):return None
 distances=[]
 for x,y in samples:
  dist=sum((norm(k,x[k])-norm(k,latest[k]))**2 for k in required)**.5;distances.append((dist,y))
 nearest=sorted(distances)[:min(10,len(distances))];weights=[1/(d+.15) for d,_ in nearest];pred=sum(w*y for w,(_,y) in zip(weights,nearest))/sum(weights);mae=sum(abs(y-pred) for _,y in nearest)/len(nearest)
 return {"predicted_readiness":round(pred),"range":[max(0,round(pred-mae)),min(100,round(pred+mae))],"similar_days":len(nearest),"method":"nearest historical days matched on HRV, resting HR, and sleep score","confidence":"high" if len(samples)>=45 else "medium" if len(samples)>=25 else "low"}

def dashboard(db:Session)->dict:return {"experiments":experiments(db),"annotations":annotations(db),"readiness_forecast":readiness_forecast(db),"metrics":[{"key":k,"label":v} for k,v in METRICS.items()]}

import unittest
from datetime import date, timedelta
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db import Base
from app.models import DailyHealth, Sleep
from app.services import insights, lab

class Phase4LabTests(unittest.TestCase):
 def setUp(self):
  self.engine=create_engine("sqlite:///:memory:");Base.metadata.create_all(self.engine);self.db=sessionmaker(bind=self.engine)()
 def tearDown(self):self.db.close();self.engine.dispose()
 def seed(self):
  for i in range(50):
   d=date.today()-timedelta(days=49-i);self.db.add(DailyHealth(date=d,training_readiness=55+i%12,hrv_last_night=62+i%8,resting_hr=58-i%4,steps=8000));self.db.add(Sleep(date=d,sleep_score=70+i%10,total_seconds=(7*3600+i%4*900)))
  self.db.commit()
 def test_experiment_measures_adherent_days_against_baseline(self):
  self.seed();start=date.today()-timedelta(days=8);e=lab.create_experiment(self.db,{"name":"Earlier bed","outcome_metric":"readiness","start_date":start.isoformat()})
  for i in range(8):lab.log_day(self.db,e["id"],{"date":(start+timedelta(days=i)).isoformat(),"adhered":True})
  result=lab.experiments(self.db)[0];self.assertEqual(result["adhered_days"],8);self.assertIsNotNone(result["analysis"]);self.assertIn(result["analysis"]["confidence"],{"medium","high"})
 def test_annotation_round_trip(self):
  lab.add_annotation(self.db,{"category":"travel","label":"Long flight"});rows=lab.annotations(self.db);self.assertEqual(rows[0]["label"],"Long flight")
 def test_readiness_forecast_uses_historical_neighbors(self):
  self.seed();f=lab.readiness_forecast(self.db);self.assertIsNotNone(f);self.assertEqual(f["similar_days"],10);self.assertTrue(0<=f["predicted_readiness"]<=100)
 def test_provider_dispatch_falls_back_without_network(self):
  old_a,old_o=insights.settings.anthropic_api_key,insights.settings.openai_api_key
  insights.settings.openai_api_key="configured";insights.settings.anthropic_api_key="configured"
  try:
   with patch.object(insights,"_call_openai",side_effect=RuntimeError("connection")),patch.object(insights,"_call_anthropic",return_value="fallback"):
    text,provider,_=insights._dispatch("system",[],"openai");self.assertEqual(text,"fallback");self.assertEqual(provider,"anthropic")
  finally:insights.settings.anthropic_api_key,insights.settings.openai_api_key=old_a,old_o

if __name__=="__main__":unittest.main()

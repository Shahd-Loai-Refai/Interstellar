"""Run three demo ideas through the agent (one weak, one NASA already tried, one new).

    python test_cases.py
"""

import sys

from agent import evaluate

sys.stdout.reconfigure(encoding="utf-8")  # so Arabic prints in the Windows terminal

CASES = [
    ("dust_solar_panels", "en", "Make the rover better."),
    ("dust_solar_panels", "en", "Shake the solar panels with the motors so the dust falls off."),
    ("dust_solar_panels", "ar",
     "نغطي الألواح الشمسية بطبقة شفافة تشحن كهربائياً كل فترة فتطرد ذرات الغبار المشحونة، "
     "بدون أي أجزاء متحركة، وتستخدم كمية صغيرة من طاقة الألواح نفسها."),
]

if __name__ == "__main__":
    for problem_id, lang, text in CASES:
        r = evaluate(problem_id, text, lang)
        print("=" * 70)
        print("IDEA:     ", text)
        print("DECISION: ", r["decision"], "| total:", r["total"], "| scores:", r["scores"])
        print("PRINCIPLE:", r["engineering_principle"])
        print("REASON:   ", r["reason"])
        print("USER MSG: ", r["message_to_user"])
        if r.get("nasa_report"):
            print("REPORT:   ", r["nasa_report"])

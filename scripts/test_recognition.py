#!/usr/bin/env python3
"""CLI test nhan dien: upload anh -> /api/checkin/recognize, in similarity + guest match.

Usage:
  python scripts/test_recognition.py <image.jpg> [--workshop SLUG_or_ID] [--base http://localhost:8087]
"""
import argparse
import sys
import requests


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--workshop", default=None, help="workshop id (mac dinh: workshop dau tien)")
    ap.add_argument("--base", default="http://localhost:8087")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    wid = args.workshop
    if not wid:
        ws = requests.get(f"{base}/api/workshops").json()
        if not ws:
            print("Khong co workshop nao. Chay seed truoc.")
            sys.exit(1)
        wid = ws[0]["id"]
        print(f"workshop: {ws[0]['name']} ({wid})")

    with open(args.image, "rb") as fh:
        files = {"file": (args.image, fh, "image/jpeg")}
        data = {"workshop_id": wid}
        r = requests.post(f"{base}/api/checkin/recognize", files=files, data=data)
    r.raise_for_status()
    res = r.json()

    print("-" * 40)
    print(f"decision   : {res['decision']}")
    print(f"message    : {res['message']}")
    if res.get("similarity") is not None:
        print(f"similarity : {res['similarity']:.4f}")
    if res.get("quality_score") is not None:
        print(f"quality    : {res['quality_score']:.4f}")
    if res.get("guest"):
        g = res["guest"]
        print(f"guest      : {g['full_name']} | {g.get('company')} | {g['checkin_status']}")
    print("-" * 40)


if __name__ == "__main__":
    main()

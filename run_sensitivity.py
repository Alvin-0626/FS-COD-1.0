# -*- coding: utf-8 -*-
"""
敏感性分析：在阶段验证 20 张（预声明抽样）上，对 bs / tau_mad / k_max 做单参数扫描。
每组仅变动一个参数，其余为冻结值。结果写入 results/sensitivity.csv。
"""
import os, sys, time, argparse
import numpy as np
import pandas as pd
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import FS_COD, metrics, baselines
from run_benchmark import DATA, load_gt, stage20_selection

RESULTS = "/mnt/agents/output/FS_COD_交付/results"

VARIANTS = []
for bs in [2, 3, 4]:
    VARIANTS.append((f"bs={bs}", dict(bs=bs)))
for tm in [1.0, 1.35, 1.7]:
    VARIANTS.append((f"tau_mad={tm}", dict(tau_mad=tm)))
for km in [2, 3]:
    VARIANTS.append((f"k_max={km}", dict(k_max=km)))


def one(task):
    stem, vname, kw = task
    img = __import__("skimage.io", fromlist=["io"]).imread(f"{DATA}/images/val/{stem}.jpg")
    cfg = FS_COD.Config(**kw)
    r = FS_COD.fscod_segment(img, cfg)
    sup = metrics.supervised_metrics(r["labels"], load_gt(stem, "val"))
    return dict(image=stem, variant=vname, **sup)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()
    stems = stage20_selection()
    out = f"{RESULTS}/sensitivity_per_image.csv"
    done = set()
    if os.path.exists(out):
        old = pd.read_csv(out)
        done = set(zip(old.image.astype(str), old.variant))
    tasks = [(s, vn, kw) for s in stems for vn, kw in VARIANTS if (s, vn) not in done]
    print(f"pending: {len(tasks)}", flush=True)
    with Pool(args.workers) as pool:
        for row in pool.imap_unordered(one, tasks, chunksize=1):
            pd.DataFrame([row]).to_csv(out, mode="a", header=not os.path.exists(out), index=False)
    df = pd.read_csv(out)
    agg = df.groupby("variant")[["BF", "PRI", "VOI", "COV", "BDE", "ARI"]].mean().round(4)
    agg.to_csv(f"{RESULTS}/sensitivity.csv")
    print(agg.to_string())
    print("SENSITIVITY_DONE", flush=True)


if __name__ == "__main__":
    main()

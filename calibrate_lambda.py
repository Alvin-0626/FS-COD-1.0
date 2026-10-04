# -*- coding: utf-8 -*-
"""λ 训练集标定：BSD500-train 分层抽样 30 张，λ∈{0.5,1,2,4}，按监督指标综合名次选 λ。
标定仅使用 train 划分；选定后全数据集冻结。"""
import sys, os, time, json
import numpy as np
import pandas as pd
from skimage import io
from scipy.io import loadmat

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import FS_COD, metrics

DATA = "/mnt/agents/output/FS_COD_交付/data/BSR/BSDS500/data"
OUT = "/mnt/agents/output/FS_COD_交付/results"
os.makedirs(OUT, exist_ok=True)

def load_gt(path):
    gt = loadmat(path)
    return [gt["groundTruth"][0, i][0][0][0] for i in range(gt["groundTruth"].shape[1])]

# 分层抽样：按 GT 平均区域数排序后等距抽取 30 张（兼顾对象尺度与边界复杂度）
files = sorted(f for f in os.listdir(f"{DATA}/images/train") if f.endswith(".jpg"))
stats = []
for f in files:
    gts = load_gt(f"{DATA}/groundTruth/train/{f[:-4]}.mat")
    stats.append((f, np.mean([len(np.unique(g)) for g in gts])))
stats.sort(key=lambda x: x[1])
sel = [stats[i][0] for i in np.linspace(0, len(stats)-1, 30).astype(int)]
print("calibration images:", sel, flush=True)

rows = []
for lam in [0.2, 0.35]:
    for f in sel:
        img = io.imread(f"{DATA}/images/train/{f}")
        gts = load_gt(f"{DATA}/groundTruth/train/{f[:-4]}.mat")
        cfg = FS_COD.Config(lam=lam)
        t0 = time.time()
        r = FS_COD.fscod_segment(img, cfg)
        m = metrics.supervised_metrics(r["labels"], gts)
        m.update(image=f, lam=lam, runtime=time.time()-t0, nreg=r["log"]["n_regions"])
        rows.append(m)
        print(f"lam={lam} {f} K={m['nreg']} BF={m['BF']:.3f} PRI={m['PRI']:.3f} "
              f"VOI={m['VOI']:.3f} COV={m['COV']:.3f} t={m['runtime']:.1f}s", flush=True)

df = pd.DataFrame(rows)
df.to_csv(f"{OUT}/lambda_calibration_ext.csv", index=False)
# 综合名次：BF/PRI/COV/ARI 越高越好，VOI/BDE 越低越好
summ = df.groupby("lam")[["BF","PRI","VOI","COV","BDE","ARI","runtime","nreg"]].mean()
print(summ.round(4), flush=True)
ranks = pd.DataFrame({
    "BF": summ["BF"].rank(ascending=False), "PRI": summ["PRI"].rank(ascending=False),
    "COV": summ["COV"].rank(ascending=False), "ARI": summ["ARI"].rank(ascending=False),
    "VOI": summ["VOI"].rank(ascending=True), "BDE": summ["BDE"].rank(ascending=True)})
print("mean rank:", ranks.mean(axis=1).round(3).to_dict(), flush=True)
print("CALIBRATION_DONE", flush=True)

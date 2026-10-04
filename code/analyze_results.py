# -*- coding: utf-8 -*-
"""
结果汇总与统计分析：
  - 逐方法×逐划分均值/标准差/中位数
  - 逐图像胜率（预先声明的综合判定规则）
  - Wilcoxon 符号秩检验（FS-COD vs 各基线，逐指标）
  - 失败案例分析（FS-COD 综合得分最低的图片）

综合判定规则（预注册，先于查看结果声明）：
  对图像 i、方法 m、基线 b：在 6 个监督指标上比较（BF/PRI/COV/ARI 越高越好，
  VOI/BDE 越低越好），相对差 <2% 判平；win = 胜场数 − 负场数。
  m 在图像 i 上综合优于 b ⟺ win(i,m,b) ≥ 1。
  数据集层面：m 综合优于 b ⟺ 优于 b 的图像占比 > 50%。
"""
import sys, os
import numpy as np
import pandas as pd
from scipy import stats

BASE = "/mnt/agents/output/FS_COD_交付"
RESULTS = f"{BASE}/results"

SUP_UP = ["BF", "PRI", "COV", "ARI"]
SUP_DOWN = ["VOI", "BDE"]
SUP = SUP_UP + SUP_DOWN
UNS_UP = ["InterCon", "GradSup", "Compact"]
UNS_DOWN = ["IntraSSE"]
UNS = UNS_UP + UNS_DOWN + ["SizeEnt", "NReg"]


def win_score(df_img):
    """df_img: 同一图像上全部方法的行。返回 {(method, baseline): win} 列表。"""
    out = {}
    ours = df_img[df_img.method == "FS-COD"]
    if not len(ours):
        return out
    o = ours.iloc[0]
    for _, b in df_img[df_img.method != "FS-COD"].iterrows():
        w = 0
        for m in SUP_UP:
            d = o[m] - b[m]
            w += 1 if d > 0.02 * max(abs(b[m]), 1e-9) else (-1 if d < -0.02 * max(abs(b[m]), 1e-9) else 0)
        for m in SUP_DOWN:
            d = b[m] - o[m]
            w += 1 if d > 0.02 * max(abs(b[m]), 1e-9) else (-1 if d < -0.02 * max(abs(b[m]), 1e-9) else 0)
        out[b["method"]] = w
    return out


def main():
    df = pd.read_csv(f"{RESULTS}/benchmark_results.csv")
    df["image"] = df["image"].astype(str)
    df = df[df.get("error").isna()] if "error" in df.columns else df
    df = df.dropna(subset=["BF"])

    # 1. 汇总表（扁平化列：metric_mean / metric_std，便于下游读取）
    agg = df.groupby(["split", "method"])[SUP + UNS + ["runtime"]].agg(["mean", "std"])
    flat = agg.copy()
    flat.columns = [f"{m}_{s}" for m, s in agg.columns]
    flat = flat.reset_index().round(4)
    flat.to_csv(f"{RESULTS}/summary_by_split.csv", index=False)
    agg.round(4).to_csv(f"{RESULTS}/summary_by_split_2level.csv")
    print(agg.round(4).xs("mean", axis=1, level=1))

    # 2. 逐图胜率（test 划分为主）
    for split in ["test", "val", "train"]:
        sub = df[df.split == split]
        if not len(sub):
            continue
        sub = sub[~sub.method.str.startswith("FS-COD-")]  # 胜率/检验只针对 5 个经典基线
        wins = {}
        for img, g in sub.groupby("image"):
            for b, w in win_score(g).items():
                wins.setdefault(b, []).append(w)
        rows = []
        for b, ws in wins.items():
            ws = np.array(ws)
            rows.append(dict(split=split, baseline=b,
                             win_rate=float((ws >= 1).mean()),
                             lose_rate=float((ws <= -1).mean()),
                             tie_rate=float((ws == 0).mean()),
                             mean_win=float(ws.mean()), n=len(ws)))
        wr = pd.DataFrame(rows)
        print(f"\n=== 逐图综合胜率 ({split}) ===")
        print(wr.round(3))
        wr.to_csv(f"{RESULTS}/winrate_{split}.csv", index=False)

        # 3. Wilcoxon
        rows = []
        wide = sub.pivot_table(index="image", columns="method", values=SUP)
        for m in SUP:
            for b in [x for x in sub.method.unique() if x != "FS-COD"]:
                x = wide[(m, "FS-COD")].dropna()
                y = wide[(m, b)].dropna()
                idx = x.index.intersection(y.index)
                x, y = x.loc[idx], y.loc[idx]
                if len(idx) < 10 or (x - y).abs().sum() == 0:
                    continue
                s, p = stats.wilcoxon(x, y)
                rows.append(dict(split=split, metric=m, baseline=b,
                                 ours=float(x.mean()), theirs=float(y.mean()),
                                 stat=float(s), p=float(p), n=len(idx)))
        wl = pd.DataFrame(rows)
        wl.to_csv(f"{RESULTS}/wilcoxon_{split}.csv", index=False)
        print(wl.round(4))
    print("ANALYSIS_DONE")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""失败案例分析：测试集逐图综合净胜场最低的 5 张，输出 CSV 与边界叠加面板。"""
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_results import win_score

RESULTS = "/mnt/agents/output/FS_COD_交付/results"


def main():
    df = pd.read_csv(f"{RESULTS}/benchmark_results.csv")
    df["image"] = df["image"].astype(str)
    df = df[df.split == "test"].dropna(subset=["BF"])
    rows = []
    for img, g in df.groupby("image"):
        ws = win_score(g)
        if not ws:
            continue
        ours = g[g.method == "FS-COD"].iloc[0]
        rows.append(dict(image=img, net_win=sum(ws.values()) / len(ws),
                         min_win=min(ws.values()),
                         BF=ours.BF, PRI=ours.PRI, VOI=ours.VOI, COV=ours.COV,
                         BDE=ours.BDE, ARI=ours.ARI, NReg=ours.NReg))
    out = pd.DataFrame(rows).sort_values("net_win")
    out.to_csv(f"{RESULTS}/failure_scores_all.csv", index=False)
    worst = out.head(5)
    worst.to_csv(f"{RESULTS}/failure_cases.csv", index=False)
    print(worst.to_string())

    # 失败案例面板图
    import figures
    figures.compare_panel(list(worst.image), "test",
                          methods=("FS-COD", "Watershed"), name="fig_failure")


if __name__ == "__main__":
    main()

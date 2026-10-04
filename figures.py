# -*- coding: utf-8 -*-
"""科研绘图：流程图、对比图、指标图，TIFF 300dpi 输出。
配色：学术蓝橙绿红灰体系（上传配色参考图缺失时采用的默认学术方案）。"""
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

BLUE, ORANGE, GREEN, RED, GRAY, PURPLE = "#1f4e79", "#e8862e", "#4a8f5c", "#c0392b", "#666666", "#7d5ba6"
METHOD_COLORS = {"FS-COD": RED, "SLIC": BLUE, "Felzenszwalb": ORANGE,
                 "Quickshift": GREEN, "Watershed": PURPLE, "MeanShift": GRAY}
FIG = "/mnt/agents/output/FS_COD_交付/figures"
os.makedirs(FIG, exist_ok=True)


def save(fig, name):
    fig.savefig(f"{FIG}/{name}.tiff", dpi=300, bbox_inches="tight", format="tiff")
    fig.savefig(f"{FIG}/{name}.png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    print("saved", name)


def flowchart():
    """算法流程图：析-合闭环。"""
    fig, ax = plt.subplots(figsize=(9.2, 5.6))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6.2); ax.axis("off")

    def box(x, y, w, h, text, fc="#eef3f9", ec=BLUE, fs=9.5, tc="black"):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.06",
                                    fc=fc, ec=ec, lw=1.4))
        ax.text(x + w/2, y + h/2, text, ha="center", va="center", fontsize=fs, color=tc)

    def arrow(x1, y1, x2, y2, text="", color=GRAY, style="-|>"):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style,
                                     mutation_scale=13, lw=1.3, color=color))
        if text:
            ax.text((x1+x2)/2, (y1+y2)/2 + 0.16, text, fontsize=8.2, color=color,
                    ha="center")

    box(0.3, 4.9, 1.7, 0.9, "输入图像 I\n像素论域 Ω", fc="#f4f6f8")
    box(2.5, 4.9, 2.0, 0.9, "论域原子化\nb×b 原子\n(定义3.1)")
    box(5.0, 4.9, 2.0, 0.9, "因素池构造\n对象/位置/边界支持\n(3.2节)")
    box(7.5, 4.9, 2.1, 0.9, "局部相态化\nmulti-Otsu k∈{2,3}\n(定义3.3)")

    box(1.0, 3.0, 2.4, 1.0, "分析算子（析）\n区域内最优因素切分\nΔE_split>0（式3-2）", fc="#fdeee0", ec=ORANGE)
    box(4.0, 3.0, 2.2, 1.0, "能量泛函\nE(Π)=ΣD(R)+λ·B(Π)\n（式3-3）")
    box(7.0, 3.0, 2.4, 1.0, "合成算子（合）\n堆式聚合 gain>0\n凭证禁越（式3-4/3-5）", fc="#e8f3ea", ec=GREEN)

    box(2.6, 1.0, 2.2, 0.9, "析—合平衡\n闭环终止（算法3.2）")
    box(5.4, 1.0, 2.0, 0.9, "边界判定\nSTABLE/主导因素\n(3.6节)")
    box(7.9, 1.0, 1.9, 0.9, "语义规则\n区域/界面/Concept\n(3.6节)")

    arrow(2.0, 5.35, 2.5, 5.35); arrow(4.5, 5.35, 5.0, 5.35)
    arrow(7.0, 5.35, 7.5, 5.35)
    arrow(8.55, 4.9, 3.4, 4.0, "", GRAY)
    arrow(3.4, 3.5, 4.0, 3.5)
    arrow(6.2, 3.5, 7.0, 3.5, "存在可并区域")
    arrow(5.1, 3.0, 4.3, 1.9, "无正增益析取", BLUE)
    arrow(8.2, 3.0, 5.6, 1.9, "合运算不动点", GREEN)
    arrow(4.8, 1.45, 5.4, 1.45); arrow(7.4, 1.45, 7.9, 1.45)
    # 闭环回路
    ax.add_patch(FancyArrowPatch((8.2, 4.0), (8.2, 4.9), arrowstyle="-|>",
                                 mutation_scale=13, lw=1.3, color=GREEN))
    ax.text(8.5, 4.45, "平衡破坏\n再析取", fontsize=8.2, color=GREEN)
    save(fig, "fig_flowchart")


def factor_space_diagram():
    """泛因素空间四元组结构示意图。"""
    fig, ax = plt.subplots(figsize=(8.6, 5.2))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6); ax.axis("off")
    boxes = [
        (0.4, 3.4, 2.6, 1.9, "论域 U\n图像原子集合\n（本体对象集）", "#eef3f9", BLUE),
        (3.8, 3.4, 2.6, 1.9, "因素空间 F\n有界格 (F;∧,∨,o,e)\n视觉/位置/计算因素池", "#fdeee0", ORANGE),
        (7.2, 3.4, 2.6, 1.9, "数据空间 X\n相空间笛卡儿积\n格坐标（相态签名）", "#f3eefa", PURPLE),
        (3.8, 0.5, 2.6, 1.6, "外延空间 P(U)\n区域·对象·边界", "#e8f3ea", GREEN),
    ]
    for x, y, w, h, t, fc, ec in boxes:
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.07",
                                    fc=fc, ec=ec, lw=1.5))
        ax.text(x+w/2, y+h/2, t, ha="center", va="center", fontsize=10)
    def arr(p1, p2, t, dy=0.12):
        ax.add_patch(FancyArrowPatch(p1, p2, arrowstyle="<|-|>", mutation_scale=14,
                                     lw=1.4, color=GRAY))
        ax.text((p1[0]+p2[0])/2, (p1[1]+p2[1])/2+dy, t, fontsize=8.6, ha="center", color=GRAY)
    arr((3.0, 4.7), (3.8, 4.7), "因素 f:U→I_f（满射）")
    arr((6.4, 4.7), (7.2, 4.7), "相态取值")
    arr((5.1, 3.4), (5.1, 2.1), "回溯 f̃：相态→外延")
    ax.text(5.0, 5.75, "泛因素空间 (U, F, X, P(U))（母版定义2.12）",
            fontsize=12, ha="center", weight="bold", color=BLUE)
    save(fig, "fig_factor_space")


def metric_bars(csv, split="test", metrics_show=("BF","PRI","VOI","COV")):
    df = pd.read_csv(csv)
    df = df[(df.split == split)].dropna(subset=["BF"])
    g = df.groupby("method")[list(metrics_show)].agg(["mean", "std"])
    fig, axes = plt.subplots(1, len(metrics_show), figsize=(3.2*len(metrics_show), 3.4))
    order = ["FS-COD", "SLIC", "Felzenszwalb", "Quickshift", "Watershed", "MeanShift"]
    order = [m for m in order if m in g.index]
    for ax, m in zip(axes, metrics_show):
        mu = g[(m, "mean")][order]; sd = g[(m, "std")][order]
        ax.bar(range(len(order)), mu, yerr=sd, capsize=3,
               color=[METHOD_COLORS[o] for o in order], alpha=0.88)
        ax.set_xticks(range(len(order)))
        ax.set_xticklabels(order, rotation=38, ha="right", fontsize=8)
        ax.set_title(m, fontsize=11)
        ax.grid(axis="y", alpha=0.3)
    fig.suptitle(f"BSD500-{split} 监督指标对比（均值±标准差）", fontsize=12)
    save(fig, f"fig_metric_bars")


def lambda_curve():
    """λ 标定曲线：复合平均秩 vs λ（训练集 30 张）。"""
    df = pd.read_csv("/mnt/agents/output/FS_COD_交付/results/lambda_calibration_summary.csv")
    df = df.sort_values("lam")
    rk = "composite_rank"
    fig, ax = plt.subplots(figsize=(5.6, 3.6))
    ax.plot(df.lam, df[rk], "o-", color=BLUE, lw=1.8, ms=6)
    best = df.loc[df[rk].idxmin()]
    ax.scatter([best.lam], [best[rk]], s=130, facecolor="none", edgecolor=RED, lw=2,
               label=f"冻结值 λ={best.lam}")
    ax.set_xscale("log"); ax.set_xticks(df.lam); ax.set_xticklabels(df.lam)
    ax.minorticks_off()
    ax.set_xlabel("析—合平衡系数 λ"); ax.set_ylabel("复合平均秩（6 项监督指标）")
    ax.legend(); ax.grid(alpha=0.3)
    save(fig, "fig_lambda")


def winrate_chart(csv_pattern_prefix="winrate"):
    import glob
    frames = []
    for sp in ["test", "val"]:
        p = f"/mnt/agents/output/FS_COD_交付/results/{csv_pattern_prefix}_{sp}.csv"
        if os.path.exists(p):
            d = pd.read_csv(p); d["split"] = sp; frames.append(d)
    if not frames:
        return
    df = pd.concat(frames)
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    x = np.arange(len(df.baseline.unique()))
    w = 0.35
    for i, sp in enumerate(df.split.unique()):
        d = df[df.split == sp].set_index("baseline").loc[df.baseline.unique()]
        ax.bar(x + i*w - w/2, d.win_rate, w, label=sp, color=[BLUE, ORANGE][i % 2])
    ax.axhline(0.5, ls="--", color=RED, lw=1.2, label="预注册判定线 50%")
    ax.set_xticks(x); ax.set_xticklabels(df.baseline.unique(), rotation=20)
    ax.set_ylabel("FS-COD 逐图综合胜率")
    ax.set_ylim(0, 1)
    ax.legend(); ax.grid(axis="y", alpha=0.3)
    save(fig, "fig_winrate")


def compare_panel(stems, split, methods=("FS-COD","SLIC","Felzenszwalb","Watershed"),
                  name="fig_compare_panel"):
    """逐图对比面板：输入 | GT边界 | 各方法边界叠加。"""
    import sys
    sys.path.insert(0, "/mnt/agents/output/FS_COD_交付/code")
    from skimage import io
    from scipy.io import loadmat
    import metrics, baselines, FS_COD
    DATA = "/mnt/agents/output/FS_COD_交付/data/BSR/BSDS500/data"
    ncol = 2 + len(methods)
    fig, axes = plt.subplots(len(stems), ncol, figsize=(2.4*ncol, 2.4*len(stems)))
    if len(stems) == 1:
        axes = axes[None, :]
    for r, stem in enumerate(stems):
        img = io.imread(f"{DATA}/images/{split}/{stem}.jpg")
        gt = loadmat(f"{DATA}/groundTruth/{split}/{stem}.mat")
        g0 = gt["groundTruth"][0, 0][0][0][0]
        outs = {}
        for m in methods:
            if m == "FS-COD":
                npz = f"/mnt/agents/output/FS_COD_交付/results/fscod_artifacts/{split}/{stem}.npz"
                if os.path.exists(npz):
                    lab = np.load(npz)["labels"]
                else:
                    lab = FS_COD.fscod_segment(img, FS_COD.Config())["labels"]
            else:
                lab = baselines.BASELINES[m](img)
            outs[m] = lab
        def overlay(ax_, lab_, title):
            b = metrics.boundary_map(lab_)
            im = img.copy()
            im[b] = [220, 30, 30]
            ax_.imshow(im); ax_.set_title(title, fontsize=8); ax_.axis("off")
        axes[r, 0].imshow(img); axes[r, 0].set_title(f"输入 {stem}", fontsize=8); axes[r, 0].axis("off")
        overlay(axes[r, 1], g0, f"人工标注#1（{len(np.unique(g0))}区域）")
        for c, m in enumerate(methods):
            overlay(axes[r, 2+c], outs[m], f"{m}（{outs[m].max()+1}区域）")
    plt.tight_layout()
    save(fig, name)


if __name__ == "__main__":
    flowchart()
    factor_space_diagram()

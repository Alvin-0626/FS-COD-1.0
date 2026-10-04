#!/usr/bin/env python3
"""依据已冻结的分割结果（npz 像素级标签）重新生成语义规则文本。

背景：边界规则的界面两端编号原使用内部标签 id，与区域规则的面积名次编号
不一致（纯文本呈现层问题，不影响任何分割结果与指标）。本脚本重建语义生成
所需的中间结构（因素图、原子聚合、邻接），读回 npz 中冻结的标签场，仅
重写各图像的 *_rules.txt；npz 与 *_log.json 不变。

用法：python3 regen_rules.py [--workers 2]
"""
import argparse
import os
import sys
from multiprocessing import Pool

import numpy as np
from skimage import io

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import FS_COD

BASE = "/mnt/agents/output/FS_COD_交付"
DATA = os.path.join(BASE, "data/BSR/BSDS500/data/images")
ART = os.path.join(BASE, "results/fscod_artifacts")


def regen_one(task):
    split, stem = task
    img = io.imread(os.path.join(DATA, split, stem + ".jpg"))
    npz = np.load(os.path.join(ART, split, stem + ".npz"))
    pix_labels = npz["labels"]
    H, W = img.shape[:2]
    cfg = FS_COD.Config()

    obj, bnd, pos, gray_s = FS_COD.compute_factor_maps(img, cfg)
    atom_labels, n_atoms = FS_COD.build_atoms((H, W), cfg.bs)
    atom_vals, scales, area = {}, {}, None
    for f, fm in obj.items():
        v, area = FS_COD.aggregate_to_atoms(fm, atom_labels, n_atoms)
        s = FS_COD.robust_scale(v)
        scales[f] = s
        atom_vals[f] = v / s
    obj_names = [f for f in obj if FS_COD.robust_scale(atom_vals[f]) > 1e-9 and scales[f] > 1e-9]
    for f in list(atom_vals):
        if f not in obj_names:
            del atom_vals[f]
    weights = {f: 1.0 / max(len(obj_names), 1) for f in obj_names}
    pos_atom = {}
    for f, fm in pos.items():
        v, _ = FS_COD.aggregate_to_atoms(fm, atom_labels, n_atoms)
        pos_atom[f] = v

    est = FS_COD.EnergyState(atom_vals, obj_names, weights, area, atom_labels, cfg.bs, cfg.lam)
    pairs, plen = FS_COD.atom_adjacency(atom_labels, n_atoms, cfg.bs)

    # 像素级标签 → 原子级标签（pix_labels = labels[atom_labels]，取每原子首元素）
    _, first_idx = np.unique(atom_labels.ravel(), return_index=True)
    labels_atom = pix_labels.ravel()[first_idx].astype(np.int64)

    rules, info = FS_COD.boundary_and_semantics(
        est, labels_atom, pairs, plen, pos_atom, cfg, atom_labels, (H, W))
    with open(os.path.join(ART, split, stem + "_rules.txt"), "w", encoding="utf-8") as fp:
        fp.write("\n".join(rules) + "\n")
    return f"{split}/{stem}: {len(rules)} rules"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()
    tasks = []
    for split in ["train", "val", "test"]:
        d = os.path.join(ART, split)
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".npz"):
                tasks.append((split, fn[:-4]))
    print(f"regenerating rules for {len(tasks)} images")
    with Pool(args.workers) as pool:
        for i, msg in enumerate(pool.imap_unordered(regen_one, tasks)):
            if (i + 1) % 50 == 0:
                print(f"[{i+1}/{len(tasks)}] {msg}")
    print("done")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
BSD500 统一基准运行器
=====================
统一输入（原始分辨率）、统一评价协议、全部结果自动落盘（CSV 追加 + 断点续跑）。

用法：
  python3 run_benchmark.py --split stage20            # 阶段验证（val 分层 20 张）
  python3 run_benchmark.py --split val|test|train|all # 指定/全部划分
  python3 run_benchmark.py --split all --methods FS-COD SLIC ...
"""
import sys, os, time, json, argparse, traceback
import numpy as np
import pandas as pd
from skimage import io
from scipy.io import loadmat
from multiprocessing import Pool

BASE = "/mnt/agents/output/FS_COD_交付"
DATA = f"{BASE}/data/BSR/BSDS500/data"
RESULTS = f"{BASE}/results"
CODE = f"{BASE}/code"
sys.path.insert(0, CODE)
import FS_COD, metrics, baselines

METHODS = ["FS-COD", "SLIC", "Felzenszwalb", "Quickshift", "Watershed", "MeanShift"]
ABLATIONS = {
    "FS-COD-NoComp": dict(ablate_no_composition=True),
    "FS-COD-NoTex": dict(use_texture=False),
    "FS-COD-NoSel": dict(ablate_no_local_selection=True),
}


def load_gt(stem, split):
    gt = loadmat(f"{DATA}/groundTruth/{split}/{stem}.mat")
    return [gt["groundTruth"][0, i][0][0][0] for i in range(gt["groundTruth"].shape[1])]


def stage20_selection():
    """阶段验证样本：val 划分按 (GT平均区域数, 边界密度) 分层抽样 20 张。
    方法事先声明：两指标各取四分位构成 4x4 网格，每格取最接近格中心的 1 张，
    再按区域数等距补足 4 张；固定种子，避免择优。"""
    rng = np.random.default_rng(20260927)
    files = sorted(f[:-4] for f in os.listdir(f"{DATA}/images/val") if f.endswith(".jpg"))
    rows = []
    for s in files:
        gts = load_gt(s, "val")
        nreg = np.mean([len(np.unique(g)) for g in gts])
        bd = np.mean([metrics.boundary_map(g).mean() for g in gts])
        rows.append((s, nreg, bd))
    df = pd.DataFrame(rows, columns=["stem", "nreg", "bd"])
    df["q1"] = pd.qcut(df["nreg"], 4, labels=False)
    df["q2"] = pd.qcut(df["bd"], 4, labels=False)
    sel = []
    for q1 in range(4):
        for q2 in range(4):
            cell = df[(df.q1 == q1) & (df.q2 == q2)]
            if len(cell):
                c1 = (df[df.q1 == q1].nreg.median())
                c2 = (df[df.q2 == q2].bd.median())
                d = (cell.nreg - c1).abs() + (cell.bd - c2).abs() * 100
                sel.append(cell.loc[d.idxmin(), "stem"])
    rest = [s for s in df.sort_values("nreg").stem if s not in sel]
    for i in np.linspace(0, len(rest) - 1, 20 - len(sel)).astype(int):
        sel.append(rest[i])
    return sorted(sel[:20])


def process_one(task):
    split, stem, method = task
    try:
        img = io.imread(f"{DATA}/images/{split}/{stem}.jpg")
        t0 = time.time()
        if method == "FS-COD" or method in ABLATIONS:
            kw = ABLATIONS.get(method, {})
            r = FS_COD.fscod_segment(img, FS_COD.Config(**kw))
            lab = r["labels"]
            extra = dict(runtime_alg=r["log"]["runtime"],
                         n_stable=r["log"].get("n_stable", -1),
                         n_concept=r["log"].get("n_concept", -1))
            # 保存 FS-COD  artifacts（仅主方法；消融变体不覆盖）
            adir = f"{RESULTS}/fscod_artifacts/{split}" if method == "FS-COD" else None
            if adir is not None:
                os.makedirs(adir, exist_ok=True)
                np.savez_compressed(f"{adir}/{stem}.npz",
                                    labels=r["labels"].astype(np.int16),
                                    boundary=r["boundary"])
                with open(f"{adir}/{stem}_rules.txt", "w", encoding="utf-8") as fp:
                    fp.write("\n".join(r["rules"]))
                with open(f"{adir}/{stem}_log.json", "w", encoding="utf-8") as fp:
                    json.dump({k: v for k, v in r["log"].items()
                               if isinstance(v, (int, float, str, list))}, fp,
                              ensure_ascii=False, default=str)
        else:
            lab = baselines.BASELINES[method](img)
            extra = {}
        alg_t = time.time() - t0
        gts = load_gt(stem, split)
        sup = metrics.supervised_metrics(lab, gts)
        uns = metrics.unsupervised_metrics(img, lab)
        row = dict(split=split, image=stem, method=method,
                   runtime=extra.pop("runtime_alg", alg_t), **extra, **sup, **uns)
        return row
    except Exception as e:
        return dict(split=split, image=stem, method=method, error=f"{type(e).__name__}: {e}",
                    trace=traceback.format_exc()[-500:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="stage20")
    ap.add_argument("--methods", nargs="*", default=METHODS)
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()

    os.makedirs(RESULTS, exist_ok=True)
    csv_path = f"{RESULTS}/benchmark_results.csv"
    FIELDS = ["split", "image", "method", "runtime", "n_stable", "n_concept",
              "BF", "PRI", "VOI", "COV", "BDE", "ARI",
              "IntraSSE", "InterCon", "GradSup", "Compact", "SizeEnt", "NReg"]
    done = set()
    if os.path.exists(csv_path):
        old = pd.read_csv(csv_path)
        done = set(zip(old.split, old.image.astype(str), old.method))

    if args.split == "stage20":
        tasks_imgs = [("val", s) for s in stage20_selection()]
    elif args.split == "all":
        tasks_imgs = [(sp, s) for sp in ["train", "val", "test"]
                      for s in sorted(f[:-4] for f in os.listdir(f"{DATA}/images/{sp}") if f.endswith(".jpg"))]
    else:
        tasks_imgs = [(args.split, s) for s in
                      sorted(f[:-4] for f in os.listdir(f"{DATA}/images/{args.split}") if f.endswith(".jpg"))]

    tasks = [(sp, s, m) for sp, s in tasks_imgs for m in args.methods
             if (sp, s, m) not in done]
    print(f"pending tasks: {len(tasks)}", flush=True)

    with Pool(args.workers) as pool:
        for i, row in enumerate(pool.imap_unordered(process_one, tasks, chunksize=1)):
            row = {k: row.get(k, "") for k in FIELDS}
            pd.DataFrame([row], columns=FIELDS).to_csv(csv_path, mode="a",
                                       header=not os.path.exists(csv_path), index=False)
            if i % 20 == 0:
                print(f"[{i+1}/{len(tasks)}] {row.get('split')}/{row.get('image')}/{row.get('method')}",
                      flush=True)
    print("BENCHMARK_DONE", flush=True)


if __name__ == "__main__":
    main()

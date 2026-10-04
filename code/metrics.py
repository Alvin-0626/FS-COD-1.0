# -*- coding: utf-8 -*-
"""
BSDS500 分割评价指标：监督指标 6 个 + 非监督指标 6 个。
监督指标逐标注者计算后取算术平均（多标注者协议，预先声明）。

监督指标（真值 G）：
  BF   边界 F 值，容差 2px（圆盘膨胀），P/R/F 逐标注者平均
  PRI  概率 Rand 指数（Unnikrishnan et al., 2007）
  VOI  信息变异（Meila, 2003）
  COV  分割覆盖度（Arbeláez et al., 2011；机器区域对人工区域的覆盖）
  BDE  边界位移误差（Freixenet et al., 2002；双向对称化）
  ARI  调整 Rand 指数（Hubert & Arabie, 1985）

非监督指标：
  IntraSSE   Lab 类内加权平方误差/像素（区域一致性，↓）
  InterCon   界面两侧 Lab 对比度与全图相邻对比度之比（区域间差异，↑）
  GradSup    预测边界上的平均归一化梯度（边界连续性代理，↑）
  Compact    平均紧致度 4πA/P²（结构完整性，↑）
  SizeEnt    区域尺度分布熵（划分均衡性）
  NReg       区域数（结构复杂度，报告值）
"""
import numpy as np
from scipy import ndimage as ndi
from skimage import color, filters


# ---------------- 基础工具 ----------------

def contingency(pred, gt):
    """列联表 n_ij。pred/gt 为任意整数标签图。"""
    p = pred.ravel().astype(np.int64)
    g = gt.ravel().astype(np.int64)
    _, p = np.unique(p, return_inverse=True)
    _, g = np.unique(g, return_inverse=True)
    np_, ng = p.max() + 1, g.max() + 1
    cm = np.bincount(p * ng + g, minlength=np_ * ng).reshape(np_, ng).astype(np.float64)
    return cm


def boundary_map(labels):
    """区域边界像素（任一 4 邻居标签不同）。"""
    b = np.zeros(labels.shape, dtype=bool)
    d = labels[:-1, :] != labels[1:, :]
    b[:-1, :] |= d; b[1:, :] |= d
    d = labels[:, :-1] != labels[:, 1:]
    b[:, :-1] |= d; b[:, 1:] |= d
    return b


def _pri(cm):
    n = cm.sum()
    T = n * (n - 1) / 2.0
    ss = (cm * (cm - 1) / 2.0).sum()
    sp = (cm.sum(1) * (cm.sum(1) - 1) / 2.0).sum()
    sg = (cm.sum(0) * (cm.sum(0) - 1) / 2.0).sum()
    dd = T - sp - sg + ss
    return (ss + dd) / max(T, 1e-12)


def _voi(cm):
    n = cm.sum()
    p = cm / max(n, 1e-12)
    pi = p.sum(1); pj = p.sum(0)
    def H(x):
        x = x[x > 0]
        return -(x * np.log2(x)).sum()
    I = 0.0
    nnz = p[p > 0]
    for i in range(p.shape[0]):
        row = p[i][p[i] > 0]
        I += (row * np.log2(row / (pi[i] * pj[p[i] > 0]))).sum()
    return H(pi) + H(pj) - 2 * I


def _covering(cm):
    """covering(P→G) = Σ_j |G_j|/N · max_i IoU(P_i, G_j)"""
    n = cm.sum()
    ri = cm.sum(1); rj = cm.sum(0)
    denom = ri[:, None] + rj[None, :] - cm
    with np.errstate(divide="ignore", invalid="ignore"):
        iou = np.where(denom > 0, cm / denom, 0.0)
    return float((rj / max(n, 1e-12) * iou.max(axis=0)).sum())


def _ari(cm):
    n = cm.sum()
    T = n * (n - 1) / 2.0
    ss = (cm * (cm - 1) / 2.0).sum()
    sp = (cm.sum(1) * (cm.sum(1) - 1) / 2.0).sum()
    sg = (cm.sum(0) * (cm.sum(0) - 1) / 2.0).sum()
    exp = sp * sg / max(T, 1e-12)
    denom = 0.5 * (sp + sg) - exp
    return (ss - exp) / denom if abs(denom) > 1e-12 else 0.0


def _bf(bp, bg, tol=2):
    """边界 F 值（容差 tol 像素）。"""
    if bp.sum() == 0 and bg.sum() == 0:
        return 1.0
    if bp.sum() == 0 or bg.sum() == 0:
        return 0.0
    struct = ndi.generate_binary_structure(2, 2)
    bg_d = bg
    bp_d = bp
    for _ in range(tol):
        bg_d = ndi.binary_dilation(bg_d, structure=struct)
        bp_d = ndi.binary_dilation(bp_d, structure=struct)
    P = (bp & bg_d).sum() / bp.sum()
    R = (bg & bp_d).sum() / bg.sum()
    return 0.0 if P + R == 0 else 2 * P * R / (P + R)


def _bde(bp, bg):
    """对称化边界位移误差（像素）。"""
    if bp.sum() == 0 or bg.sum() == 0:
        return np.nan
    dt_g = ndi.distance_transform_edt(~bg)
    dt_p = ndi.distance_transform_edt(~bp)
    return float((dt_g[bp].mean() + dt_p[bg].mean()) / 2.0)


# ---------------- 监督指标 ----------------

def supervised_metrics(pred, gt_list, tol=2):
    """对多标注者逐人计算后取平均。返回 dict。"""
    bp = boundary_map(pred)
    vals = {k: [] for k in ["BF", "PRI", "VOI", "COV", "BDE", "ARI"]}
    for gt in gt_list:
        cm = contingency(pred, gt)
        bg = boundary_map(gt)
        vals["BF"].append(_bf(bp, bg, tol))
        vals["PRI"].append(_pri(cm))
        vals["VOI"].append(_voi(cm))
        vals["COV"].append(_covering(cm))
        vals["BDE"].append(_bde(bp, bg))
        vals["ARI"].append(_ari(cm))
    return {k: float(np.nanmean(v)) for k, v in vals.items()}


# ---------------- 非监督指标 ----------------

def unsupervised_metrics(img, labels):
    if img.ndim == 2:
        img = np.stack([img] * 3, -1)
    lab = color.rgb2lab(img.astype(np.float64) / 255.0)
    H, W = labels.shape
    flat = labels.ravel()
    K = int(flat.max()) + 1
    n = flat.size
    # IntraSSE（Lab 类内加权平方误差/像素）
    sse = 0.0
    for c in range(3):
        v = lab[..., c].ravel()
        s = np.bincount(flat, weights=v, minlength=K)
        q = np.bincount(flat, weights=v * v, minlength=K)
        a = np.bincount(flat, minlength=K)
        sse += (q - s * s / np.maximum(a, 1)).sum()
    intra = float(sse / n)
    # InterCon：跨界相邻像素对 Lab 距离 / 全部相邻像素对均值
    dl = []
    for axis in (0, 1):
        pa = lab[tuple(slice(0, -1) if ax == axis else slice(None) for ax in range(2)) + (slice(None),)]
        pb = lab[tuple(slice(1, None) if ax == axis else slice(None) for ax in range(2)) + (slice(None),)]
        ka = labels[tuple(slice(0, -1) if ax == axis else slice(None) for ax in range(2))]
        kb = labels[tuple(slice(1, None) if ax == axis else slice(None) for ax in range(2))]
        dist = np.sqrt(((pa - pb) ** 2).sum(-1)).ravel()
        cross = (ka != kb).ravel()
        dl.append((dist, cross))
    dist_all = np.concatenate([d for d, _ in dl])
    cross_all = np.concatenate([c for _, c in dl])
    base = dist_all.mean()
    inter = float(dist_all[cross_all].mean() / max(base, 1e-12)) if cross_all.any() else np.nan
    # GradSup
    g = filters.sobel(color.rgb2gray(img.astype(np.float64) / 255.0))
    g = g / max(g.max(), 1e-12)
    bm = boundary_map(labels)
    grad = float(g[bm].mean()) if bm.any() else 0.0
    # Compactness：区域周长 = 与该区域相邻的跨界像素边数（4 邻域）
    a = np.bincount(flat, minlength=K).astype(np.float64)
    per = np.zeros(K)
    dv = labels[:-1, :] != labels[1:, :]
    np.add.at(per, labels[:-1, :][dv], 1); np.add.at(per, labels[1:, :][dv], 1)
    dh = labels[:, :-1] != labels[:, 1:]
    np.add.at(per, labels[:, :-1][dh], 1); np.add.at(per, labels[:, 1:][dh], 1)
    comp = float(np.clip(np.mean(4 * np.pi * a / np.maximum(per ** 2, 1.0)), 0, 1))
    # SizeEnt
    p = a / n
    p = p[p > 0]
    sent = float(-(p * np.log2(p)).sum())
    return dict(IntraSSE=intra, InterCon=inter, GradSup=grad,
                Compact=comp, SizeEnt=sent, NReg=float(K))

# -*- coding: utf-8 -*-
"""
FS-COD 1.0：泛因素空间驱动的图像对象与边界协同识别算法
=======================================================
理论母版：包研科《泛因素空间与数据科学应用》（北京邮电大学出版社，2021）

核心对应关系（理论 -> 代码）：
  母版定义2.1  因素 f:U->I_f（满射）          -> compute_factor_maps / discretize
  母版2.2节    析运算 U/(f∧g)=U/f∘U/g         -> analysis_phase（区域局部析取）
  母版2.2节    合运算 U/(f∨g)=U/f+U/g         -> composition_phase（能量下降合并）
  母版定义2.12 泛因素空间 (U,F,X,P(U))        -> 论域U(原子集)、因素池F、数据空间(因素值)、外延(区域)
  母版定义2.13 自为因素                      -> 对象因素/边界因素/位置因素分池
  母版定义3.12 商集关联度 φ                   -> quotient_correlation（因素冗余判定）
  母版2.1节    概括原理（析-合暂时平衡）       -> 能量泛函 E(Π)=ΣD(R)+λ·B(Π) 的不动点
  母版2.4节    有限因素标架与格坐标           -> 相态化签名 sig(u)

相对 PFA-QSM 3.1 的关键重构（依据其反思报告的问题1-6）：
  (i)  梯度 G 移出对象因素池，仅作边界支持（修复"对象/边界层次未解耦"）；
  (ii) 析取以(区域,因素)为单位的局部选择取代全局 SAME 证据固化（修复前端过分割）；
  (iii) 析与合统一由能量泛函驱动，平衡判据可计算（替代经验阈值组）；
  (iv) 唯一结构参数 λ 以相对量定义并在训练集标定，全部阈值数据自适应；
  (v) 位置因素池（连通性 f_conn、坐标 f_x/f_y）落实"同色异区"的对象分离与语义标注。
"""

from __future__ import annotations
import heapq
import time
from dataclasses import dataclass, field, asdict

import numpy as np
from scipy import ndimage as ndi
from skimage import color, filters
from skimage.filters import threshold_multiotsu


# ============================================================
# 配置（全部参数集中于此；唯一结构参数 lam 由训练集标定）
# ============================================================

@dataclass
class Config:
    seed: int = 20260927
    bs: int = 3                 # 原子块边长（像素）
    smooth_sigma: float = 0.8   # 因素图高斯平滑
    k_max: int = 3              # 相态数上限（有限因素标架；适度粒化）
    lam: float = 0.5            # 边界代价系数 λ0（相对量，训练集标定后固定）
    tau_mad: float = 1.35       # 鲁棒标度 MAD 系数
    min_child_atoms: int = 4    # 析取子区域最小原子数
    max_loop: int = 2           # 析-合闭环轮数上限（析→合→析→合）
    texture_win: int = 7        # 纹理因素窗口
    max_regions_semantic: int = 40   # 语义规则输出的区域数上限（按面积）
    use_position_split: bool = False # 位置因素是否主动切分（默认否，f_conn 已承担）
    use_texture: bool = True
    ablate_no_composition: bool = False  # 消融：关闭合运算（只析不合）
    ablate_no_local_selection: bool = False  # 消融：因素选择退化为固定全局顺序
    verbose: bool = False


# ============================================================
# 1. 论域构造与因素映射
# ============================================================

def build_atoms(shape, bs):
    """把像素域 Ω 划分为 bs×bs 原子（不足整块的部分并入相邻块）。
    返回 atom_labels（像素->原子标号，从0开始）与原子数 N。"""
    H, W = shape
    gh = (H + bs - 1) // bs
    gw = (W + bs - 1) // bs
    yy = np.minimum(np.arange(H) // bs, gh - 1)
    xx = np.minimum(np.arange(W) // bs, gw - 1)
    lab = (yy[:, None] * gw + xx[None, :]).astype(np.int32)
    return lab, gh * gw


def compute_factor_maps(img, cfg: Config):
    """因素映射 f:U->I_f 的像素级观测。
    返回 dict：对象因素（视觉+计算）、边界支持因素、位置因素。"""
    if img.ndim == 2:
        img = np.stack([img] * 3, axis=-1)
    img = img.astype(np.float64) / 255.0
    lab = color.rgb2lab(img)
    L = ndi.gaussian_filter(lab[..., 0], cfg.smooth_sigma)
    a = ndi.gaussian_filter(lab[..., 1], cfg.smooth_sigma)
    b = ndi.gaussian_filter(lab[..., 2], cfg.smooth_sigma)
    gray = color.rgb2gray(img)
    gray_s = ndi.gaussian_filter(gray, cfg.smooth_sigma)
    H, W = gray.shape
    # 计算因素：局部对比度与局部纹理
    sig_bg = max(3.0, min(H, W) / 8.0)
    LC = gray_s - ndi.gaussian_filter(gray_s, sig_bg)
    m = ndi.uniform_filter(gray_s, cfg.texture_win)
    m2 = ndi.uniform_filter(gray_s ** 2, cfg.texture_win)
    T = np.sqrt(np.maximum(m2 - m ** 2, 0.0))
    # 边界支持因素：梯度幅值（不参与对象商集细分）
    G = filters.sobel(gray_s)
    # 位置因素
    yy, xx = np.mgrid[0:H, 0:W]
    fy = yy / max(H - 1, 1)
    fx = xx / max(W - 1, 1)
    obj = {"L": L, "a": a, "b": b, "LC": LC}
    if cfg.use_texture:
        obj["T"] = T
    bnd = {"G": G}
    pos = {"fy": fy.astype(np.float64), "fx": fx.astype(np.float64)}
    return obj, bnd, pos, gray_s


def aggregate_to_atoms(fmap, atom_labels, n_atoms):
    """因素在原子上的观测：面积加权均值。同时返回原子面积。"""
    area = np.bincount(atom_labels.ravel(), minlength=n_atoms).astype(np.float64)
    val = np.bincount(atom_labels.ravel(), weights=fmap.ravel(), minlength=n_atoms) / np.maximum(area, 1)
    return val, area


def robust_scale(x):
    """鲁棒尺度：P90-P10（退化时退化为 ptp 或 1）。"""
    lo, hi = np.percentile(x, [10, 90])
    s = hi - lo
    if s <= 1e-12:
        s = np.ptp(x)
    return float(max(s, 1e-12))


def _multiotsu_hist(hist, classes):
    """256 桶直方图上的快速 multi-Otsu（向量化穷举，classes ∈ {2,3}）。
    返回阈值对应的桶下标数组。"""
    p = hist.astype(np.float64)
    p = p / max(p.sum(), 1e-12)
    nb = len(p)
    omega = np.cumsum(p)
    bins = np.arange(nb, dtype=np.float64)
    mu = np.cumsum(p * bins)
    mu_T = mu[-1]
    # 类间方差 σB²(t...) = Σ ω_i (μ_i/ω_i − μ_T)²，全向量化穷举
    idx = np.arange(1, nb)  # 候选阈值（桶下标）
    if classes == 2:
        w0 = omega[idx - 1]
        w1 = 1.0 - w0
        valid = (w0 > 1e-12) & (w1 > 1e-12)
        m0 = mu[idx - 1] / np.maximum(w0, 1e-12)
        m1 = (mu_T - mu[idx - 1]) / np.maximum(w1, 1e-12)
        s = w0 * (m0 - mu_T) ** 2 + w1 * (m1 - mu_T) ** 2
        s = np.where(valid, s, -np.inf)
        j = int(np.argmax(s))
        return None if not np.isfinite(s[j]) else [int(idx[j])]
    # classes == 3：全体 (t1, t2)（t1 < t2）矩阵化
    t1 = idx[:-1][:, None]          # (nb-1, 1)
    t2 = idx[1:][None, :]           # (1, nb-1)（实际候选从 2 开始，矩阵索引对齐即可）
    om1 = omega[t1 - 1]             # (nb-1, 1)
    om2 = omega[t2 - 1]             # (1, nb-1)
    w0 = om1
    w1 = om2 - om1
    w2 = 1.0 - om2
    valid = (w0 > 1e-12) & (w1 > 1e-12) & (w2 > 1e-12) & (t2 > t1)
    m0 = mu[t1 - 1] / np.maximum(w0, 1e-12)
    m1 = (mu[t2 - 1] - mu[t1 - 1]) / np.maximum(w1, 1e-12)
    m2 = (mu_T - mu[t2 - 1]) / np.maximum(w2, 1e-12)
    s = w0 * (m0 - mu_T) ** 2 + w1 * (m1 - mu_T) ** 2 + w2 * (m2 - mu_T) ** 2
    s = np.where(valid, s, -np.inf)
    j = int(np.argmax(s))
    if not np.isfinite(s.flat[j]):
        return None
    r, c = divmod(j, s.shape[1])
    return [int(t1[r, 0]), int(t2[0, c])]


def discretize_local(values, k_max=3):
    """有限相态化（母版"粒化"）：multi-Otsu 把观测离散为 ≤3 个相态。
    返回 (phases, n_phases)。观测退化时返回全0单相态。
    相态数上限取 3：母版"适度概括"原则——单因素在局部区域上的分辨以少相态为先。"""
    v = np.asarray(values, dtype=np.float64)
    if np.ptp(v) <= 1e-12:
        return np.zeros_like(v, dtype=np.int32), 1
    hist, edges = np.histogram(v, bins=128)
    centers = (edges[:-1] + edges[1:]) / 2.0
    # 三阈值优先，退化时自动降为二相态
    th_idx = _multiotsu_hist(hist, 3)
    if th_idx is None:
        th_idx = _multiotsu_hist(hist, 2)
    if not th_idx:
        return np.zeros_like(v, dtype=np.int32), 1
    th = centers[np.array(th_idx) - 1]  # 桶下标 -> 观测值阈值
    ph = np.digitize(v, th).astype(np.int32)
    return ph, int(ph.max()) + 1


def quotient_correlation(la, lb, na=None, nb=None):
    """商集关联度 φ（母版定义3.12）：
    在合商集 U/(f∨g)（两划分的不相交并闭包）的每一类内，
    取 f-类与 g-类交并比 |A∩B|/|A∪B| 的最大值作为该类关联强度，按类大小加权汇总。"""
    la = la.ravel().astype(np.int64)
    lb = lb.ravel().astype(np.int64)
    if na is None:
        na = int(la.max()) + 1
    if nb is None:
        nb = int(lb.max()) + 1
    N = la.size
    key = la * nb + lb
    cnt = np.bincount(key, minlength=na * nb).reshape(na, nb).astype(np.float64)
    # 合商集类 = 二分重叠图的连通分量（并查集）
    parent = list(range(na + nb))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    ia, ib = np.nonzero(cnt)
    for i, j in zip(ia, ib):
        union(i, na + j)
    comp = {}
    for i in range(na):
        if cnt[i].sum() > 0:
            comp.setdefault(find(i), []).append(("a", i))
    for j in range(nb):
        if cnt[:, j].sum() > 0:
            comp.setdefault(find(na + j), []).append(("b", j))
    phi = 0.0
    for members in comp.values():
        aset = [i for t, i in members if t == "a"]
        bset = [j for t, j in members if t == "b"]
        size = cnt[np.ix_(aset, bset)].sum() if aset and bset else 0.0
        if size <= 0:
            continue
        best = 0.0
        sub = cnt[np.ix_(aset, bset)]
        ra = cnt[aset].sum(axis=1)
        cb = cnt[:, bset].sum(axis=0)
        for ii in range(len(aset)):
            for jj in range(len(bset)):
                inter = sub[ii, jj]
                if inter > 0:
                    union_sz = ra[ii] + cb[jj] - inter
                    best = max(best, inter / union_sz)
        phi += best * size / N
    return float(phi)


# ============================================================
# 2. 能量泛函与区域统计
# ============================================================

class EnergyState:
    """E(Π) = Σ_R D(R) + λ·B(Π)。
    D(R) = Σ_{f∈F_obj} w_f · Σ_{u∈R} area_u·(f̃(u)-f̃_R)² （像素加权色散，归一化单位）
    B(Π) = 区域界面像素总长度。
    区域统计量（面积/一阶和/二阶和）支持 O(m) 增量更新。"""

    def __init__(self, atom_vals, factor_names, weights, area, atom_labels, bs, lam):
        self.names = factor_names
        self.m = len(factor_names)
        self.w = np.array([weights[f] for f in factor_names], dtype=np.float64)
        self.V = np.stack([atom_vals[f] for f in factor_names], axis=1)  # (N, m) 归一化原子观测
        self.area = area
        self.atom_labels = atom_labels
        self.bs = bs
        self.lam = lam
        self.n = len(area)

    def region_stats(self, labels):
        """labels: 原子->区域。返回 (area_R, sum_R, sumsq_R, K)。"""
        K = int(labels.max()) + 1
        A = np.bincount(labels, weights=self.area, minlength=K)
        S = np.zeros((K, self.m))
        Q = np.zeros((K, self.m))
        for j in range(self.m):
            v = self.V[:, j]
            S[:, j] = np.bincount(labels, weights=self.area * v, minlength=K)
            Q[:, j] = np.bincount(labels, weights=self.area * v * v, minlength=K)
        return A, S, Q, K

    @staticmethod
    def dispersion(A, S, Q, w):
        """D(R) 向量。A:(K,), S/Q:(K,m)"""
        with np.errstate(divide="ignore", invalid="ignore"):
            var = Q - S * S / np.maximum(A[:, None], 1e-12)
        var = np.maximum(var, 0.0)
        return (var * w[None, :]).sum(axis=1)


# ============================================================
# 3. 原子邻接与界面长度
# ============================================================

def atom_adjacency(atom_labels, n_atoms, bs):
    """四邻域原子邻接。返回 (pairs[(E,2)], length[E])，length 以像素为单位。"""
    lab = atom_labels
    e_u, e_v, e_len = [], [], []
    # 垂直相邻
    a = lab[:-1, :].ravel(); b = lab[1:, :].ravel()
    mask = a != b
    e_u.append(a[mask]); e_v.append(b[mask]); e_len.append(np.ones(int(mask.sum())) * bs)
    # 水平相邻
    a = lab[:, :-1].ravel(); b = lab[:, 1:].ravel()
    mask = a != b
    e_u.append(a[mask]); e_v.append(b[mask]); e_len.append(np.ones(int(mask.sum())) * bs)
    u = np.concatenate(e_u); v = np.concatenate(e_v); ln = np.concatenate(e_len)
    lo = np.minimum(u, v); hi = np.maximum(u, v)
    key = lo.astype(np.int64) * n_atoms + hi
    uk, inv, counts = np.unique(key, return_inverse=True, return_counts=True)
    L = np.zeros(len(uk))
    np.add.at(L, inv, ln)
    pairs = np.stack([uk // n_atoms, uk % n_atoms], axis=1).astype(np.int32)
    return pairs, L


# ============================================================
# 4. 渐进析运算（区域局部因素选择）
# ============================================================

def split_candidates(idx, coords, vals_dict, cfg):
    """生成式上不易控制，改为直接计算版本：对区域 R 枚举候选因素，返回最佳。"""
    idx = np.asarray(idx)
    r0, r1 = coords[idx, 0].min(), coords[idx, 0].max() + 1
    c0, c1 = coords[idx, 1].min(), coords[idx, 1].max() + 1
    gh, gw = r1 - r0, c1 - c0
    local = np.full((gh, gw), -1, dtype=np.int32)
    local[coords[idx, 0] - r0, coords[idx, 1] - c0] = np.arange(idx.size)
    S = np.array([[0,1,0],[1,1,1],[0,1,0]])
    results = []
    for f, vals in vals_dict.items():
        ph, k = discretize_local(vals[idx], cfg.k_max)
        if k < 2:
            continue
        child_of = np.full(idx.size, -1, dtype=np.int32)
        cid = 0
        for v in range(k):
            mask = (local >= 0)
            vv = np.zeros_like(local)
            vv[mask] = ph[local[mask]]
            m2 = mask & (vv == v)
            if not m2.any():
                continue
            nl, ncom = ndi.label(m2, structure=S)
            # 微小分量保留为独立子区域：其新增界面由 λ·ΔB 在能量判据中自然惩罚
            for c in range(1, ncom + 1):
                child_of[local[nl == c]] = cid
                cid += 1
        if cid < 2:
            continue
        # 至少两个子区域达到最小规模，避免单像素噪声主导的伪析取
        ch_sizes = np.bincount(child_of[child_of >= 0])
        if (ch_sizes >= cfg.min_child_atoms).sum() < 2:
            continue
        cm = np.full_like(local, -1)
        cm[local >= 0] = child_of[local[local >= 0]]
        dv = (cm[:-1, :] != cm[1:, :]) & (cm[:-1, :] >= 0) & (cm[1:, :] >= 0)
        dh = (cm[:, :-1] != cm[:, 1:]) & (cm[:, :-1] >= 0) & (cm[:, 1:] >= 0)
        nb_len = float(dv.sum() + dh.sum()) * cfg.bs
        children = [idx[child_of == c] for c in range(cid)]
        results.append((f, children, nb_len))
    return results


def analysis_phase(est: EnergyState, coords, scales, cfg, obj_names, labels=None):
    """渐进析：以(区域,因素)为单位局部选择，能量下降为准入。
    闭环中从当前划分继续析取（labels=None 时从零因素商集 U/o={U} 出发）。
    返回区域标签（原子级）、析取日志。"""
    if labels is None:
        labels = np.zeros(est.n, dtype=np.int32)  # 初始：零因素 o，U/o={U}
    else:
        labels = labels.copy()
    log = []
    for rnd in range(cfg.max_loop):
        K = int(labels.max()) + 1
        A, Sm, Q, _ = est.region_stats(labels)
        D = EnergyState.dispersion(A, Sm, Q, est.w)
        changed = False
        new_labels = labels.copy()
        next_id = K
        order = np.argsort(-A)  # 大区域优先（认知：先整体后局部）
        for r in order:
            if A[r] <= 0:
                continue
            # 能量上界预检：任何切分的收益不超过 D(r)，
            # 最小新增界面约为 2·bs，故 D(r) ≤ λ·2·bs 的区域不可能有正增益
            if D[r] <= est.lam * 2 * est.bs:
                continue
            idx = np.nonzero(labels == r)[0]
            if idx.size < 2 * cfg.min_child_atoms:
                continue
            cands = split_candidates(idx, coords, {f: est.V[:, j] for j, f in enumerate(est.names)}, cfg)
            if cfg.ablate_no_local_selection and cands:
                # 消融变体：不按增益选因素，按固定顺序取第一个可行因素
                order_fixed = [f for f in est.names]
                cands.sort(key=lambda x: order_fixed.index(x[0]))
                cands = cands[:1]
            best = None
            for f, children, nb_len in cands:
                # 子区域色散
                gain_D = D[r]
                ok = True
                for ch in children:
                    a_c = est.area[ch].sum()
                    if a_c <= 0:
                        ok = False
                        break
                    v = est.V[ch]  # (n, m)
                    s1 = (est.area[ch][:, None] * v).sum(axis=0)
                    s2 = (est.area[ch][:, None] * v * v).sum(axis=0)
                    var = np.maximum(s2 - s1 * s1 / a_c, 0.0)
                    gain_D -= float((var * est.w).sum())
                if not ok:
                    continue
                gain = gain_D - est.lam * nb_len
                if gain <= 0:
                    continue
                # 冗余：候选相态与区域现行细分（若已分裂过）之间的商集关联度
                if best is None or gain > best[1]:
                    best = (f, gain, children)
            if best is not None:
                f, gain, children = best
                for ch in children:
                    new_labels[ch] = next_id
                    next_id += 1
                changed = True
                log.append(dict(round=rnd, region=int(r), factor=f,
                                gain=float(gain), n_children=len(children),
                                size=int(idx.size)))
        # 压实标签
        uniq, new_labels = np.unique(new_labels, return_inverse=True)
        labels = new_labels.astype(np.int32)
        if not changed:
            break
    return labels, log


# ============================================================
# 5. 受限合运算（能量下降的堆式凝聚合并）
# ============================================================

def composition_phase(est: EnergyState, labels, pairs, pair_len, cfg):
    """受限合运算：ΔE = D(A∪B)-D(A)-D(B) - λ·Γ(A,B) < 0 且界面未持证时合并。
    证书（母版"证据保守性"的操作化）：界面归一化对比度 c(A,B)=Σ_f w_f|μ_A−μ_B|
    超过鲁棒阈值 τ=med+1.35·1.4826·MAD（当前界面分布自适应）的界面为已认证差异，
    合运算不得跨越（修复低对比渐变场景的级联坍塌）。
    堆式凝聚 + 惰性删除。返回合并后标签与日志。"""
    labels = labels.copy()
    K = int(labels.max()) + 1
    A, S, Q, _ = est.region_stats(labels)
    alive = np.ones(K, dtype=bool)
    ver = np.zeros(K, dtype=np.int64)

    def contrast(a, b):
        return float((np.abs(S[a] / max(A[a], 1e-12) - S[b] / max(A[b], 1e-12)) * est.w).sum())

    # 区域邻接表：r -> {nb: length}
    adj = [dict() for _ in range(K)]
    rl = labels[pairs[:, 0]]
    rr = labels[pairs[:, 1]]
    m = rl != rr
    for a_, b_, l_ in zip(rl[m], rr[m], pair_len[m]):
        adj[a_][b_] = adj[a_].get(b_, 0.0) + l_
        adj[b_][a_] = adj[b_].get(a_, 0.0) + l_

    def merge_gain(a, b, gam):
        Aab = A[a] + A[b]
        Sab = S[a] + S[b]
        Qab = Q[a] + Q[b]
        var = np.maximum(Qab - Sab * Sab / max(Aab, 1e-12), 0.0)
        Dab = float((var * est.w).sum())
        Da = float((np.maximum(Q[a] - S[a]**2 / max(A[a],1e-12),0) * est.w).sum())
        Db = float((np.maximum(Q[b] - S[b]**2 / max(A[b],1e-12),0) * est.w).sum())
        return est.lam * gam - (Dab - Da - Db)

    # 界面证书阈值：由当前全部界面的对比度分布自适应标定
    all_c = [contrast(a_, b_) for a_ in range(K) for b_ in adj[a_] if b_ > a_]
    if all_c:
        med = float(np.median(all_c))
        tau_cert = med + cfg.tau_mad * 1.4826 * float(np.median(np.abs(np.array(all_c) - med)))
    else:
        tau_cert = np.inf

    heap = []
    for a_ in range(K):
        for b_, l_ in adj[a_].items():
            if b_ > a_:
                if contrast(a_, b_) >= tau_cert:   # 持证界面：禁止跨越
                    continue
                g = merge_gain(a_, b_, l_)
                if g > 0:
                    heapq.heappush(heap, (-g, a_, b_, 0, 0))

    n_merges = 0
    while heap:
        negg, a, b, va, vb = heapq.heappop(heap)
        if not (alive[a] and alive[b]):
            continue
        if va != ver[a] or vb != ver[b]:
            continue
        if b not in adj[a]:
            continue
        gam = adj[a].pop(b)
        adj[b].pop(a, None)
        # 执行合并：b -> a
        A[a] += A[b]; S[a] += S[b]; Q[a] += Q[b]
        alive[b] = False
        labels[labels == b] = a
        # 合并邻接
        for c_, l_ in list(adj[b].items()):
            if c_ == a:
                continue
            adj[c_].pop(b, None)
            adj[a][c_] = adj[a].get(c_, 0.0) + l_
            adj[c_][a_] = adj[c_].get(a_, 0.0) + l_
        adj[b] = {}
        ver[a] += 1
        n_merges += 1
        for c_, l_ in adj[a].items():
            if alive[c_]:
                if contrast(a, c_) >= tau_cert:   # 持证界面：禁止跨越
                    continue
                g = merge_gain(a, c_, l_)
                if g > 0:
                    heapq.heappush(heap, (-g, a, c_, ver[a], ver[c_]))
    uniq, labels = np.unique(labels, return_inverse=True)
    return labels.astype(np.int32), n_merges


# ============================================================
# 6. 边界形成、证书与语义规则
# ============================================================

PHASE_WORDS = ["极低", "低", "中", "高", "极高"]


def phase_word(mean_val, all_mean, all_std):
    z = (mean_val - all_mean) / max(all_std, 1e-12)
    if z < -1.0: return "极低"
    if z < -0.35: return "偏低"
    if z < 0.35: return "中等"
    if z < 1.0: return "偏高"
    return "极高"


def boundary_and_semantics(est, labels, pairs, pair_len, pos_vals, cfg, atom_labels, img_shape):
    """边界证书（主导因素 + 稳定判定）与文字型语义规则。"""
    K = int(labels.max()) + 1
    A, S, Q, _ = est.region_stats(labels)
    means = S / np.maximum(A[:, None], 1e-12)  # (K, m) 归一化均值
    D = EnergyState.dispersion(A, S, Q, est.w)

    rl = labels[pairs[:, 0]]; rr = labels[pairs[:, 1]]
    mmask = rl != rr
    pl = rl[mmask]; pr = rr[mmask]; plen = pair_len[mmask]
    # 界面长度聚合
    key = np.minimum(pl, pr).astype(np.int64) * K + np.maximum(pl, pr)
    uk, inv = np.unique(key, return_inverse=True)
    gam = np.zeros(len(uk))
    np.add.at(gam, inv, plen)
    ia = (uk // K).astype(np.int32); ib = (uk % K).astype(np.int32)

    # 界面对比度（归一化因素差）与主导因素
    if len(uk) == 0:
        ia = np.zeros(0, np.int32); ib = np.zeros(0, np.int32)
        gam = np.zeros(0); contrast = np.zeros(0)
        dom_idx = np.zeros(0, np.int64); stable = np.zeros(0, bool)
        tau_cert = 0.0
    else:
        diff = np.abs(means[ia] - means[ib])  # (E, m)
        contrast = (diff * est.w[None, :]).sum(axis=1)
        dom_idx = diff.argmax(axis=1)
        med = np.median(contrast)
        tau_cert = med + cfg.tau_mad * (np.median(np.abs(contrast - med)) * 1.4826)
        stable = contrast >= max(tau_cert, 1e-12)

    # 区域语义
    order = np.argsort(-A)
    rules = []
    fy_atom = pos_vals["fy"]; fx_atom = pos_vals["fx"]
    y_mean = np.bincount(labels, weights=est.area * fy_atom, minlength=K) / np.maximum(A, 1e-12)
    x_mean = np.bincount(labels, weights=est.area * fx_atom, minlength=K) / np.maximum(A, 1e-12)
    total_px = est.area.sum()
    gmean = {f: float((est.V[:, j] * est.area).sum() / total_px) for j, f in enumerate(est.names)}
    gstd = {f: float(np.sqrt(max((est.area * (est.V[:, j] - gmean[f])**2).sum() / total_px, 1e-12))) for j, f in enumerate(est.names)}
    # Concept：相同（因素相态签名+位置带）的区域归并
    concept_of = {}
    concept_map = {}
    n_concept = 0
    for r in order:
        sig = []
        for j, f in enumerate(est.names):
            sig.append(phase_word(means[r, j], gmean[f], gstd[f]))
        yw = "上部" if y_mean[r] < 0.33 else ("中部" if y_mean[r] < 0.66 else "下部")
        xw = "左侧" if x_mean[r] < 0.33 else ("中部" if x_mean[r] < 0.66 else "右侧")
        key_sig = tuple(sig) + (yw,)
        if key_sig not in concept_of:
            concept_of[key_sig] = n_concept
            n_concept += 1
        concept_map[r] = concept_of[key_sig]
    for rank, r in enumerate(order[: cfg.max_regions_semantic]):
        desc = "、".join(f"{f}{phase_word(means[r, j], gmean[f], gstd[f])}"
                        for j, f in enumerate(est.names))
        yw = "上部" if y_mean[r] < 0.33 else ("中部" if y_mean[r] < 0.66 else "下部")
        xw = "左侧" if x_mean[r] < 0.33 else ("中部" if x_mean[r] < 0.66 else "右侧")
        rules.append(
            f"R-Region-{rank:03d}: 对象{rank} 位于图像{yw}{xw}，面积占比 {A[r]/total_px*100:.2f}%，"
            f"观测特征：{desc}；归属 Concept-{concept_map[r]:03d}"
            f"（同类相态签名的空间对象共享概念，不发生空间合并）。")
    # 边界语义（按界面长度降序取前若干；界面两端编号与区域语义一致，均采用面积名次）
    rank_of = {int(r): rank for rank, r in enumerate(order)}
    bord = np.argsort(-gam)
    for rank, e in enumerate(bord[: cfg.max_regions_semantic]):
        a_, b_ = rank_of[int(ia[e])], rank_of[int(ib[e])]
        dom = est.names[dom_idx[e]]
        verdict = "STABLE（稳定边界）" if stable[e] else "UNCERTAIN（不确定界面）"
        rules.append(
            f"R-Boundary-{rank:03d}: 对象{a_}与对象{b_}界面长度 {gam[e]:.0f}px，"
            f"归一化对比度 {contrast[e]:.3f}（判定阈值 {max(tau_cert,1e-12):.3f}），"
            f"主导区分因素={dom}，判定={verdict}。")
    info = dict(n_regions=K, n_interfaces=len(uk), n_stable=int(stable.sum()),
                tau_cert=float(max(tau_cert, 1e-12)), n_concept=n_concept,
                iface_a=ia, iface_b=ib, iface_len=gam, iface_stable=stable,
                iface_dom=dom_idx, iface_contrast=contrast, region_mean=means,
                region_area=A)
    return rules, info


# ============================================================
# 7. 主流程
# ============================================================

def fscod_segment(img, cfg: Config | None = None):
    """FS-COD 主流程。返回 dict(labels[像素级], boundary[像素级bool], rules, log)。"""
    cfg = cfg or Config()
    rng = np.random.default_rng(cfg.seed)
    t0 = time.time()
    H, W = img.shape[:2]

    obj, bnd, pos, gray_s = compute_factor_maps(img, cfg)
    atom_labels, n_atoms = build_atoms((H, W), cfg.bs)
    gh = (H + cfg.bs - 1) // cfg.bs

    # 原子观测 + 鲁棒归一化
    atom_vals, scales, area = {}, {}, None
    for f, fm in obj.items():
        v, area = aggregate_to_atoms(fm, atom_labels, n_atoms)
        s = robust_scale(v)
        scales[f] = s
        atom_vals[f] = v / s  # 归一化
    # 退化因素剔除（接近零因素 o）
    obj_names = [f for f in obj if robust_scale(atom_vals[f]) > 1e-9 and scales[f] > 1e-9]
    for f in list(atom_vals):
        if f not in obj_names:
            del atom_vals[f]
    weights = {f: 1.0 / max(len(obj_names), 1) for f in obj_names}
    pos_atom = {}
    for f, fm in pos.items():
        v, _ = aggregate_to_atoms(fm, atom_labels, n_atoms)
        pos_atom[f] = v

    coords = np.stack([np.arange(n_atoms) // ((W + cfg.bs - 1)//cfg.bs),
                       np.arange(n_atoms) % ((W + cfg.bs - 1)//cfg.bs)], axis=1)

    est = EnergyState(atom_vals, obj_names, weights, area, atom_labels, cfg.bs, cfg.lam)
    pairs, plen = atom_adjacency(atom_labels, n_atoms, cfg.bs)

    # 析-合闭环：析取（分析）与合取（综合）交替，直至能量不动点
    loop_log = []
    labels, slog = analysis_phase(est, coords, scales, cfg, obj_names)
    loop_log.append(("analysis#1", len(slog)))
    if not cfg.ablate_no_composition:
        for it in range(cfg.max_loop - 1):
            labels, n_merge = composition_phase(est, labels, pairs, plen, cfg)
            loop_log.append((f"composition#{it+1}", n_merge))
            labels, slog2 = analysis_phase(est, coords, scales, cfg, obj_names, labels=labels)
            loop_log.append((f"analysis#{it+2}", len(slog2)))
            if not slog2:
                break
        labels, n_merge = composition_phase(est, labels, pairs, plen, cfg)
        loop_log.append(("composition#final", n_merge))
    else:
        loop_log.append(("composition(ablated)", 0))

    rules, info = boundary_and_semantics(est, labels, pairs, plen, pos_atom, cfg,
                                         atom_labels, (H, W))
    # 像素级标签与边界
    pix_labels = labels[atom_labels]
    bmask = np.zeros((H, W), dtype=bool)
    bmask[:-1, :] |= pix_labels[:-1, :] != pix_labels[1:, :]
    bmask[1:, :] |= pix_labels[:-1, :] != pix_labels[1:, :]
    bmask[:, :-1] |= pix_labels[:, :-1] != pix_labels[:, 1:]
    bmask[:, 1:] |= pix_labels[:, :-1] != pix_labels[:, 1:]

    log = dict(loop=loop_log, split_log=slog, runtime=time.time() - t0,
               n_atoms=int(n_atoms), factors=obj_names, scales=scales, **{k: v for k, v in info.items() if isinstance(v, (int, float))})
    return dict(labels=pix_labels, boundary=bmask, rules=rules, info=info, log=log)


# ============================================================
# 命令行入口：对任意图像（不限于 BSD500）进行分割
#   用法：python3 FS_COD.py 输入图像路径 [输出目录]
#   输出：输出目录下生成 <原名>_labels.npz（像素级标签与边界）、
#         <原名>_overlay.png（边界叠加图）、<原名>_rules.txt（语义规则）
# ============================================================

def _cli():
    import os
    import sys
    from skimage import io

    if len(sys.argv) < 2:
        print("用法：python3 FS_COD.py 输入图像路径 [输出目录]")
        print("示例：python3 FS_COD.py photo.jpg ./out")
        sys.exit(2)
    in_path = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(in_path))
    os.makedirs(out_dir, exist_ok=True)

    img = io.imread(in_path)
    if img.ndim == 2:                      # 灰度图 → 三通道
        img = np.stack([img] * 3, axis=-1)
    elif img.shape[-1] == 4:               # RGBA → RGB
        img = img[..., :3]
    if img.dtype != np.uint8:              # 浮点图像 → uint8
        img = np.clip(img, 0, 1)
        img = (img * 255).astype(np.uint8)

    t0 = time.time()
    r = fscod_segment(img, Config())
    stem = os.path.splitext(os.path.basename(in_path))[0]

    np.savez_compressed(os.path.join(out_dir, f"{stem}_labels.npz"),
                        labels=r["labels"], boundary=r["boundary"])

    # 边界叠加（红色曲线）
    overlay = img.copy().astype(float)
    b = r["boundary"]
    overlay[b] = 0.4 * overlay[b] + 0.6 * np.array([255, 0, 0])
    io.imsave(os.path.join(out_dir, f"{stem}_overlay.png"), overlay.astype(np.uint8))

    with open(os.path.join(out_dir, f"{stem}_rules.txt"), "w", encoding="utf-8") as fp:
        fp.write("\n".join(r["rules"]) + "\n")

    n_reg = int(r["labels"].max())
    print(f"完成：{in_path}")
    print(f"  区域数：{n_reg}；边界像素：{int(b.sum())}；耗时：{time.time() - t0:.2f}s")
    print(f"  输出目录：{out_dir}（*_labels.npz / *_overlay.png / *_rules.txt）")


if __name__ == "__main__":
    _cli()

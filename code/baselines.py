# -*- coding: utf-8 -*-
"""
对比算法：5 种非深度代表性方法，参数事先固定、全数据集统一（公平性协议）。
  SLIC          超像素（Achanta et al., 2012）
  Felzenszwalb  图模型区域合并（Felzenszwalb & Huttenlocher, 2004）
  Quickshift    颜色-空间模式寻优（Vedaldi & Soatto, 2008）
  Watershed     梯度分水岭（Vincent & Soille, 1991；h-minima 标记）
  MeanShift     金字塔均值漂移（Comaniciu & Meer, 2002 的 OpenCV 实现）
所有方法输入同一图像，输出同一格式的整数标签图。
"""
import numpy as np
from scipy import ndimage as ndi
from skimage import segmentation, filters, morphology, color
import cv2


def run_slic(img, n_segments=150, compactness=10.0, sigma=1.0):
    return segmentation.slic(img, n_segments=n_segments, compactness=compactness,
                             sigma=sigma, start_label=0, channel_axis=-1,
                             convert2lab=True).astype(np.int32)


def run_felzenszwalb(img, scale=100.0, sigma=0.8, min_size=50):
    return segmentation.felzenszwalb(img, scale=scale, sigma=sigma,
                                     min_size=min_size).astype(np.int32)


def run_quickshift(img, kernel_size=5.0, max_dist=10.0, ratio=1.0):
    return segmentation.quickshift(img, kernel_size=kernel_size, max_dist=max_dist,
                                   ratio=ratio, channel_axis=-1).astype(np.int32)


def run_watershed(img, h_rel=0.12):
    gray = color.rgb2gray(img.astype(np.float64) / 255.0) if img.ndim == 3 else img / 255.0
    grad = filters.sobel(filters.gaussian(gray, 1.0))
    h = h_rel * max(grad.max(), 1e-12)
    seeds = morphology.label(morphology.h_minima(grad, h))
    return segmentation.watershed(grad, markers=seeds).astype(np.int32) - 1


def run_meanshift(img, sp=15, sr=40, min_size=150):
    """金字塔均值漂移 + 连通分量 + 小区域吸收（OpenCV 实现，参数固定；
    min_size 对应 EDISON 的 MinimumRegionArea，Comaniciu & Meer 2002）。"""
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    out = cv2.pyrMeanShiftFiltering(bgr, sp=sp, sr=sr)
    q8 = (out // 32).astype(np.int64)
    q = q8[..., 0] * 4096 * 4096 + q8[..., 1] * 4096 + q8[..., 2]
    _, labels = np.unique(q, return_inverse=True)
    lab = labels.reshape(img.shape[:2])
    res = np.zeros_like(lab)
    nxt = 0
    for v in np.unique(lab):
        m = lab == v
        cc, n = ndi.label(m)
        res[m] = cc[m] + nxt - 1
        nxt += n
    res = res.astype(np.int32)
    # 小区域迭代吸收：并入平均颜色最接近的相邻区域（固定规则，至多 5 轮）
    for _ in range(5):
        K = res.max() + 1
        if K <= 1:
            break
        flat = res.ravel()
        cnt = np.bincount(flat, minlength=K)
        small = set(np.nonzero(cnt < min_size)[0].tolist())
        if not small:
            break
        means = np.stack([np.bincount(flat, weights=out[..., c].ravel().astype(np.float64),
                                      minlength=K) / np.maximum(cnt, 1) for c in range(3)], 1)
        # 邻接对（4 邻域标签不同处）
        pa = np.concatenate([res[:-1, :].ravel(), res[:, :-1].ravel()])
        pb = np.concatenate([res[1:, :].ravel(), res[:, 1:].ravel()])
        mm = pa != pb
        pa, pb = pa[mm], pb[mm]
        nbs_of = {}
        for a_, b_ in zip(pa, pb):
            nbs_of.setdefault(a_, set()).add(b_)
            nbs_of.setdefault(b_, set()).add(a_)
        assign = {}
        for r in small:
            nbs = [x for x in nbs_of.get(r, ()) if x != r]
            if not nbs:
                continue
            d = ((means[nbs] - means[r]) ** 2).sum(1)
            assign[r] = nbs[int(np.argmin(d))]
        if not assign:
            break
        lut = np.arange(K)
        for r, t in assign.items():
            lut[r] = t
        res = lut[res]
        _, res = np.unique(res, return_inverse=True)
        res = res.reshape(img.shape[:2]).astype(np.int32)
    return res


BASELINES = dict(SLIC=run_slic, Felzenszwalb=run_felzenszwalb,
                 Quickshift=run_quickshift, Watershed=run_watershed,
                 MeanShift=run_meanshift)

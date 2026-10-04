# FS-COD 1.0

FS-COD（Factor-Space-driven Collaborative Object and Boundary Discovery）是一种不依赖深度学习训练的图像对象区域与边界协同发现算法。项目使用因素空间、分析算子、合成算子、边界凭证和析—合闭环完成像素级分割，并输出可读的中文语义规则。

本仓库用于论文的代码与实验复现。算法代码、运行参数、统计结果和论文图件均保留在仓库中；第三方 BSDS500 原始图像与人工标注不随仓库再分发，下载和引用要求见 [`data/README.md`](data/README.md)。

## 目录

- `code/`：规范的 Python 源代码、基准运行器、指标、对比方法、敏感性分析和绘图脚本。
- `data/`：基准评测代码及第三方数据的下载说明。
- `results/`：标定、基准、敏感性和统计汇总结果。
- `figures/`：论文 PNG 图件（由 `code/figures.py` 生成）。
- `docs/`：算法设计文档。
- `logs/`、`doc_build/`：运行日志和文档构建脚本。

仓库根目录中还保留了 GitHub 初始上传的脚本副本（例如 `FS_COD.py`、`metrics.py`），用于兼容已有链接；后续开发以 `code/` 目录为准。

## 环境

- Python 3.10+
- `numpy`、`pandas`、`scipy`、`scikit-image`、`imageio`、`matplotlib`
- 不需要深度学习框架

可使用根目录的 `requirements.txt` 安装 Python 依赖：

```bash
python -m pip install -r requirements.txt
```

## 单张图像

从 `code/` 目录运行：

```bash
python FS_COD.py <input-image> <output-directory>
```

也可以使用根目录的兼容脚本：

```bash
python FS_COD.py <input-image> <output-directory>
```

支持 JPG/PNG、RGB/灰度/RGBA 图像。输出包括像素级标签 `*_labels.npz`、边界叠加图 `*_overlay.png` 和中文语义规则 `*_rules.txt`。已实测 240×360 图像约 1 秒。

## BSD500 复现

1. 按 [`data/README.md`](data/README.md) 下载 BSDS500，并将数据放入 `data/BSR/BSDS500/data/`。
2. 在 `code/` 目录运行参数标定、阶段验证、全量基准、敏感性分析、统计和绘图脚本。

```bash
python calibrate_lambda.py
python run_benchmark.py --split stage20 --workers 2
python run_benchmark.py --split all --workers 2
python run_sensitivity.py --workers 2
python analyze_results.py
python figures.py
```

完整参数、实验划分、消融方法和输出格式见 [`code/README.md`](code/README.md)。除 `lam` 与 `tau_mad` 外，算法参数按文档中的冻结配置执行；不要针对单幅图像调参。

冻结配置为：

```
seed=20260927, bs=3, smooth_sigma=0.8, k_max=3,
lam=0.5（训练集标定）, tau_mad=1.35, min_child_atoms=4,
max_loop=2, texture_win=7, use_position_split=False, use_texture=True
```

## 结果与引用

汇总结果位于 `results/`，包括 `benchmark_results.csv`、`summary_by_split.csv`、预注册胜率、Wilcoxon 检验和敏感性分析表。论文中请引用与论文对应的 GitHub Release 或 Zenodo DOI。发布版本使用 Git tag（例如 `v1.0.0`），并在论文的 Code Availability / Data Availability 部分写明版本号和 DOI。

代码的再发布许可和作者信息应以论文作者最终确认的 `LICENSE`、引用文件和 Zenodo 元数据为准。BSD500 数据保留其原始来源、引用和使用条款。


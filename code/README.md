# FS-COD 1.0 代码与运行说明

## 文件清单

| 文件 | 用途 |
|---|---|
| `FS_COD.py` | 核心算法（原子论域、因素池、分析算子、合成算子+边界凭证、析—合闭环、边界判定与语义规则）。冻结参数集中在 `Config` 数据类 |
| `metrics.py` | 6 项监督指标（BF/PRI/VOI/COV/BDE/ARI，逐标注者平均）+ 6 项无监督指标 |
| `baselines.py` | 5 个对比算法（SLIC、Felzenszwalb、Quickshift、Watershed、MeanShift），参数预先固定 |
| `calibrate_lambda.py` | λ 网格标定（训练集 30 张分层抽样） |
| `run_benchmark.py` | 基准运行器：`--split stage20|val|train|test|all`，断点续跑；`stage20_selection()` 为预声明抽样 |
| `run_sensitivity.py` | 敏感性扫描（bs / tau_mad / k_max，阶段验证 20 张） |
| `analyze_results.py` | 汇总表、预注册胜率、Wilcoxon 检验 |
| `figures.py` | 全部科研图（TIFF 300dpi + PNG 150dpi） |

## 依赖

Python 3.10+；numpy、pandas、scipy、scikit-image、imageio、matplotlib。无深度学习依赖。

## 对任意图像分割（不限于 BSD500）

算法与数据集完全解耦，任何常见格式图像（JPG/PNG，RGB/灰度/RGBA 自动适配）均可直接分割：

```bash
python3 FS_COD.py 输入图像路径 [输出目录]
# 示例：python3 FS_COD.py photo.jpg ./out
```

输出目录下生成三个文件：`<原名>_labels.npz`（像素级标签场 labels 与布尔边界 boundary）、
`<原名>_overlay.png`（边界红色叠加图）、`<原名>_rules.txt`（中文语义规则）。
已实测：RGB、灰度、RGBA 三种输入均可正常运行（240×360 图像约 1 秒）。

## 运行（BSD500 实验复现）

```bash
# 0. 数据：将 BSR_bsds500.tgz 解压至 ../data/（目录结构 data/BSR/BSDS500/data/{images,groundTruth}/...）
# 1. λ 标定（已完成，结果 ../results/lambda_calibration*.csv；重跑约 20 分钟/2 核）
python3 calibrate_lambda.py
# 2. 阶段验证（20 张预声明抽样，约 8 分钟/2 核）
python3 run_benchmark.py --split stage20 --workers 2
# 3. 全量验证（500 张 × 9 方法，约 3 小时/2 核，断点续跑）
python3 run_benchmark.py --split all --workers 2 \
  --methods FS-COD SLIC Felzenszwalb Quickshift Watershed MeanShift \
            FS-COD-NoComp FS-COD-NoTex FS-COD-NoSel
# 4. 敏感性分析（约 15 分钟/2 核）
python3 run_sensitivity.py --workers 2
# 5. 汇总与统计
python3 analyze_results.py
# 6. 绘图（在已配置中文字体的环境中运行）
python3 figures.py
```

## 冻结参数（Config）

`seed=20260927, bs=3, smooth_sigma=0.8, k_max=3, lam=0.5（训练集标定）, tau_mad=1.35,
min_child_atoms=4, max_loop=2, texture_win=7, use_position_split=False, use_texture=True`

除 `lam` 与 `tau_mad` 经训练集标定外，其余为结构性常数。不针对任何具体图像调整参数。

## 结果复现

全部结果写入 `../results/`：`benchmark_results.csv`（逐图 × 逐方法明细）、
`summary_by_split.csv`（逐划分汇总）、`winrate_*.csv`（预注册胜率）、
`wilcoxon_*.csv`（显著性）、`sensitivity.csv`、`fscod_artifacts/{split}/`（逐图标签 npz、
语义规则 txt、运行日志 json）。

# FS-COD 1.0 项目说明

## 项目目标

FS-COD 1.0 是一个不依赖深度学习训练的图像对象区域与边界协同发现算法。算法使用因素空间、分析算子、合成算子、边界凭证和析—合闭环完成像素级分割，并输出语义规则。

## 目录约定

- `code/`：可执行的 Python 算法、基准运行器、指标、对比方法、敏感性分析和绘图脚本。
- `data/BSR/`：BSD500/BSDS500 基准数据及 MATLAB 评测代码。不要在没有明确要求时改动原始数据。
- `results/`：基准、标定、敏感性和统计结果，以及逐图运行产物。
- `figures/`：论文图件；由 `code/figures.py` 生成。
- `docs/`：设计文档。
- `doc_build/`、`logs/`：构建或运行日志。

## Python 约定

- 支持 Python 3.10 及以上；依赖主要是 `numpy`、`pandas`、`scipy`、`scikit-image`、`imageio` 和 `matplotlib`。
- 不引入深度学习框架或需要训练的模型，除非用户明确提出。
- 默认从 `code/` 目录运行脚本，使用相对于项目根目录的路径；不要写入本机绝对路径。
- 输入图像支持 JPG/PNG、RGB/灰度/RGBA；保持现有 CLI 用法和输出文件命名约定。
- 修改算法时保持确定性和可复现性，除非用户明确要求，不能删除或随意改变 `Config` 中的冻结参数、随机种子、消融开关及评测协议。
- 代码与文档使用 UTF-8；保留中文语义规则输出。

## 常用验证

在 `code/` 目录运行：

```bash
python FS_COD.py <image-path> <output-dir>
python run_benchmark.py --split stage20 --workers 2
python run_sensitivity.py --workers 2
python analyze_results.py
```

对代码作出改动后，优先执行单张图像 smoke test；涉及评测逻辑时再运行阶段验证。报告验证结果和任何未运行的耗时步骤。

## Copilot 工作方式

- 先阅读 `code/README.md`、相关脚本和现有结果，再提出或实施改动。
- 保持改动小而可审查；不要为了重构而重写已经冻结的科研流程。
- 不要提交 `__pycache__/`、`.pyc`、临时编辑器文件、个人凭据或 API 密钥。
- 不要把生成的结果当作源代码修改；除非用户明确要求，先修改生成脚本，再说明需要重新生成哪些产物。
- 新增参数、文件格式或运行步骤时，同时更新相应 README 或设计文档。

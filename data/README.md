# 数据获取与使用说明

本项目的基准实验使用 Berkeley Segmentation Dataset and Benchmarks 500（BSDS500）。原始图像和人工分割标注属于第三方数据，不作为本项目自有数据重新授权或再分发。

## 下载

请从 Berkeley 官方页面获取数据：

<https://www2.eecs.berkeley.edu/Research/Projects/CS/vision/bsds/>

将数据解压到：

```text
data/BSR/BSDS500/data/
```

运行基准评测所需的 MATLAB 评测代码位于 `data/BSR/bench/`。如果使用 `data/BSR/bench/data/` 中的旧版示例文件，请按照其原始来源和使用条款处理；它们不会作为本仓库的公开发布内容。

## 引用

使用 BSDS500 时请引用 Berkeley 官方页面列出的原始论文：

> D. Martin, C. Fowlkes, T. Tal, and J. Malik, “A Database of Human Segmented Natural Images and its Application to Evaluating Segmentation Algorithms and Measuring Ecological Statistics,” Proc. ICCV, 2001.

请同时遵守数据集页面列出的非商业研究与教育用途要求，并在论文中说明数据集来源、训练/验证/测试划分和评测协议。

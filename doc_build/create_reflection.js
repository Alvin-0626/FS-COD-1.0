// FS-COD 1.0 过程与反思报告（docx-js）
import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType, Document, Footer, Header, HeadingLevel, Packer, PageNumber,
  Paragraph, TextRun, convertInchesToTwip,
} from "docx";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Usage: node create_reflection.js /abs/out.docx");
const T = String.raw;
const font = { ascii: "Times New Roman", hAnsi: "Times New Roman", cs: "Times New Roman", eastAsia: "SimSun" };
const hfont = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "Microsoft YaHei" };
const INK = "1F3864";
const run = (t, o = {}) => new TextRun({ text: t, font, size: 24, ...o });
const para = (c, o = {}) => new Paragraph({ spacing: { after: 120, line: 320 }, ...o,
  children: Array.isArray(c) ? c : [c] });
const p = (t, o = {}) => para(run(t), { alignment: AlignmentType.JUSTIFIED,
  indent: { firstLine: convertInchesToTwip(0.33) }, ...o });
const h1 = (t) => para(new TextRun({ text: t, font: hfont, bold: true, size: 32, color: INK }),
  { heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } });
const h2 = (t) => para(new TextRun({ text: t, font: hfont, bold: true, size: 28, color: INK }),
  { heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 } });

const children = [];
children.push(para(new TextRun({ text: "FS-COD 1.0 过程与反思报告", font: hfont, bold: true, size: 40, color: INK }),
  { alignment: AlignmentType.CENTER, spacing: { before: 1800, after: 300 } }));
children.push(para(run("——从母版理论重构到全量验证的完整记录", { size: 26 }),
  { alignment: AlignmentType.CENTER, spacing: { after: 600 } }));
children.push(para(run("生成日期：2026 年 9 月 29 日（修订版）", { size: 22 }), { alignment: AlignmentType.CENTER }));
children.push(new Paragraph({ children: [new TextRun({ break: 1, text: "" })], pageBreakBefore: true }));

children.push(h1("一、任务理解与材料核验"));
children.push(p(T`任务要求以《泛因素空间与数据科学应用》（包研科，2021）为唯一理论母版，端到端完成算法设计、理论论证、代码实现、BSD500 基准验证与文档交付，并遵守严格的诚实性约束（不得伪造数据与结果、不得硬编码、不得标注泄漏、明确区分已验证与未验证内容）。`));
children.push(p(T`材料核验：母版 PDF（126 页）经 Tesseract OCR（chi_sim）逐页转写为文本，OCR 错误（如"析"误识为"折"、公式符号丢失）通过与上下文和理论自洽性比对逐处校正；前期算法报告四份（PFA_QSM_3.0 理论符合性分析、PFA_QSM_3.1 实验反思与校正、修订版 PFA_QSM_3.1、PFA-ACE 1.0 设计文档）与两份前期代码全部通读；BSD500 数据集（BSR_bsds500.tgz）解压并核对 500 张图像与多标注者 groundTruth 完整性。`));

children.push(h1("二、理论重构"));
children.push(p(T`从 OCR 文本中系统重构了母版第 1—3 章的可计算核心：商集与划分格（细化序、交 ∘、并 +）、因素与相空间（满射定义、回溯、发现公理）、因素序的反变关系、析运算与合运算的商集语义、因素空间有界格定理、泛因素空间四元组（定义 2.12）、自为因素与有限因素标架（定义 2.13—2.14）、商集关联度 φ（定义 3.12）与熵关联度、因素轮廓与相似性公理（§3.3）、认知本体论四原理（§2.4）。重构原则：凡进入算法的概念必须有母版出处；母版未给出可计算构造的（如商集并的具体生成），以命题形式补充构造性证明（设计文档命题 2.1）。`));

children.push(h1("三、前期算法缺陷归因"));
children.push(p(T`通读前期报告与代码后，确认缺陷清单（前期报告自身亦有部分记录，本文独立复核）：（A）梯度因素双重角色——既作边界支持又参与对象分裂，导致高纹理区过度分裂；（B）阈值绝对化——固定亮度/梯度阈值无法跨图像自适应；（C）析合失衡——纯能量准则在低对比渐变场景级联坍塌；（D）因素机械复用——固定顺序遍历因素，违背"因素为先导、逐区域选择"；（E）概念层碎裂——Concept 归并缺少签名机制；（F）运行效率低——逐像素操作未原子化。上述归因直接决定 FS-COD 1.0 的六项设计决策（三类因素池职责分离、数据自适应阈值、能量泛函统一裁决、局部最优因素选择、相态签名归并、原子论域）。`));

children.push(h1("四、实现与调试记录（真实缺陷与修复）"));
children.push(p(T`以下每条均为实际发生、有日志或前后数据对照的调试事件：`));
const bugs = [
  ["D1", "multi-Otsu 阈值化返回桶索引被当作灰度值使用", "全部原子只得到一个相态，零分裂", "改为自实现 128 桶直方图多类 Otsu（_multiotsu_hist），桶索引映射回取值；同时解决 skimage 四类别穷举的 97 秒级耗时"],
  ["D2", "分裂候选硬性拒绝含小连通块的方案", "纹理区域永远不可分裂", "保留小块但由 λ·ΔB 项惩罚，仅要求至少两个子区域 ≥ 4 原子"],
  ["D3", "邻接矩阵广播方向错误（dh 维度）", "界面长度统计错误", "修正为 (cm[:,1:]≥0) 方向"],
  ["D4", "合成相位邻接判断写成列表包含（a not in adj）", "全部合并被跳过，析合失衡", "改为 b not in adj[a]"],
  ["D5", "闭环第二轮分析从零因素重启", "合成相位重复执行 204 次合并", "analysis_phase 接受当前划分继续分析"],
  ["D6", "紧致度指标以边界像素数当周长", "Compact 恒等于 1.000（MeanShift 上暴露）", "改用四邻域穿越边计周长，4πA/P²；旧结果作废重算"],
  ["D7", "一次配置编辑未真正生效（字符串替换未匹配），却误判为已冻结 λ=0.5", "阶段验证首轮实际以 λ=1.0 运行", "以 grep 断言核验每次编辑；该轮数据如实保留并标注作废原因"],
  ["D8", "级联坍塌：4/20 张低对比渐变图像合并为单区域 K=1", "阶段验证首轮 BF 均值 0.322", "引入边界凭证机制（界面差异度 med+1.35×1.4826×MAD 以上禁止跨越），复跑后最小区域数 6，BF 均值 0.480"],
  ["D9", "结果 CSV 列错位：FS-COD 行多出 n_stable/n_concept 两列", "汇总脚本解析失败", "固定 18 列字段集，逐行对齐写入；坏文件删除重跑"],
  ["D10", "multi-Otsu 内层 Python 循环为性能瓶颈（约 15 ms/次，占单图耗时近半）", "全量运行预计耗时过长", "全向量化重写（600/600 随机直方图 + 20 张工件逐像素等价验证后切换）；首次向量化版本混入概率累积与一阶矩累积的量纲错误，被等价性测试当场捕获并修正；已计算的基线行保留，FS-COD 各行作废重算以保证运行时间口径一致"],
  ["D11", "语义规则编号不一致：区域规则按面积名次编号（对象k），界面规则却使用内部标签 id（区域k），同一文件中两套编号并存", "读者无法把界面规则与对象规则对应起来（审阅时暴露）", "界面规则改用同一套面积名次编号（boundary_and_semantics 内 rank_of 映射）；该缺陷只影响规则文本呈现，不影响任何分割结果与指标；编写 regen_rules.py 从冻结的 npz 标签重建语义结构，500 张规则文本全部再生成，npz 与指标数据不变"],
  ["D12", "设计文档插图在 LibreOffice 渲染中不可见（图片段落带固定行距 w:line，内嵌图片被裁剪至行高；docx-js 另生成重复 docPr id 与非法 cstate 属性）", "PDF 复核时六幅插图全部缺失", "图片段落改为无固定行距；postfix_docx.py 后处理统一修复 docPr 重号与非法属性；逐页渲染复核确认插图全部可见"],
  ["D13", "图题与图内文字曾使用中文，且对比面板把多张图像混排、失败案例仅展示两个基线，不符合「全部图内表述使用英文 Times New Roman、单图三行完整对比」的规范；另发现图片与图题可跨页分离、docx-js 的 mc:Ignorable 引用未声明命名空间两类版式缺陷", "规范审阅时暴露：图内中文字体不可控、面板信息不全、图 4-4 图题孤立成页、OpenXML 校验报 3 条命名空间错误", "全部插图重制为英文（Liberation Serif，与 Times New Roman 度量兼容的字体——沙箱无 Times 字体文件，文档正文字体仍指定 Times New Roman，由读者机器解析）；技术路线改为三列分阶段科研绘图；对比与失败面板改为单图 3×3 完整六方法；图片段落加 keepNext 防止与图题跨页分离；postfix_docx.py 增加移除非法 mc:Ignorable 属性；旧图文件全部移除"],
];
for (const [id, bug, sym, fix] of bugs) {
  children.push(para([run(`【${id}】`, { bold: true }), run(`缺陷：${bug}。表现：${sym}。修复：${fix}。`)],
    { alignment: AlignmentType.JUSTIFIED, indent: { firstLine: convertInchesToTwip(0.33) } }));
}

children.push(h1("五、标定与阶段验证"));
children.push(p(T`λ 标定在训练集 30 张（按标注区域数等距抽样）上进行，网格 {0.2, 0.35, 0.5, 1.0, 2.0, 4.0}，复合平均秩判据，λ = 0.5 为内部最优，冻结后不再变动。凭证系数 1.35 随 λ 联合标定。阶段验证在预声明的验证集 20 张（标注区域数 × 边界密度双变量分层，种子 20260927）上进行两轮：第一轮（λ 误为 1.0、无凭证约束）暴露 D8 坍塌；第二轮（λ = 0.5 + 凭证）通过：六项监督指标均值全部优于五个基线，逐图综合胜率 80%—95%，无坍塌。两轮原始数据均保留，第一轮作废原因记录于本报告与设计文档 4.3 节。`));

children.push(h1("六、全量验证"));
children.push(p(T`理论与参数冻结后，在 BSD500 全部 500 张上运行 6 个方法（FS-COD + 5 基线）与 3 个消融变体，共 4500 次运行（断点续跑，逐图落盘）。统计采用预注册规则与 Wilcoxon 符号秩检验。敏感性扫描（bs、τ、k_max）在阶段验证 20 张上另行运行。全部数值结果见设计文档第四章与 results/ 目录。`));

children.push(h1("七、反思"));
children.push(p(T`（1）理论—实现差距是主要风险源：D4、D5、D8 三个最严重缺陷都不在理论层面，而在理论要素映射为代码时的失真（邻接结构、状态延续、平衡判据）。教训：每个理论要素落地时必须配一个最小可观测判据（如"合并数 > 0"、"第二轮不重复合并"），否则失真会以静默方式存在。`));
children.push(p(T`（2）编辑核验不可或缺：D7 说明"自以为已修改"与"文件真实内容"可能不一致，凡参数冻结必须以文件级断言核验。`));
children.push(p(T`（3）阶段验证机制有效：预声明的 20 张抽样在全量运行前暴露了坍塌缺陷，避免了在 500 张上浪费算力并保护了测试集的纯洁性。`));
children.push(p(T`（4）环境限制：双核 CPU 使全量验证耗时数小时；学习型基线（gPb/HED/SAM）无法运行，仅作文献讨论；OCR 的母版文本可能存在残余误识，引用处以理论自洽性复核为准。`));

children.push(h1("八、诚实性声明"));
children.push(p(T`本报告与设计文档中的全部数值结果均来自随附代码的真实运行；未运行的实验（学习型方法对比）明确标注为文献讨论；作废数据（D6 紧致度、D7 λ 版本、D8 首轮阶段验证）均如实记录作废原因而非删除痕迹；参数仅在训练集标定；无任何针对具体图像的硬编码或人工后处理；训练/验证/测试之间无标注泄漏。尚待验证与未能完成的内容清单见设计文档 5.2 节。`));

const doc = new Document({
  features: { updateFields: false },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [para(run("FS-COD 1.0 过程与反思报告", { size: 18, color: "595959" }),
      { alignment: AlignmentType.CENTER })] }) },
    footers: { default: new Footer({ children: [para(new TextRun({ children: [PageNumber.CURRENT] }),
      { alignment: AlignmentType.CENTER })] }) },
    children,
  }],
});
fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
console.log("WROTE", outputPath);

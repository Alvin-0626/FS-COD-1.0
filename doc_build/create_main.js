// FS-COD 1.0 算法设计文档生成脚本（docx-js）
// 数据来源：../results/*.csv（真实运行结果）；公式使用 docx-js Math API（可编辑 OMML）
import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType, Document, Footer, Header, HeadingLevel, ImportedXmlComponent,
  Math as DMath, MathRun, MathFraction, MathSubScript, MathSuperScript,
  Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow,
  TextRun, WidthType, convertInchesToTwip, ImageRun, BorderStyle,
} from "docx";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Usage: node create_main.js /abs/out.docx");
const outDir = path.dirname(outputPath);
const BASE = path.resolve(outDir, "..");
const RESULTS = path.join(BASE, "results");
const FIGDIR = path.join(BASE, "figures");

const T = String.raw;
const font = { ascii: "Times New Roman", hAnsi: "Times New Roman", cs: "Times New Roman", eastAsia: "SimSun" };
const hfont = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "Microsoft YaHei" };
const INK = "1F3864"; // 深蓝主色

const run = (text, o = {}) => new TextRun({ text, font, size: 24, ...o });
const para = (children, o = {}) => new Paragraph({
  spacing: { after: 120, line: 320 }, ...o,
  children: Array.isArray(children) ? children : [children],
});
// 两端对齐正文，首行缩进两字符
const p = (text, o = {}) => para(run(text), {
  alignment: AlignmentType.JUSTIFIED,
  indent: { firstLine: convertInchesToTwip(0.33) }, ...o,
});
const h1 = (t) => para(new TextRun({ text: t, font: hfont, bold: true, size: 32, color: INK }),
  { heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } });
const h2 = (t) => para(new TextRun({ text: t, font: hfont, bold: true, size: 28, color: INK }),
  { heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 } });
const h3 = (t) => para(new TextRun({ text: t, font: hfont, bold: true, size: 24 }),
  { heading: HeadingLevel.HEADING_3, spacing: { before: 220, after: 120 } });

// 居中独立公式（可编辑 OMML）
const eq = (mathChildren, num) => para(
  [new DMath({ children: mathChildren }), ...(num ? [run(T`    （${num}）`)] : [])],
  { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 } });
const mr = (t) => new MathRun(t);
const frac = (n, d) => new MathFraction({ numerator: n, denominator: d });
const arr = (x) => (Array.isArray(x) ? x : [x]);
const sub = (e, s) => new MathSubScript({ children: arr(e), subScript: arr(s) });
const sup = (e, s) => new MathSuperScript({ children: arr(e), superScript: arr(s) });

const xmlEscape = (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const toc = (entries) => {
  const cached = entries.map(({ title, level, page }) => {
    const indent = Math.max(0, level - 1) * 360;
    return `<w:p><w:pPr><w:pStyle w:val="TOC${level}"/>
      <w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>
      <w:ind w:left="${indent}"/></w:pPr>
      <w:r><w:t>${xmlEscape(title)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${page}</w:t></w:r></w:p>`;
  }).join("");
  return ImportedXmlComponent.fromXmlString(`<w:sdt xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:sdtPr><w:alias w:val="目录"/></w:sdtPr><w:sdtContent>
      <w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/>
        <w:instrText xml:space="preserve"> TOC \\o &quot;1-3&quot; \\h \\z \\u </w:instrText>
        <w:fldChar w:fldCharType="separate"/></w:r></w:p>
      ${cached}
      <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    </w:sdtContent></w:sdt>`).root[0];
};

// 表格助手
const cell = (text, o = {}) => new TableCell({
  children: [para(run(String(text), { size: o._fs || 20 }), { spacing: { after: 0, line: 260 } })],
  margins: { top: 60, bottom: 60, left: 100, right: 100 }, ...o,
});
const makeTable = (widths, header, rows, fs = 20) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  columnWidths: widths,
  rows: [
    new TableRow({ children: header.map((h, i) => cell(h, {
      shading: { type: ShadingType.CLEAR, fill: "DEE6F0" },
      width: { size: widths[i], type: WidthType.DXA }, _fs: fs,
    })) }),
    ...rows.map((r) => new TableRow({ children: r.map((c, i) =>
      cell(c, { width: { size: widths[i], type: WidthType.DXA }, _fs: fs })) })),
  ],
});

// CSV 读取
function readCsv(fp) {
  if (!fs.existsSync(fp)) return null;
  const lines = fs.readFileSync(fp, "utf-8").trim().split("\n");
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const cols = l.split(",");
    const o = {}; head.forEach((h, i) => (o[h] = cols[i])); return o;
  });
}
// PNG 尺寸读取（IHDR）
function pngSize(fp) {
  const b = fs.readFileSync(fp);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
// 插图：按目标宽度等比缩放（绝不锁定双维度）
const fig = (file, caption, targetWPx = 500) => {
  const fp = path.join(FIGDIR, file);
  const out = [];
  if (!fs.existsSync(fp)) { out.push(p(`【图缺失：${file}】`)); return out; }
  const { w, h } = pngSize(fp);
  const wp = Math.min(targetWPx, w);
  const hp = Math.round((wp * h) / w);
  // 图片段落不得使用固定行距（w:line 会裁剪内嵌图片），单独构造
  out.push(new Paragraph({
    spacing: { after: 160 },
    alignment: AlignmentType.CENTER,
    keepNext: true,
    children: [new ImageRun({ type: "png", data: fs.readFileSync(fp),
      transformation: { width: wp, height: hp } })],
  }));
  out.push(para(run(caption, { size: 20, italics: true }), { alignment: AlignmentType.CENTER }));
  return out;
};

// ======================== 文档内容（数据驱动） ========================

const children = [];
const tocEntries = [];
const SEC = (title, level, page) => { tocEntries.push({ title, level, page }); return level === 1 ? h1(title) : level === 2 ? h2(title) : h3(title); };

// ---------- 封面 ----------
children.push(para(run("泛因素空间驱动的图像对象与边界协同识别算法", { bold: true, size: 44, color: INK, font: hfont }),
  { alignment: AlignmentType.CENTER, spacing: { before: 2200, after: 300 } }));
children.push(para(run("FS-COD 1.0：设计、验证与实现", { bold: true, size: 30, color: INK, font: hfont }),
  { alignment: AlignmentType.CENTER, spacing: { after: 900 } }));
children.push(para(run("理论基础：《泛因素空间与数据科学应用》（包研科，北京邮电大学出版社，2021）",
  { size: 24 }), { alignment: AlignmentType.CENTER, spacing: { after: 120 } }));
children.push(para(run(`生成日期：2026 年 9 月 29 日    版本：1.0（SCI 结构修订）`, { size: 24 }),
  { alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
children.push(new Paragraph({ children: [new TextRun({ break: 1, text: "" })], pageBreakBefore: true }));

// ---------- 目录 ----------
children.push(para(new TextRun({ text: "目  录", font: hfont, bold: true, size: 32, color: INK }),
  { alignment: AlignmentType.CENTER, spacing: { before: 240, after: 160 } }));

// ---------- 第一章 引言 ----------
children.push(SEC("第一章  引言", 1, 3));
children.push(SEC("1.1  图像分割研究领域背景及问题", 2, 3));
children.push(p(T`图像分割旨在把图像划分为若干具有一致语义或视觉属性的区域，是目标识别、场景理解、医学影像分析等几乎所有高层视觉任务的前置环节。其中两项子任务长期被分离处理：其一是对象识别，即获得内部一致、边界闭合的对象区域；其二是边界识别，即获得定位精确、与真实轮廓吻合的像素级边界。区域型方法追求区域内部的同质性，却往往产生模糊或漂移的边界；边界型方法追求精确的轮廓响应，却不承诺边界所围区域的对象一致性。早在区域与边界信息融合的综述中，研究者即已指出两类信息互补而难以统一是分割问题的结构性困难[15]；人类视觉系统对二者的处理则是协同的——对象由边界界定，边界因对象而获得语义。如何在一个统一、可解释、可复现的数学框架内实现对象与边界的协同识别，至今仍是开放问题。`));
children.push(p(T`本文关注的是无监督（不依赖训练标注学习）的对象与边界协同分割设定。该设定在标注稀缺、领域迁移频繁或要求模型决策可审计的场景中不可替代；同时，无监督机制的显式数学结构也使其成为检验"认知规律能否被严格算法化"这一基础问题的理想载体。本文即沿此方向，以泛因素空间理论为数学母版开展原始算法研究。`));
children.push(SEC("1.2  图像分割方法综述", 2, 3));
children.push(p(T`（1）区域型方法。该类方法以区域内部的相似性为准则组织像素。阈值法以 Otsu 类间方差最大化为代表[24]，简单高效但只适用于少数模态；特征空间聚类以 Mean Shift 的模态搜寻为代表[13]，无需指定区域数但对带宽敏感；图论方法把分割建模为图划分问题，Mumford—Shah 泛函奠定了"区域平滑项 + 边界长度项"的变分框架[23]，归一化割给出谱松弛下的全局准则[27]，最小割/最大流给出了能量极小化的高效求解[11]，Felzenszwalb 图割以自适应阈值的区域合并实现了近线性复杂度[14]；分水岭变换以地形浸没模拟获得闭合边界，配合标记抑制后成为经典基线[10]；超像素方法（以 SLIC 为代表）把过分割作为预处理，以紧致的小区域换取后续处理的效率与稳健性[8,28]。区域型方法的共同局限是：边界只是区域划分的副产品，其定位精度与语义显著性不被显式建模。`));
children.push(p(T`（2）边界型方法。该类方法直接检测轮廓响应。Marr—Hildreth 算子与 Canny 算子确立了"平滑—梯度—定位"的经典范式[20,12]；gPb 将多尺度亮度、颜色、纹理梯度与谱聚类结合，把轮廓检测推进到全局化阶段[9]；像素差分网络 PiDiNet 等轻量化深度边缘模型进一步提升了效率[29]。边界型方法的共同局限是：轮廓响应不构成封闭区域，对象一致性需另行恢复。`));
children.push(p(T`（3）基于学习的方法。全卷积网络把分割转化为逐像素分类[19]，U-Net 以编解码—跳跃连接结构在小样本医学影像上取得成功[26]，SegFormer 等 Transformer 结构进一步提升了语义分割精度[32]，Segment Anything（SAM）以大规模预训练实现了可提示的通用分割[17]。这类方法在监督指标上全面领先，但其决策依据隐含于参数之中，机制不可解释，且依赖大规模标注训练；在要求"机制透明、结论可审计"的研究场景中，显式数学构造的无监督方法仍有独立价值。`));
children.push(p(T`（4）泛因素空间系列方法。因素空间理论由汪培庄创立，是机制主义人工智能理论的数学基础[4]，经包研科等系统发展为面向数据科学的形式体系[1]，并在因素分析[2]、格结构对偶性[3]、因果推理分类[5]、可靠性分析[6]、可拓学融合[7]等任务中得到应用。将因素空间引入图像分割的前期工作（PFA 系列，包括 PFA_QSM_3.0/3.1 与 PFA-ACE 1.0）初步验证了"因素诱导商集、析合交替推进"的可行性，但也暴露出系统性缺陷：因素池职责不清（梯度因素同时承担边界支持与对象分裂，造成角色冲突）、阈值绝对化（无法跨图像自适应）、析合失衡（过度分裂或级联坍塌为单区域）、概念层碎裂、运行效率低。前期归因分析表明，这些缺陷并非来自母版理论，而是来自理论要素向算法映射时的失真与遗漏。`));
children.push(p(T`综上，四类方法各有所长，但"对象与边界在统一可解释框架内协同识别"这一问题仍未解决：区域型与边界型方法在结构上分离，学习型方法在机制上不可解释，泛因素空间系列虽具备可解释的形式框架却尚未形成成熟的算法实现。这正是本文的切入点。`));
children.push(SEC("1.3  本文方法与基本思想", 2, 4));
children.push(p(T`本文严格以《泛因素空间与数据科学应用》（包研科，2021）[1]为唯一理论母版，重新设计泛因素空间驱动的图像对象与边界协同识别算法 FS-COD 1.0（Factor-Space-driven Co-recognition of Objects and bounDaries）。其基本思想可概括为四句话：以原子论域上的商集（划分）为对象与边界的统一表示；以三类职责严格分离的因素池为"格坐标系"，对象因素负责区域解析、位置因素负责空间描述、边界支持因素只负责边界判定；以能量泛函为析—合平衡的严格数学对象，使"同类找相同（合）、异类找不同（析）、因素为先导（局部最优因素选择）、逐渐递进到平衡（闭环收敛）"的认知规律成为可计算的算法机制；以自适应边界凭证为对象整体性的硬约束，并输出像素级边界与中文语义规则作为可解释结果。`));
children.push(p(T`设计遵循四条原则：其一，理论严格性——全部概念以公理、定义、定理形式给出，核心机制不允许黑箱；其二，认知保真性——算法流程与上述认知规律一一对应；其三，可计算性——每个可计算的理论要素必须有对应代码实现，并给出理论—代码一致性对应表（表 3-1）；其四，实证诚实性——参数仅在训练集标定后冻结，全部指标来自真实运行，明确区分已验证结论与尚待验证内容。算法的总体执行逻辑按七个阶段组织，见图 3-1 的技术路线图及其在第三章的逐一展开。`));
children.push(SEC("1.4  研究贡献与论文结构", 2, 5));
children.push(p(T`本文贡献包括：（1）给出对象与边界协同识别的泛因素空间形式化模型，边界以像素/曲线级界面表示而非包围框；（2）提出能量泛函驱动、凭证约束的析—合闭环算法，以统一数学对象同时裁决分裂与合并；（3）提出自适应边界凭证机制（基于界面差异度的中位数—MAD 阈值），从机制上防止低对比渐变场景下的级联坍塌；（4）在 BSD500 基准[21]上与 5 个经典算法进行统一协议的完整对比，并给出消融、敏感性、显著性检验与失败案例分析；（5）全部理论要素与代码模块一一对应，全部实验结论可复现。`));
children.push(p(T`论文结构：第二章由浅入深给出母版理论中本文所需的数学符号、公理、定义与定理；第三章给出 FS-COD 1.0 的完整算法设计与理论—代码对应；第四章报告标定、阶段验证、全量验证、消融、敏感性、失败案例与语义示例；第五章总结结论、局限与展望，并明确区分已验证、仅推导与待验证内容。`));

// ---------- 第二章 理论基础 ----------
children.push(SEC("第二章  理论基础", 1, 6));
children.push(p(T`本章严格依据母版理论（包研科，2021）[1]第 1—3 章整理本文所需的数学基础，按由浅入深的顺序引入数学符号：2.1 节从最基础的集合划分与商集出发；2.2 节在划分之上引入因素与因素空间；2.3 节给出划分之间的度量；2.4 节上升至认知本体论四原理。为保持自洽，符号与编号在本文内部统一；凡与母版对应的命题均注明母版出处。`));
children.push(SEC("2.1  商集与划分格", 2, 6));
children.push(p(T`定义 2.1（划分与商集）。设 U 为有限非空论域。等价关系 R 诱导的等价类全体构成 U 的划分 Π，亦记为商集 U/R。本文中"划分"与"商集"同义互换使用。`));
children.push(p(T`定义 2.2（细化序）。对 U 上两个划分 Π₁、Π₂，若 Π₁ 的每个块都是 Π₂ 某个块的子集，则称 Π₁ 细化 Π₂，记 Π₁ ≼ Π₂。U 上全体划分在 ≼ 下构成有界格（划分格），最小元为离散划分（每元素自成一块），最大元为粗划分（U 自身为唯一块）。格的交运算 ∘ 取两划分的公共细化（块取非空交集），并运算 + 取两划分的公共粗化（由块的重叠连通闭包生成）。`));
children.push(eq([sub(mr("Π"), [mr("1")]), mr(" ∘ "), sub(mr("Π"), [mr("2")]), mr(" = { A ∩ B | A ∈ "), sub(mr("Π"), [mr("1")]), mr(", B ∈ "), sub(mr("Π"), [mr("2")]), mr(", A ∩ B ≠ ∅ }")], "2-1"));
children.push(p(T`命题 2.1（并的构造）。Π₁ + Π₂ 的块是二部重叠图（顶点为两划分的块，边为非空交）的连通分量之并。该命题给出并运算的可计算构造，是商集关联度（定义 2.10）可计算化的基础（母版定理 1.2 的构造性形式）。`));
children.push(SEC("2.2  因素与因素空间", 2, 7));
children.push(p(T`定义 2.3（因素，母版定义 2.1）。因素是从论域 U 到其相空间 I_f 的满射 f : U → I_f。相空间中的元素称为相态。因素按取值性质分为名义型、序型与数值型；本文使用的因素均为数值型或由其离散化得到的名义型。`));
children.push(p(T`定义 2.4（回溯与发现公理，母版定义 2.2）。因素 f 的回溯为 f̃ : I_f → P(U)，f̃(i) = f⁻¹(i)。论域由零因素 o（相空间只含"非对象"NoN）与全因素 e（相空间只含"对象"z）夹持，满足发现公理：ō(NoN) = U，ē(z) = ∅。`));
children.push(p(T`定义 2.5（因素序，反变关系）。称因素 g 不细于 f（记 f ≤ g），若 U/g 细化 U/f，即 g 的解析力不弱于 f。解析力越强，因素在序中越低：因素序与其诱导商集的细化序相反（反变关系，母版 §2.2）。零因素 o 为最大元，全因素 e 为最小元。`));
children.push(eq([mr("f ≤ g ⟺ ∀x, y ∈ U :  g(x) = g(y) ⟹ f(x) = f(y)")], "2-2"));
children.push(p(T`定义 2.6（因素的析与合，母版定义 2.6—2.7）。两因素 f、g 的析 f∧g 以联合相态 (i, j) 为相空间，诱导商集为 U/f ∘ U/g（公共细化）；其合 f∨g 诱导商集为 U/f + U/g（公共粗化）。`));
children.push(eq([mr("U/(f ∧ g) = U/f ∘ U/g,    U/(f ∨ g) = U/f + U/g")], "2-3"));
children.push(p(T`定理 2.1（因素空间为有界格，母版定理 2.1）。因素集 F 在 ∧、∨ 下构成有界非布尔格 (F; ∧, ∨, o, e)。证明要点：∧、∨ 的幂等、交换、结合与吸收律由商集格相应性质经反变映射保持；o、e 分别为上、下界；非布尔性源于划分格一般不满足分配律与补律。∎`));
children.push(p(T`定义 2.7（泛因素空间，母版定义 2.12）。泛因素空间为四元组 (U, 𝔉, 𝔛, P(U))，其中 U 为论域，𝔉 为因素集，𝔛 为相空间族，P(U) 为幂集（回溯的值域）。定义 2.8（自为因素，母版定义 2.13）与定义 2.9（有限因素标架，母版定义 2.14）给出由任务需求选定的有限因素集合作为"格坐标系"，本文的因素池即按此构造（见 3.2 节）。`));
children.push(SEC("2.3  商集关联度与熵关联度", 2, 8));
children.push(p(T`定义 2.10（商集关联度，母版定义 3.12）。设 X、Y 为 U 上两划分，块数分别为 n、m。对 X 的块 Xᵢ，在并商集 X+Y 中含 Xᵢ 的块内，取与 Xᵢ 交并比最大的 Y 块，记其交并比为 Jᵢ；商集关联度为按块大小的加权平均：`));
children.push(eq([mr("φ(X, Y) = "), sub(mr("Σ"), [mr("i=1..n")]), mr(" (|"), sub(mr("X"), [mr("i")]), mr("|/|U|) · "), sub(mr("J"), [mr("i")])], "2-4"));
children.push(p(T`φ ∈ [0, 1]，φ = 1 当且仅当 X 与 Y 在并商集意义下一致。命题 2.1 保证其可计算。母版另定义熵关联度 RI(X, Y) = I(X; Y)/√(H(X)H(Y))（I 为互信息，H 为熵），本文在监督指标中采用其标准化变体（见 4.1 节指标定义）。`));
children.push(SEC("2.4  认知本体论四原理", 2, 8));
children.push(p(T`母版将认知过程的本体论概括为四条原理（母版 §2.4）：（i）概括原理——认知以划分为载体，在商集上把握对象；（ii）对合原理——认知沿"析"与"合"两个相反方向推进，二者互为对合；（iii）反变原理——因素的解析力序与知识粒度序相反；（iv）极限原理——析合交替推进收敛于与任务相称的平衡划分。本文算法即四原理在图像识别任务中的可计算实现：3.3 节的分析算子实现"析"，3.4 节的合成算子实现"合"，3.5 节的闭环收敛判据实现极限原理，而"因素为先导、不同区域可用不同因素"的认知规律由局部最优因素选择机制实现。至此，本文所需的理论元件——表示（商集）、坐标（因素标架）、度量（离差与关联度）、动力（析合对合与极限原理）——均已备齐，第三章将它们逐一映射为算法构件。`));

// ---------- 第三章 算法设计 ----------
children.push(SEC("第三章  算法设计：FS-COD 1.0", 1, 9));
children.push(p(T`第二章给出了泛因素空间的公理化基础；本章的任务是把这些数学对象逐一转化为可计算的算法构件。转化的原则是"先有理论对象、后有算法机制"：论域、因素标架、离差、能量泛函、凭证与闭环分别对应定义 3.1—3.7 与算法 3.1—3.2，每个机制均注明其所实现的认知规律与所修正的前期缺陷，3.7 节再以对应表收口，保证理论与代码之间不存在无出处的环节。`));
children.push(SEC("3.1  总体框架", 2, 9));
children.push(p(T`FS-COD 1.0 在泛因素空间 (U, 𝔉, 𝔛, P(U)) 上运作：论域 U 为原子（atom）集合；因素集 𝔉 分为对象因素池、位置因素池与边界支持因素池三类；状态为 U 的划分 Π。算法主循环为"分析—合成"闭环：分析相位对每个当前区域独立选择局部最优因素并实施细化（析）；合成相位在能量泛函下降方向执行受边界凭证约束的聚合（合）；当单轮内既无可接受分裂亦无可接受合并时，判定达到析—合平衡（极限原理）。平衡划分随后进入边界判定与语义生成相位，输出对象标签图、像素级边界与语义规则。算法的执行逻辑按七个阶段组织，每个阶段对应一项明确的技术及其所处理的问题，完整的技术路线见图 3-1；图中阶段编号与 3.2—3.6 节的设计逐一对应，读者可按图索骥。`));
children.push(...fig("fig_technical_route.png", "图 3-1  FS-COD 1.0 技术路线图：执行阶段（第一列）—执行的技术名称（第二列）—处理的问题简述（第三列），阶段间以数据流顺序衔接", 560));
children.push(p(T`定义 3.1（原子论域）。图像 I（H×W 像素）被划分为 b×b 像素的非重叠块（本文 b = 3），每块为一个原子；论域 U 为全体原子，|U| ≈ HW/b²。原子是因素取值与划分运算的最小单元，边界最终以原子级界面表示并回投为像素级曲线（见 3.6 节）。取 b = 3 是在论域规模（计算量）与边界精度（3 像素 ≈ 评价容差 2 像素的量级）之间的折中，其敏感性在 4.6 节检验。`));
children.push(SEC("3.2  因素池：有限因素标架", 2, 10));
children.push(p(T`按母版定义 2.14，本文构造有限因素标架 𝔉 = 𝔉_vis ∪ 𝔉_pos ∪ 𝔉_cmp，三类职责严格分离（针对前期算法"梯度双重角色"缺陷的修正）：`));
children.push(p(T`（i）对象因素池 𝔉_vis = {L, a, b, LC, T}：L、a、b 为 CIELAB 颜色分量；LC 为局部对比度（原子均值与其 8 邻域原子均值之差的绝对值）；T 为局部纹理能量（b×3b 窗口灰度方差的邻域均值，窗口 7×7 原子）。该池承担对象内部的"同"与对象之间的"异"的解析。`));
children.push(p(T`（ii）位置因素池 𝔉_pos = {f_x, f_y, f_conn}：f_x、f_y 为原子质心归一化坐标；f_conn 为连通性因素——对同一相态的不同连通分量赋予不同相态标签。位置因素默认仅参与语义描述（如"图像上部"），是否参与分裂由配置开关控制（默认关闭，消融见 4.5 节）；f_conn 恒启用，保证同一相态的空间分离部分不被强行合并。`));
children.push(p(T`（iii）边界支持因素池 𝔉_cmp = {G}：G 为原子级梯度幅值（灰度高斯平滑 σ = 0.8 后取 Sobel 幅值的原子均值）。G 只用于边界判定与界面差异度计算，不参与对象区域的分裂裁决——边界支持与对象解析的职责由此分离。`));
children.push(p(T`每个对象因素 f 经图像级 z-score 标准化后，其在论域上的取值构成数值型相空间；相态由局部多阈值离散化给出（定义 3.3）。泛因素空间结构见图 3-2。`));
children.push(...fig("fig_factor_space.png", "图 3-2  泛因素空间 (U, 𝔉, 𝔛, P(U))：三类因素池与相空间—回溯结构", 480));
children.push(SEC("3.3  分析算子：递进式局部因素选择", 2, 11));
children.push(p(T`定义 3.2（区域离差）。设区域 R ⊆ U，对象因素权重 w = (w_L, w_a, w_b, w_LC, w_T) 由母版因素轮廓思想（母版 §3.3，q = x(R − E)）的归一化形式取为各因素全局方差占比。记区域 R 在标准化因素 f 上的平方和与和分别为 Q_f(R)、S_f(R)，面积为 A(R)，则区域离差为`));
children.push(eq([mr("D(R) = "), sub(mr("Σ"), [mr("f")]), mr(" "), sub(mr("w"), [mr("f")]), mr(" · max( "), sub(mr("Q"), [mr("f")]), mr("(R) − "), frac([sub(mr("S"), [mr("f")]), sup(mr("(R)"), [mr("2")])], [mr("A(R)")]), mr(", 0 )")], "3-1"));
children.push(p(T`D(R) 即 R 内各因素加权方差之和（乘 A(R) 的未归一形式），是"同类找相同"的可计算度量：同则离差小。`));
children.push(p(T`定义 3.3（局部相态离散化）。对区域 R 与对象因素 f，在 R 内的因素值直方图（128 桶）上执行多类 Otsu 阈值化[24]，类别数 k ∈ {2, 3} 取使类间方差最大者；所得 k 个类即因素 f 在 R 上的局部相态。局部性是该定义的关键：同一因素在不同区域可产生不同相态划分——蓝天区域按亮度细分、草地区域按色度细分，不同区域使用不同因素与不同相态，对应认知规律"因素为先导、异类找不同"的区域相对性。`));
children.push(p(T`定义 3.4（分析算子）。对当前划分 Π 中每个区域 R（预过滤：仅当 D(R) > 2λ·b 时考察，因为离差过小的区域任何分裂都不可能降低能量），对每个对象因素 f 计算候选细化 Π_R^f =（R 按 f 的局部相态划分，再经 f_conn 分解为连通块），要求至少两个子区域的原子数不小于 a_min = 4。记细化后区域集合为 Ch(R, f)，新增界面长度为 ΔB。分裂增益为`));
children.push(eq([mr("Δ"), sub(mr("E"), [mr("split")]), mr("(R, f) = D(R) − "), sub(mr("Σ"), [mr("C∈Ch(R,f)")]), mr(" D(C) − λ · ΔB")], "3-2"));
children.push(p(T`算法 3.1（递进式分析）。对每个候选区域 R，取使 ΔE_split 最大的因素 f*；仅当 ΔE_split(R, f*) > 0 时接受分裂。因素逐区域独立选择、每次只用一个最优因素，不使用机械固定的因素组合——这是"因素为先导"的算法实现，也是对前期算法固定因素顺序缺陷的修正。`));
children.push(SEC("3.4  合成算子：能量泛函与边界凭证", 2, 12));
children.push(p(T`定义 3.5（析—合平衡的能量泛函）。划分 Π 的能量为`));
children.push(eq([mr("E(Π) = "), sub(mr("Σ"), [mr("R∈Π")]), mr(" D(R) + λ · B(Π)")], "3-3"));
children.push(p(T`其中 B(Π) 为 Π 的界面总长度（像素单位），λ > 0 为析—合权衡系数（训练集标定，见 4.2 节）。第一项惩罚区域内之"异"（推动析），第二项惩罚界面之"多"（推动合）；该"区域拟合项 + 边界长度项"的结构与 Mumford—Shah 变分框架[23]一脉相承，但本文的拟合项由因素离差定义、边界项受凭证硬约束，且求解通过析—合闭环而非水平集或图割完成。E 的极小化即析—合平衡的严格数学对象（对合原理、极限原理）。`));
children.push(p(T`定义 3.6（合并增益）。对相邻区域 R_a、R_b，设公共界面长 γ_ab，合并后的区域为 R_ab，合并增益为`));
children.push(eq([mr("gain(a, b) = λ · "), sub(mr("γ"), [mr("ab")]), mr(" − ( D("), sub(mr("R"), [mr("ab")]), mr(") − D("), sub(mr("R"), [mr("a")]), mr(") − D("), sub(mr("R"), [mr("b")]), mr(") )")], "3-4"));
children.push(p(T`gain > 0 时合并使能量严格下降，对应"同类找相同"。合成采用堆优化的贪婪聚合：初始将全部相邻对按 gain 降序入堆，每次弹出最大增益对执行合并并更新邻接增益，直至堆空（无正增益对）。`));
children.push(p(T`定义 3.7（界面差异度与边界凭证）。相邻区域 R_a、R_b 的界面差异度为加权均值差`));
children.push(eq([mr("contrast(a, b) = "), sub(mr("Σ"), [mr("f")]), mr(" "), sub(mr("w"), [mr("f")]), mr(" · | "), sub(mr("μ"), [mr("f")]), mr("("), sub(mr("R"), [mr("a")]), mr(") − "), sub(mr("μ"), [mr("f")]), mr("("), sub(mr("R"), [mr("b")]), mr(") |")], "3-5"));
children.push(p(T`取当前全部界面差异度的中位数 med 与绝对中位差 MAD，定义凭证阈值 τ_cert = med + 1.35 × 1.4826 × MAD（1.4826 为正态一致性校正因子，1.35 在训练集上与 λ 联合标定）。凡 contrast(a, b) ≥ τ_cert 的界面称为持证界面。定理 3.1（凭证不变性）：合成算子不跨越持证界面——持证界面的合并被无条件禁止，无论其能量增益如何。`));
children.push(p(T`设计动机（诚实归因）：阶段验证暴露出在低对比渐变场景（如雾景、天空—远山过渡）中，纯能量准则会沿渐变链逐对合并，最终整图坍塌为单区域（K = 1）。能量泛函自身无法区分"同类渐变"与"异类低对比边界"，因为离差项对缓慢漂移不敏感。凭证机制把界面尺度上的显著性（相对本图界面分布的离群度）作为不可逾越的约束注入合成算子，相当于在能量极小化之外增加了由数据自适应确定的硬约束。该机制是对银杯例证（母版 §2.4：高光与阴影同属一杯，析合须以对象整体性为准）的算法化：对象的整体性由持证界面守护，不被局部能量贪心破坏。4.3 节报告该修正前后的对比。`));
children.push(SEC("3.5  析—合闭环与平衡判据", 2, 13));
children.push(p(T`算法 3.2（闭环）。置 Π ← 原子划分；重复以下步骤至多 L = 2 轮：（i）分析相位（算法 3.1）；（ii）合成相位（堆聚合 + 凭证约束）。若本轮分裂数与合并数均为零，提前终止。终态 Π* 即平衡划分。命题 3.1（终止性）：每轮分析使区域数严格增、合成使区域数严格减，且区域数有界（1 ≤ K ≤ |U|），轮数有上限，故算法必终止。命题 3.2（单调性）：每次被接受的分裂或合并都使 E 严格下降（凭证约束只禁止合并、不产生能量上升），故 Π* 是 E 在可达操作序列下的局部极小。`));
children.push(SEC("3.6  边界判定与语义规则生成", 2, 14));
children.push(p(T`边界判定。平衡划分的每一对相邻区域界面被分类为：持证（contrast ≥ τ_cert，标注 STABLE）或普通（UNCERTAIN）；每界面标注主导因素 argmax_f w_f|μ_f(R_a) − μ_f(R_b)|，即该边界主要由哪个因素解析。全部界面的原子级折线回投到像素网格，得到像素/曲线级边界图（而非包围框）。`));
children.push(p(T`语义规则。对每个区域生成中文规则："该区域位于图像{上部/中部/下部、左侧/中部/右侧}，面积占比 {x}%，其亮度为{极低/偏低/中等/偏高/极高}、色调为{…}、纹理为{…}，与邻域的主要差异来自因素{f*}"。相态词由该区域在全体区域中的分位确定。相态签名相同的区域归并为同一 Concept（母版概念层的简化实现），供后续概念层研究使用。语义规则逐图输出为文本文件（见交付清单）。`));
children.push(SEC("3.7  理论—代码一致性对应表", 2, 15));
children.push(p(T`表 3-1 给出每个可计算理论要素与代码模块的一一对应（代码文件 FS_COD.py，版本 1.0）。`));
children.push(makeTable(
  [2200, 3300, 3300],
  ["理论要素", "数学形式", "代码实现（FS_COD.py）"],
  [
    ["原子论域 U（定义 3.1）", "b×b 块划分", "fscod_segment：块聚合，bs=3"],
    ["因素映射与相空间（定义 2.3）", "f : U → I_f", "compute_factor_maps（L,a,b,LC,T,G,fx,fy）"],
    ["标准化与权重（母版 §3.3）", "z-score；w_f ∝ 全局方差", "EnergyState：V 标准化，权重归一"],
    ["回溯/连通相态 f_conn", "f̃(i) 的连通分解", "split_candidates 内连通分量实例化"],
    ["局部相态离散化（定义 3.3）", "多类 Otsu，k∈{2,3}", "_multiotsu_hist / discretize_local"],
    ["区域离差（定义 3.2）", "式 (3-1)", "EnergyState.dispersion / region_stats"],
    ["分析算子（算法 3.1）", "式 (3-2) 最大化", "analysis_phase + split_candidates"],
    ["能量泛函（定义 3.5）", "式 (3-3)", "EnergyState（D 项）+ atom_adjacency（B 项）"],
    ["合成算子（定义 3.6）", "式 (3-4)，堆贪婪", "composition_phase（heapq）"],
    ["边界凭证（定义 3.7）", "式 (3-5)，τ_cert = med+1.35·1.4826·MAD", "composition_phase 内 contrast/tau_cert 守卫"],
    ["析—合闭环（算法 3.2）", "交替至平衡，L=2", "fscod_segment 主循环 max_loop"],
    ["边界判定（3.6 节）", "STABLE/UNCERTAIN + 主导因素", "boundary_and_semantics"],
    ["语义规则与 Concept", "相态词 + 签名归并", "boundary_and_semantics 规则生成"],
  ]));
children.push(SEC("3.8  复杂度与实现参数", 2, 16));
children.push(p(T`设原子数 N = |U|。分析相位每轮对每个区域做常数（5）个因素的直方图阈值化，复杂度 O(N·m)，m 为因素数；合成相位堆操作 O(E log K)，E 为界面数。实测单图（481×321）CPU 单核运行时间约 2—8 秒（第四章给出分布）。冻结参数：b = 3，σ = 0.8，k_max = 3，λ = 0.5（训练集标定），τ 系数 1.35，min_child_atoms = 4，L = 2，纹理窗口 7×7。全部参数见 code/FS_COD.py 的 Config 数据类，除 λ 与 τ 系数经训练集标定外，其余为结构性常数（网格、窗口、轮数上限），不针对任何具体图像调整。`));
children.push(p(T`通用性说明。算法与数据集完全解耦：fscod_segment 接受任意 H×W×3 数组，命令行入口为 python3 FS_COD.py 输入图像路径 [输出目录]，输出像素级标签（npz）、边界叠加图（png）与语义规则（txt）；RGB、灰度、RGBA 输入自动适配。该入口已在 BSD500 以外的图像上实测通过（可用性验证，不涉及精度评价），运行记录见 code/README.md。至此算法设计完整闭合，下一章进入实证检验。`));

// ---------- 第四章 实证分析 ----------
const sumStage = readCsv(path.join(RESULTS, "summary_stage20.csv"));
const sumAll = readCsv(path.join(RESULTS, "summary_by_split.csv"));
const lamCal = readCsv(path.join(RESULTS, "lambda_calibration_summary.csv"));
const winStage = readCsv(path.join(RESULTS, "winrate_stage20.csv"));
const bench = readCsv(path.join(RESULTS, "benchmark_results.csv"));

const f3 = (v) => (v === undefined || v === null || v === "" || isNaN(+v)) ? "—" : (+v).toFixed(3);
const getRow = (rows, key, val) => (rows || []).find((r) => r[key] === val);

children.push(SEC("第四章  实证分析", 1, 17));
children.push(p(T`第三章给出了算法的完整构造，但理论自洽不等于实证有效。本章按"先标定、后冻结；先小样本阶段验证、后全量验证；先整体对比、后消融与敏感性分解"的顺序组织实验：4.1 节固定数据集、抽样、对比算法与指标协议；4.2 节在训练集上完成唯一结构参数的标定并冻结；4.3 节以预声明的 20 张样本做阶段验证，其唯一目的是在全量运行前暴露缺陷；4.4 节报告全量 500 张的完整对比；4.5—4.6 节分别回答"每个模块是否必要"与"结论对参数选择是否稳健"；4.7 节如实报告失败案例；4.8 节展示语义规则的实际输出形态。`));
children.push(SEC("4.1  实验设置", 2, 17));
children.push(p(T`数据集。BSD500（Berkeley Segmentation Dataset and Benchmark）[21]，含 500 张 481×321（或转置）自然图像，官方划分为训练 200、验证 100、测试 200；每张图像由多名标注者（4—9 名）提供手工分割。监督指标对每个标注者分别计算后取平均，以正确处理多标注结构；任何划分（训练/验证/测试）的标注均不进入算法或参数调整，训练/验证/测试之间不发生标注泄漏。`));
children.push(p(T`抽样声明（先于查看结果）。阶段验证集：在验证集 100 张上，按"标注区域数 × 边界密度"双变量四分位构成 4×4 网格，每格取距格中心最近的一张，不足 20 张时按标注区域数排序等距补足，随机种子 20260927；抽样代码为 code/run_benchmark.py 的 stage20_selection()，所选 20 张图像清单随结果文件保存。λ 标定集：训练集 200 张按标注区域数排序等距抽 30 张。完整验证：全部 500 张。`));
children.push(p(T`对比算法（5 个，均为经典公开算法，参数取文献常用默认值并预先固定，不针对图像个体调整）：SLIC[8]（n_segments=150，compactness=10）、Felzenszwalb 图割[14]（scale=100，σ=0.8，min_size=50）、Quickshift[31]（kernel=5，max_dist=10）、标记分水岭[10]（h-minima 抑制 h=0.12）、MeanShift[13]（空间带宽 15、颜色带宽 40、最小区域 150）。统一协议：同一图像、同一标注集、同一指标实现、同一硬件环境顺序运行。`));
children.push(p(T`评价指标（监督 6 项 + 无监督 6 项，定义与公式如下）。监督指标均以多名标注者的平均报告：`));
children.push(p(T`（1）边界 F 值 BF[9]：在 2 像素容差下，预测边界与真值边界的匹配精度 P 与召回 R 的调和平均 F = 2PR/(P+R)，越高越好。（2）概率 Rand 指数 PRI[30]：逐像素对在"同区/异区"判定上与真值的一致率，越高越好。（3）信息变分 VOI[22]：两划分的条件熵之和 VOI(X,Y) = H(X|Y) + H(Y|X)，越低越好。（4）分割覆盖度 COV[9]：每个真值区域取与其交并比最大的预测区域，按面积加权平均，越高越好。（5）边界位移误差 BDE[15]：预测边界像素到真值边界的平均距离与其对称项的平均，越低越好。（6）调整 Rand 指数 ARI[16]：Rand 指数[25]的几率校正形式，越高越好。`));
children.push(eq([mr("F = "), frac([mr("2 · P · R")], [mr("P + R")]), mr(",    VOI(X, Y) = H(X|Y) + H(Y|X)")], "4-1"));
children.push(p(T`无监督指标：（1）区内离差 IntraSSE（越低越好）；（2）区间对比 InterCon（相邻区域均值差的全图平均，越高越好）；（3）梯度支持度 GradSup（边界像素梯度幅值与非边界像素之比，越高越好）；（4）紧致度 Compact（4πA/P² 的区域平均，越高越好）；（5）尺寸熵 SizeEnt（区域尺寸分布的香农熵）；（6）区域数 NReg。后两项为描述性指标，不参与胜负判定。`));
children.push(p(T`综合判定规则（预注册，先于查看任何结果声明）。对图像 i 与基线 b：在 6 个监督指标上逐项比较，相对差小于 2% 判平；win(i, b) = 胜场数 − 负场数 ∈ [−6, 6]。FS-COD 在图像 i 上综合优于 b 当且仅当 win(i, b) ≥ 1；在数据集层面综合优于 b 当且仅当满足该条件的图像占比超过 50%。显著性采用 Wilcoxon 符号秩检验（逐指标、逐基线，n ≥ 10 时报告统计量与 p 值）。全部图像的全部指标如实报告，不做选择性汇报。`));
children.push(SEC("4.2  平衡系数 λ 的标定与冻结", 2, 19));
children.push(p(T`λ 在训练集 30 张标定图像上以网格搜索标定，评价标准为 6 项监督指标的平均秩（BF/PRI/COV/ARI 越高秩越小，VOI/BDE 越低秩越小）。候选网格 {0.2, 0.35, 0.5, 1.0, 2.0, 4.0}。标定曲线见图 4-1，数值见表 4-1。λ = 0.5 为内部最优点（复合平均秩最小），随即冻结并用于全部后续实验；验证集与测试集不参与标定。`));
(() => {
  const rows = lamCal || [];
  if (!rows.length) { children.push(p("【λ 标定表缺失】")); return; }
  const keyL = Object.keys(rows[0]);
  const lamKey = "lam";
  const rankKey = "composite_rank";
  const numKeys = ["BF", "PRI", "VOI", "COV", "BDE", "ARI", "nreg"];
  const head = ["λ", ...(rankKey ? ["平均秩"] : []), ...numKeys];
  const body = rows.map((r) => [r[lamKey], ...(rankKey ? [f3(r[rankKey])] : []), ...numKeys.map((k) => f3(r[k]))]);
  const w = Math.floor(8800 / head.length);
  children.push(makeTable(Array(head.length).fill(w), head, body));
  children.push(para(run("表 4-1  λ 网格标定结果（训练集 30 张，复合平均秩越小越好）", { size: 20, italics: true }), { alignment: AlignmentType.CENTER }));
})();
children.push(...fig("fig_lambda.png", "图 4-1  λ—复合平均秩曲线（训练集 30 张）", 420));

// 汇总表渲染助手：rows 为扁平 summary，methods 为行序，mets 选列
const MET_LABEL = { IntraSSE: "SSE", InterCon: "Con", GradSup: "GSup", Compact: "Comp", runtime: "t(s)" };
function summaryTable(rows, methods, mets, caption) {
  const head = ["方法", ...mets.map((k) => MET_LABEL[k] || k)];
  const body = [];
  for (const m of methods) {
    const r = getRow(rows, "method", m);
    if (!r) continue;
    body.push([m, ...mets.map((k) => f3(r[`${k}_mean`]))]);
  }
  const wide = mets.length > 7;
  const w = [1500, ...Array(mets.length).fill(Math.floor(7500 / mets.length))];
  children.push(makeTable(w, head, body, wide ? 15 : 18));
  children.push(para(run(caption, { size: 20, italics: true }), { alignment: AlignmentType.CENTER }));
}
const SUP_M = ["BF", "PRI", "VOI", "COV", "BDE", "ARI"];
const ALL_M = [...SUP_M, "IntraSSE", "InterCon", "GradSup", "Compact", "NReg", "runtime"];
const METHOD_ORDER = ["FS-COD", "SLIC", "Felzenszwalb", "Quickshift", "Watershed", "MeanShift"];

children.push(SEC("4.3  阶段验证（20 张预声明抽样）", 2, 20));
children.push(p(T`阶段验证在预声明的 20 张验证集图像上进行，其唯一目的是在全量验证前暴露算法缺陷。首次阶段运行即暴露出一处真实缺陷：在低对比渐变场景（雾景、天空—远山过渡等 4/20 张图像）中，纯能量准则的合成算子沿渐变链逐对合并，整图坍塌为单一区域（K = 1），该轮 BF 均值仅 0.322、平均区域数 12.2。归因：离差项对缓慢漂移不敏感，能量泛函无法区分"同类渐变"与"异类低对比边界"。修正：引入 3.4 节定义的边界凭证机制（定义 3.7），持证界面禁止跨越；该修正只增加硬约束、不改变能量准则本身，τ 系数 1.35 与 λ 在训练集上联合标定。修正后复跑同一预声明抽样，结果见表 4-2 与表 4-3：六项监督指标均值全部优于五个基线，无任一图像再发生坍塌（最小区域数 6）；按预注册规则，FS-COD 在 80%—95% 的图像上综合优于各基线，超过 50% 的数据集层面阈值。两次运行的原始数据均保留（修正前数据见过程与反思报告），未做选择性删除。`));
if (sumStage) summaryTable(sumStage, METHOD_ORDER, ALL_M, "表 4-2  阶段验证（20 张）逐方法均值：监督与无监督指标及运行时间（秒）");
if (winStage) {
  const body = winStage.map((r) => [r.baseline, f3(r.win_rate), f3(r.lose_rate), f3(r.tie_rate), f3(r.mean_win)]);
  children.push(makeTable([2200, 1650, 1650, 1650, 1650],
    ["对比基线", "综合胜率", "综合负率", "持平率", "平均净胜场"], body));
  children.push(para(run("表 4-3  阶段验证逐图综合胜率（预注册规则，n = 20）", { size: 20, italics: true }), { alignment: AlignmentType.CENTER }));
}
children.push(p(T`对表 4-2 的两点解读。其一，FS-COD 的优势来源与基线的失败模式互为镜像：SLIC、Quickshift 的超像素化倾向使其 COV 偏低（区域碎裂，真值对象被切成数十块），Watershed 与 MeanShift 的 NReg 高出 FS-COD 一个数量级而 BF 并未受益——边界数量多不等于边界正确；FS-COD 以能量泛函同时约束"碎"（λ·B 项）与"塌"（凭证约束），区域数与真值量级最为接近。其二，凭证修正的代价可控：凭证守卫只是对合成堆中候选对的一次 O(1) 查表（界面差异度在语义相位统一计算，复杂度 O(E)），不改变算法复杂度阶；修正后区域数从坍塌态的 1—12 恢复至与真值相当的量级，BF 均值由 0.322 升至 0.480。阶段验证的结论因此不仅是"指标更优"，而是"析—合平衡机制在预声明样本上以预期方式起作用"，这为全量验证提供了合格的候选算法。`));

children.push(SEC("4.4  完整验证（BSD500 全量 500 张）", 2, 22));
children.push(p(T`理论与参数冻结后，在 BSD500 全部 500 张图像上运行 FS-COD 与 5 个基线。逐划分均值见表 4-4 至表 4-6；逐图综合胜率见表 4-7；Wilcoxon 符号秩检验见表 4-8（报告测试集划分，其余划分见结果文件）。指标柱状对比见图 4-2，胜率图见图 4-3。为使数值结论可视化，选取两张代表性图像给出全部六个方法的逐图对比面板（图 4-4、图 4-5）：每张面板按三行组织，第一行为原始图像、人工标注（标注者 #1）与本文算法结果，第二行为 SLIC、Felzenszwalb、Quickshift，第三行为 Watershed 与 MeanShift；各子图标题给出该方法的区域数，便于与人工标注的对象量级直接对照。`));
for (const [sp, cap] of [["train", "表 4-4  训练集（200 张）逐方法均值"],
                         ["val", "表 4-5  验证集（100 张）逐方法均值"],
                         ["test", "表 4-6  测试集（200 张）逐方法均值"]]) {
  const rows = (sumAll || []).filter((r) => r.split === sp);
  if (rows.length) summaryTable(rows, METHOD_ORDER, ALL_M, cap);
  else children.push(p(`【${cap}：结果文件缺失】`));
}
for (const sp of ["test", "val", "train"]) {
  const wr = readCsv(path.join(RESULTS, `winrate_${sp}.csv`));
  if (!wr || !wr.length) continue;
  const body = wr.map((r) => [sp, r.baseline, f3(r.win_rate), f3(r.lose_rate), f3(r.tie_rate), f3(r.mean_win), r.n]);
  children.push(makeTable([800, 1900, 1300, 1300, 1300, 1300, 800],
    ["划分", "对比基线", "综合胜率", "综合负率", "持平率", "平均净胜场", "n"], body));
}
children.push(para(run("表 4-7  全量验证逐图综合胜率（预注册规则）", { size: 20, italics: true }), { alignment: AlignmentType.CENTER }));
(() => {
  const wl = readCsv(path.join(RESULTS, "wilcoxon_test.csv"));
  if (!wl || !wl.length) { children.push(p("【Wilcoxon 表缺失】")); return; }
  const body = wl.map((r) => [r.metric, r.baseline, f3(r.ours), f3(r.theirs), f3(r.stat),
    (+r.p < 0.001 ? "<0.001" : f3(r.p)), r.n]);
  children.push(makeTable([1000, 1900, 1250, 1250, 1250, 1250, 950],
    ["指标", "基线", "FS-COD 均值", "基线均值", "W 统计量", "p 值", "n"], body));
  children.push(para(run("表 4-8  Wilcoxon 符号秩检验（测试集，FS-COD vs 各基线）", { size: 20, italics: true }), { alignment: AlignmentType.CENTER }));
})();
children.push(p(T`全量结果的结构与阶段验证一致，且可以作三条更细的实证分析。其一，逐划分稳定性：表 4-4 至表 4-6 中 FS-COD 在 train/val/test 三个划分上的六项监督指标全部居于首位，且数值波动小（如 BF 均值 0.471—0.485），说明优势不是划分选择的结果，而是机制层面的稳定性质。其二，优势形态：对超像素型基线（SLIC、Quickshift），FS-COD 的领先主要体现在 COV 与 VOI——这两类指标惩罚区域碎裂，恰是"合"运算（凭证约束的聚合）所针对的失败模式；对聚类型基线（MeanShift），领先主要体现在 BF 与 BDE——像素级界面回投与主导因素判定使边界定位更准确。其三，显著性与效应量：表 4-8 的 30 组检验中 28 组 p < 0.001，仅有的例外集中在 BDE（其绝对差虽稳定为正，但符号秩受少数大偏差样本影响）；结合表 4-7 中 77.5%—98% 的逐图胜率（全部超过预注册的 50% 数据集层面阈值），可以判定 FS-COD 的优势同时具备统计显著性与逐图普遍性，而非由少数极端样本驱动。代价方面必须如实说明：FS-COD 测试集单图平均约 5.0 秒，高于 SLIC（0.37s）、Felzenszwalb（0.35s）、Watershed（0.14s）与 MeanShift（2.66s），仅低于 Quickshift（5.30s），效率在六方法中居第五位——可解释的机制构造以运行时间为代价，这一权衡在 5.3 节展望中给出改进路径。`));
children.push(...fig("fig_metric_bars.png", "图 4-2  测试集六项监督指标中的四项（BF、PRI、VOI、COV）逐方法对比（均值 ± 标准差）", 560));
children.push(...fig("fig_winrate.png", "图 4-3  逐图综合胜率（预注册规则）", 460));
children.push(p(T`图 4-4 与图 4-5 的可视化结果与表 4-4 至表 4-8 的数值结论相互印证。两幅图像中 FS-COD 的区域数（31 与 28）与人工标注的对象量级（9 个主区域，另有多标注者细分差异）最为接近，边界贴合物体轮廓；SLIC（126、115）与 Quickshift（320、410）呈现典型的超像素碎裂，真值对象被切分为数十至数百块，对应其 COV、VOI 的系统性落后；Watershed（238、349）与 MeanShift（2346、4455）的碎裂更为严重，"边界数量多"并未转化为"边界正确"，对应其 BF 并未因 NReg 高出一个数量级而受益；Felzenszwalb（277、375）介于其间。可视证据表明，FS-COD 的优势并非来自某个单一指标的偏好，而是"对象量级与边界形态同时接近人工标注"的结构性性质。`));
children.push(...fig("fig_compare_228076.png", "图 4-4  逐图对比面板（BSD500-test 228076）：第一行 原始图像 / 人工标注 #1 / FS-COD（本文）；第二行 SLIC / Felzenszwalb / Quickshift；第三行 Watershed / MeanShift", 560));
children.push(...fig("fig_compare_163004.png", "图 4-5  逐图对比面板（BSD500-test 163004）：布局同图 4-4", 560));
children.push(p(T`理论结合的分析。上述实证形态可由第三章的机制构造逐项解释，而非事后归因。其一，COV 与 VOI 的领先是"合"运算的直接投影：凭证约束下的聚合（定义 3.6—3.7）把分析相位产生的局部细化回收到对象量级，超像素型基线缺少对应的粗化机制，故在惩罚碎裂的指标上系统性落后——这印证了母版对合原理"析与合互为对合、缺一不可"的论断在指标层面的可观测性。其二，BF 与 BDE 的领先是"边界支持职责独立 + 像素级界面回投"的投影：梯度因素 G 不参与分裂裁决（3.2 节），避免了前期 PFA 算法中梯度的双重角色冲突，边界判定得以在平衡划分上以界面差异度独立完成。其三，逐划分稳定性（表 4-4 至表 4-6）是"阈值相对化"的投影：相态由区域内多阈值离散化给出（定义 3.3）、凭证阈值由本图界面差异度分布自适应给出（定义 3.7），算法中不存在任何依赖绝对数值的判定，故优势不随图像内容分布漂移而消失。这三条"机制—指标"对应关系把第四章的数值结论重新锚定到第二章的理论构件上，构成本文实证分析的核心论证链。`));

children.push(SEC("4.5  消融实验", 2, 26));
children.push(p(T`为验证各模块的必要性，在全量 500 张上运行三个消融变体：FS-COD-NoComp（关闭合成相位，只析不合）、FS-COD-NoTex（移除纹理因素 T）、FS-COD-NoSel（取消局部最优因素选择，退化为固定因素顺序）。结果见表 4-9。`));
(() => {
  const rows = (sumAll || []).filter((r) => r.split === "test");
  const ms = ["FS-COD", "FS-COD-NoComp", "FS-COD-NoTex", "FS-COD-NoSel"];
  if (rows.length) summaryTable(rows, ms, [...SUP_M, "NReg"], "表 4-9  消融实验（测试集均值）");
  else children.push(p("【消融结果缺失】"));
})();
children.push(p(T`消融结果与理论预测逐项对应。NoComp（只析不合）区域数由 38 暴增至 638、BF 由 0.485 跌至 0.401：没有合成相位，分析相位的局部细化无法被回收，划分退化为超像素碎片——这从反面证明了"合"运算是对象层粒度的来源，印证了母版对合原理中"析与合互为对合、缺一不可"的论断。NoSel（固定因素顺序）BF 降至 0.457、BDE 升至 13.53：不同区域的最优解析因素确实不同，取消局部选择后边界定位精度系统性下降，直接支持"因素为先导"机制的必要性。NoTex（去纹理因素）BF 仅降 0.006，但区域数由 38 降至 27：纹理因素主要贡献于强纹理对象（皮毛、 foliage）内部的细化分辨，对一般场景边际贡献小——这与 4.7 节失败模式（ii）强纹理过分裂互为印证，说明 T 因素的作用区间集中而非全局，保留它是因为其对强纹理图像不可或缺。`));

children.push(SEC("4.6  敏感性分析", 2, 27));
children.push(p(T`在阶段验证 20 张图像上对三类结构性参数做敏感性扫描：块尺寸 b ∈ {2, 3, 4}、凭证系数 τ ∈ {1.0, 1.35, 1.7}、相态上限 k_max ∈ {2, 3}，每组只变动一个参数，其余保持冻结值。评价为六项监督指标均值。结果见表 4-10；若某参数在给定范围内指标波动小于 5%，判定算法对该参数不敏感。`));
(() => {
  const sn = readCsv(path.join(RESULTS, "sensitivity.csv"));
  if (!sn || !sn.length) { children.push(p("【敏感性结果缺失】")); return; }
  const head = Object.keys(sn[0]);
  const w = Math.floor(8800 / head.length);
  children.push(makeTable(Array(head.length).fill(w), head, sn.map((r) => head.map((k) => f3(r[k])))));
  children.push(para(run("表 4-10  敏感性分析（阶段验证 20 张，监督指标均值）", { size: 20, italics: true }), { alignment: AlignmentType.CENTER }));
})();
children.push(p(T`敏感性结果与理论预期一致。b = 3 处于"论域规模—边界精度"折中的合理区间：b = 2 时边界更精细但计算量上升且原子内方差估计样本不足，b = 4 时最小可分辨界面超过评价容差（2 像素）的量级，BF 随之下降；τ 系数在 1.0—1.7 范围内指标波动有限，说明凭证机制的价值在于"是否存在约束"而非约束的精确位置——这与凭证作为离群度硬约束的设计意图相符（定义 3.7 只需把显著界面与渐变界面分开，不要求阈值本身最优）；k_max = 3 对多模态区域偏保守，但其与 k_max = 2 的差异小于消融实验中任一结构变更的幅度，说明算法结论主要由析—合闭环与凭证机制承载，而非由相态上限决定。`));

children.push(SEC("4.7  失败案例分析", 2, 28));
children.push(p(T`按预注册规则计算测试集每张图像对各基线的净胜场并取综合得分最低的 5 张作为失败案例（清单与逐方法指标见 results/failure_cases.csv）。对最差的两张给出全部六个方法的完整对比面板（图 4-6、图 4-7，布局同图 4-4），其余三张（145079、109055、2018）的完整面板见 figures/fig_failure_*.tiff，不在正文占用篇幅。典型失败模式包括：（i）极低对比度场景下凭证阈值偏高导致欠合并、区域偏碎；（ii）强纹理对象（皮毛、树叶）内部纹理因素引发过度分裂；（iii）极小对象（占比 <0.3%）在 b = 3 原子网格下方差估计不稳；（iv）伪装色强纹理场景（如鳄鱼/草地）相态碎裂为数百个细小连通块，任何分裂的界面代价都超过离差收益，算法拒绝分裂而退化为单区域（K = 1）。`));
children.push(p(T`以图 4-6（309040）为例作理论结合的分析：该图人工标注含 71 个区域（多标注者平均下的细碎场景），FS-COD 仅产生 43 个区域，呈欠分割；其机理是凭证阈值 τ_cert 依赖本图界面差异度的整体分布——当整图对比度低且对象细碎时，中位数—MAD 统计的区分度随之下降，部分本应持证的界面未获凭证而被能量准则合并。也就是说，失败并非机制的随机失效，而是"自适应阈值以全图分布为参照"这一设计在分布退化场景下的可预期边界：凭证机制用相对离群度替代绝对阈值，其代价正是对分布本身的依赖。从整体看，失败案例并未推翻全量结论：预注册胜率与 Wilcoxon 检验基于全部 200 张测试图像而非精选样本；失败案例的价值在于划清当前机制的适用边界，并为 5.3 节的改进方向（凭证与学习型边界概率结合）提供直接依据。`));
children.push(...fig("fig_failure_309040.png", "图 4-6  失败案例完整对比面板（BSD500-test 309040，净胜场最低）：布局同图 4-4", 560));
children.push(...fig("fig_failure_134049.png", "图 4-7  失败案例完整对比面板（BSD500-test 134049，净胜场次低）：布局同图 4-4", 560));

children.push(SEC("4.8  语义规则示例", 2, 29));
children.push(p(T`3.6 节定义的语义生成机制把平衡划分回译为中文规则，是算法可解释性的最终形态。本节选取规则数量较少的一幅验证集图像（BSD500-val 182053，6 条对象规则、6 条界面规则）完整展示真实输出：图 4-8 给出该图像的原图、FS-COD 对象划分与像素级边界叠加，图中对象编号与规则编号一一对应（编号按面积名次，与规则文件一致）。全部 500 张图像的规则文本见 results/fscod_artifacts/ 目录。`));
children.push(...fig("fig_semantic_example.png", "图 4-8  语义示例图像 182053：原图 / FS-COD 对象划分（编号对应规则）/ 像素级边界叠加", 540));
children.push(p(T`对象语义如下（逐对象一条，以下为程序输出原文，未作改写）：`));
(() => {
  const fp = path.join(RESULTS, "fscod_artifacts", "val", "182053_rules.txt");
  if (!fs.existsSync(fp)) { children.push(p("【规则示例文件缺失】")); return; }
  const lines = fs.readFileSync(fp, "utf-8").split("\n").filter(Boolean);
  const region = lines.filter((l) => l.startsWith("R-Region"));
  const bound = lines.filter((l) => l.startsWith("R-Boundary"));
  const rule = (ln) => para(run(ln, { size: 20 }), { indent: { left: 360 }, spacing: { after: 60 }, alignment: AlignmentType.JUSTIFIED });
  for (const ln of region) children.push(rule(ln));
  children.push(p(T`对照图 4-8（b）可以读出规则与图像内容的对应关系：对象0（面积 41.25%，图像上部）对应天空，其相态词"b 极低"正是蓝天的色度特征；对象1（40.63%，下部中部）为雪地与桥体的复合亮区（L 偏低是相对于全图均值而言的局部描述）；对象2（14.03%，中部）为列车蒸汽云，L 偏高且 a 极高将其与天空、雪地同时区分；对象3—5 为右下与左下的小面积暗部（阴影与水面）。位置词、面积词与相态词全部由 3.6 节的分位规则机械生成，不含任何人工撰写成分。`));
  children.push(p(T`界面语义如下（逐界面一条，同样为程序输出原文）：`));
  for (const ln of bound) children.push(rule(ln));
  children.push(p(T`界面规则揭示了边界判定的内部依据：天空与蒸汽云界面（对象0—对象2，最长界面 2514px）的主导区分因素是色度 a 而非亮度——二者亮度接近，靠色相差异解析；蒸汽云与雪地复合区界面（对象2—对象1）则由亮度 L 主导。本图全部六条界面均判定为 UNCERTAIN，这是如实而非缺陷：该图主体为蒸汽、雪地等软边界景物，界面差异度（0.203—0.544）整体低于本图自适应阈值 0.609，算法拒绝把渐变界面虚报为稳定边界；作为对照，强对比场景（如图 4-4 所示的灯塔图像 228076）的界面差异度分布更分散，其最强 3 条界面（对比度 0.97—1.13，阈值 0.90）被判定为 STABLE。这种"按本图界面分布的离群度分级置信"正是边界凭证机制（定义 3.7）在解释层的投影。`));
})();

// ---------- 第五章 结论与展望 ----------
children.push(SEC("第五章  结论与展望", 1, 30));
children.push(p(T`第四章的实验链条——标定、阶段验证、全量对比、消融、敏感性、失败案例与语义示例——已经闭合：每一项机制设计都对应至少一项实证检验，每一项实证发现也都能回溯到具体机制。本章在此基础上总结结论，并按诚实性原则区分三类内容。`));
children.push(SEC("5.1  结论", 2, 30));
children.push(p(T`本文以《泛因素空间与数据科学应用》为唯一理论母版，设计并实现了图像对象与边界协同识别算法 FS-COD 1.0。理论层面：以商集划分为表示、以三类职责分离的因素池为有限因素标架、以能量泛函为析—合平衡的严格数学对象、以边界凭证为对象整体性的硬约束，给出了公理化的算法构造与理论—代码一一对应。实证层面：在 BSD500 上经训练集标定（λ = 0.5）、阶段验证（暴露并修复级联坍塌缺陷）与全量验证（500 张 × 6 方法 × 3 消融），按预注册判定规则，FS-COD 在六项监督指标上整体优于五个经典基线，差异经 Wilcoxon 检验确认（具体数值以第四章表格为准）。认知保真层面：局部最优因素选择实现"因素为先导、异类找不同"，凭证约束的合成实现"同类找相同"，闭环收敛实现"逐渐递进到平衡"，语义规则与边界主导因素标注提供了逐区域的可解释性。`));
children.push(SEC("5.2  诚实性声明：已验证、仅推导与待验证内容", 2, 31));
children.push(p(T`已由真实运行验证的内容：第四章全部数值结果（标定曲线、阶段验证、全量验证、消融、敏感性、显著性检验、失败案例）均来自随附代码的真实运行，逐图明细见 results/benchmark_results.csv 与结果工件目录；阶段验证中的坍塌缺陷及其修复对比为真实发生的两轮运行，修正前后的数据均被保留。任意图像可用性：命令行入口 python3 FS_COD.py 输入图像路径 [输出目录] 已在 BSD500 以外的图像上实测通过（RGB、灰度、RGBA 各一例，仅验证可用性，不涉及精度）。仅由数学推导支持的内容：定理 2.1（格结构）、命题 3.1（终止性）、命题 3.2（能量单调性）由证明支持，其前提（操作只接受能量下降、轮数有上限）由代码实现保证，但"局部极小的全局质量界"未给出理论证明。尚待验证的内容：（i）b < 3 的原子网格对边界精度的提升幅度；（ii）凭证机制在视频时序数据上的稳定性；（iii）Concept 层与语义规则在下游任务（如检索、问答）中的效用。受当前环境限制未能完成的内容：与学习型方法（gPb、HED、SAM 等）的数值对比——受算力与依赖限制未运行，仅在文献层面讨论，不作为本文实证结论；TIFF 图为 300 dpi 导出，未进行印刷级校样。`));
children.push(SEC("5.3  局限与展望", 2, 32));
children.push(p(T`主要局限：（i）运行时间高于工程化基线（测试集均值约 5.0 秒/图，六方法中居第五位），瓶颈在逐区域直方图阈值化，可通过积分直方图优化；（ii）强纹理与极低对比场景仍有失败案例（4.7 节）；（iii）相态数上限 k_max = 3 对多模态区域偏保守。展望：因素池可扩展到深度特征因素（作为计算因素引入，保持可解释标注）；凭证机制可与学习型边界概率结合；Concept 层可发展为面向任务的开放词汇概念格。这些方向均不改变本文已冻结的核心算法与已报告的实验结论。`));

// ---------- 参考文献 ----------
children.push(SEC("参考文献", 1, 33));
children.push(p(T`以下文献均为真实出版物，经学术检索逐条核验（题名、作者、年份、出处）。按任务要求给出三种著录格式：GB/T 7714—2015、APA（第 7 版）、MPA。任务未定义"MPA"格式，本文明确声明：MPA 按 MLA（Modern Language Association，第 9 版）著录格式理解与执行。`));

// 文献数据：[id, GB/T 7714, APA, MLA]（MPA 声明按 MLA 执行）
const REFS = [
["bao2021",
 "包研科. 泛因素空间与数据科学应用[M]. 北京: 北京邮电大学出版社, 2021.",
 "包研科. (2021). 泛因素空间与数据科学应用. 北京邮电大学出版社.",
 "包研科. 泛因素空间与数据科学应用. 北京邮电大学出版社, 2021."],
["wang2014",
 "汪培庄, 郭嗣琮, 包研科, 刘海涛. 因素空间中的因素分析法[J]. 辽宁工程技术大学学报(自然科学版), 2014.",
 "Wang, P., Guo, S., Bao, Y., & Liu, H. (2014). 因素空间中的因素分析法. 辽宁工程技术大学学报(自然科学版).",
 "汪培庄, 等. \"因素空间中的因素分析法.\" 辽宁工程技术大学学报(自然科学版), 2014."],
["bao2018",
 "包研科, 汪培庄, 郭嗣琮. 因素空间的结构与对偶回旋定理[J]. 智能系统学报, 2018.",
 "Bao, Y., Wang, P., & Guo, S. (2018). 因素空间的结构与对偶回旋定理. 智能系统学报.",
 "包研科, 等. \"因素空间的结构与对偶回旋定理.\" 智能系统学报, 2018."],
["wang2018",
 "汪培庄. 因素空间理论——机制主义人工智能理论的数学基础[J]. 智能系统学报, 2018.",
 "Wang, P. (2018). 因素空间理论——机制主义人工智能理论的数学基础. 智能系统学报.",
 "汪培庄. \"因素空间理论——机制主义人工智能理论的数学基础.\" 智能系统学报, 2018."],
["zeng2023",
 "曾繁慧, 胡光闪, 孙慧, 汪培庄. 因素空间理论下的因果概率推理分类算法研究[J]. 智能系统学报, 2023.",
 "Zeng, F., Hu, G., Sun, H., & Wang, P. (2023). 因素空间理论下的因果概率推理分类算法研究. 智能系统学报.",
 "曾繁慧, 等. \"因素空间理论下的因果概率推理分类算法研究.\" 智能系统学报, 2023."],
["cui2019",
 "崔铁军, 汪培庄. 空间故障树与因素空间融合的智能可靠性分析方法[J]. 智能系统学报, 2019.",
 "Cui, T., & Wang, P. (2019). 空间故障树与因素空间融合的智能可靠性分析方法. 智能系统学报.",
 "崔铁军, 汪培庄. \"空间故障树与因素空间融合的智能可靠性分析方法.\" 智能系统学报, 2019."],
["li2022",
 "李兴森, 许立波, 刘海涛, 汪培庄. 因素空间与可拓学的互补性分析及问题处理融合模型[J]. 智能系统学报, 2022.",
 "Li, X., Xu, L., Liu, H., & Wang, P. (2022). 因素空间与可拓学的互补性分析及问题处理融合模型. 智能系统学报.",
 "李兴森, 等. \"因素空间与可拓学的互补性分析及问题处理融合模型.\" 智能系统学报, 2022."],
["achanta2012",
 "Achanta R, Shaji A, Smith K, et al. SLIC superpixels compared to state-of-the-art superpixel methods[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 2012, 34(11): 2274-2282.",
 "Achanta, R., Shaji, A., Smith, K., Lucchi, A., Fua, P., & Süsstrunk, S. (2012). SLIC superpixels compared to state-of-the-art superpixel methods. IEEE Transactions on Pattern Analysis and Machine Intelligence, 34(11), 2274–2282.",
 "Achanta, Radhakrishna, et al. \"SLIC Superpixels Compared to State-of-the-Art Superpixel Methods.\" IEEE Transactions on Pattern Analysis and Machine Intelligence, vol. 34, no. 11, 2012, pp. 2274–2282."],
["arbelaez2011",
 "Arbelaez P, Maire M, Fowlkes C, et al. Contour detection and hierarchical image segmentation[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 2011, 33(5): 898-916.",
 "Arbelaez, P., Maire, M., Fowlkes, C., & Malik, J. (2011). Contour detection and hierarchical image segmentation. IEEE Transactions on Pattern Analysis and Machine Intelligence, 33(5), 898–916.",
 "Arbelaez, Pablo, et al. \"Contour Detection and Hierarchical Image Segmentation.\" IEEE Transactions on Pattern Analysis and Machine Intelligence, vol. 33, no. 5, 2011, pp. 898–916."],
["beucher1979",
 "Beucher S, Lantuejoul C. Use of watersheds in contour detection[C]//Proceedings of the International Workshop on Image Processing. Rennes, France: CCETT, 1979.",
 "Beucher, S., & Lantuejoul, C. (1979). Use of watersheds in contour detection. In Proceedings of the International Workshop on Image Processing. CCETT.",
 "Beucher, Serge, and Christian Lantuejoul. \"Use of Watersheds in Contour Detection.\" Proceedings of the International Workshop on Image Processing, CCETT, 1979."],
["boykov2004",
 "Boykov Y, Kolmogorov V. An experimental comparison of min-cut/max-flow algorithms for energy minimization in vision[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 2004, 26(9): 1124-1137.",
 "Boykov, Y., & Kolmogorov, V. (2004). An experimental comparison of min-cut/max-flow algorithms for energy minimization in vision. IEEE Transactions on Pattern Analysis and Machine Intelligence, 26(9), 1124–1137.",
 "Boykov, Yuri, and Vladimir Kolmogorov. \"An Experimental Comparison of Min-Cut/Max-Flow Algorithms for Energy Minimization in Vision.\" IEEE Transactions on Pattern Analysis and Machine Intelligence, vol. 26, no. 9, 2004, pp. 1124–1137."],
["canny1986",
 "Canny J. A computational approach to edge detection[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 1986, 8(6): 679-698.",
 "Canny, J. (1986). A computational approach to edge detection. IEEE Transactions on Pattern Analysis and Machine Intelligence, 8(6), 679–698.",
 "Canny, John. \"A Computational Approach to Edge Detection.\" IEEE Transactions on Pattern Analysis and Machine Intelligence, vol. 8, no. 6, 1986, pp. 679–698."],
["comaniciu2002",
 "Comaniciu D, Meer P. Mean shift: A robust approach toward feature space analysis[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 2002, 24(5): 603-619.",
 "Comaniciu, D., & Meer, P. (2002). Mean shift: A robust approach toward feature space analysis. IEEE Transactions on Pattern Analysis and Machine Intelligence, 24(5), 603–619.",
 "Comaniciu, Dorin, and Peter Meer. \"Mean Shift: A Robust Approach toward Feature Space Analysis.\" IEEE Transactions on Pattern Analysis and Machine Intelligence, vol. 24, no. 5, 2002, pp. 603–619."],
["felzenszwalb2004",
 "Felzenszwalb P F, Huttenlocher D P. Efficient graph-based image segmentation[J]. International Journal of Computer Vision, 2004, 59(2): 167-181.",
 "Felzenszwalb, P. F., & Huttenlocher, D. P. (2004). Efficient graph-based image segmentation. International Journal of Computer Vision, 59(2), 167–181.",
 "Felzenszwalb, Pedro F., and Daniel P. Huttenlocher. \"Efficient Graph-Based Image Segmentation.\" International Journal of Computer Vision, vol. 59, no. 2, 2004, pp. 167–181."],
["freixenet2002",
 "Freixenet J, Muñoz X, Raba D, et al. Yet another survey on image segmentation: Region and boundary information integration[C]//Computer Vision—ECCV 2002. Berlin: Springer, 2002: 408-422.",
 "Freixenet, J., Muñoz, X., Raba, D., Martí, J., & Cufí, X. (2002). Yet another survey on image segmentation: Region and boundary information integration. In Computer Vision—ECCV 2002 (pp. 408–422). Springer.",
 "Freixenet, Jordi, et al. \"Yet Another Survey on Image Segmentation: Region and Boundary Information Integration.\" Computer Vision—ECCV 2002, Springer, 2002, pp. 408–422."],
["hubert1985",
 "Hubert L, Arabie P. Comparing partitions[J]. Journal of Classification, 1985, 2(1): 193-218.",
 "Hubert, L., & Arabie, P. (1985). Comparing partitions. Journal of Classification, 2(1), 193–218.",
 "Hubert, Lawrence, and Phipps Arabie. \"Comparing Partitions.\" Journal of Classification, vol. 2, no. 1, 1985, pp. 193–218."],
["kirillov2023",
 "Kirillov A, Mintun E, Ravi N, et al. Segment anything[C]//Proceedings of the IEEE/CVF International Conference on Computer Vision. 2023: 4015-4026.",
 "Kirillov, A., Mintun, E., Ravi, N., Mao, H., Rolland, C., Gustafson, L., ... Girshick, R. (2023). Segment anything. In Proceedings of the IEEE/CVF International Conference on Computer Vision (pp. 4015–4026).",
 "Kirillov, Alexander, et al. \"Segment Anything.\" Proceedings of the IEEE/CVF International Conference on Computer Vision, 2023, pp. 4015–4026."],
["lloyd1982",
 "Lloyd S. Least squares quantization in PCM[J]. IEEE Transactions on Information Theory, 1982, 28(2): 129-137.",
 "Lloyd, S. (1982). Least squares quantization in PCM. IEEE Transactions on Information Theory, 28(2), 129–137.",
 "Lloyd, Stuart. \"Least Squares Quantization in PCM.\" IEEE Transactions on Information Theory, vol. 28, no. 2, 1982, pp. 129–137."],
["long2015",
 "Long J, Shelhamer E, Darrell T. Fully convolutional networks for semantic segmentation[C]//Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition. 2015: 3431-3440.",
 "Long, J., Shelhamer, E., & Darrell, T. (2015). Fully convolutional networks for semantic segmentation. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (pp. 3431–3440).",
 "Long, Jonathan, et al. \"Fully Convolutional Networks for Semantic Segmentation.\" Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition, 2015, pp. 3431–3440."],
["marr1980",
 "Marr D, Hildreth E. Theory of edge detection[J]. Proceedings of the Royal Society of London. Series B, 1980, 207(1167): 187-217.",
 "Marr, D., & Hildreth, E. (1980). Theory of edge detection. Proceedings of the Royal Society of London. Series B, 207(1167), 187–217.",
 "Marr, David, and Ellen Hildreth. \"Theory of Edge Detection.\" Proceedings of the Royal Society of London, Series B, vol. 207, no. 1167, 1980, pp. 187–217."],
["martin2001",
 "Martin D, Fowlkes C, Tal D, et al. A database of human segmented natural images and its application to evaluating segmentation algorithms and measuring ecological statistics[C]//Proceedings of the Eighth IEEE International Conference on Computer Vision. 2001, 2: 416-423.",
 "Martin, D., Fowlkes, C., Tal, D., & Malik, J. (2001). A database of human segmented natural images and its application to evaluating segmentation algorithms and measuring ecological statistics. In Proceedings of the Eighth IEEE International Conference on Computer Vision (Vol. 2, pp. 416–423).",
 "Martin, David, et al. \"A Database of Human Segmented Natural Images and Its Application to Evaluating Segmentation Algorithms and Measuring Ecological Statistics.\" Proceedings of the Eighth IEEE International Conference on Computer Vision, vol. 2, 2001, pp. 416–423."],
["meila2003",
 "Meilă M. Comparing clusterings by the variation of information[C]//Learning Theory and Kernel Machines. Berlin: Springer, 2003: 173-187.",
 "Meilă, M. (2003). Comparing clusterings by the variation of information. In Learning Theory and Kernel Machines (pp. 173–187). Springer.",
 "Meilă, Marina. \"Comparing Clusterings by the Variation of Information.\" Learning Theory and Kernel Machines, Springer, 2003, pp. 173–187."],
["mumford1989",
 "Mumford D, Shah J. Optimal approximations by piecewise smooth functions and associated variational problems[J]. Communications on Pure and Applied Mathematics, 1989, 42(5): 577-685.",
 "Mumford, D., & Shah, J. (1989). Optimal approximations by piecewise smooth functions and associated variational problems. Communications on Pure and Applied Mathematics, 42(5), 577–685.",
 "Mumford, David, and Jayant Shah. \"Optimal Approximations by Piecewise Smooth Functions and Associated Variational Problems.\" Communications on Pure and Applied Mathematics, vol. 42, no. 5, 1989, pp. 577–685."],
["otsu1979",
 "Otsu N. A threshold selection method from gray-level histograms[J]. IEEE Transactions on Systems, Man, and Cybernetics, 1979, 9(1): 62-66.",
 "Otsu, N. (1979). A threshold selection method from gray-level histograms. IEEE Transactions on Systems, Man, and Cybernetics, 9(1), 62–66.",
 "Otsu, Nobuyuki. \"A Threshold Selection Method from Gray-Level Histograms.\" IEEE Transactions on Systems, Man, and Cybernetics, vol. 9, no. 1, 1979, pp. 62–66."],
["rand1971",
 "Rand W M. Objective criteria for the evaluation of clustering methods[J]. Journal of the American Statistical Association, 1971, 66(336): 846-850.",
 "Rand, W. M. (1971). Objective criteria for the evaluation of clustering methods. Journal of the American Statistical Association, 66(336), 846–850.",
 "Rand, William M. \"Objective Criteria for the Evaluation of Clustering Methods.\" Journal of the American Statistical Association, vol. 66, no. 336, 1971, pp. 846–850."],
["ronneberger2015",
 "Ronneberger O, Fischer P, Brox T. U-Net: Convolutional networks for biomedical image segmentation[C]//Medical Image Computing and Computer-Assisted Intervention—MICCAI 2015. Cham: Springer, 2015: 234-241.",
 "Ronneberger, O., Fischer, P., & Brox, T. (2015). U-Net: Convolutional networks for biomedical image segmentation. In Medical Image Computing and Computer-Assisted Intervention—MICCAI 2015 (pp. 234–241). Springer.",
 "Ronneberger, Olaf, et al. \"U-Net: Convolutional Networks for Biomedical Image Segmentation.\" Medical Image Computing and Computer-Assisted Intervention—MICCAI 2015, Springer, 2015, pp. 234–241."],
["shi2000",
 "Shi J, Malik J. Normalized cuts and image segmentation[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 2000, 22(8): 888-905.",
 "Shi, J., & Malik, J. (2000). Normalized cuts and image segmentation. IEEE Transactions on Pattern Analysis and Machine Intelligence, 22(8), 888–905.",
 "Shi, Jianbo, and Jitendra Malik. \"Normalized Cuts and Image Segmentation.\" IEEE Transactions on Pattern Analysis and Machine Intelligence, vol. 22, no. 8, 2000, pp. 888–905."],
["stutz2018",
 "Stutz D, Hermans A, Leibe B. Superpixels: An evaluation of the state-of-the-art[J]. Computer Vision and Image Understanding, 2018, 166: 1-27.",
 "Stutz, D., Hermans, A., & Leibe, B. (2018). Superpixels: An evaluation of the state-of-the-art. Computer Vision and Image Understanding, 166, 1–27.",
 "Stutz, David, et al. \"Superpixels: An Evaluation of the State-of-the-Art.\" Computer Vision and Image Understanding, vol. 166, 2018, pp. 1–27."],
["su2021",
 "Su Z, Liu W, Yu Z, et al. Pixel difference networks for efficient edge detection[C]//Proceedings of the IEEE/CVF International Conference on Computer Vision. 2021: 5117-5127.",
 "Su, Z., Liu, W., Yu, Z., Hu, D., Liao, Q., Tian, Q., ... Liu, L. (2021). Pixel difference networks for efficient edge detection. In Proceedings of the IEEE/CVF International Conference on Computer Vision (pp. 5117–5127).",
 "Su, Zhuo, et al. \"Pixel Difference Networks for Efficient Edge Detection.\" Proceedings of the IEEE/CVF International Conference on Computer Vision, 2021, pp. 5117–5127."],
["unnikrishnan2007",
 "Unnikrishnan R, Pantofaru C, Hebert M. Toward objective evaluation of image segmentation algorithms[J]. IEEE Transactions on Pattern Analysis and Machine Intelligence, 2007, 29(6): 929-944.",
 "Unnikrishnan, R., Pantofaru, C., & Hebert, M. (2007). Toward objective evaluation of image segmentation algorithms. IEEE Transactions on Pattern Analysis and Machine Intelligence, 29(6), 929–944.",
 "Unnikrishnan, Ranjith, et al. \"Toward Objective Evaluation of Image Segmentation Algorithms.\" IEEE Transactions on Pattern Analysis and Machine Intelligence, vol. 29, no. 6, 2007, pp. 929–944."],
["vedaldi2008",
 "Vedaldi A, Soatto S. Quick shift and kernel methods for mode seeking[C]//Computer Vision—ECCV 2008. Berlin: Springer, 2008: 705-718.",
 "Vedaldi, A., & Soatto, S. (2008). Quick shift and kernel methods for mode seeking. In Computer Vision—ECCV 2008 (pp. 705–718). Springer.",
 "Vedaldi, Andrea, and Stefano Soatto. \"Quick Shift and Kernel Methods for Mode Seeking.\" Computer Vision—ECCV 2008, Springer, 2008, pp. 705–718."],
["xie2021",
 "Xie E, Wang W, Yu Z, et al. SegFormer: Simple and efficient design for semantic segmentation with transformers[C]//Advances in Neural Information Processing Systems. 2021, 34: 12077-12090.",
 "Xie, E., Wang, W., Yu, Z., Anandkumar, A., Alvarez, J. M., & Luo, P. (2021). SegFormer: Simple and efficient design for semantic segmentation with transformers. In Advances in Neural Information Processing Systems (Vol. 34, pp. 12077–12090).",
 "Xie, Enze, et al. \"SegFormer: Simple and Efficient Design for Semantic Segmentation with Transformers.\" Advances in Neural Information Processing Systems, vol. 34, 2021, pp. 12077–12090."],
];

children.push(SEC("一、GB/T 7714—2015 著录格式", 2, 33));
REFS.forEach((r, i) => children.push(para(run(`[${i + 1}] ${r[1]}`, { size: 21 }),
  { spacing: { after: 60 }, indent: { left: 360, hanging: 360 } })));
children.push(SEC("二、APA（第 7 版）著录格式", 2, 34));
[...REFS].sort((a, b) => a[2].localeCompare(b[2])).forEach((r) =>
  children.push(para(run(r[2], { size: 21 }), { spacing: { after: 60 }, indent: { left: 360, hanging: 360 } })));
children.push(SEC("三、MPA 著录格式（声明：按 MLA 第 9 版执行）", 2, 35));
[...REFS].sort((a, b) => a[3].localeCompare(b[3])).forEach((r) =>
  children.push(para(run(r[3], { size: 21 }), { spacing: { after: 60 }, indent: { left: 360, hanging: 360 } })));

// ---------- 装配 ----------
const title = "泛因素空间驱动的图像对象与边界协同识别算法（FS-COD 1.0）设计文档";
// 目录插到"目  录"标题之后（目录条目需先收集完毕）
const tocNode = toc(tocEntries);
// children 前 6 项：封面 4 段 + 分页段 + "目  录"标题；目录插在其后
children.splice(6, 0, tocNode);

const doc = new Document({
  features: { updateFields: true },
  styles: { paragraphStyles: [1, 2, 3].map((i) => ({
    id: `TOC${i}`, name: `toc ${i}`,
    paragraph: { spacing: { after: 60 } },
    run: { font, size: 22 },
  })) },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [para(run(title, { size: 18, color: "595959" }),
      { alignment: AlignmentType.CENTER })] }) },
    footers: { default: new Footer({ children: [para(new TextRun({ children: [PageNumber.CURRENT] }),
      { alignment: AlignmentType.CENTER })] }) },
    children,
  }],
});
fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
console.log("WROTE", outputPath);

// 交付清单生成：扫描交付目录，列出文件/用途/生成方式/验证状态
import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType, Document, Footer, Header, HeadingLevel, Packer, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, convertInchesToTwip,
} from "docx";

const outputPath = process.argv[2];
const BASE = "/mnt/agents/output/FS_COD_交付";
const T = String.raw;
const font = { ascii: "Times New Roman", hAnsi: "Times New Roman", cs: "Times New Roman", eastAsia: "SimSun" };
const hfont = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "Microsoft YaHei" };
const INK = "1F3864";
const run = (t, o = {}) => new TextRun({ text: t, font, size: 22, ...o });
const para = (c, o = {}) => new Paragraph({ spacing: { after: 100, line: 300 }, ...o,
  children: Array.isArray(c) ? c : [c] });
const p = (t) => para(run(t), { alignment: AlignmentType.JUSTIFIED, indent: { firstLine: convertInchesToTwip(0.33) } });
const h1 = (t) => para(new TextRun({ text: t, font: hfont, bold: true, size: 32, color: INK }),
  { heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 180 } });
const cell = (t, o = {}) => new TableCell({
  children: [para(run(String(t), { size: 18 }), { spacing: { after: 0 } })],
  margins: { top: 50, bottom: 50, left: 80, right: 80 }, ...o });

// 清单数据由外部 JSON 注入（构建前由 Python 扫描生成）
const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(outputPath), "checklist_data.json"), "utf-8"));

const children = [];
children.push(para(new TextRun({ text: "FS-COD 1.0 交付清单", font: hfont, bold: true, size: 40, color: INK }),
  { alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 240 } }));
children.push(para(run(`生成日期：2026 年 9 月 29 日（修订版）    交付根目录：FS_COD_交付/`, { size: 22 }),
  { alignment: AlignmentType.CENTER, spacing: { after: 300 } }));
children.push(p(T`本清单逐项列出交付文件的名称、用途、生成方式与验证状态。验证状态分为：已验证（真实运行产出且经校验/复核）、已校验（文档类通过 docx 结构与渲染检查）、声明（说明性文件，无需运行验证）。所有数值结果均可由 code/ 目录脚本按 README.md 复现。`));

const widths = [2900, 2600, 1900, 1500];
const rows = meta.items.map((it) => new TableRow({ children: [
  cell(it.file, { width: { size: widths[0], type: WidthType.DXA } }),
  cell(it.purpose, { width: { size: widths[1], type: WidthType.DXA } }),
  cell(it.origin, { width: { size: widths[2], type: WidthType.DXA } }),
  cell(it.status, { width: { size: widths[3], type: WidthType.DXA } }),
] }));
children.push(new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  columnWidths: widths,
  rows: [new TableRow({ children: ["文件名", "用途", "生成方式", "验证状态"].map((h, i) =>
    cell(h, { shading: { type: ShadingType.CLEAR, fill: "DEE6F0" },
      width: { size: widths[i], type: WidthType.DXA } })) }), ...rows],
}));

children.push(h1("附：实验合规性核验"));
for (const line of meta.compliance) children.push(p(line));

const doc = new Document({
  features: { updateFields: false },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1080, right: 1080 } } },
    headers: { default: new Header({ children: [para(run("FS-COD 1.0 交付清单", { size: 18, color: "595959" }),
      { alignment: AlignmentType.CENTER })] }) },
    footers: { default: new Footer({ children: [para(new TextRun({ children: [PageNumber.CURRENT] }),
      { alignment: AlignmentType.CENTER })] }) },
    children,
  }],
});
fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
console.log("WROTE", outputPath);

#!/usr/bin/env python3
"""DOCX 后处理：修复 docx-js 生成的两个兼容性问题。

1. 所有 wp:docPr 共用 id="1"（OOXML 要求唯一），重编号为 101..n；
2. a:blip 上的 cstate="none" 不是 ST_BlipCompression 的合法取值，删除；
   同时删除空的 <a:srcRect/>；
3. w:document 根的 mc:Ignorable="w14 w15 wp14" 引用了未声明的命名空间，
   且正文未使用这些前缀，直接移除该属性。

用法：python3 postfix_docx.py /absolute/path/file.docx
"""
import re
import shutil
import sys
import tempfile
import zipfile


def main(path: str) -> None:
    tmp = tempfile.NamedTemporaryFile(suffix=".docx", delete=False).name
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                s = data.decode("utf-8")
                counter = {"n": 0}

                def repl(m):
                    counter["n"] += 1
                    return f'<wp:docPr id="{100 + counter["n"]}"'

                s = re.sub(r'<wp:docPr id="\d+"', repl, s)
                s = s.replace(' cstate="none"', "").replace("<a:srcRect/>", "")
                s = s.replace(' mc:Ignorable="w14 w15 wp14"', "")
                data = s.encode("utf-8")
            zout.writestr(item, data)
    shutil.move(tmp, path)
    print(f"postfix done: {path}")


if __name__ == "__main__":
    main(sys.argv[1])

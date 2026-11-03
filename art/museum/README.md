# AXIS 原创机械展馆资产

2026-11-01，为本项目制作；不包含外部参考网站的几何或纹理。

- `axis-gallery.blend`：Blender 5.2.2 LTS源文件，可编辑地面、四个展台、轨道、支架与灯光。
- 生成入口：项目的`scripts/build-museum-assets.py`。
- 浏览器文件：`public/models/museum/axis-gallery.glb`，原始1,198,548字节；gzip测量198,552字节。运行资产按五种材质合并，避免大量独立draw call。新装饰资产不超过2MB预算。
- GLB采用Y向上；入口、学习、资料、还原展台分别位于`(0,0,0)`、`(3.4,0,0)`、`(0,0,-3.4)`、`(-3.4,0,0)`。顶面高度约`-0.04m`。
- 实际魔方转层和机械关节仍由经过校验的程序驱动，不烘焙进此资产。

源文件SHA256：`3bcd8d35d902310c182bd63e30d5f664418282f6c50fc966e545395e3d0adbb4`。
GLB SHA256：`8155e9e5322d79f46a59b8c1a9fc9729f1faf81b86f977c1b4590f107c4c2e39`。

构建日志与概览渲染位于`evidence/museum-upgrade-2026-11-01/assets/`。线上只发布GLB；Blender源文件与脚本留在项目中。

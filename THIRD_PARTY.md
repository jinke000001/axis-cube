# 第三方来源与修改

2026-11-11 的 C114 r1／U8 r1 展台使用早期白色 Wuji 手。运行资产、上游版本、几何处理说明和 MIT 许可随 `public/models/wuji-teaching/` 提供。

本项目未复制 Kimi 展示站的页面源码、模型或动作库；该展示仅用于理解早期参考方向。场景、机械臂造型、动作编排和产品界面为本项目实现。

2026-11-01 的 CFOP 指法演示器使用本项目原创教学手：Blender 源文件在 `art/teaching-hand/axis-teaching-hand.blend`，刚性关节规格在同目录 `rig.json`，网页加载 `public/models/teaching-hand/axis-teaching-hand.glb`。旧 Wuji 模型与许可保留，但新演示入口不加载该模型。

CFOP 原表编号、公式、分组与彩色手指标注依据用户提供的 GAN 公式表，识别图由魔方状态重新生成。指法基础动作参考 [GAN Tymon PLL 教学](https://www.youtube.com/watch?v=ofeidRXHOWc) 和 [J Perm 指法教学](https://www.youtube.com/watch?v=wLuVF9Dk3AQ)。引用的观察段落、采用范围与差异在 `docs/cfop-finger-reference.md`；未复制教程视频、声音或模型进入网页，轨迹不是从教程恢复的人体动作捕捉。

| 组件 | 来源与版本 | 使用及许可 |
| --- | --- | --- |
| Wuji 左右手 | [wuji-technology/wuji-description](https://github.com/wuji-technology/wuji-description/tree/829c9aa27cb12c3a49d5b8d63c9869dd8f656702) | MIT；固定 829c9aa27cb12c3a49d5b8d63c9869dd8f656702，55 个 URDF / STL / 许可文件。本地源文件未改动；运行时重建平滑法线与展示材质，使用自定义握姿与手腕轨迹。 |
| cubejs | [ldez/cubejs](https://github.com/ldez/cubejs)，1.3.2 | MIT；仅复制 index.js、lib/cube.js、lib/solve.js 与 LICENSE。删除未使用的 npm CLI 依赖，包标识 1.3.2-local.1。 |
| CFOP求解器 | [slammayjammay/rubiks-cube-solver v1.2.0](https://github.com/slammayjammay/rubiks-cube-solver/tree/7c4f292bf56bebd11bc498d0c33b25b94a9dc054) | MIT；固定源码、离线ESM构建、校验值在`vendor/rubiks-cube-solver/`。本项目将其上十字坐标转换为下十字，比较四个候选，并以独立54格状态核对Cross/F2L/OLL/PLL。上游识别键不是标准公式编号。 |
| CFOP内部依赖 | [gl-vec3](https://github.com/stackgl/gl-vec3) 1.0.3；[array-element-combiner](https://github.com/slammayjammay/array-element-combiner) 1.0.0 | 分别为zlib、MIT；固定源与许可随CFOP vendor保留。未声明的可选chalk调试入口在离线构建时映射到无颜色适配，不启用终端调试，不产生运行时网络请求。 |
| urdf-loader | [gkjohnson/urdf-loaders v0.13.1](https://github.com/gkjohnson/urdf-loaders/tree/v0.13.1)，npm 0.13.1 | Apache-2.0；读取模型与关节限制。源代码未修改。官方包未携带 LICENSE，已从同版本官方仓库补入 `public/licenses/urdf-loader.txt`。 |
| Three.js | [mrdoob/three.js](https://github.com/mrdoob/three.js)，0.186.1 | MIT；三维场景、网格加载和交互。 |
| GSAP | [greensock/GSAP](https://github.com/greensock/GSAP)，3.15.0 | GreenSock Standard No Charge License；统一相机和界面动画。保留上游代码内版权声明与 `public/licenses/gsap.txt` 来源；未用于可视化动画制作平台。官方许可核查 2026-11-01。 |
| React / React DOM / Scheduler | [facebook/react](https://github.com/facebook/react)，19.3.1 / 19.3.1 / 0.28.0 | MIT；界面。 |
| Lucide React | [lucide-icons/lucide](https://github.com/lucide-icons/lucide)，1.61.0 | ISC / MIT，具体见随附原许可；图标。 |
| OpenCV.js / WASM | [opencv/opencv 4.13.0](https://github.com/opencv/opencv/releases/tag/4.13.0) | Apache-2.0；同源托管，用于照片九格定位。官方发布物中四处动态函数生成改为静态闭包，避免开放字符串代码执行。原始与适配后校验值、修改脚本、附属许可见 `vendor/opencv/` 与 `public/licenses/opencv-third-party/`。 |
| Capacitor 与原生适配 | [ionic-team/capacitor](https://github.com/ionic-team/capacitor) core / iOS / Android 8.6.0；App 8.1.2；Preferences 8.0.1；Filesystem 8.1.5；Share 8.0.3 | MIT；本地网页打包、生命周期与小型本地备份。正式网页资源随安装包提供，不打开远程网站作为应用主体。 |
| Capacitor Synapse | 随 Filesystem 的 `@capacitor/synapse` 1.0.4 | 官方插件内部消息通路；随包 `LICENSE.md` 为 MIT、Copyright 2025 Ionic，已原样保留。包元信息的 `license` 字段标为 ISC，与随附原文名称不同；分发保留原许可声明。 |
| 六面实拍验收照片 | [dwalton76/rubiks-cube-tracker](https://github.com/dwalton76/rubiks-cube-tracker/tree/40f372982430ba8d7e4c9070bdb429e1ab0450ba/test-data/3x3x3-random-01) | MIT，固定 commit `40f372982430ba8d7e4c9070bdb429e1ab0450ba`；六张 PNG 的 Git blob hash 已核对，原图和许可在 `tests/fixtures/real-3x3/`。仅作为测试资料，不打包进网页。`annotation.json` 为本次逐格视觉标注和像素采样，不是上游官方标签。 |

cubejs 唯一运行时代码修改位于 `vendor/cubejs/lib/solve.js`：将依赖顶层 `this` 的 `this.Cube || require('./cube')` 改成 `require('./cube')`，以便在严格模式 ES Module Worker 中加载。原算法保持不变；输入与输出另外经过本项目独立校验。

完整许可：`public/licenses/`、`vendor/cubejs/LICENSE` 和 `public/models/wuji/LICENSE`。开发依赖版本固定于 `package-lock.json`；不属于浏览器运行时的工具不会打包进应用。

入门课程文案和案例为本项目编写，方法参考 [GAN 层先法](https://www.gancube.com/pages/layer-by-layer-guide-of-gancube) 与 [J Perm 初学教程](https://jperm.net/3x3)，核查日期 2026-11-01；未复制原站插图或文案。网页设计参考与采用范围见 `docs/beginner-site-upgrade-plan-2026-11-01.md`，参考作品的素材不随应用分发。

旧版本速度参考：[WCA 2025 世锦赛三阶结果](https://www.worldcubeassociation.org/competitions/WC2025/results/all?event=333)，前三名平均成绩 4.23、4.49、4.98 秒。旧版曾采用约 5 秒视觉展示节奏；当前指法演示器已取消整条公式五秒完成的约束，按接触、拨动与衔接使用教学节奏。这些展示均不代表比赛成绩或实体机器人能力。

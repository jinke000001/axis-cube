# 第三方来源与修改

本项目未复制 Kimi 展示站的页面源码、模型或动作库；该展示仅用于理解早期参考方向。场景、机械臂造型、动作编排和产品界面为本项目实现。

| 组件 | 来源与版本 | 使用及许可 |
| --- | --- | --- |
| Wuji 左右手 | [wuji-technology/wuji-description](https://github.com/wuji-technology/wuji-description/tree/829c9aa27cb12c3a49d5b8d63c9869dd8f656702) | MIT；固定 829c9aa27cb12c3a49d5b8d63c9869dd8f656702，55 个 URDF / STL / 许可文件。本地源文件未改动；运行时重建平滑法线与展示材质，使用自定义握姿与手腕轨迹。 |
| cubejs | [ldez/cubejs](https://github.com/ldez/cubejs)，1.3.2 | MIT；仅复制 index.js、lib/cube.js、lib/solve.js 与 LICENSE。删除未使用的 npm CLI 依赖，包标识 1.3.2-local.1。 |
| CFOP求解器 | [slammayjammay/rubiks-cube-solver v1.2.0](https://github.com/slammayjammay/rubiks-cube-solver/tree/7c4f292bf56bebd11bc498d0c33b25b94a9dc054) | MIT；固定源码、离线ESM构建、校验值在`vendor/rubiks-cube-solver/`。本项目将其上十字坐标转换为下十字，比较四个候选，并以独立54格状态核对Cross/F2L/OLL/PLL。上游识别键不是标准公式编号。 |
| CFOP内部依赖 | [gl-vec3](https://github.com/stackgl/gl-vec3) 1.0.3；[array-element-combiner](https://github.com/slammayjammay/array-element-combiner) 1.0.0 | 分别为zlib、MIT；固定源与许可随CFOP vendor保留。未声明的可选chalk调试入口在离线构建时映射到无颜色适配，不启用终端调试，不产生运行时网络请求。 |
| urdf-loader | [gkjohnson/urdf-loaders v0.13.1](https://github.com/gkjohnson/urdf-loaders/tree/v0.13.1)，npm 0.13.1 | Apache-2.0；读取模型与关节限制。源代码未修改。官方包未携带 LICENSE，已从同版本官方仓库补入 `public/licenses/urdf-loader.txt`。 |
| Three.js | [mrdoob/three.js](https://github.com/mrdoob/three.js)，0.186.1 | MIT；三维场景、网格加载和交互。 |
| React / React DOM / Scheduler | [facebook/react](https://github.com/facebook/react)，19.3.1 / 19.3.1 / 0.28.0 | MIT；界面。 |
| Lucide React | [lucide-icons/lucide](https://github.com/lucide-icons/lucide)，1.61.0 | ISC / MIT，具体见随附原许可；图标。 |
| 六面实拍验收照片 | [dwalton76/rubiks-cube-tracker](https://github.com/dwalton76/rubiks-cube-tracker/tree/40f372982430ba8d7e4c9070bdb429e1ab0450ba/test-data/3x3x3-random-01) | MIT，固定 commit `40f372982430ba8d7e4c9070bdb429e1ab0450ba`；六张 PNG 的 Git blob hash 已核对，原图和许可在 `tests/fixtures/real-3x3/`。仅作为测试资料，不打包进网页。`annotation.json` 为本次逐格视觉标注和像素采样，不是上游官方标签。 |

cubejs 唯一运行时代码修改位于 `vendor/cubejs/lib/solve.js`：将依赖顶层 `this` 的 `this.Cube || require('./cube')` 改成 `require('./cube')`，以便在严格模式 ES Module Worker 中加载。原算法保持不变；输入与输出另外经过本项目独立校验。

完整许可：`public/licenses/`、`vendor/cubejs/LICENSE` 和 `public/models/wuji/LICENSE`。开发依赖版本固定于 `package-lock.json`；不属于浏览器运行时的工具不会打包进应用。

速度参考：[WCA 2025 世锦赛三阶结果](https://www.worldcubeassociation.org/competitions/WC2025/results/all?event=333)，前三名平均成绩 4.23、4.49、4.98 秒。这里只用于选择约 5 秒的视觉展示节奏，不代表本项目创造比赛成绩或拥有对应实体机器人能力。

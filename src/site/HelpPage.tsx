import { useState } from "react";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { Link } from "./Link";
import { PageHeading } from "./LearningPages";
export function HelpPage({
  ready,
  reduceMotion,
  setReduceMotion,
  resetLearning,
}: {
  ready: boolean;
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
  resetLearning: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false),
    [resetDone, setResetDone] = useState(false);
  return (
    <div className="as-page as-help-page">
      <PageHeading
        eyebrow="VISITOR INFORMATION"
        title="按你的节奏，探索展馆。"
        description="需要什么、怎样学、卡住了怎么办。关于机械展馆的说明，都在这里。"
      />
      <div className="as-help-columns">
        <div>
          <section>
            <h2>你只需要一颗普通三阶魔方</h2>
            <p>
              不用蓝牙连接，也不用注册。课程示例采用白黄相对的配色；如果你的配色不同，请以自己魔方的中心确定每一块的家。
            </p>
            <p>
              屏幕里的魔方是教学示例，不会自动知道你手里的状态。先按提示拿好魔方，再根据实物选择情形、完成检查。
            </p>
          </section>
          <section>
            <h2>一次学一件事</h2>
            <p>
              先看目标，选择情形，再跟着逐步转。演示可以暂停、后退、循环和放慢；转错一步且知道错在哪里，可以逆转退回。不要为了追上动画连续补不确定的动作。
            </p>
            <p>
              入门课翻黄面时，前两层暂时变乱属于方法的一部分。先读完整说明，固定正面、整组操作，四个位置检查一圈后再判断结果。
            </p>
            <Link to="/learn" className="as-text-link">
              回到学习路线
              <ArrowUpRight size={16} />
            </Link>
          </section>
          <section>
            <h2>需要先还原手里的魔方</h2>
            <p>
              还原工具支持六面照片、相机取景与手动颜色录入。先核对识别结果，再计算；它提供的是现有的分阶段解法，与入门课程的逐层教学步骤不完全相同。
            </p>
            <p>
              相机不可用时，可以上传相册照片，或在展开图上直接改色。识别和计算在当前设备进行，照片不会为此上传。
            </p>
            <Link to="/solve" className="as-text-link">
              打开还原工具
              <ArrowUpRight size={16} />
            </Link>
          </section>
          <section>
            <h2>内容与演示的来源</h2>
            <p>
              课程讲解与情形组织由 AXIS 编写。完整 CFOP 库保留 GAN 原表的 41 /
              57 / 21
              个编号；识别图重新绘制，并独立核对色块、方向和应保持的层。公式属于学习方法，不代表与其他品牌存在合作或关联。
            </p>
            <div className="as-source-links">
              <a
                href="https://www.gancube.com/pages/layer-by-layer-guide-of-gancube"
                target="_blank"
                rel="noreferrer"
              >
                GAN 层先法参考
                <ArrowUpRight size={14} />
              </a>
              <a href="https://jperm.net/3x3" target="_blank" rel="noreferrer">
                J Perm 入门参考
                <ArrowUpRight size={14} />
              </a>
              <a
                href="https://jperm.net/3x3/cfop"
                target="_blank"
                rel="noreferrer"
              >
                J Perm 简化 CFOP
                <ArrowUpRight size={14} />
              </a>
              <a
                href="https://www.cubeskills.com/tutorials/f2l"
                target="_blank"
                rel="noreferrer"
              >
                CubeSkills F2L
                <ArrowUpRight size={14} />
              </a>
            </div>
            <p>
              机械手用于动作观察。模型和软件依赖的许可见工作台说明；机械演示不等同于实体机器人执行验证。
            </p>
          </section>
        </div>
        <aside>
          <section className="as-settings">
            <span className="as-eyebrow">MAKE IT COMFORTABLE</span>
            <h2>按你的节奏</h2>
            <label className="as-setting-toggle">
              <span>
                <strong>减弱动效</strong>
                <small>
                  展台切换直接到位，文字停止入场动画；手动教学演示仍可使用，也会尊重设备设置。
                </small>
              </span>
              <input
                type="checkbox"
                disabled={!ready}
                checked={reduceMotion}
                onChange={(event) => setReduceMotion(event.target.checked)}
              />
            </label>
          </section>
          <section className="as-settings">
            <span className="as-eyebrow">YOUR PROGRESS, HERE</span>
            <h2>学习进度与数据</h2>
            <p>
              学习记录保存在这台设备。旧版完成状态作为历史保留，新版判断与变式另行记录。网站和手机应用分别保存，暂不跨设备同步。清除浏览器数据或卸载应用，可能移除这些记录。
            </p>
            <p>
              课程练习不会覆盖还原工具里的魔方局面、照片录入草稿或跟做进度。重要魔方局面仍可在工作台下载保存。
            </p>
            {!confirmReset ? (
              <button
                className="as-text-link"
                disabled={!ready}
                onClick={() => {
                  setConfirmReset(true);
                  setResetDone(false);
                }}
              >
                <RotateCcw size={15} />
                重新开始课程
              </button>
            ) : (
              <div className="as-reset-confirm">
                <p>
                  这会重置旧版课程历史，以及新版 20
                  课的判断、变式和实物确认记录。保存的魔方局面和照片录入草稿会保留。
                </p>
                <div>
                  <button
                    className="as-button"
                    disabled={!ready}
                    onClick={() => {
                      resetLearning();
                      setConfirmReset(false);
                      setResetDone(true);
                    }}
                  >
                    清空课程进度
                  </button>
                  <button
                    className="as-text-link"
                    onClick={() => setConfirmReset(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            {resetDone && (
              <p role="status" className="as-saved-note">
                本次课程已从头开始。保存状态请留意页面提示。
              </p>
            )}
          </section>
          <section className="as-settings">
            <h2>用手机跟做</h2>
            <p>
              把手机靠稳，留出双手转动魔方。先看一组，再暂停自己做；需要改变屏幕里的观察角度时，打开“旋转视角”。
            </p>
            <p>
              离开课程页会暂停演示，回来后从已记住的动作继续。重要的是每一步转准，不必追赶动画。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

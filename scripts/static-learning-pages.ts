import type { Plugin } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ACADEMY_LESSONS as LESSONS } from "../src/learning/academy.ts";

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const list = () => `<ol>${LESSONS.map(lesson => `<li><a href="/learn/${lesson.id}">${escape(lesson.title)}</a><p>${escape(lesson.summary)}</p></li>`).join("")}</ol>`;
const frame = (body: string) => `<div class="axis-site"><main class="as-page"><nav aria-label="网站导航"><a href="/">AXIS 首页</a> · <a href="/learn">开始学习</a> · <a href="/solve">还原魔方</a> · <a href="/library">公式与指法</a></nav>${body}<p>三维演示和学习进度需要开启 JavaScript。</p></main></div>`;
const home = frame(`<h1>把每一步看清楚。</h1><p>准备一颗普通三阶魔方，逐步观察、跟做，完成你的第一次还原。无需智能魔方，无需注册。</p><a href="/learn/${LESSONS[0].id}">开始第一课</a><h2>20 课，走完一颗魔方</h2>${list()}`);
const wrap = (body: string) => `<div id="root"><!--axis-static:start-->${body}<!--axis-static:end--></div>`;
function page(template: string, title: string, description: string, body: string) {
  return template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)} · AXIS</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?\s*>/, `<meta name="description" content="${escape(description)}"/>`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?\s*>/, `<meta property="og:title" content="${escape(title)} · AXIS"/>`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?\s*>/, `<meta property="og:description" content="${escape(description)}"/>`)
    .replace(/<div id="root"><!--axis-static:start-->[\s\S]*?<!--axis-static:end--><\/div>/, wrap(body));
}

export function staticLearningPages(): Plugin {
  return {
    name: "axis-static-learning-pages", apply: "build",
    transformIndexHtml: { order: "post", handler: html => html.replace('<div id="root"></div>', wrap(home)) },
    async writeBundle(options) {
      const root = resolve(options.dir ?? "dist");
      const template = await readFile(join(root, "index.html"), "utf8");
      const pages = [{ path: "learn", title: "完整三阶魔方入门课程", description: "从认识魔方到独立还原，首次还原、六单元直观 F2L、10+6 简化顶层与指法补充。", body: frame(`<h1>走完你的第一颗魔方。</h1><p>按顺序学习，也可以回到卡住的那一步。</p>${list()}`) },
        ...LESSONS.map(lesson => ({ path: `learn/${lesson.id}`, title: lesson.title, description: lesson.goal,
          body: frame(`<p>第 ${lesson.number} 课 / 共 20 课</p><h1>${escape(lesson.title)}</h1><p>${escape(lesson.goal)}</p><h2>开始前</h2>${lesson.prepare.map(text => `<p>${escape(text)}</p>`).join("")}${lesson.cases.map(example => `<section><h2>${escape(example.title)}</h2><p>${escape(example.when)}</p><p>摆法：${escape(example.orientation)}</p><p><code>${escape(example.algorithm.replaceAll("'", "′"))}</code></p>${example.explanation.map(text => `<p>${escape(text)}</p>`).join("")}<p>完成后检查：${escape(example.check)}</p></section>`).join("")}<h2>现在，换你来</h2><p>${escape(lesson.practice)}</p><a href="/learn">查看完整学习路线</a>`),
        }))];
      for (const item of pages) {
        const directory = join(root, item.path); await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "index.html"), page(template, item.title, item.description, item.body));
      }
    },
  };
}

// Netlify Functions v2 适配版：与 Vercel 版 api/chat.js 逻辑一致
// 环境变量名相同：DEEPSEEK_API_KEY
// 通过 config.path 映射到 /api/chat，前端代码无需任何修改
// v3：JSON 结构化输出（支持原文溯源/Top3/剧本流/单条微调）

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const apiKey = Netlify.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) {
    return Response.json({ error: '未配置 DEEPSEEK_API_KEY 环境变量' }, { status: 500 });
  }

  let messages, tone;
  try {
    ({ messages, tone } = await req.json());
  } catch {
    return Response.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: '缺少 messages 参数' }, { status: 400 });
  }
  if (messages.length > 40) {
    return Response.json({ error: '对话轮数过多' }, { status: 400 });
  }
  const totalLen = messages.reduce((s, m) => s + (m.content || '').length, 0);
  if (totalLen > 200000) {
    return Response.json({ error: '输入内容过长' }, { status: 400 });
  }

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: buildSystemPrompt(tone) }, ...messages],
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('DeepSeek API error:', r.status, errText);
      return Response.json({ error: '模型服务返回错误：' + r.status }, { status: r.status });
    }

    const data = await r.json();
    return Response.json(data);
  } catch (e) {
    console.error('Request failed:', e);
    return Response.json({ error: '服务端请求失败：' + e.message }, { status: 500 });
  }
};

export const config = { path: '/api/chat' };

const TONE_DIRECTIVES = {
  neutral: '',
  empathetic: `\n\n# 本次语气要求：共情模式
每条追问前可先简短承接受访者处境（如"听起来跑单的时间很不固定，那……"），再引出问题。承接语必须中性：不得暗示任何候选答案、不得评价或安慰过度。`,
  direct: `\n\n# 本次语气要求：直接模式
问句简短直接、直指要点，不加铺垫语（如"你一天到底跑几个小时？"）。仍须保持中性非导向，不得预设答案。`
};

function buildSystemPrompt(tone) {
  return SYSTEM_PROMPT + (TONE_DIRECTIVES[tone] || '');
}

const SYSTEM_PROMPT = `你是"sk小问"，一款面向社会调查课程学生的二次访谈追问生成助手。

# 任务
用户会提供：(1) 对某位访谈对象的初次访谈整理文本；(2) 研究目标。你需要生成对该对象进行下一次访谈时可用的追问清单。若缺少初访文本或研究目标，在 JSON 的 reminders 字段中礼貌请求补齐，其余字段给空值，不要凭空生成。

# 输出格式（最高优先级：必须只输出一个合法 JSON 对象，不得输出任何解释文字或代码块标记）
{
  "top3": [ { "reason": "为什么必问（必须直接指向研究目标）", "question": "追问原文" } ],
  "issues": [
    { "topic": "议题名（如：工作时间）",
      "quote": "原文摘录（保留受访者原有措辞，已匿名化）",
      "keywords": ["quote 中出现的核心词，1~3个"],
      "diagnosis": "为什么值得追问（一句话）",
      "questions": [ { "text": "追问文本", "type": "澄清|详述|举例|对比|深挖|空字符串", "situation": "前后矛盾|回答模糊|过于简短|答非所问|数字时间不清|未展开" } ]
    }
  ],
  "gaps": [ { "dimension": "研究目标中初访完全未涉及的维度", "question": "配1条追问" } ],
  "skipped": [ { "topic": "跳过的话题", "reason": "拒答/敏感/与目标无关" } ],
  "script": [ { "phase": "破冰/日常", "content": "开场白或该阶段的追问串" }, { "phase": "切入核心", "content": "..." }, { "phase": "收尾", "content": "..." } ],
  "alerts": ["高风险群体提醒等伦理提示，没有则为空数组"],
  "tips": "非提问式追问技术（停顿10~15秒、重复问题、重复原话）+ 不知道/不愿回答的应对话术",
  "next_step": "下一步建议，不超过50字",
  "reminders": "拒答权+录音同意提醒；信息不足时在此请求补齐"
}

# 生成规则
1. issues 是主体：通读初访文本，逐段找出真实存在的问题点，来源只有三类——表述模糊（如"差不多""有时候"）、前后矛盾（与自身其他说法不一致）、未展开（提到了却没细节、没例子、没原因）。只记录确实存在的问题，找不到就给空数组；严禁凑数。
2. quote 必须是初访文本中真实存在的连续片段（逐字摘录，便于前端高亮定位），不得改写、不得拼接不同位置的话；引用前对能识别个人身份的信息（姓名、电话、住址等）一律匿名化。
3. keywords 从 quote 中选取原词，用于前端加粗提示。
4. type 只是标签不是骨架：某条追问若不属于任何类型，type 给空字符串，不必强行归类。
5. top3 从全部追问中挑出 2~3 条与研究目标关系最紧密、最优先的，reason 说明理由；不足 2 条可少给。
6. gaps 对照研究目标列出初访未覆盖的维度；没有就给空数组。
7. script 把所有追问按真实访谈的时间线重新排列：先破冰/日常 → 切入核心议题 → 深挖细节 → 收尾，每条 content 是该阶段自然串联起来的追问（可整合多条）。
8. 用户已明确表示"不想说/不愿回答"的话题，不生成任何形式的追问（包括开放式），放入 skipped 并注明原因。
9. 清单与全文一律不得出现受访者真实姓名，统一用"受访者"指代。

# 追问技术规范（源自 RAND L.A.FANS 访谈员培训手册）
1. situation 如实标注适用情形，方便用户在访谈现场判断何时使用。
2. 追问措辞一律中性、非导向，不暗示任何候选答案；优先使用规范话术，如"你指的是什么？""能举个例子吗？""能更具体一点吗？"
3. 数字或时间模糊的回答，追问具体数值或单一最佳估计；二次访谈沿用与初访一致的核心问法，仅在信息缺口处追问。

# 微调规则（用户在生成后要求调整时）
- 全局调整（如"去掉所有关于家庭的问题""语气再委婉一点"）：基于当前 JSON 修改后返回完整 JSON，未涉及的字段保持原样。
- 单条调整（用户提供某条追问原文并要求"换个问法"或"切换语气"）：只修改该条追问，其余内容一律保持不变，返回完整 JSON。

# 伦理红线（依据研究伦理审查要点，优先级高于其他所有规则）
1. 不生成打探与研究目标无关的个人隐私或敏感话题（恋爱与性、家庭矛盾、收入细节、健康状况、宗教信仰、政治倾向等）的追问；无法确定相关性时，改为开放式提问并在 situation 中标注"敏感话题请确认知情同意"。
2. 不生成诱导性提问，不预设"标准答案"，不以强制、利诱方式获取回答；语气切换（共情/直接）也不得违反本条。
3. 不生成可能使受访者被贴标签、污名化或感到被冒犯的提问。
4. 若初访文本显示受访者可能是未成年人、身心障碍者、判断能力受限的高龄者，或与研究者存在权力关系（师生、雇佣），须在 alerts 中提醒：该群体属高风险研究对象，追问应保守并需额外的知情同意与保护程序。
5. reminders 中固定包含：受访者可拒答任何问题或随时退出；录音录像需事先单独征得同意。
6. 若用户上传的文本含明显个人隐私（真实姓名、电话等），在 alerts 中提醒脱敏。`;

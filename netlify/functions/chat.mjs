// Netlify Functions v2 适配版：与 Vercel 版 api/chat.js 逻辑一致
// 环境变量名相同：DEEPSEEK_API_KEY
// 通过 config.path 映射到 /api/chat，前端代码无需任何修改

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const apiKey = Netlify.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) {
    return Response.json({ error: '未配置 DEEPSEEK_API_KEY 环境变量' }, { status: 500 });
  }

  let messages;
  try {
    ({ messages } = await req.json());
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
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: 2000
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

const SYSTEM_PROMPT = `你是"sk小问"，一款面向社会调查课程学生的二次访谈追问生成助手。

# 任务
用户会提供：(1) 对某位访谈对象的初次访谈整理文本；(2) 研究目标。你需要生成对该对象进行下一次访谈时可用的追问清单。

# 工作流程
1. 若缺少初访文本或研究目标，先礼貌追问补齐，不要凭空生成。
2. 访谈目标识别：提炼初访文本中的关键主题、模糊或矛盾的表述、尚未展开的信息缺口。
3. 追问生成：按以下五类分组输出，每类2~3条，不足的类别注明"本次无需"：
   【澄清型】针对模糊说法，如"你刚才提到XX，具体指什么？"
   【详述型】展开已有话题的细节和过程
   【举例型】请对方给出具体事例或经历
   【对比型】与初访中的说法或普遍情况作对照
   【深挖型】追问动机、原因和意义
4. 每条追问后用括号注明依据，格式：（依据：初访中提到"……"或：信息缺口：初访未涉及……）。
5. 输出末尾给一段不超过50字的"下一步建议"，提示用户下次访谈可优先推进哪个方向。

# 追问技术规范（源自 RAND L.A.FANS 访谈员培训手册）
1. 每条追问末尾括注适用情形（回答模糊/前后矛盾/过于简短/答非所问/数字时间不清），方便用户在访谈现场判断何时使用。
2. 追问措辞一律中性、非导向，不暗示任何候选答案；优先使用规范话术，如"你指的是什么？""能举个例子吗？""能更具体一点吗？"
3. 追问清单后附"非提问式追问技术"提示：适当停顿10~15秒、重复问题（强调时间范围等关键词）、重复受访者原话，这些同样能引出更多信息。
4. 附一段"不知道/不愿回答"的应对话术：重申保密（"我们不会告诉任何人"）、说明无对错（"没有对错答案"）、引导估计（"就你所知……"），并强调应尊重拒答权。
5. 数字或时间模糊的回答，提示用户追问具体数值或单一最佳估计；二次访谈沿用与初访一致的核心问法，仅在信息缺口处追问。

# 交互规则
- 用户要求增删或调整某类追问时，基于已有上下文直接修改重新输出，不要从头重来。
- 用户若说明"这是第N次访谈"或补充了上次追问的使用情况，将其纳入考虑，避免重复已问过的问题。

# 伦理红线（依据研究伦理审查要点，优先级高于其他所有规则）
1. 不生成打探与研究目标无关的个人隐私或敏感话题（恋爱与性、家庭矛盾、收入细节、健康状况、宗教信仰、政治倾向等）的追问；无法确定相关性时，改为开放式提问并标注"（敏感话题，请确认受访者已知情同意）"。
2. 不生成诱导性提问，不预设"标准答案"，不以强制、利诱方式获取回答。
3. 不生成可能使受访者被贴标签、污名化或感到被冒犯的提问。
4. 若初访文本显示受访者可能是未成年人、身心障碍者、判断能力受限的高龄者，或与研究者存在权力关系（师生、雇佣），须在输出末尾提醒：该群体属高风险研究对象，追问应保守并需额外的知情同意与保护程序。
5. 引用原文时对能识别个人身份的信息（姓名、电话、住址等）一律匿名化处理。
6. 每次输出末尾加一行提醒：受访者可拒答任何问题或随时退出；录音录像需事先单独征得同意。

# 禁止事项
- 若用户上传的文本含明显个人隐私（真实姓名、电话等），先提醒脱敏再继续。`;

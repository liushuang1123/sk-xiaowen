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
2. 通读初访文本，逐段找出真实存在的问题点，来源只有三类：
   - 表述模糊：说不清、含糊（如"差不多""有时候"）
   - 前后矛盾：与自身其他说法或上下文不一致
   - 未展开：提到了却没给细节、没给例子、没说明原因
   只记录文本中确实存在的问题，找不到就不写；严禁为了凑类型或凑数量凭空造问题。
3. 对照研究目标，列出初访完全未涉及的维度，单列为"目标缺口"。
4. 每个问题点生成1~2条追问，标注（类型：澄清/详述/举例/对比/深挖｜适用：模糊/矛盾/未展开）。类型只是标签，不是骨架：某条追问若不属于任何类型，可只写适用情形，不必强行归类。
5. 输出按以下结构组织：
   ① 首行脱敏提醒（固定）
   ② 文本中的问题点（主体）：按议题分组，每个问题点写三层——原文摘录 → 诊断（为什么值得追问）→ 追问1~2条（带类型与适用情形标注）
   ③ 目标缺口追问：研究目标中初访未涉及的维度，各配1条追问
   ④ 本次跳过的话题：拒答、敏感、与目标无关的内容，注明跳过原因
   ⑤ 手法自检（一行）：五类手法各用几次、哪类偏少，只提示不补凑数条目
   ⑥ 现场提示：非提问式追问技术（停顿10~15秒、重复问题、重复原话）+ "不知道/不愿回答"应对话术
   ⑦ 下一步建议（不超过50字）
6. 清单标题与全文一律不得出现受访者真实姓名，统一用"受访者"代替；引用原文时保留原有措辞便于对照。
7. 用户已明确表示"不想说/不愿回答"的话题，不再生成任何形式的追问（包括开放式），直接跳过并在④中注明。

# 追问技术规范（源自 RAND L.A.FANS 访谈员培训手册）
1. 每条追问末尾括注适用情形（回答模糊/前后矛盾/过于简短/答非所问/数字时间不清），方便用户在访谈现场判断何时使用。
2. 追问措辞一律中性、非导向，不暗示任何候选答案；优先使用规范话术，如"你指的是什么？""能举个例子吗？""能更具体一点吗？"
3. 数字或时间模糊的回答，提示用户追问具体数值或单一最佳估计；二次访谈沿用与初访一致的核心问法，仅在信息缺口处追问。

# 交互规则
- 用户要求调整、增删追问时，基于已有上下文直接修改重新输出，不要从头重来。
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

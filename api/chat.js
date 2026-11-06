// Vercel Serverless Function：转发 DeepSeek API 请求
// API Key 存放在 Vercel 环境变量 DEEPSEEK_API_KEY 中，不会暴露给浏览器

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '未配置 DEEPSEEK_API_KEY 环境变量' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '缺少 messages 参数' });
  }

  // 简单防滥用：限制上下文长度和输入体量
  if (messages.length > 40) {
    return res.status(400).json({ error: '对话轮数过多' });
  }
  const totalLen = messages.reduce((s, m) => s + (m.content || '').length, 0);
  if (totalLen > 200000) {
    return res.status(400).json({ error: '输入内容过长' });
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
      return res.status(r.status).json({ error: '模型服务返回错误：' + r.status });
    }

    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    console.error('Request failed:', e);
    return res.status(500).json({ error: '服务端请求失败：' + e.message });
  }
}

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

# 交互规则
- 用户要求增删或调整某类追问时，基于已有上下文直接修改重新输出，不要从头重来。
- 用户若说明"这是第N次访谈"或补充了上次追问的使用情况，将其纳入考虑，避免重复已问过的问题。

# 禁止事项
- 不生成诱导性提问，不预设"标准答案"。
- 不生成涉及隐私或敏感个人信息的追问。
- 若用户上传的文本含明显个人隐私（真实姓名、电话等），先提醒脱敏再继续。`;

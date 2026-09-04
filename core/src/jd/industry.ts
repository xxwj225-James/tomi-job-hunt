/**
 * Industry detection for prompt role injection — figures out which industry a
 * JD + resume belong to so each prompt can tell the LLM it should act as a
 * headhunter / advisor / interviewer specialised in THAT industry (game vs
 * finance vs healthcare recruiters talk and probe very differently).
 *
 * Pure rule-based: a keyword dictionary, zero cost, deterministic, unit-testable.
 * MISSES are fine — callers fall back to the generic role when this returns ''.
 *
 * RULE ORDER IS PRIORITY: specific industries sit before generic tech so a
 * "游戏引擎" JD lands in 游戏, not 互联网·软件. Keep this array in sync with
 * the verbatim copies in extension/src/direct/industry.ts and hr/src/industry.ts.
 */

export type Industry = string;

/** Ordered [matcher, industryName] rules. First match wins. */
export const INDUSTRY_RULES: Array<[RegExp, string]> = [
  // 游戏 — most specific, must precede 互联网·软件（裸「游戏」足以指向游戏行业）
  [/游戏引擎|游戏策划|游戏开发|手游|端游|游戏测试|游戏运营|游戏公司|游戏行业|游戏项目|关卡|unity|unreal|cocos|gameplay|游戏/i, '游戏'],
  // 医疗 — 医疗/医药 keywords
  [/医疗|医院|医药|制药|生物医药|临床试验|医疗器械|大健康|医生|护士|护理|口腔|中医/i, '医疗'],
  // 金融 — 金融/支付/风控/量化等（风控须先于网络安全）
  [/金融|银行|证券|基金|保险|支付|风控|量化|投行|券商|期货|信贷|财富管理|投资顾问/i, '金融'],
  // 汽车 — 先于制造/能源/硬件（新能源汽车、汽车电子归汽车）
  [/汽车|整车|自动驾驶|智能驾驶|车联网|车载|新能源汽车|汽车电子|车辆工程/i, '汽车'],
  // 硬件·芯片 — 先于制造/互联网
  [/芯片|半导体|fpga|嵌入式|集成电路|ic设计|单片机|电路设计|硬件工程|电子工程|晶圆|光刻/i, '硬件·芯片'],
  // 云计算·DevOps — 只用强行业信号（K8s/Docker 常见于后端岗，不单列）
  [/云计算|云原生|devops|sre|运维开发|容器云|阿里云|\baws\b|\bazure\b|混合云|k8s\s*运维/i, '云计算·DevOps'],
  // 网络安全 — 先于 AI（AI 安全 / 大模型安全归安全）
  [/网络安全|信息安全|渗透测试|攻防|漏洞挖掘|安全工程师|安全研究|蓝队|红队|等保|应急响应/i, '网络安全'],
  // AI·大数据
  [/人工智能|大模型|机器学习|深度学习|自然语言处理|\bnlp\b|计算机视觉|推荐算法|数据挖掘|大数据|算法工程师|\baigc\b|图像识别|语音识别|数据分析师/i, 'AI·大数据'],
  // 电商·零售 — 先于互联网（电商开发岗位归电商，懂支付/大促/商品域）
  [/电商|跨境电商|直播带货|网店|淘宝|拼多多|京东运营|商品运营|零售|新零售|买手|o2o/i, '电商·零售'],
  // 教育
  [/教育培训|在线教育|教师|讲师|教研|课程设计|k12|家教|留学|雅思|托福/i, '教育'],
  // 物流
  [/物流|快递|仓储|货运|配送|运输|关务|报关|供应链管理|货代/i, '物流'],
  // 能源
  [/能源|电力|光伏|风电|储能|锂电池|电池研发|石油|天然气|核电|电网/i, '能源'],
  // 文化传媒
  [/传媒|广告投放|新媒体|短视频|内容运营|mcn|编剧|出版|记者|公关|品牌营销|影视/i, '文化传媒'],
  // 制造·工业 — 先于互联网（机械/产线/质量岗归工业）
  [/制造|工厂|生产线|生产管理|质检|质量工程|工业工程|机械设计|模具|注塑|精益生产|工艺工程/i, '制造·工业'],
  // 互联网·软件 — 通用技术兜底，放最后
  [/互联网|软件|前端|后端|全栈|开发工程师|测试工程|产品经理|项目经理|saas|java|python|react|vue|数据库/i, '互联网·软件'],
];

/**
 * Detects the industry from JD title + requirements + resume text.
 * Returns the industry name (e.g. "游戏") or '' when nothing matches.
 */
export function detectIndustry(text: string): string {
  for (const [re, industry] of INDUSTRY_RULES) {
    if (re.test(text)) return industry;
  }
  return '';
}

/** True when a JD + resume resolve to an industry (else keep generic role). */
export function hasIndustry(jd: { title: string; requirements: string }, resume?: string): boolean {
  return detectIndustry(`${jd.title} ${jd.requirements} ${resume ?? ''}`) !== '';
}

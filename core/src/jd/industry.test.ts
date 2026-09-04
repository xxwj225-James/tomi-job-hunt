import { describe, expect, it } from 'vitest';
import { detectIndustry, hasIndustry } from './industry.js';

describe('detectIndustry', () => {
  it('returns "" for text with no industry signals', () => {
    expect(detectIndustry('销售经理 负责渠道拓展')).toBe('');
    expect(detectIndustry('')).toBe('');
  });

  it('detects specific industries from JD keywords', () => {
    expect(detectIndustry('资深游戏引擎开发 Unity 手游')).toBe('游戏');
    expect(detectIndustry('银行后端 支付系统 风控')).toBe('金融');
    expect(detectIndustry('医疗信息管理系统 医院实施')).toBe('医疗');
    expect(detectIndustry('自动驾驶算法 智能驾驶')).toBe('汽车');
    expect(detectIndustry('芯片验证 FPGA 嵌入式')).toBe('硬件·芯片');
    expect(detectIndustry('渗透测试 攻防 安全工程师')).toBe('网络安全');
    expect(detectIndustry('大模型算法 推荐系统')).toBe('AI·大数据');
    expect(detectIndustry('电商运营 双11 大促')).toBe('电商·零售');
    expect(detectIndustry('高中数学教师 教研')).toBe('教育');
    expect(detectIndustry('物流调度 仓储 配送')).toBe('物流');
    expect(detectIndustry('光伏电站 储能 电力')).toBe('能源');
    expect(detectIndustry('短视频运营 MCN 内容')).toBe('文化传媒');
    expect(detectIndustry('精益生产 质量工程 工厂')).toBe('制造·工业');
  });

  it('respects rule priority: specific industry wins over generic tech', () => {
    // 游戏引擎 must land in 游戏, not 互联网·软件
    expect(detectIndustry('游戏引擎开发工程师 熟悉 C++ Unity')).toBe('游戏');
    // AI 安全 → 网络安全 (网络安全 before AI)
    expect(detectIndustry('大模型安全 攻防研究员')).toBe('网络安全');
    // 新能源汽车 → 汽车 (汽车 before 能源)
    expect(detectIndustry('新能源汽车 电池 BMS 研发')).toBe('汽车');
    // 电商后端 → 电商 (电商 before 互联网)
    expect(detectIndustry('资深电商前端 大促 秒杀')).toBe('电商·零售');
    // 金融开发 → 金融 (金融 before 互联网)
    expect(detectIndustry('量化交易开发 Python')).toBe('金融');
  });

  it('detects industry from the resume when the JD is generic', () => {
    const text = '后端工程师 熟悉 Java' + ' 之前在一家游戏公司做过 5 年，负责英雄联盟相关项目';
    expect(detectIndustry(text)).toBe('游戏');
  });

  it('falls back to internet/software for generic tech roles', () => {
    expect(detectIndustry('高级后端工程师 熟悉 Java、Redis、K8s')).toBe('互联网·软件');
    expect(detectIndustry('前端开发 React Vue')).toBe('互联网·软件');
  });
});

describe('hasIndustry', () => {
  const jd = { title: '资深Java开发', requirements: '熟悉 Redis、K8s' };

  it('is true when JD+resume resolve to an industry', () => {
    expect(hasIndustry(jd, '# 张三\n- 曾在券商做交易系统')).toBe(true);
    expect(hasIndustry({ title: '游戏关卡策划', requirements: '' })).toBe(true);
  });

  it('is false when nothing matches', () => {
    expect(hasIndustry({ title: '销售', requirements: '渠道拓展' })).toBe(false);
  });
});
